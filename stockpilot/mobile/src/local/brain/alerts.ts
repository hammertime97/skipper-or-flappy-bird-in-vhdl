/**
 * Smart alerts: the app watches the numbers and says what needs the seller, before they ask.
 * Also builds the Monday digest and the "order today" reminders the phone schedules.
 */
import { change, changeWord, DAY, dayLabel, Facts, fmtMoney, fmtNum, inDays, perWeek, plural } from './facts';
import type { LeakReport } from './leaks';

export type Severity = 'urgent' | 'warning' | 'good' | 'info';

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  product_id: number | null;
  /** Where the alert's button goes. */
  action: { label: string; href: string } | null;
}

export interface Reminder {
  /** ISO date (the day to order). */
  date: string;
  title: string;
  body: string;
}

export interface AlertReport {
  items: Alert[];
  counts: Record<Severity, number>;
  digest: { title: string; body: string };
  reminders: Reminder[];
}

const BIG = new Set(['Black Friday', 'Cyber Monday', 'Christmas', "Valentine's Day", "Mother's Day (UK)", "Mother's Day (US)", "Father's Day (US & UK)", "Singles' Day (11.11)", 'Boxing Day']);

export function findAlerts(f: Facts, leaks: LeakReport | null): AlertReport {
  const now = f.now, m = (v: number) => fmtMoney(v, f.cur), today = new Date(now).toISOString().slice(0, 10), out: Alert[] = [];
  const add = (a: Omit<Alert, 'product_id'> & { product_id?: number | null }) => out.push({ product_id: null, ...a });
  const product = (id: number) => ({ label: 'Open product', href: `/product/${id}` });
  const tracked = f.F.items.filter((it) => !it.locked && it.stock_plan && it.forecast);

  // Stock: sold out, order today, order in the next few days.
  const soldOut = tracked.filter((it) => it.stock_plan!.status === 'out_of_stock' && it.forecast!.next_week > 0.3);
  for (const it of soldOut.slice(0, 5)) {
    add({
      id: `out:${it.product.id}`, severity: 'urgent', product_id: it.product.id,
      title: `${it.product.name} is sold out`,
      body: `Customers buy about ${perWeek(it.forecast!.next_week)}. Order ${fmtNum(it.stock_plan!.reorder_qty)}${it.product.supplier ? ` from ${it.product.supplier}` : ''} now.`,
      action: { label: 'Supplier orders', href: '/orders' },
    });
  }
  if (soldOut.length > 5) add({ id: 'out:more', severity: 'urgent', title: `${plural(soldOut.length - 5, 'more product')} sold out`, body: 'All of them are in Supplier orders, ready to send.', action: { label: 'Supplier orders', href: '/orders' } });
  const orderToday = tracked.filter((it) => it.stock_plan!.status === 'reorder_now' && it.stock_plan!.order_by && it.stock_plan!.order_by <= today);
  if (orderToday.length) {
    const cost = orderToday.reduce((x, it) => x + it.stock_plan!.reorder_qty * it.product.cost_price, 0);
    add({
      id: `order-today:${orderToday.map((it) => it.product.id).sort().join(',')}`, severity: 'urgent',
      title: orderToday.length === 1 ? `Order ${orderToday[0].product.name} today` : `Order ${plural(orderToday.length, 'product')} today`,
      body: `${orderToday.slice(0, 3).map((it) => `${fmtNum(it.stock_plan!.reorder_qty)} × ${it.product.name}`).join('; ')}${orderToday.length > 3 ? `; and ${orderToday.length - 3} more` : ''}. Any later and ${orderToday.length === 1 ? 'it runs' : 'they run'} out before the delivery arrives.${cost > 0 ? ` About ${m(cost)} at cost.` : ''}`,
      action: { label: 'Supplier orders', href: '/orders' },
    });
  }
  const soon = tracked.filter((it) => ['reorder_now', 'low'].includes(it.stock_plan!.status) && it.stock_plan!.order_by && it.stock_plan!.order_by > today && Date.parse(it.stock_plan!.order_by) - now <= 4 * DAY);
  if (soon.length) {
    add({
      id: `order-soon:${soon.map((it) => it.product.id).sort().join(',')}`, severity: 'warning',
      title: `${plural(soon.length, 'product')} to order in the next few days`,
      body: soon.slice(0, 3).map((it) => `${it.product.name} by ${dayLabel(it.stock_plan!.order_by!)}`).join('; ') + (soon.length > 3 ? `; and ${soon.length - 3} more.` : '.'),
      action: { label: 'Supplier orders', href: '/orders' },
    });
  }

  // Sales that suddenly fell or took off, product by product (last 7 days against the 4 weeks before).
  const last7 = f.aggBy(now - 7 * DAY, now, (s) => s.pid), prior = f.aggBy(now - 35 * DAY, now - 7 * DAY, (s) => s.pid);
  const drops: { id: number; lost: number; text: string; title: string }[] = [], spikes: Alert[] = [];
  for (const p of f.products) {
    const before = (prior.get(p.id)?.units ?? 0) / 4, nowU = last7.get(p.id)?.units ?? 0;
    if (before >= 5 && nowU <= before * 0.4 && before - nowU >= 4) {
      if (p.stock_known && p.stock_qty <= 0) continue; // that's the sold-out alert
      const price = p.sell_price || (prior.get(p.id)!.revenue / prior.get(p.id)!.units);
      drops.push({
        id: p.id, lost: (before - nowU) * price,
        title: `Sales of ${p.name} fell ${Math.round((1 - nowU / before) * 100)}%`,
        text: `${fmtNum(nowU)} sold in the last 7 days, against about ${fmtNum(before)} a week before. Check the listing is still live and in stock on the platform, the price against competitors, and any new bad review.`,
      });
    } else if (nowU >= 6 && nowU >= Math.max(2, before) * 2) {
      const daysLeft = p.stock_known && nowU > 0 ? Math.floor(p.stock_qty / (nowU / 7)) : null;
      const short = daysLeft != null && daysLeft < Math.max(14, (p.lead_time_days ?? 7) + 3);
      spikes.push({
        id: `spike:${p.id}`, severity: short ? 'warning' : 'good', product_id: p.id,
        title: `${p.name} is taking off`,
        body: `${fmtNum(nowU)} sold in the last 7 days, ${before ? `${(nowU / before).toFixed(1)}× its usual week` : 'up from almost nothing'}.${daysLeft != null ? ` At this pace stock lasts about ${daysLeft} days${short ? ', so order more now' : ''}.` : ''} Push it while it's hot: a short video or a featured spot.`,
        action: product(p.id),
      });
    }
  }
  drops.sort((a, b) => b.lost - a.lost);
  for (const d of drops.slice(0, 3)) add({ id: `drop:${d.id}`, severity: 'warning', product_id: d.id, title: d.title, body: d.text, action: product(d.id) });
  spikes.sort((a, b) => (a.severity === 'warning' ? 0 : 1) - (b.severity === 'warning' ? 0 : 1));
  out.push(...spikes.slice(0, 3));

  // The whole store this week.
  const w = f.agg(now - 7 * DAY, now), pw = f.agg(now - 14 * DAY, now - 7 * DAY), c = change(w.revenue, pw.revenue);
  if (c != null && pw.revenue > 0 && c <= -0.25) {
    add({ id: `store-drop:${today}`, severity: 'warning', title: `Sales are ${changeWord(c)} on last week`, body: `${m(w.revenue)} in the last 7 days against ${m(pw.revenue)} the week before. Ask StockPilot “why did sales drop?” to see which products and channels caused it.`, action: { label: 'Ask why', href: '/ai/assistant?q=why%20did%20sales%20drop%20this%20week' } });
  } else if (c != null && pw.revenue > 0 && c >= 0.25) {
    add({ id: `store-up:${today}`, severity: 'good', title: `Sales are ${changeWord(c)} on last week`, body: `${m(w.revenue)} in the last 7 days against ${m(pw.revenue)} the week before, with ${m(w.profit)} profit after fees.`, action: { label: 'See what grew', href: '/ai/assistant?q=why%20did%20sales%20go%20up%20this%20week' } });
  }

  // Money: from the profit leak finder.
  if (leaks) {
    const losing = leaks.items.filter((l) => l.kind === 'loss');
    if (losing.length) add({ id: `loss:${losing.map((l) => l.product_id).join(',')}`, severity: 'warning', title: losing.length === 1 ? `${losing[0].product_name} loses money on every sale` : `${plural(losing.length, 'product')} lose money on every sale`, body: losing.slice(0, 2).map((l) => l.title).join('. ') + '.', action: { label: 'Profit leaks', href: '/leaks' } });
    const slip = leaks.items.filter((l) => l.kind === 'price_slip');
    if (slip.length) add({ id: `slip:${slip.map((l) => l.product_id).join(',')}`, severity: 'info', title: slip[0].title, body: slip[0].fix, product_id: slip[0].product_id, action: { label: 'Profit leaks', href: '/leaks' } });
    if (leaks.cash_total >= 300) add({ id: `cash:${Math.round(leaks.cash_total / 100)}`, severity: 'info', title: `${m(leaks.cash_total)} is stuck in slow stock`, body: 'Clearing it frees cash for your best sellers. The profit leak finder lists each product with a safe clearance price.', action: { label: 'Profit leaks', href: '/leaks' } });
  }

  // Big shopping days coming up: are the best sellers stocked?
  const ev = f.F.events.find((e) => BIG.has(e.name) && e.in_days <= 35);
  if (ev) {
    const top = [...tracked].sort((a, b) => (b.next_week_revenue ?? 0) - (a.next_week_revenue ?? 0)).slice(0, 10);
    const short = top.filter((it) => it.product.stock_known && it.stock_plan!.stockout_in_days != null && it.stock_plan!.stockout_in_days < ev.in_days + 7);
    add({
      id: `event:${ev.name}:${ev.date}`, severity: short.length ? 'warning' : 'info',
      title: ev.in_days <= 0 ? `${ev.name} is today` : `${ev.name} is ${inDays(ev.in_days)}`,
      body: short.length
        ? `${plural(short.length, 'best seller')} will run out before or during it: ${short.slice(0, 3).map((it) => it.product.name).join(', ')}. Order now: suppliers get slow before big sales.`
        : 'Your best sellers have enough stock for it. Plan your promotion now: list bundles and set discounts a week ahead.',
      action: { label: 'Weekly plan', href: '/ai/weekly-plan' },
    });
  }

  // Set-up gaps that make the advice weaker.
  const unknown = f.products.filter((p) => !p.stock_known).length;
  if (unknown) add({ id: `setup-stock:${unknown}`, severity: 'info', title: `${plural(unknown, 'product')} without a stock count`, body: "Without it we can't warn you before they sell out.", action: { label: 'Add stock counts', href: '/stock-counts?tab=stock' } });

  const rank: Record<Severity, number> = { urgent: 0, warning: 1, good: 2, info: 3 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const counts = { urgent: 0, warning: 0, good: 0, info: 0 } as Record<Severity, number>;
  for (const a of out) counts[a.severity]++;

  // Monday digest: last week in one notification.
  const need = tracked.filter((it) => ['out_of_stock', 'reorder_now', 'low'].includes(it.stock_plan!.status));
  const budget = f.F.store.restock_budget.now;
  const digest = {
    title: `Your week: ${m(w.revenue)} sales${c != null ? `, ${changeWord(c)}` : ''}`,
    body:
      `${m(w.profit)} profit after fees in the last 7 days. ` +
      (need.length ? `${plural(need.length, 'product')} to reorder${budget > 0 ? ` (about ${m(budget)})` : ''}. ` : 'Nothing to reorder. ') +
      (out[0] && out[0].severity !== 'info' ? `Top of the list: ${out[0].title}.` : 'Open your weekly plan for the details.'),
  };

  // "Order today" reminders on the day each order is due (one per day, next 3 weeks).
  const byDay = new Map<string, { name: string; qty: number }[]>();
  for (const it of tracked) {
    const ob = it.stock_plan!.order_by;
    if (!ob || ob <= today || Date.parse(ob) - now > 21 * DAY || !it.stock_plan!.reorder_qty) continue;
    if (!byDay.has(ob)) byDay.set(ob, []);
    byDay.get(ob)!.push({ name: it.product.name, qty: it.stock_plan!.reorder_qty });
  }
  const reminders = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([date, list]) => ({
    date,
    title: list.length === 1 ? `Order ${list[0].name} today` : `Order ${list.length} products today`,
    body: list.slice(0, 3).map((x) => `${fmtNum(x.qty)} × ${x.name}`).join('; ') + (list.length > 3 ? `; and ${list.length - 3} more` : '') + '. Tap to open Supplier orders.',
  }));

  return { items: out, counts, digest, reminders };
}
