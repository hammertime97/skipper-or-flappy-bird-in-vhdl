/**
 * Ask StockPilot: answers questions about the seller's own store on the phone, with no cloud AI.
 * It works out what's being asked (intent), about what (products, a family of similar products,
 * a category, a supplier, a sales channel) and when (any period), answers from the numbers,
 * says how it worked the answer out, and remembers the topic for follow-ups ("and last month?").
 */
import { Engine as E, type LocalProduct, type LocalSale } from '../engine';
import { findAlerts } from './alerts';
import { change, changeWord, DAY, dayLabel, Facts, fmtMoney, fmtNum, fmtPct, inDays, perWeek, plural, type Agg } from './facts';
import { findLeaks } from './leaks';
import { cap, inP, lastNDays, Matcher, normalise, parseCount, parseMetric, parsePeriods, parsePriceChange, previousPeriod, type Metric, type Period, type Target } from './nlu';

export type Intent =
  | 'greet' | 'help' | 'why' | 'whatif' | 'price' | 'leaks' | 'attention' | 'runout' | 'reorder' | 'cash' | 'stockout' | 'dead'
  | 'bundle' | 'forecast' | 'compare' | 'how_doing' | 'weekday' | 'rank' | 'fees' | 'stock_value' | 'channels' | 'trends'
  | 'unsupported' | 'metric' | 'product';

export interface AskContext {
  intent?: Intent;
  target?: { kind: Target['kind']; label: string; ids: number[]; channel?: string } | null;
  channel?: string | null;
  period?: Period | null;
  metric?: Metric | null;
}

export interface Answer {
  text: string;
  /** How the answer was worked out, in plain words. */
  how?: string;
  suggestions: string[];
  links: { label: string; href: string }[];
  ctx: AskContext;
}

const RULES: [Intent, RegExp][] = [
  ['greet', /^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening)|thanks|thank you|thx|cheers|ok|okay|great|cool|nice|awesome|perfect)\b[\s!.,]*(stockpilot|there|a lot|so much|mate)?[\s!.]*$/],
  ['help', /\bwhat can you (do|answer|tell)|\bhelp\b|\bwhat (do|can|should) i ask|\bhow do(es)? (this|you) work|\bwhat do you know/],
  ['unsupported', /\b(customer'?s?'? (names?|emails?|address(es)?)|who (bought|buys|are my customers)|refunds?|returns?\b|reviews?|ratings?|shipping cost|postage cost|ad spend|advertising spend|roas|conversion rate|traffic|page views|visitors)\b/],
  ['why', /\bwhy\b|\bwhat (happened|caused|went wrong|changed)|\bthe reason\b|\bexplain (the|my|why)|\bhow come\b/],
  ['whatif', /\bwhat if\b|\bif i (raise|increase|lower|drop|cut|put|change|charge|sell|discount)|\b(raise|increase|lower|drop|cut|reduce|change) (the |my )?prices?\b|\bput (the )?price (up|down)|\b\d+ ?% (off|discount|more|less|higher|lower|cheaper)/],
  ['price', /\bwhat price|\bwhich price|\bhow much should i (charge|sell|ask|price)|\bwhat (should|do) i (charge|price)|\bprice (should i|to sell|for)|\bwhat to charge|\bunderpriced|\boverpriced|\bright price|\bbest price|\bpricing\b/],
  ['leaks', /\bleak|\blosing money|\blose money|\blost money|\bwhere am i losing|\bwast(e|ing)|\bmoney (going|disappearing)|\bunprofitable|\bat a loss\b|\bbleeding/],
  ['runout', /\bwhen (will|does|is|do)\b.*\b(run out|sell out|be out|out of stock|run low)|\bhow long (will|does|do|until)\b.*\b(last|stock)|\bdays of stock|\bweeks of stock|\bdays left|\bhow much stock (is )?left/],
  ['cash', /\b(cash|budget|money) (do i need|needed|for (re)?stock|for (the )?orders|to restock|to reorder)|\bhow much (will|do|would) (the |my )?(re)?orders? cost|\brestock budget|\bcost to restock/],
  ['reorder', /\breorder|\bre-order|\brestock|\border more|\brunning (low|out)|\brun out|\bbuy more|\bwhat (should|do|must) i (need to )?(order|buy|stock)|\bhow (many|much) (should|do) i (order|buy)|\bstock up|\btop up|\breplenish|\bsupplier orders?|\bwhat to order/],
  ['stockout', /\bout of stock|\bsold out|\bstock-?outs?|\bno stock/],
  ['attention', /\b(needs? (my )?attention|urgent|worry|worried|concern|problems?|issues?|anything wrong|going wrong|alerts?|warnings?|anything (i should|to) (know|do|watch)|what should i (do|focus on|work on)|priorit|to-?do|today'?s? (list|tasks)|focus (on )?(today|this week))\b/],
  ['dead', /\bnot selling|\bdead stock|\bslow(est)?[- ]?(mov|sell)|\bslow sellers?|\bstuck|\btied up|\bclearance|\bclear (out|stock)|\bovers?tock|\btoo much stock|\bget rid of|\bliquidat|\bnot moving|\bnever sold/],
  ['bundle', /\btogether|\bbundles?\b|\bpairs? (well)?|\bcross-?sell|\bupsell|\bfrequently bought/],
  ['forecast', /\bnext (week|month|\d+ weeks|few weeks)|\bforecast|\bpredict|\bexpect(ed)?\b|\bwill i (sell|make|earn)|\bcoming (week|weeks|month)|\bin the future|\bprojection|\bgoing to (sell|make)|\bhow (many|much) will/],
  ['weekday', /\b(best|busiest|worst|quietest|slowest|strongest) (day|days|weekday)|\bwhich day|\bwhat day (of the week|do i sell|sells)|\bday of (the )?week/],
  ['compare', /\bcompar|\bvs\.?\b|\bversus\b|\bdifference between|\bbetter than|\bworse than|\bagainst\b/],
  ['how_doing', /\bhow (am i|are we|is (my|the) (store|shop|business)|did (i|we) do|('?s|is) (it|business|everything|my store|my shop) (going|doing))|\bhow'?s (business|my (store|shop|business)|it going)|\bsummary\b|\boverview\b|\breport\b|\bupdate me\b|\bstatus\b/],
  ['channels', /\b(which|what|best|top|worst) (channel|platform|marketplace|site)|\bwhere (do|did|should) i sell (best|most)|\bby (channel|platform|marketplace)|\bper (channel|platform)|\b(channel|platform|marketplace) (split|breakdown|comparison)/],
  ['rank', /\b(top|best|worst|bottom|most|least|highest|lowest|biggest|smallest|weakest|strongest|leading|popular)\b/],
  ['fees', /\bfees?\b|\bcommission|\bcharges\b/],
  ['stock_value', /\bstock (value|worth)|\bworth of (my )?(stock|inventory)|\binventory (value|worth)|\bvalue of (my )?(stock|inventory)|\bhow much stock (do i have|have i got)|\bunits on hand|\bhow much is my (stock|inventory)/],
  ['trends', /\btrend(ing|s)?\b|\bbooming|\bwhat (else |new )?(should|could|can) i (sell|add|stock)|\bnew products? (to|ideas?)|\bproduct ideas?|\bwhat'?s hot|\bviral|\bwhat to sell/],
  ['metric', /\bhow (much|many)|\bwhat (was|were|is|are) (my|the|our)\b|\btotal\b|\brevenue|\bprofit|\bsales\b|\bsold\b|\bmade\b|\bearn|\bturnover|\btakings|\bmargin|\borders\b|\bunits\b/],
];

const FOLLOW_UP = /^(and|what about|how about|and for|same for|ok,? and|now|also|then|and what about|what of)\b/;
const PRONOUN = /\b(it|its|it's|that one|this one|that product|this product|them|those|these|they)\b/;

function detect(t: string): Intent[] {
  return RULES.filter(([, re]) => re.test(t)).map(([i]) => i);
}

export interface AskTools {
  /** The free plan's product limit, to explain locked products. */
  freeLimit: number;
  proLimit: number;
}

export function ask(question: string, f: Facts, prev: AskContext | null, tools: AskTools): Answer {
  const t = normalise(question);
  const now = f.now, m = (v: number) => fmtMoney(v, f.cur);
  if (!f.products.length) {
    return { text: 'There are no products yet. Import your sales (Account → Import sales or stock) or load a demo store, then ask me anything about them.', suggestions: [], links: [{ label: 'Import sales', href: '/import' }], ctx: {} };
  }
  const match = new Matcher(f);
  const periods = parsePeriods(t, now);
  const metric = parseMetric(t);
  const channelT = match.channel(t);
  const explicitSupplier = /\b(supplier|vendor|from|factory|manufacturer)\b/.test(t);
  let target: Target | null = null;
  const prodT = match.products(t), catT = match.category(t), supT = match.supplier(t);
  if (supT && (explicitSupplier || !prodT)) target = supT;
  else if (catT && (/\bcategor/.test(t) || !prodT || prodT.kind === 'group')) target = catT;
  else if (prodT) target = prodT;

  let intents = detect(t);
  // A follow-up: "and last month?", "what about the yoga mats?", or just "September?".
  const followUp = !!prev?.intent && (FOLLOW_UP.test(t) || (!intents.length && !target && !!(periods.length || channelT)));
  if (prev?.target && !target && PRONOUN.test(t)) target = { ...prev.target, ids: new Set(prev.target.ids) };
  let intent: Intent;
  if (followUp && prev?.intent && (!intents.length || intents.every((i) => i === 'metric' || i === 'compare'))) {
    // A new period after a question that doesn't use periods ("when will it run out?" → "and in September?") means its numbers.
    const timeless = !['metric', 'rank', 'why', 'how_doing', 'compare', 'weekday', 'channels', 'fees', 'forecast'].includes(prev.intent);
    intent = periods.length && timeless ? 'metric' : prev.intent;
    if (!target && prev.target && !channelT) target = { ...prev.target, ids: new Set(prev.target.ids) };
  } else {
    // A few combinations read better as something more specific.
    if (intents.includes('trends') && target && target.kind !== 'category') intents = ['product', ...intents];
    if (intents.includes('compare') && !(periods.length >= 2 || match.pair(t))) intents = intents.filter((i) => i !== 'compare');
    if (intents.includes('rank') && intents.includes('weekday')) intents = ['weekday'];
    if (intents.includes('rank') && (intents.includes('channels') || /\b(channel|platform|marketplace)/.test(t))) intents = ['channels'];
    if (intents.includes('reorder') && intents.includes('runout')) intents = ['runout'];
    intent = intents[0] ?? (target ? 'product' : ('unknown' as Intent));
  }
  const channel = channelT?.channel ?? (followUp && !target ? prev?.channel ?? null : null);
  const period = periods[0] ?? (followUp && !periods.length ? prev?.period ?? null : null);
  const ctx: AskContext = {
    intent, period, metric: metric ?? (followUp ? prev?.metric ?? null : null), channel,
    target: target ? { kind: target.kind, label: target.label, ids: [...target.ids] } : null,
  };
  const A = (text: string, how?: string, suggestions: string[] = [], links: Answer['links'] = []): Answer => ({ text, how, suggestions: suggestions.slice(0, 3), links, ctx });

  // ------------------------------------------------------------ helpers shared by the answers
  const ids = target?.ids ?? null;
  const aggOf = (p: Period): Agg => {
    if (!channel) return f.agg(p.from, p.to, ids);
    return f.aggBy(p.from, p.to, (s) => f.channelOf(s), ids).get(channel) ?? f.agg(0, 0);
  };
  const scope = (): string => {
    const parts: string[] = [];
    if (target) parts.push(target.kind === 'category' ? `${target.label} products` : target.kind === 'supplier' ? `products from ${target.label}` : target.label);
    if (channel) parts.push(`on ${channelLabel(channel)}`);
    return parts.join(' ');
  };
  const forScope = () => (!scope() ? '' : !target && channel ? ` ${scope()}` : ` for ${scope()}`);
  const tracked = f.F.items.filter((it) => !it.locked && it.stock_plan && it.forecast && (!ids || ids.has(it.product.id)));
  const lockedInScope = f.F.items.filter((it) => it.locked && (!ids || ids.has(it.product.id)));
  const lockedNote = () =>
    lockedInScope.length
      ? `\n${plural(lockedInScope.length, 'product')}${ids ? ' here' : ''} ${lockedInScope.length === 1 ? 'is' : 'are'} beyond the ${fmtNum(f.limit)} best sellers your plan forecasts${f.pro ? '' : ` (Pro covers ${fmtNum(tools.proLimit)})`}, so ${lockedInScope.length === 1 ? 'it isn’t' : 'they aren’t'} counted.`
      : '';
  const name = (id: number) => f.byId.get(id)?.name ?? 'a product';
  const single = target?.kind === 'product' ? f.byId.get([...target.ids][0]) ?? null : null;
  const sug = {
    product: (n: string) => [`When will ${short(n)} run out?`, `What price should I charge for ${short(n)}?`, `How did ${short(n)} sell last month?`],
    general: ['What needs my attention?', 'Where am I losing money?', 'Why did sales change this week?'],
  };

  switch (intent) {
    // ---------------------------------------------------------- small talk
    case 'greet': {
      if (/thank|cheers|thx/.test(t)) return A('Any time. Ask me whenever you want a number checked.', undefined, sug.general);
      const al = findAlerts(f, null);
      const urgent = al.counts.urgent + al.counts.warning;
      return A(`Hi! ${urgent ? `${plural(urgent, 'thing needs', 'things need')} your attention today. Ask “what needs my attention?” to see them.` : 'Nothing urgent today.'} You can ask me about sales, profit, stock, reorders, prices or any product by name.`, undefined, urgent ? ['What needs my attention?', ...sug.general.slice(1)] : sug.general);
    }
    case 'help':
      return A(
        'I answer from your own sales, stock, costs and forecasts. For example:\n' +
          list([
            'Sales and profit for any period: “How much profit did I make in October?”',
            'Any product, family or category: “How many water bottles did I sell last month?”',
            'Rankings: “Top 5 products by profit this month”, “worst sellers”',
            'Comparisons: “This month vs last month”, “Compare the black and the white earbuds”',
            'Reasons: “Why did sales drop this week?”',
            'Stock: “What should I reorder?”, “When will the yoga mat run out?”',
            'Prices: “What if I raise the price of the chopper by 10%?”',
            'Money: “Where am I losing money?”, “What’s not selling?”',
            'The future: “What will I sell next month?”',
          ]),
        'Everything runs on your phone, so it works offline and your data never leaves the device.',
        ['What needs my attention?', 'How is my store doing?', 'Where am I losing money?'],
      );
    case 'unsupported':
      return A(
        "Your sales files don't include that, so I can't answer it truthfully. " +
          (/(return|refund)/.test(t) ? 'Returns and refunds aren’t in most order exports. If a product gets many returns, lower its stock count when they come back and I’ll adjust.' : /(customer|who bought)/.test(t) ? 'I keep no buyer names or contact details (for privacy, they’re dropped on import).' : /(ad|roas|traffic|visitor|conversion|page)/.test(t) ? 'For ads, the Profit & ads calculator shows the most you can spend per sale before you lose money.' : ''),
        undefined,
        ['Where am I losing money?', 'How is my store doing?', 'What should I reorder?'],
        /(ad|roas)/.test(t) ? [{ label: 'Profit & ads calculator', href: '/calculator' }] : [],
      );

    // ---------------------------------------------------------- what needs doing
    case 'attention': {
      const leaks = findLeaks(f, null), al = findAlerts(f, leaks);
      const items = al.items.filter((a) => a.severity !== 'info').slice(0, 6);
      if (!items.length) return A('Nothing urgent. Stock covers the coming weeks, prices cover cost and fees, and no sales have suddenly dropped. A good week to grow your best sellers.', undefined, ['What are my top 5 products by profit?', 'What will I sell next month?', 'What’s trending?']);
      return A(
        `${plural(items.length, 'thing')} worth your attention, most urgent first:\n` + list(items.map((a) => `${a.severity === 'urgent' ? 'Urgent: ' : a.severity === 'good' ? 'Good news: ' : ''}${a.title}. ${a.body}`)),
        'I check every product for sell-outs, order deadlines, sudden drops or spikes in sales, and money leaks, every time you open the app.',
        ['What should I reorder?', 'Where am I losing money?', 'Why did sales change this week?'],
        [{ label: 'All alerts', href: '/alerts' }],
      );
    }
    case 'leaks': {
      const r = findLeaks(f, null);
      if (!r.count) return A(r.headline, r.how, ['What are my lowest-margin products?', 'What’s not selling?', 'How is my store doing?'], [{ label: 'Profit leaks', href: '/leaks' }]);
      const show = r.items.slice(0, f.pro ? 5 : 3);
      return A(
        `${r.headline}\n` + list(show.map((l) => `${l.title}${l.monthly >= 1 ? ` (about ${m(l.monthly)} a month)` : ''}. ${l.fix}`)) +
          (r.count > show.length ? `\n…and ${r.count - show.length} more in the profit leak finder${f.pro ? '' : ' (Pro shows them all)'}.` : ''),
        r.how,
        [show[0]?.product_id ? `What price should I charge for ${short(name(show[0].product_id))}?` : 'What’s not selling?', 'What are my lowest-margin products?', 'What’s not selling?'],
        [{ label: 'Open profit leaks', href: '/leaks' }],
      );
    }

    // ---------------------------------------------------------- stock
    case 'runout':
    case 'reorder': {
      if (target && tracked.length === 0 && lockedInScope.length) {
        return A(`${target.label} isn't among the ${fmtNum(f.limit)} best sellers your plan forecasts, so I don't have reorder dates for it.${f.pro ? '' : ` Pro forecasts up to ${fmtNum(tools.proLimit)} products.`}`, undefined, [], f.pro ? [] : [{ label: 'See Pro', href: '/paywall' }]);
      }
      if (single) {
        const it = f.fc.get(single.id);
        if (!it?.stock_plan || !it.forecast) return A(`${single.name} has no sales history yet, so there's nothing to plan from.`);
        const sp = it.stock_plan, fc = it.forecast;
        if (!single.stock_known) return A(`I don't know how many ${single.name} you have. ${sp.reason}`, undefined, [], [{ label: 'Add stock counts', href: '/stock-counts?tab=stock' }]);
        const lines = [
          `${fmtNum(single.stock_qty)} in stock${single.incoming_qty ? ` (+${fmtNum(single.incoming_qty)} on order)` : ''}, selling about ${fmtNum(fc.next_week, 1)} a week.`,
          sp.stockout_in_days != null ? `At that pace it runs out in about ${sp.stockout_in_days} days (${sp.stockout_date ? dayLabel(sp.stockout_date) : 'soon'}).` : 'At the current pace it won’t run out in the next 6 months.',
        ];
        if (sp.reorder_qty > 0) lines.push(`Order ${fmtNum(sp.reorder_qty)}${sp.order_by ? ` ${whenText(sp.order_by, now)}` : ''}${single.supplier ? ` from ${single.supplier}` : ''}${single.cost_price ? `, about ${m(sp.reorder_qty * single.cost_price)} at cost` : ''}.`);
        else lines.push(sp.status === 'overstock' ? 'No need to reorder: you have plenty.' : 'No need to order yet.');
        return A(
          `${single.name}: ${lines.join(' ')}${sp.notes.length ? `\n${sp.notes.join(' ')}` : ''}`,
          `The order covers the supplier's ${single.lead_time_days} days to deliver plus 2 more weeks of sales, with a safety buffer of ${fmtNum(sp.safety_stock)} units because weekly sales vary. Demand comes from the forecast (${fc.accuracy != null ? `${fmtPct(fc.accuracy)} accurate on your past weeks` : 'little history yet, so treat it as a rough guide'}).`,
          [`What price should I charge for ${short(single.name)}?`, `How did ${short(single.name)} sell last month?`, 'What else should I reorder?'],
          [{ label: 'Open product', href: `/product/${single.id}` }, { label: 'Supplier orders', href: '/orders' }],
        );
      }
      const today = new Date(now).toISOString().slice(0, 10);
      if (intent === 'runout' && target && tracked.length && tracked.length <= 8) {
        const rows = [...tracked].sort((a, b) => (a.stock_plan!.stockout_in_days ?? 9999) - (b.stock_plan!.stockout_in_days ?? 9999));
        return A(
          `${cap(scope())}:\n` + list(rows.map((it) => {
            const sp = it.stock_plan!, p = it.product;
            if (!p.stock_known) return `${p.name}: no stock count yet`;
            if (sp.status === 'out_of_stock') return `${p.name}: sold out. Order ${fmtNum(sp.reorder_qty)} now`;
            if (sp.stockout_in_days == null) return `${p.name}: ${fmtNum(p.stock_qty)} left, enough for 6 months or more`;
            return `${p.name}: ${fmtNum(p.stock_qty)} left, runs out in about ${sp.stockout_in_days} days${sp.reorder_qty ? `. Order ${fmtNum(sp.reorder_qty)} ${whenText(sp.order_by ?? today, now)}` : ''}`;
          })) + lockedNote(),
          'Days left come from each product’s forecast sales; order dates allow for the supplier’s delivery time.',
          ['What should I reorder?', `How many ${target.label.replace(/^the \d+ /, '').replace(/ products$/, '')} did I sell last month?`],
          [{ label: 'Supplier orders', href: '/orders' }],
        );
      }
      let need = tracked.filter((it) => ['out_of_stock', 'reorder_now', 'low'].includes(it.stock_plan!.status));
      if (intent === 'runout') need = tracked.filter((it) => it.stock_plan!.stockout_in_days != null && it.stock_plan!.stockout_in_days <= 21).sort((a, b) => a.stock_plan!.stockout_in_days! - b.stock_plan!.stockout_in_days!);
      if (!need.length) {
        const unknown = tracked.filter((it) => it.stock_plan!.status === 'stock_unknown').length;
        return A(
          `Nothing${forScope()} needs ordering right now: stock covers the expected sales.${unknown ? ` (${plural(unknown, 'product')} ${unknown === 1 ? 'has' : 'have'} no stock count, so I can't check ${unknown === 1 ? 'it' : 'them'}.)` : ''}${lockedNote()}`,
          undefined, ['What will I sell next week?', 'What’s not selling?', 'Where am I losing money?'],
        );
      }
      const groups: [string, typeof need][] = [
        ['Order today', need.filter((it) => it.stock_plan!.status === 'out_of_stock' || (it.stock_plan!.order_by && it.stock_plan!.order_by <= today))],
        ['This week', need.filter((it) => it.stock_plan!.order_by && it.stock_plan!.order_by > today && Date.parse(it.stock_plan!.order_by) - now <= 7 * DAY)],
        ['Later', need.filter((it) => !(it.stock_plan!.status === 'out_of_stock') && (!it.stock_plan!.order_by || Date.parse(it.stock_plan!.order_by) - now > 7 * DAY))],
      ];
      const cost = need.reduce((x, it) => x + it.stock_plan!.reorder_qty * it.product.cost_price, 0);
      const suppliers = new Set(need.map((it) => it.product.supplier).filter(Boolean)).size;
      let text = `${plural(need.length, 'product')}${forScope()} ${intent === 'runout' ? 'run out in the next 3 weeks' : 'to reorder'}${cost > 0 ? `, about ${m(cost)} at cost` : ''}${suppliers > 1 ? ` from ${suppliers} suppliers` : ''}:`;
      for (const [label, g] of groups) {
        if (!g.length) continue;
        text += `\n${label}:\n` + list(g.slice(0, 5).map((it) => `${it.product.name}: ${it.stock_plan!.reorder_qty ? `order ${fmtNum(it.stock_plan!.reorder_qty)}` : 'check stock'}${it.stock_plan!.order_by && label !== 'Order today' ? ` by ${dayLabel(it.stock_plan!.order_by)}` : ''} (${it.stock_plan!.status === 'out_of_stock' ? 'sold out' : `${it.stock_plan!.stockout_in_days} days left`})`)) + (g.length > 5 ? `\n  …and ${g.length - 5} more` : '');
      }
      return A(text + lockedNote(), 'Each product’s order covers its supplier’s delivery time plus 2 weeks of forecast sales and a safety buffer. Supplier orders groups them by supplier with the messages written.', ['How much cash do I need to restock?', need[0] ? `When will ${short(need[0].product.name)} run out?` : 'What will I sell next week?', 'What’s not selling?'], [{ label: 'Supplier orders', href: '/orders' }]);
    }
    case 'cash': {
      const need = tracked.filter((it) => ['out_of_stock', 'reorder_now', 'low'].includes(it.stock_plan!.status));
      const nowCost = need.filter((it) => it.stock_plan!.status !== 'low').reduce((x, it) => x + it.stock_plan!.reorder_qty * it.product.cost_price, 0);
      const soonCost = need.filter((it) => it.stock_plan!.status === 'low').reduce((x, it) => x + it.stock_plan!.reorder_qty * it.product.cost_price, 0);
      const k = f.agg(now - 30 * DAY, now);
      return A(
        `Orders to place now cost about ${m(nowCost)} at cost price, plus about ${m(soonCost)} over the next two weeks. ` +
          `For comparison, the last 30 days brought in ${m(k.profit)} profit after fees${k.profit > 0 && nowCost + soonCost > k.profit ? ', so you may want to order the urgent ones first and the rest as cash comes in' : ''}.` +
          (need.some((it) => it.product.cost_price <= 0) ? ' Some products have no cost price, so the real figure is higher.' : ''),
        'Adds up each suggested order × what you pay per item.',
        ['What should I reorder?', 'What’s not selling?', 'Where am I losing money?'],
        [{ label: 'Supplier orders', href: '/orders' }],
      );
    }
    case 'stockout': {
      const out = tracked.filter((it) => it.stock_plan!.status === 'out_of_stock');
      if (!out.length) return A(`Nothing that sells is out of stock${forScope()} right now.`, undefined, ['What will run out soon?', 'What should I reorder?']);
      const lost = out.reduce((x, it) => x + it.forecast!.next_week * Math.max(0, it.product.sell_price - it.product.cost_price), 0);
      return A(
        `${plural(out.length, 'product')} ${out.length === 1 ? 'is' : 'are'} sold out while customers still buy, costing about ${m(lost)} of profit a week:\n` +
          list(out.slice(0, 8).map((it) => `${it.product.name}: about ${perWeek(it.forecast!.next_week)}. Order ${fmtNum(it.stock_plan!.reorder_qty)}${it.product.supplier ? ` from ${it.product.supplier}` : ''}`)),
        undefined, ['What will run out soon?', 'How much cash do I need to restock?'], [{ label: 'Supplier orders', href: '/orders' }],
      );
    }
    case 'dead': {
      const since = now - 30 * DAY, sold = f.aggBy(since, now, (s) => s.pid);
      const dead = f.products.filter((p) => (!ids || ids.has(p.id)) && p.stock_known && p.stock_qty > 0 && !sold.get(p.id)?.units).sort((a, b) => b.stock_qty * b.cost_price - a.stock_qty * a.cost_price);
      const over = tracked.filter((it) => it.stock_plan!.status === 'overstock').sort((a, b) => (b.stock_plan!.weeks_of_cover ?? 0) - (a.stock_plan!.weeks_of_cover ?? 0));
      if (!dead.length && !over.length) return A(`Everything${forScope()} with stock has sold in the last 30 days, and nothing is badly overstocked.`, undefined, ['What should I reorder?', 'What are my top 5 products?']);
      const cash = dead.reduce((x, p) => x + p.stock_qty * p.cost_price, 0), fee = f.storeFeeRate();
      let text = dead.length ? `${plural(dead.length, 'product')} haven’t sold in 30 days, with ${m(cash)} tied up at cost:\n` + list(dead.slice(0, 6).map((p) => {
        const last = f.lastSoldAt(p.id);
        const floor = p.cost_price > 0 && fee < 0.9 ? p.cost_price / (1 - fee) : 0;
        return `${p.name}: ${fmtNum(p.stock_qty)} in stock, ${m(p.stock_qty * p.cost_price)}${last ? `, last sold ${dayLabel(last)}` : ', never sold'}${floor ? `. Don't go below ${m(floor)}` : ''}`;
      })) + (dead.length > 6 ? `\n  …and ${dead.length - 6} more` : '') : '';
      if (over.length) text += `${text ? '\n' : ''}Overstocked (more than 12 weeks of stock):\n` + list(over.slice(0, 4).map((it) => `${it.product.name}: ${fmtNum(Math.round(it.stock_plan!.weeks_of_cover ?? 0))} weeks of stock`));
      return A(
        text + '\nTo free the cash: bundle slow items with a best seller, run a 15–20% discount, or list them on another channel. Pause reordering anything overstocked.',
        `The floor price is what you pay plus your average fee (${fmtPct(fee)} of the price): below it, each sale loses money.`,
        ['Which products sell together?', 'Where am I losing money?', 'What are my best sellers?'],
        [{ label: 'Profit leaks', href: '/leaks' }],
      );
    }
    case 'bundle': {
      if (!f.pro) return A('“Bought together” finds products customers buy in the same order, so you can bundle them and raise the order value. It’s part of Pro.', undefined, ['What are my best sellers?', 'What’s not selling?'], [{ label: 'See Pro', href: '/paywall' }]);
      const b = E.bundles(f.store, f.products, now);
      const pairs = (b.pairs as { a: { id: number; name: string }; b: { id: number; name: string }; orders_together: number; lift: number }[]).filter((p) => !ids || ids.has(p.a.id) || ids.has(p.b.id));
      if (!pairs.length) return A(b.note || `No strong pairs${forScope()} yet: customers mostly buy these on their own.`);
      return A('Customers often buy these together:\n' + list(pairs.slice(0, 5).map((p) => `${p.a.name} + ${p.b.name}: in ${p.orders_together} orders, ${p.lift}× more often than chance`)) + '\nOffer them as a bundle at a small discount, or show one on the other’s page.', `Looked at ${fmtNum(b.orders)} orders from the last 6 months; “× more often than chance” compares how often they’re bought together with how often you’d expect if it were random.`, ['What’s not selling?', 'What are my best sellers?']);
    }

    // ---------------------------------------------------------- the future
    case 'forecast': {
      const month = /\bmonth|4 weeks|four weeks|next few weeks|coming weeks/.test(t), weeks = month ? 4 : 1, label = month ? 'the next 4 weeks' : 'next week';
      if (!target && !channel) {
        const s = f.F.store, sum = (a: number[]) => a.slice(0, weeks).reduce((x, v) => x + v, 0);
        const top = [...tracked].sort((a, b) => b.forecast!.weeks.slice(0, weeks).reduce((x, v) => x + v, 0) - a.forecast!.weeks.slice(0, weeks).reduce((x, v) => x + v, 0)).slice(0, 4);
        const band = s.revenue_band ? `likely ${m(sum(s.revenue_band.lower))}–${m(sum(s.revenue_band.upper))}` : '';
        const last = f.agg(now - weeks * 7 * DAY, now);
        return A(
          `For ${label} I expect about ${fmtNum(sum(s.next_weeks_units))} items, ${m(sum(s.next_weeks_revenue))} revenue${band ? ` (${band})` : ''} and ${m(sum(s.next_weeks_profit))} profit. ` +
            `That's ${changeWord(change(sum(s.next_weeks_revenue), last.revenue))} on the last ${weeks === 1 ? '7 days' : '4 weeks'} (${m(last.revenue)}).\n` +
            'Biggest sellers:\n' + list(top.map((it) => `${it.product.name}: about ${fmtNum(it.forecast!.weeks.slice(0, weeks).reduce((x, v) => x + v, 0))} units`)) +
            (f.F.events.length ? `\nComing up: ${f.F.events.slice(0, 2).map((e) => `${e.name} ${inDays(e.in_days)}`).join(', ')}. The forecast follows your past weeks, so check stock for these.` : '') + lockedNote(),
          `Each product's forecast blends several methods (recent level, trend, seasonality, and methods for slow sellers), weighted by how well each would have predicted your own past weeks.${s.accuracy != null ? ` Store-level accuracy on past weeks: ${fmtPct(s.accuracy)}.` : ''}`,
          ['What should I reorder?', 'What will I sell next month?', 'Which products are rising?'],
          [{ label: 'Forecast tab', href: '/forecast' }],
        );
      }
      if (!tracked.length) return A(lockedInScope.length ? `${scope()} ${lockedInScope.length === 1 ? 'isn’t' : 'aren’t'} among the ${fmtNum(f.limit)} best sellers your plan forecasts.${f.pro ? '' : ` Pro covers ${fmtNum(tools.proLimit)}.`}` : `No sales history${forScope()} to forecast from yet.`);
      const units = tracked.reduce((x, it) => x + it.forecast!.weeks.slice(0, weeks).reduce((a, v) => a + v, 0), 0);
      const lo = tracked.reduce((x, it) => x + it.forecast!.lower.slice(0, weeks).reduce((a, v) => a + v, 0), 0);
      const hi = tracked.reduce((x, it) => x + it.forecast!.upper.slice(0, weeks).reduce((a, v) => a + v, 0), 0);
      const rev = tracked.reduce((x, it) => x + it.forecast!.weeks.slice(0, weeks).reduce((a, v) => a + v, 0) * it.product.sell_price, 0);
      const one = tracked.length === 1 ? tracked[0] : null;
      const trendTxt = one ? ({ rising: `rising (${changeWord(one.forecast!.trend_pct)} over 4 weeks)`, declining: `slowing (${changeWord(one.forecast!.trend_pct)} over 4 weeks)`, stable: 'steady', new: 'new, so still settling', no_sales: 'not selling' } as Record<string, string>)[one.forecast!.trend] : '';
      return A(
        `${cap(scope())}: about ${fmtNum(units)} units ${month ? 'in the next 4 weeks' : 'next week'} (likely ${fmtNum(lo)}–${fmtNum(hi)}), around ${m(rev)} at your prices.` + (one ? ` Sales are ${trendTxt}.` : `\n` + list([...tracked].sort((a, b) => b.forecast!.next_week - a.forecast!.next_week).slice(0, 5).map((it) => `${it.product.name}: about ${fmtNum(it.forecast!.weeks.slice(0, weeks).reduce((a, v) => a + v, 0))}`))) + lockedNote(),
        one ? `Based on ${one.forecast!.history.filter((v) => v > 0).length} weeks with sales. ${one.forecast!.accuracy != null ? `On its past weeks this forecast was ${fmtPct(one.forecast!.accuracy)} accurate.` : 'Little history yet, so treat it as a rough guide.'}${one.forecast!.seasonal ? ' It sells more at certain times of year, and the forecast allows for that.' : ''}` : 'The range is where sales land 8 times out of 10.',
        one ? [`When will ${short(one.product.name)} run out?`, `What price should I charge for ${short(one.product.name)}?`] : ['What should I reorder?'],
      );
    }

    // ---------------------------------------------------------- the past
    case 'why': {
      const p1 = period ?? (/\bmonth\b/.test(t) ? lastNDays(now, 30) : lastNDays(now, 7)), p2 = periods[1] ?? previousPeriod(p1, now);
      const [cur, old] = p1.from >= p2.from ? [p1, p2] : [p2, p1];
      const byP = (p: Period) => (channel ? f.aggBy(p.from, p.to, (s) => (f.channelOf(s) === channel ? s.pid : -1), ids) : f.aggBy(p.from, p.to, (s) => s.pid, ids));
      const a = byP(cur), b = byP(old);
      const total = (mp: Map<number, Agg>) => [...mp.entries()].filter(([k]) => k !== -1).reduce((x, [, v]) => x + v.revenue, 0);
      const ra = total(a), rb = total(b), c = change(ra, rb);
      if (!rb && !ra) return A(`No sales${forScope()} ${inP(cur)} or ${old.label}, so nothing to explain.`);
      const askedDown = /\b(drop|down|fall|fell|decline|declin|slow|worse|lower|less|bad|dip|decreas|lost)/.test(t), askedUp = /\b(up|rise|rose|grow|grew|increase|better|higher|more|good|spike|jump|boom)/.test(t);
      const dir = ra < rb ? 'down' : 'up';
      const rows = [...new Set([...a.keys(), ...b.keys()])].filter((k) => k !== -1).map((id) => {
        const x = a.get(id), y = b.get(id);
        return { id, diff: (x?.revenue ?? 0) - (y?.revenue ?? 0), x, y };
      });
      const drivers = rows.filter((r) => (dir === 'down' ? r.diff < 0 : r.diff > 0)).sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff)).slice(0, 4);
      const against = rows.filter((r) => (dir === 'down' ? r.diff > 0 : r.diff < 0)).sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff)).slice(0, 2);
      const reason = (r: (typeof rows)[number]) => {
        const p = f.byId.get(r.id)!, ux = r.x?.units ?? 0, uy = r.y?.units ?? 0;
        const px = ux ? r.x!.revenue / ux : 0, py = uy ? r.y!.revenue / uy : 0;
        const bits = [`${m(r.diff >= 0 ? r.diff : -r.diff)} ${r.diff >= 0 ? 'more' : 'less'} (${fmtNum(ux)} sold vs ${fmtNum(uy)})`];
        if (!ux && p.stock_known && p.stock_qty <= 0) bits.push('it sold out');
        else if (ux < uy && p.stock_known && p.stock_qty <= 0) bits.push('it ran out of stock');
        if (px && py && Math.abs(px / py - 1) >= 0.05) bits.push(`price ${px < py ? 'down' : 'up'} ${fmtPct(Math.abs(px / py - 1))} (${m(py)} → ${m(px)})`);
        return `${p.name}: ${bits.join('; ')}`;
      };
      const oa = [...a.entries()].filter(([k]) => k !== -1).reduce((x, [, v]) => x + v.orders, 0), ob = [...b.entries()].filter(([k]) => k !== -1).reduce((x, [, v]) => x + v.orders, 0);
      const aovA = oa ? ra / oa : 0, aovB = ob ? rb / ob : 0;
      let text = `${scope() ? cap(scope()) + ': revenue' : 'Revenue'} ${c == null ? 'started' : `is ${changeWord(c)}`}: ${m(ra)} ${inP(cur)} against ${m(rb)} ${inP(old)}.`;
      if (askedDown && dir === 'up') text = `Good news: sales didn't drop. ${text}`;
      if (askedUp && dir === 'down') text = `Actually sales went down. ${text}`;
      if (ob && oa) {
        const co = change(oa, ob)!, ca = change(aovA, aovB)!;
        text += ` That's ${Math.abs(co) >= Math.abs(ca) ? `mostly ${co < 0 ? 'fewer' : 'more'} orders (${fmtNum(oa)} vs ${fmtNum(ob)})` : `mostly ${ca < 0 ? 'smaller' : 'bigger'} orders (average ${m(aovA)} vs ${m(aovB)})`}.`;
      }
      if (drivers.length) text += `\nBiggest reasons:\n` + list(drivers.map(reason));
      if (against.length) text += `\nGoing the other way:\n` + list(against.map(reason));
      if (!channel && f.channels().length > 1) {
        const ch = (p: Period) => f.aggBy(p.from, p.to, (s) => f.channelOf(s), ids);
        const ca = ch(cur), cb = ch(old);
        const moves = f.channels().map((k) => ({ k, d: (ca.get(k)?.revenue ?? 0) - (cb.get(k)?.revenue ?? 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
        if (moves[0] && Math.abs(moves[0].d) > Math.abs(ra - rb) * 0.3) text += `\nBy channel, most of the change was on ${channelLabel(moves[0].k)} (${moves[0].d >= 0 ? '+' : '-'}${m(Math.abs(moves[0].d))}).`;
      }
      // Same weeks last year: seasonal or not?
      if (f.firstSale != null && f.firstSale <= old.from - 365 * DAY) {
        const ly = { from: cur.from - 364 * DAY, to: cur.to - 364 * DAY, label: '' }, lyb = { from: old.from - 364 * DAY, to: old.to - 364 * DAY, label: '' };
        const cl = change(aggOf(ly).revenue, aggOf(lyb).revenue);
        if (cl != null && Math.sign(cl) === Math.sign(c ?? 0) && Math.abs(cl) >= 0.1) text += `\nThe same weeks last year went ${changeWord(cl)} too, so part of this is seasonal.`;
      }
      const ev = E.upcomingEvents(old.from, Math.ceil((old.to - old.from) / (7 * DAY)) + 1).find((e: { date: string }) => Date.parse(e.date) >= old.from && Date.parse(e.date) < old.to);
      if (ev && dir === 'down') text += `\n${ev.name} fell ${inP(old)}, which usually lifts sales.`;
      return A(text, 'I compared every product’s revenue in the two periods and ranked what changed most, then checked stock, price changes, order count and order size for each.', [drivers[0] ? `When will ${short(name(drivers[0].id))} run out?` : 'What should I reorder?', 'What needs my attention?', 'What will I sell next week?']);
    }
    case 'compare': {
      const pair = match.pair(t);
      if (pair && periods.length < 2) {
        const p = period ?? lastNDays(now, 30);
        const rows = pair.map((tg) => {
          const a = f.agg(p.from, p.to, tg.ids), its = f.F.items.filter((it) => tg.ids.has(it.product.id) && !it.locked && it.forecast);
          const stock = [...tg.ids].reduce((x, id) => x + Math.max(0, f.byId.get(id)?.stock_qty ?? 0), 0);
          const next = its.reduce((x, it) => x + it.forecast!.next_week, 0);
          return { tg, a, next, stock, unit: a.units ? a.profit / a.units : 0 };
        });
        const [x, y] = rows;
        const line = (r: (typeof rows)[number]) => `${r.tg.label}: ${m(r.a.revenue)} revenue, ${fmtNum(r.a.units)} sold, ${m(r.a.profit)} profit (${m(r.unit)} a sale${r.a.revenue ? `, ${fmtPct(r.a.profit / r.a.revenue)} margin` : ''}). ${fmtNum(r.stock)} in stock, about ${perWeek(r.next)} expected.`;
        const verdict = x.a.profit === y.a.profit ? 'They earn about the same.' : `${(x.a.profit > y.a.profit ? x : y).tg.label} earns more overall` + ((x.unit > y.unit) !== (x.a.profit > y.a.profit) ? `, but ${(x.unit > y.unit ? x : y).tg.label} keeps more per sale.` : '.');
        return A(`${p.label[0].toUpperCase() + p.label.slice(1)}:\n` + list(rows.map(line)) + `\n${verdict}`, undefined, [`What price should I charge for ${short(x.tg.label)}?`, `When will ${short(y.tg.label)} run out?`]);
      }
      // fall through to period comparison
    }
    case 'how_doing': {
      const p1 = period ?? lastNDays(now, 7), p2 = periods[1] ?? previousPeriod(p1, now);
      const [cur, old] = p1.from >= p2.from ? [p1, p2] : [p2, p1];
      const a = aggOf(cur), b = aggOf(old);
      const row = (label: string, x: number, y: number, fmt: (v: number) => string) => `${label}: ${fmt(x)} vs ${fmt(y)} (${changeWord(change(x, y))})`;
      let text = `${cap(scope() ? `${scope()}, ${cur.label}` : cur.label)} compared with ${old.label}:\n` + list([
        row('Revenue', a.revenue, b.revenue, m),
        row('Profit after fees', a.profit, b.profit, m),
        row('Orders', a.orders, b.orders, (v) => fmtNum(v)),
        row('Items sold', a.units, b.units, (v) => fmtNum(v)),
        `Average order: ${m(a.orders ? a.revenue / a.orders : 0)} vs ${m(b.orders ? b.revenue / b.orders : 0)}`,
      ]);
      // A period still running ("this month so far") is shorter: give the pace too.
      const curDays = (cur.to - cur.from) / DAY, oldDays = (old.to - old.from) / DAY;
      if (curDays < oldDays * 0.9 && curDays >= 1) text += `\n${cur.label} isn't over yet: at this pace it ends near ${m((a.revenue / curDays) * oldDays)} revenue.`;
      if (intent === 'how_doing' && !target && !channel) {
        const al = findAlerts(f, null), s = f.F.store;
        text += `\nNext week: about ${m(s.next_weeks_revenue[0] ?? 0)} revenue expected.` + (al.counts.urgent + al.counts.warning ? ` ${plural(al.counts.urgent + al.counts.warning, 'thing needs', 'things need')} your attention.` : ' Nothing urgent.');
      }
      if (a.costMissingUnits) text += `\nNote: ${fmtNum(a.costMissingUnits)} items sold have no cost price, so profit is overstated.`;
      return A(text, 'Profit is revenue minus what you pay per item minus each channel’s selling fee (Account → Selling fees).', ['Why did sales change?', 'What needs my attention?', 'What are my top 5 products this month?']);
    }
    case 'weekday': {
      const p = period ?? lastNDays(now, 56);
      const by = f.aggBy(p.from, p.to, (s) => new Date(s.when).getUTCDay(), ids);
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const weeks = Math.max(1, (p.to - p.from) / (7 * DAY));
      const rows = days.map((d, i) => ({ d, rev: (by.get(i)?.revenue ?? 0) / weeks })).sort((x, y) => y.rev - x.rev);
      if (!rows[0].rev) return A(`No sales${forScope()} ${inP(p)}.`);
      return A(`Average revenue by day of the week over ${p.label}${forScope()}:\n` + list(rows.map((r) => `${r.d}: ${m(r.rev)}`)) + `\n${rows[0].d} is your strongest day, ${rows[6].d} the quietest. Start promotions the day before your strongest day, and send supplier orders early in the week.`, 'Uses the date on each sale (marketplaces record the order date in UTC).', ['Which channel keeps the most?', 'What are my top 5 products?', 'How is my store doing?']);
    }
    case 'channels': {
      const p = period ?? lastNDays(now, 30);
      const by = f.aggBy(p.from, p.to, (s) => f.channelOf(s), ids);
      const rows = [...by.entries()].sort((x, y) => y[1].revenue - x[1].revenue);
      if (!rows.length) return A(`No sales${forScope()} ${inP(p)}.`);
      if (rows.length === 1) return A(`All your sales${forScope()} ${inP(p)} were on ${channelLabel(rows[0][0])}: ${m(rows[0][1].revenue)} revenue, ${m(rows[0][1].profit)} profit after ${m(rows[0][1].fees)} of fees. Selling on a second channel spreads the risk; your import screen takes files from eBay, Amazon, Shopify, Etsy and TikTok Shop.`, undefined, ['How much are my fees?', 'Where am I losing money?']);
      return A(`By channel, ${p.label}${forScope()}:\n` + list(rows.map(([k, a]) => `${channelLabel(k)}: ${m(a.revenue)} revenue, ${m(a.profit)} profit (${a.revenue ? fmtPct(a.profit / a.revenue) : '–'} margin), fees ${m(a.fees)}`)) + `\n${channelLabel(rows.sort((x, y) => y[1].profit / Math.max(1, y[1].revenue) - x[1].profit / Math.max(1, x[1].revenue))[0][0])} keeps the most of each sale.`, 'Fees use the rates in Account → Selling fees.', ['How much are my fees?', 'Where am I losing money?']);
    }
    case 'rank': {
      const p = period ?? lastNDays(now, 30), n = parseCount(t);
      const asc = /\b(worst|bottom|least|lowest|smallest|weakest)\b/.test(t);
      let met: Metric = ctx.metric ?? 'revenue';
      if (!metric && /\b(popular|how many|most sold)\b/.test(t)) met = 'units';
      if (met === 'fees' || met === 'aov') met = 'revenue';
      const groupBy = /\bcategor/.test(t) ? 'category' : /\bsupplier|vendor/.test(t) ? 'supplier' : 'product';
      const keyOf = (s: LocalSale, pr: LocalProduct): string | number => (groupBy === 'category' ? pr.category || 'No category' : groupBy === 'supplier' ? pr.supplier || 'No supplier' : s.pid);
      const byK = new Map<string | number, Agg>();
      for (const [k, v] of f.aggBy(p.from, p.to, (s, pr) => (channel && f.channelOf(s) !== channel ? '__x' : keyOf(s, pr)), ids)) if (k !== '__x') byK.set(k, v);
      const total = [...byK.values()].reduce((x, a) => x + a.revenue, 0);
      const val = (a: Agg) => (met === 'margin' ? (a.revenue ? a.profit / a.revenue : 0) : met === 'units' ? a.units : met === 'orders' ? a.orders : met === 'profit' ? a.profit : a.revenue);
      let rows = [...byK.entries()];
      if (met === 'margin') rows = rows.filter(([, a]) => a.revenue >= Math.max(20, total * 0.005) && a.costMissingUnits < a.units);
      rows.sort((x, y) => (asc ? val(x[1]) - val(y[1]) : val(y[1]) - val(x[1])));
      if (!rows.length) return A(`No sales${forScope()} ${inP(p)}.`);
      const label = (k: string | number) => (typeof k === 'number' ? name(k) : k);
      const fmtV = (a: Agg) => (met === 'margin' ? `${fmtPct(val(a))} margin (${m(a.profit)} profit)` : met === 'units' ? `${fmtNum(a.units)} sold (${m(a.revenue)})` : met === 'orders' ? `${fmtNum(a.orders)} orders` : met === 'profit' ? `${m(a.profit)} profit (${fmtNum(a.units)} sold)` : `${m(a.revenue)} (${fmtNum(a.units)} sold, ${m(a.profit)} profit)`);
      const what = groupBy === 'product' ? 'products' : groupBy === 'category' ? 'categories' : 'suppliers';
      const metWord = { revenue: 'revenue', profit: 'profit', units: 'units sold', orders: 'orders', margin: 'margin after fees', fees: 'fees', aov: 'revenue' }[met];
      let text = `${asc ? 'Bottom' : 'Top'} ${Math.min(n, rows.length)} ${what} by ${metWord}, ${p.label}${forScope()}:\n` + rows.slice(0, n).map(([k, a], i) => `${i + 1}. ${label(k)}: ${fmtV(a)}`).join('\n');
      if (!asc && met !== 'margin' && total > 0 && groupBy === 'product') {
        const share = rows.slice(0, n).reduce((x, [, a]) => x + a.revenue, 0) / total;
        text += `\nTogether they're ${fmtPct(share)} of revenue${share > 0.5 ? ': keep them in stock above all else' : ''}.`;
      }
      if (asc && groupBy === 'product') {
        const zero = f.products.filter((pr) => (!ids || ids.has(pr.id)) && !byK.has(pr.id)).length;
        if (zero) text += `\nNot counted: ${plural(zero, 'product')} with no sales at all in this period (ask “what’s not selling?”).`;
      }
      const firstId = typeof rows[0][0] === 'number' ? (rows[0][0] as number) : null;
      return A(text, met === 'profit' || met === 'margin' ? 'Profit = what each sale brought in, minus what you pay per item, minus the channel’s fee.' : undefined, firstId ? sug.product(name(firstId)) : sug.general);
    }
    case 'fees': {
      const p = period ?? lastNDays(now, 30), by = f.aggBy(p.from, p.to, (s) => f.channelOf(s), ids), all = aggOf(p);
      return A(
        `Selling fees${forScope()}, ${p.label}: ${m(all.fees)}, ${all.revenue ? fmtPct(all.fees / all.revenue) : '0%'} of revenue.` + (by.size > 1 ? '\n' + list([...by.entries()].map(([k, a]) => `${channelLabel(k)}: ${m(a.fees)} (${a.revenue ? fmtPct(a.fees / a.revenue) : '–'})`)) : '') + '\nThey’re already taken off every profit figure. If your real rates differ (store subscription, category, promoted listings), change them in Account → Selling fees.',
        undefined, ['Where am I losing money?', 'Which channel keeps the most?'], [{ label: 'Selling fees', href: '/fees' }],
      );
    }
    case 'stock_value': {
      const ps = f.products.filter((p) => (!ids || ids.has(p.id)) && p.stock_known && p.stock_qty > 0);
      const cost = ps.reduce((x, p) => x + p.stock_qty * p.cost_price, 0), retail = ps.reduce((x, p) => x + p.stock_qty * p.sell_price, 0);
      const top = [...ps].sort((a, b) => b.stock_qty * b.cost_price - a.stock_qty * a.cost_price).slice(0, 3);
      const unknown = f.products.filter((p) => (!ids || ids.has(p.id)) && !p.stock_known).length;
      return A(`You have ${fmtNum(ps.reduce((x, p) => x + p.stock_qty, 0))} units${forScope()} on hand, worth ${m(cost)} at cost and ${m(retail)} at your selling prices.\nMost cash is in:\n` + list(top.map((p) => `${p.name}: ${fmtNum(p.stock_qty)} units, ${m(p.stock_qty * p.cost_price)}`)) + (unknown ? `\n${plural(unknown, 'product')} have no stock count, so the real figure is higher.` : ''), undefined, ['What’s not selling?', 'What should I reorder?']);
    }
    case 'trends': {
      const niche = f.store.user.niche;
      return A(`The Trends tab lists what’s selling now${niche ? ` for ${niche}` : ''} and in 8 other niches, with how fast each is growing, how crowded it is, and what to search for on supplier sites. “Add to my store” saves an idea; Product Check then tells you if the numbers work before you buy stock.` + (tracked.some((it) => it.forecast!.trend === 'rising') ? `\nIn your own store, these are rising: ${tracked.filter((it) => it.forecast!.trend === 'rising').sort((a, b) => (b.next_week_revenue ?? 0) - (a.next_week_revenue ?? 0)).slice(0, 3).map((it) => `${it.product.name} (${changeWord(it.forecast!.trend_pct)})`).join(', ')}.` : ''), undefined, ['What will I sell next month?', 'What are my best sellers?'], [{ label: 'Trends', href: '/trends' }, { label: 'Product Check', href: '/ai/product-check' }]);
    }

    // ---------------------------------------------------------- prices
    case 'whatif':
    case 'price': {
      const pr = single ?? (target && target.ids.size ? null : null);
      if (!pr) {
        if (target?.kind === 'group') return A(`Which one? ${target.label} covers several products. Try the full name, e.g. “What price should I charge for ${name([...target.ids][0])}?”`);
        // "What if I raise all my prices by 10%?": the whole store (or category, supplier, channel).
        const storeChange = intent === 'whatif' ? parsePriceChange(t) : null;
        if (storeChange?.pct) {
          const p = lastNDays(now, 30), a = aggOf(p), x = storeChange.pct;
          if (!a.revenue) return A(`No sales${forScope()} in the last 30 days to work from.`);
          const gain = x * (a.revenue - a.fees), newProfit = a.profit + gain;
          const ratio = newProfit > 0 ? a.profit / newProfit : null;
          return A(
            `If every price${forScope()} went ${x > 0 ? 'up' : 'down'} ${fmtPct(Math.abs(x))} and sales held at the last 30 days' level, profit would go from ${m(a.profit)} to ${m(newProfit)} a month (${x > 0 ? '+' : '-'}${m(Math.abs(gain))}).` +
              (ratio != null && a.profit > 0 ? (ratio < 1 ? `\nYou could lose up to ${fmtPct(1 - ratio)} of sales and still make the same profit.` : `\nYou'd need ${fmtPct(ratio - 1)} more sales just to make the same profit.`) : '') +
              `\nA safer test: change the price on 3–5 best sellers first, then ask me how they sold after two weeks.`,
            `Fees move with the price; what you pay per item doesn't. Based on ${fmtNum(a.units)} items sold in the last 30 days.`,
            ['What are my lowest-margin products?', 'Top 5 products by profit this month', 'Where am I losing money?'],
          );
        }
        // No product named: the products whose price most needs a look.
        const leaks = findLeaks(f, null).items.filter((l) => l.kind === 'loss' || l.kind === 'thin_margin').slice(0, 5);
        if (!leaks.length) return A('Name a product and I’ll work out its price: what it really sells for, what you keep after cost and fees, and what happens if you change it. None of your products is below cost or on a very thin margin right now.', undefined, ['What are my lowest-margin products?']);
        return A('These prices need a look first:\n' + list(leaks.map((l) => `${l.title}. ${l.fix}`)) + '\nAsk about one by name, e.g. “What if I raise ' + short(leaks[0].product_name ?? '') + ' by 10%?”', undefined, leaks[0].product_name ? [`What if I raise ${short(leaks[0].product_name)} by 10%?`] : []);
      }
      const ue = f.unitEconomics(pr, now - 90 * DAY, now);
      const price = ue?.price ?? pr.sell_price, feeRate = ue?.feeRate ?? f.storeFeeRate(), fee = price * feeRate;
      if (!price) return A(`${pr.name} has no price or sales yet.`);
      const unit = price - fee - pr.cost_price, monthly = ue ? ue.units / 3 : 0;
      const at = (marg: number) => { const k = 1 - feeRate - marg; return k > 0.05 ? pr.cost_price / k : null; };
      const lines = [`Sells for about ${m(price)}${ue ? ` (average of the last 90 days, ${fmtNum(ue.units)} sold)` : ''}. You pay ${pr.cost_price ? m(pr.cost_price) : 'an unknown cost'}, fees take about ${m(fee)}, so you keep ${m(unit)} a sale (${fmtPct(unit / price)}).`];
      const how = `Fees are your average for this product (${fmtPct(feeRate)} of the price). Profit ignores shipping and ads; the Profit & ads calculator includes them.`;
      if (!pr.cost_price) return A(`${pr.name}: ${lines[0]}\nAdd what you pay per item and I can tell you the right price.`, how, [], [{ label: 'Add costs', href: '/stock-counts?tab=cost' }]);
      const change = intent === 'whatif' ? parsePriceChange(t) : null;
      if (change) {
        const np = change.to ?? price * (1 + (change.pct ?? 0)), nunit = np - np * feeRate - pr.cost_price;
        const sameProfitUnits = nunit > 0 && unit > 0 ? (unit * monthly) / nunit : null;
        let text = `${pr.name} at ${m(np)} instead of ${m(price)}: you'd keep ${m(nunit)} a sale instead of ${m(unit)} (${nunit >= unit ? '+' : ''}${m(nunit - unit)}).`;
        if (monthly) text += `\nIf sales hold at about ${fmtNum(monthly)} a month, that's ${m(Math.abs(nunit - unit) * monthly)} ${nunit >= unit ? 'more' : 'less'} profit a month.`;
        else text += `\nIt hasn't sold in the last 90 days, so I can't say what the change would do to sales.`;
        if (sameProfitUnits != null && monthly) {
          const ratio = sameProfitUnits / monthly;
          text += ratio < 1 ? `\nYou could lose up to ${fmtPct(1 - ratio)} of sales and still make the same profit.` : `\nYou'd need ${fmtPct(ratio - 1)} more sales just to make the same profit.`;
        }
        if (nunit < 0) text += '\nAt that price every sale loses money.';
        text += '\nTry it for two weeks, then ask me how it sold.';
        return A(text, how, [`How did ${short(pr.name)} sell last week?`, `What price should I charge for ${short(pr.name)}?`]);
      }
      const p25 = at(0.25), p35 = at(0.35);
      lines.push(unit < 0 ? 'Every sale loses money.' : unit / price < 0.1 ? 'That margin is thin: one return wipes out several sales.' : unit / price >= 0.35 ? 'That’s a healthy margin.' : 'That’s a fair margin.');
      if (p25) lines.push(`To keep 25% after fees, charge at least ${m(p25)}${p35 ? `; for 35%, ${m(p35)}` : ''}.`);
      if (pr.sell_price && Math.abs(pr.sell_price - price) / price > 0.05) lines.push(`Your list price is ${m(pr.sell_price)}, but buyers paid ${m(price)} on average: check for discounts or coupons.`);
      const it = f.fc.get(pr.id);
      if (it?.forecast?.trend === 'rising' && unit / price < 0.35) lines.push('Sales are rising, a good time to test a slightly higher price.');
      return A(`${pr.name}:\n` + list(lines), how, [`What if I raise ${short(pr.name)} by 10%?`, `What if I lower ${short(pr.name)} by 10%?`, `When will ${short(pr.name)} run out?`]);
    }

    // ---------------------------------------------------------- numbers for any period, product, category…
    case 'metric': {
      const p = period ?? lastNDays(now, 30), prevP = previousPeriod(p, now);
      const a = aggOf(p), b = aggOf(prevP), met = ctx.metric ?? 'revenue';
      if (!a.units) {
        const last = ids ? Math.max(...[...ids].map((id) => f.lastSoldAt(id) ?? 0)) : f.lastSale ?? 0;
        return A(`No sales${forScope()} ${inP(p)}.${last ? ` The last one was on ${dayLabel(last)}.` : ''}`, undefined, target ? sug.product(target.label) : sug.general);
      }
      const ch = (x: number, y: number) => (y ? ` (${changeWord(change(x, y))} on ${prevP.label})` : '');
      const lead: Record<Metric, string> = {
        revenue: `${m(a.revenue)} revenue${forScope()} ${inP(p)}${ch(a.revenue, b.revenue)}.`,
        profit: `${m(a.profit)} profit after fees${forScope()} ${inP(p)}${ch(a.profit, b.profit)}, ${a.revenue ? fmtPct(a.profit / a.revenue) : '0%'} of revenue.`,
        units: `${fmtNum(a.units)} sold${forScope()} ${inP(p)}${ch(a.units, b.units)}.`,
        orders: `${fmtNum(a.orders)} orders${forScope()} ${inP(p)}${ch(a.orders, b.orders)}, ${m(a.revenue / a.orders)} on average.`,
        fees: `${m(a.fees)} in selling fees${forScope()} ${inP(p)}, ${fmtPct(a.fees / a.revenue)} of revenue.`,
        aov: `Average order${forScope()} ${inP(p)}: ${m(a.revenue / a.orders)}${ch(a.revenue / a.orders, b.orders ? b.revenue / b.orders : 0)}.`,
        margin: `Margin after fees${forScope()} ${inP(p)}: ${fmtPct(a.profit / a.revenue)} (${m(a.profit)} profit on ${m(a.revenue)}).`,
      };
      let text = lead[met] + `\n` + list([`Revenue ${m(a.revenue)}`, `Profit after fees ${m(a.profit)}`, `${fmtNum(a.units)} items in ${fmtNum(a.orders)} orders`, `Fees ${m(a.fees)}`].filter((_, i) => !(met === 'revenue' && i === 0) && !(met === 'profit' && i === 1)));
      if (target && target.ids.size > 1 && target.kind !== 'channel') {
        const by = f.aggBy(p.from, p.to, (s) => s.pid, ids);
        const top = [...by.entries()].sort((x, y) => (met === 'units' ? y[1].units - x[1].units : y[1].revenue - x[1].revenue)).slice(0, 4);
        text += `\nBiggest within it:\n` + list(top.map(([id, x]) => `${name(id)}: ${met === 'units' ? `${fmtNum(x.units)} sold` : m(x.revenue)}`));
      }
      if (a.costMissingUnits && (met === 'profit' || met === 'margin')) text += `\n${fmtNum(a.costMissingUnits)} of these items have no cost price, so profit is overstated.`;
      return A(text, `Added up every sale${forScope()} from ${dayLabel(p.from)} to ${dayLabel(p.to - 1)}. Profit is revenue minus what you pay per item minus each channel's fee.`, target?.kind === 'product' ? sug.product(target.label) : ['Why did it change?', `Compare ${p.label} with ${prevP.label}`, 'What are my top 5 products?']);
    }

    // ---------------------------------------------------------- one product (or family) in full
    case 'product': {
      if (!target) break;
      const p30 = lastNDays(now, 30), a = f.agg(p30.from, p30.to, target.ids), b = f.agg(now - 60 * DAY, now - 30 * DAY, target.ids);
      if (target.kind !== 'product') {
        return A(`${cap(scope())}, last 30 days: ${m(a.revenue)} revenue (${changeWord(change(a.revenue, b.revenue))}), ${fmtNum(a.units)} sold, ${m(a.profit)} profit.\n` + list([...f.aggBy(p30.from, p30.to, (s) => s.pid, target.ids).entries()].sort((x, y) => y[1].revenue - x[1].revenue).slice(0, 5).map(([id, x]) => `${name(id)}: ${m(x.revenue)}, ${fmtNum(x.units)} sold`)), undefined, ['What should I reorder?', `What will I sell next month?`]);
      }
      const p = single!, it = f.fc.get(p.id), all = f.aggBy(p30.from, p30.to, (s) => s.pid);
      const rankPos = [...all.entries()].sort((x, y) => y[1].revenue - x[1].revenue).findIndex(([id]) => id === p.id);
      const lastSold = f.lastSoldAt(p.id);
      const lines = [
        a.units
          ? `Last 30 days: ${m(a.revenue)} revenue (${changeWord(change(a.revenue, b.revenue))}), ${fmtNum(a.units)} sold, ${m(a.profit)} profit after fees${a.revenue ? ` (${fmtPct(a.profit / a.revenue)})` : ''}.${rankPos >= 0 ? ` Your #${rankPos + 1} product by revenue.` : ''}`
          : `No sales in the last 30 days${lastSold ? `; the last was on ${dayLabel(lastSold)}` : ' (it has never sold)'}.`,
        p.stock_known ? `${fmtNum(p.stock_qty)} in stock${it?.stock_plan?.stockout_in_days != null ? `, about ${it.stock_plan.stockout_in_days} days left` : ''}.` : 'No stock count yet.',
      ];
      if (it?.forecast && !it.locked && it.forecast.next_week >= 0.2) lines.push(`Expected: about ${perWeek(it.forecast.next_week)}; sales are ${it.forecast.trend === 'rising' ? `rising (${changeWord(it.forecast.trend_pct)} over 4 weeks)` : it.forecast.trend === 'declining' ? `slowing (${changeWord(it.forecast.trend_pct)} over 4 weeks)` : it.forecast.trend === 'new' ? 'new, still settling' : 'steady'}.`);
      if (it?.stock_plan && !it.locked && it.stock_plan.reorder_qty) lines.push(`Order ${fmtNum(it.stock_plan.reorder_qty)}${it.stock_plan.order_by ? ` ${whenText(it.stock_plan.order_by, now)}` : ''}.`);
      if (it?.locked) lines.push(`It's beyond the ${fmtNum(f.limit)} best sellers your plan forecasts${f.pro ? '' : ` (Pro covers ${fmtNum(tools.proLimit)})`}.`);
      const byCh = f.aggBy(now - 90 * DAY, now, (s) => f.channelOf(s), new Set([p.id]));
      if (byCh.size > 1) lines.push(`Sells best on ${channelLabel([...byCh.entries()].sort((x, y) => y[1].revenue - x[1].revenue)[0][0])}.`);
      if (a.units && lastSold && now - lastSold > 14 * DAY) lines.push(`Last sold on ${dayLabel(lastSold)}.`);
      return A(`${p.name}${p.sku ? ` (${p.sku})` : ''}:\n` + list(lines), undefined, sug.product(p.name), [{ label: 'Open product', href: `/product/${p.id}` }]);
    }
  }

  // Didn't understand: say so, and offer what's close.
  const close = ctx.target ? sug.product(ctx.target.label) : periods.length ? [`How much did I make ${periods[0].label}?`, `Top 5 products ${periods[0].label}`, 'What needs my attention?'] : ['What needs my attention?', 'How is my store doing?', 'What should I reorder?'];
  return A(
    "I'm not sure what you mean. I can answer questions about your sales, profit, stock, reorders, prices, trends and forecasts, for any product, category, supplier, channel or period. Try one of these, or ask “what can you do?”",
    undefined, close,
  );
}

function list(rows: string[]): string {
  return rows.map((r) => `• ${r}`).join('\n');
}

/** Product names in suggestion buttons: the full name, so the button names exactly one product. */
function short(n: string): string {
  return n;
}

function channelLabel(k: string): string {
  return ({ ebay: 'eBay', amazon: 'Amazon', shopify: 'Shopify', etsy: 'Etsy', tiktok: 'TikTok Shop', other: 'other channels' } as Record<string, string>)[k] ?? k;
}

function whenText(iso: string, now: number): string {
  const today = new Date(now).toISOString().slice(0, 10);
  return iso <= today ? 'today' : `by ${dayLabel(iso)}`;
}
