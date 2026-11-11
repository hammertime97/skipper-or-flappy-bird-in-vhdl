/**
 * Checks the on-phone brain (Ask StockPilot, profit leaks, alerts) against every sample store:
 * that common questions are understood, answers make sense, and nothing crashes.
 *   npm run test:brain
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCAL = fileURLToPath(new URL('../../src/local/', import.meta.url));
const { Engine: E } = await import(`${LOCAL}engine.ts`);
const { Facts } = await import(`${LOCAL}brain/facts.ts`);
const { ask } = await import(`${LOCAL}brain/ask.ts`);
const { findLeaks } = await import(`${LOCAL}brain/leaks.ts`);
const { findAlerts } = await import(`${LOCAL}brain/alerts.ts`);

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-11T15:00:00Z');
const TOOLS = { freeLimit: 200, proLimit: 600 };
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log('FAIL', msg);
};

function loadStore(key: string) {
  const samples = JSON.parse(readFileSync(`${LOCAL}generated/samples.json`, 'utf8'));
  const s = samples.find((x: { key: string }) => x.key === key);
  const tables: { a: any; x: any }[] = [];
  for (const f of s.files) {
    const buf = Buffer.from(f.b64, 'base64');
    for (const t of E.readTables(f.name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))) {
      const a = E.analyse(t.rows);
      tables.push({ a, x: a.missing.length ? null : E.extract(t.rows, a) });
    }
  }
  let newest = 0;
  for (const t of tables) if (t.x) for (const o of t.x.orders) newest = Math.max(newest, o.when);
  const shift = Math.round((Math.floor(NOW / DAY) * DAY - DAY - Math.floor(newest / DAY) * DAY) / DAY) * DAY;
  for (const t of tables) if (t.x) for (const o of t.x.orders) o.when += shift;
  const store = E.newStore();
  E.applyImport(store, tables.filter((t) => t.x));
  return store;
}

function facts(store: any, pro: boolean) {
  const limit = pro ? 600 : 200, end = Math.floor(NOW / DAY) * DAY + DAY;
  return new Facts(store, NOW, E.forecasts(store, NOW, limit, 4, new Map(), end), pro, 'USD', limit);
}

// ------------------------------------------------------------------ 1. understanding (the 554-product store)
const big = facts(loadStore('bigstore'), true);
const named = big.products.find((p: { name: string }) => p.name.includes('Yoga Mat – 10mm, Teal'))!.name;
const UNDERSTANDS: [string, string, ((a: any) => string | null)?][] = [
  ['hi', 'greet'],
  ['What can you do?', 'help'],
  ['How much profit did I make last month?', 'metric', (a) => (a.ctx.metric === 'profit' && a.ctx.period?.label === 'October' ? null : 'profit for October')],
  ['and in September?', 'metric', (a) => (a.ctx.period?.label === 'September' && a.ctx.metric === 'profit' ? null : 'follow-up keeps profit, moves to September')],
  ['how many water bottles did I sell in October', 'metric', (a) => (a.ctx.target?.ids.length >= 10 && a.ctx.metric === 'units' ? null : 'water bottles family, units')],
  ['Why did sales drop this week?', 'why'],
  ['What should I reorder?', 'reorder'],
  [`When will ${named} run out?`, 'runout', (a) => (a.ctx.target?.ids.length === 1 ? null : 'one product')],
  ['when will the lavender water bottle run out', 'runout', (a) => (a.ctx.target?.ids.length === 3 ? null : '3 lavender bottles')],
  ['Where am I losing money?', 'leaks'],
  ['What needs my attention?', 'attention'],
  ['Top 5 products by profit this month', 'rank', (a) => ((a.text.match(/^\d\. /gm) ?? []).length === 5 ? null : 'five rows')],
  ['top categories by revenue', 'rank', (a) => (/categories/.test(a.text) ? null : 'grouped by category')],
  ['compare this month vs last month', 'compare'],
  ['compare the black and white earbuds', 'compare', (a) => (/Black/.test(a.text) && /White/.test(a.text) && !/products:/.test(a.text) ? null : 'two single earbuds')],
  [`What if I raise the price of ${named} by 10%?`, 'whatif', (a) => (/instead of/.test(a.text) ? null : 'new vs old price')],
  ['what if I raise prices by 10%', 'whatif', (a) => (/every price/.test(a.text) ? null : 'store-wide')],
  ['What will I sell next month?', 'forecast', (a) => (/next 4 weeks/.test(a.text) ? null : '4 weeks')],
  ["What's not selling?", 'dead'],
  ['Which products sell together?', 'bundle'],
  ['best day of the week', 'weekday'],
  ['who are my customers', 'unsupported'],
  ['tell me about the teal 10mm yoga mat', 'product', (a) => (a.ctx.target?.ids.length === 1 ? null : 'one product')],
  ['how many yoga mtas did i sell', 'metric', (a) => (a.ctx.target ? null : 'typo still finds yoga mats')],
  ['revenue from the kitchen category last 3 months', 'metric', (a) => (a.ctx.target?.kind === 'category' ? null : 'kitchen category')],
  ['how much did I sell on ebay last week', 'metric', (a) => (a.ctx.channel === 'ebay' ? null : 'eBay channel')],
];
let ctx = null;
for (const [q, intent, check] of UNDERSTANDS) {
  const a = ask(q, big, ctx, TOOLS);
  ctx = a.ctx;
  if (a.ctx.intent !== intent) fail(`"${q}": understood as ${a.ctx.intent}, expected ${intent}`);
  const why = check?.(a);
  if (why) fail(`"${q}": ${why}\n${a.text}`);
}

// ------------------------------------------------------------------ 2. leaks and alerts find the demo store's planted problems
const leaks = findLeaks(big, null);
for (const kind of ['loss', 'thin_margin', 'price_slip', 'stockout', 'dead_stock']) {
  if (!leaks.items.some((l: { kind: string }) => l.kind === kind)) fail(`leak finder missed a ${kind}`);
}
if (findLeaks(facts(loadStore('bigstore'), false), 3).items.length > 3) fail('Free shows more than 3 leaks');
const alerts = findAlerts(big, leaks);
if (!alerts.counts.urgent) fail('no urgent alerts on a store with sold-out best sellers');
if (!alerts.digest.title || !alerts.reminders.length) fail('digest or order reminders missing');

// ------------------------------------------------------------------ 3. no crash or broken text, any store, any question
const QS = ['hi', 'thanks', 'what can you do', 'what needs my attention', 'how is my store doing', 'where am I losing money', 'what should I reorder',
  'how much cash do I need to restock', "what's out of stock", "what's not selling", 'which products sell together', 'what will I sell next week',
  'what will I sell next month', 'why did sales drop this week', 'why did sales go up this month', 'compare this month vs last month',
  'compare october and september', 'top 5 products by profit', 'worst sellers', 'lowest margin products', 'top categories', 'best day of the week',
  'which channel is best', 'how much are my fees', 'what is my stock worth', 'how much did I make last month', 'and in september?', 'revenue yesterday',
  'sales today', 'profit this year', 'orders last week', 'average order value this month', 'what price should I charge', 'what if I raise prices by 10%',
  'who are my customers', 'what about returns', 'asdfgh', 'trending', 'what should I sell next', 'how many did I sell all time', 'revenue last 90 days',
  'sales in may', 'sales in december 2025', 'last quarter', 'this quarter', 'compare last week and the week before'];
const BROKEN = /undefined|NaN|Infinity|\[object|null\b/;
for (const key of ['ebay', 'amazon', 'shopify', 'etsy', 'tiktok', 'spreadsheet', 'bigstore', 'empty']) {
  for (const pro of [false, true]) {
    const f = facts(key === 'empty' ? E.newStore() : loadStore(key), pro);
    try {
      const L = findLeaks(f, pro ? null : 3), A = findAlerts(f, L);
      const words = [L.headline, ...L.items.flatMap((l: any) => [l.title, l.detail, l.fix]), ...A.items.flatMap((a: any) => [a.title, a.body]), A.digest.title, A.digest.body, ...A.reminders.map((r: any) => r.body)].join('\n');
      if (BROKEN.test(words)) fail(`${key}: broken text in leaks or alerts: ${words.match(new RegExp(`.*(${BROKEN.source}).*`))?.[0]}`);
    } catch (e) {
      fail(`${key}: leaks/alerts crashed: ${e}`);
    }
    const p = f.products[Math.floor(f.products.length / 2)];
    const qs = p ? [...QS, `tell me about ${p.name}`, `when will ${p.name} run out`, `what price should I charge for ${p.name}`, `what if I lower the price of ${p.name} by 20%`, `what if I sell ${p.name} for $5`, `how many ${p.name} did I sell last month`, `compare ${f.products[0].name} and ${f.products[1].name}`, p.sku] : QS;
    let c = null;
    for (const q of qs) {
      try {
        const a = ask(q, f, c, TOOLS);
        c = a.ctx;
        if (!a.text || BROKEN.test(a.text + (a.how ?? '') + a.suggestions.join('|'))) fail(`${key}/${pro ? 'pro' : 'free'} "${q}": ${a.text}`);
      } catch (e) {
        fail(`${key}/${pro ? 'pro' : 'free'} "${q}" crashed: ${e}`);
      }
    }
  }
}

console.log(failures ? `\n${failures} problem(s)` : 'brain check: all good');
process.exit(failures ? 1 : 0);
