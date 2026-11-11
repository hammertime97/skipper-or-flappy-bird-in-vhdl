/**
 * Understanding a seller's question without a cloud AI: time periods ("last month", "in October",
 * "this week vs last week"), what they want to measure, and which products, categories, suppliers
 * or sales channels they mean, even with typos, plurals or only part of a product name.
 */
import { DAY, Facts } from './facts';
import type { LocalProduct } from '../engine';

export interface Period {
  from: number;
  to: number;
  label: string;
}

export type Metric = 'revenue' | 'profit' | 'units' | 'orders' | 'fees' | 'aov' | 'margin';

export interface Target {
  kind: 'product' | 'group' | 'category' | 'supplier' | 'channel';
  label: string;
  ids: Set<number>;
  /** For channels: the channel key (ebay, amazon…). */
  channel?: string;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(20\d\d))?/g;
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };

export function normalise(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const dayStart = (t: number) => Math.floor(t / DAY) * DAY;
const monthStart = (y: number, m: number) => Date.UTC(y, m, 1);
const fmtMonth = (y: number, m: number, now: number) => `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)}${y !== new Date(now).getUTCFullYear() ? ` ${y}` : ''}`;

/** Every time period mentioned, in the order they appear. Periods end at "now" at the latest. */
export function parsePeriods(t: string, now: number): Period[] {
  const found: { at: number; p: Period }[] = [];
  const today = dayStart(now), d = new Date(now), y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const add = (at: number, from: number, to: number, label: string) => found.push({ at, p: { from, to: Math.min(to, now), label } });
  const mondayOf = (t0: number) => t0 - ((new Date(t0).getUTCDay() + 6) % 7) * DAY;
  let m: RegExpExecArray | null;

  const rules: [RegExp, (m: RegExpExecArray) => void][] = [
    [/\btoday\b/g, (m) => add(m.index, today, now, 'today')],
    [/\byesterday\b/g, (m) => add(m.index, today - DAY, today, 'yesterday')],
    [/\bthis week\b/g, (m) => add(m.index, mondayOf(today), now, 'this week so far')],
    [/\b(last|previous|past) week\b/g, (m) => add(m.index, mondayOf(today) - 7 * DAY, mondayOf(today), 'last week')],
    [/\b(?:the )?week before(?: last)?\b/g, (m) => add(m.index, mondayOf(today) - 14 * DAY, mondayOf(today) - 7 * DAY, 'the week before last')],
    [/\bthis month\b/g, (m) => add(m.index, monthStart(y, mo), now, fmtMonth(y, mo, now) + ' so far')],
    [/\b(last|previous|past) month\b/g, (m) => {
      const pm = (mo + 11) % 12, py = mo === 0 ? y - 1 : y;
      add(m.index, monthStart(py, pm), monthStart(y, mo), fmtMonth(py, pm, now));
    }],
    [/\b(?:the )?month before(?: last)?\b/g, (m) => {
      const pm = (mo + 10) % 12, py = mo <= 1 ? y - 1 : y;
      add(m.index, monthStart(py, pm), monthStart(py, pm + 1), fmtMonth(py, pm, now));
    }],
    [/\b(last|past|previous|the last|over the last|in the last)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty)\s+(day|week|month|year)s?\b/g, (m) => {
      const n = /\d/.test(m[2]) ? Number(m[2]) : NUM_WORDS[m[2]] ?? 1, unit = m[3];
      const days = unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'month' ? n * 30 : n * 365;
      add(m.index, now - days * DAY, now, `the last ${n === 1 ? unit : `${n} ${unit}s`}`);
    }],
    [/\b(\d+)\s*(day|week|month)s?\b(?! (from now|ahead|time))/g, (m) => {
      // "30 days", "8 weeks" on their own (but not "in 3 weeks from now")
      if (found.some((f) => Math.abs(f.at - m.index) < 25)) return;
      const n = Number(m[1]), unit = m[2], days = unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
      if (n > 0 && n <= 1000) add(m.index, now - days * DAY, now, `the last ${n} ${unit}s`);
    }],
    [/\b(fortnight|two weeks)\b/g, (m) => {
      if (found.some((f) => Math.abs(f.at - m.index) < 20)) return;
      add(m.index, now - 14 * DAY, now, 'the last 2 weeks');
    }],
    [/\bthis year\b|\byear to date\b|\bytd\b|\bso far this year\b/g, (m) => add(m.index, Date.UTC(y, 0, 1), now, `${y} so far`)],
    [/\b(last|previous|past) year\b/g, (m) => add(m.index, Date.UTC(y - 1, 0, 1), Date.UTC(y, 0, 1), String(y - 1))],
    [/\b(this|last|previous) quarter\b/g, (m) => {
      const q = Math.floor(mo / 3), qq = m[1] === 'this' ? q : q - 1, qy = qq < 0 ? y - 1 : y, qs = ((qq % 4) + 4) % 4;
      add(m.index, monthStart(qy, qs * 3), m[1] === 'this' ? now : monthStart(qy, qs * 3 + 3), `Q${qs + 1} ${qy}${m[1] === 'this' ? ' so far' : ''}`);
    }],
    [/\b(all time|ever|since (i|we) (started|began|opened)|in total|overall|all together|altogether)\b/g, (m) => add(m.index, 0, now, 'all time')],
    [/\b(black friday|cyber monday|christmas|xmas)\b/g, () => {
      // handled as plain words (not a period) unless asked "last black friday"; left to the answer.
    }],
  ];
  for (const [re, fn] of rules) {
    re.lastIndex = 0;
    while ((m = re.exec(t))) fn(m);
  }
  // Month names: "October", "in oct 2025". "may" only counts with a hint ("in may", "may 2026").
  MONTH_RE.lastIndex = 0;
  while ((m = MONTH_RE.exec(t))) {
    const word = m[1];
    if (word === 'may' && !m[2] && !/\b(in|during|for|of|since|from|vs|versus|and|than|compare[ds]?) may\b|\bmay (vs|versus|and|compared)\b/.test(t)) continue;
    if (word === 'mar' && !m[2] && !/\b(in|during|for|of|vs) mar\b/.test(t)) continue;
    const mi = MONTHS.findIndex((x) => x.startsWith(word.slice(0, 3)));
    let yr = m[2] ? Number(m[2]) : y;
    if (!m[2] && mi > mo) yr = y - 1; // "October" in February means last October
    const from = monthStart(yr, mi);
    if (from > now) continue;
    add(m.index, from, monthStart(yr, mi + 1), fmtMonth(yr, mi, now) + (yr === y && mi === mo ? ' so far' : ''));
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.p).filter((p, i, a) => a.findIndex((x) => x.from === p.from && x.to === p.to) === i);
}

/** The period of the same length just before p (for "compared with"). */
export function previousPeriod(p: Period, now: number): Period {
  const len = p.to - p.from;
  const d = new Date(p.from);
  // "So far" periods compare with the same days of the week/month/year before.
  if (/so far$/.test(p.label)) {
    if (p.label.startsWith('this week')) return { from: p.from - 7 * DAY, to: p.to - 7 * DAY, label: 'the same days last week' };
    if (/^\d{4} so far$/.test(p.label)) {
      const from = Date.UTC(d.getUTCFullYear() - 1, 0, 1);
      return { from, to: from + len, label: 'the same days last year' };
    }
    if (/^Q\d/.test(p.label)) return { from: p.from - 91 * DAY, to: p.to - 91 * DAY, label: 'the same days last quarter' };
    const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
    return { from, to: from + len, label: 'the same days last month' };
  }
  // Calendar months compare with the previous calendar month.
  if (d.getUTCDate() === 1 && p.from % DAY === 0 && len >= 28 * DAY && len <= 31 * DAY + 1) {
    const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
    return { from, to: p.from, label: fmtMonth(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), now) };
  }
  const q = /^Q(\d) (\d{4})$/.exec(p.label);
  if (q) {
    const qi = Number(q[1]) - 2, yr = Number(q[2]) - (qi < 0 ? 1 : 0), qs = (qi + 4) % 4;
    return { from: Date.UTC(yr, qs * 3, 1), to: p.from, label: `Q${qs + 1} ${yr}` };
  }
  const days = Math.round(len / DAY);
  return { from: p.from - len, to: p.from, label: days === 1 ? 'the day before' : `the ${days} days before` };
}

export const lastNDays = (now: number, n: number): Period => ({ from: now - n * DAY, to: now, label: `the last ${n} days` });

export function parseMetric(t: string): Metric | null {
  if (/\b(average order|aov|basket|per order|order value)\b/.test(t)) return 'aov';
  if (/\bmargins?\b|\bmark-?up\b/.test(t)) return 'margin';
  if (/\b(fees?|commission|charges)\b/.test(t)) return 'fees';
  if (/\bprofit|\bearn|\bnet\b|\bmake money|\bmade money|\bclear(ed)?\b.*\bafter\b|\btake home|\bkeep\b/.test(t)) return 'profit';
  if (/\bhow many (orders|customers|buyers|transactions)|\borders?\b(?! more)|\bcustomers\b|\btransactions\b/.test(t) && !/\b(re)?order (more|now|today|by)\b|\bshould i (re)?order\b|\bwhat to order\b/.test(t)) return 'orders';
  if (/\bhow many\b|\bunits?\b|\bitems?\b|\bpieces\b|\bquantity\b|\bvolume\b|\bsold\b(?! for)/.test(t)) return 'units';
  if (/\brevenue|\bsales\b|\bturnover|\btakings|\bincome|\bgross\b|\bmade\b|\bmake\b|\bsell(ing)? for|\bhow much\b|\bmoney\b/.test(t)) return 'revenue';
  return null;
}

export function parseCount(t: string, fallback = 5): number {
  const m = /\b(top|best|worst|bottom|first|last)\s+(\d+|three|five|ten|twenty)\b/.exec(t) ?? /\b(\d+|three|five|ten|twenty)\s+(best|worst|top|products|items|sellers)\b/.exec(t);
  if (!m) return fallback;
  const raw = /\d/.test(m[2] ?? '') ? m[2] : /\d/.test(m[1]) ? m[1] : (NUM_WORDS[m[2]] ?? NUM_WORDS[m[1]] ?? fallback);
  return Math.max(1, Math.min(25, Number(raw)));
}

/** A percentage ("by 10%") or an amount ("to $24.99") for what-if price questions. */
export function parsePriceChange(t: string): { pct?: number; to?: number } | null {
  const pctM = /(\d+(?:\.\d+)?)\s*(%|percent)/.exec(t);
  if (pctM) {
    const n = Number(pctM[1]), down = /\b(lower|drop|cut|reduce|discount|decrease|down|less|off|cheaper|sale)\b/.test(t);
    if (n > 0 && n < 100) return { pct: (down ? -n : n) / 100 };
  }
  const toM = /\bto\s*[$£€]?\s*(\d+(?:\.\d{1,2})?)\b|[$£€]\s*(\d+(?:\.\d{1,2})?)/.exec(t);
  if (toM) {
    const v = Number(toM[1] ?? toM[2]);
    if (v > 0) return { to: v };
  }
  return null;
}

// ------------------------------------------------------------------ products, categories, suppliers, channels

// Words that describe the question, not the product.
const STOP = new Set(
  ('a an the and or of for to in on at by with from my our me i we you your is are was were be been do did does done have has had ' +
    'what which who whom when where why how much many any some all this that these those it its it\'s them they there than then ' +
    'sell sold sells selling sale sales order orders ordered ordering reorder restock stock stocks stocked item items product products ' +
    'unit units piece pieces revenue profit profits margin margins money make made earn earned earning cost costs price prices priced pricing ' +
    'week weeks month months year years day days today yesterday last next this past previous since ago time times ' +
    'top best worst most least more less highest lowest biggest smallest good bad great well doing going about tell show give ' +
    'should could would will can may might shall must need needs want please thanks thank hi hello hey ok okay yes no not ' +
    'compare compared comparison versus vs against between both each per average total overall number amount ' +
    'run runs running out low left still also just only ever every much lot lots get got buy bought bundle together ' +
    'forecast predict expect expected trend trending rising falling drop dropped fall fell down up increase decrease ' +
    'raise raised lower lowered charge charging percent if what\'s whats whys hows going happen happened why ' +
    'category categories supplier suppliers vendor vendors channel channels platform platforms shop store online')
    .split(' '),
);

const stem = (w: string) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(ches|shes|sses|xes)$/, (s) => s.slice(0, -2)).replace(/([^s])s$/, '$1');

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 1)
    .map(stem);
}

/** Edit distance up to 1 (one typo) for words of 5+ letters. */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export class Matcher {
  private readonly docs: { p: LocalProduct; words: Set<string>; sku: string }[];
  private readonly idf = new Map<string, number>();
  private readonly vocab: string[];

  constructor(private readonly f: Facts) {
    this.docs = f.products.map((p) => ({ p, words: new Set(tokens(`${p.name}`)), sku: p.sku.toLowerCase() }));
    const df = new Map<string, number>();
    for (const d of this.docs) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
    const n = Math.max(1, this.docs.length);
    for (const [w, c] of df) this.idf.set(w, Math.log(1 + n / c));
    this.vocab = [...df.keys()];
  }

  /** The question's words that could name a product (typos fixed against product words). */
  private queryWords(text: string): string[] {
    const out: string[] = [];
    for (const w of tokens(text)) {
      if (STOP.has(w) || /^\d+$/.test(w)) continue;
      if (this.idf.has(w)) out.push(w);
      else {
        const fix = this.vocab.find((v) => close(v, w));
        if (fix) out.push(fix);
      }
    }
    return [...new Set(out)];
  }

  /** Products the text names: one product, or a family of similar ones ("water bottles"). */
  products(text: string): Target | null {
    const t = text.toLowerCase();
    const skuHit = this.docs.find((d) => d.sku.length >= 3 && new RegExp(`(^|[^a-z0-9-])${d.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9-])`).test(t));
    if (skuHit) return { kind: 'product', label: skuHit.p.name, ids: new Set([skuHit.p.id]) };
    const words = this.queryWords(text);
    if (!words.length) return null;
    let best = 0;
    const scored = this.docs.map((d) => {
      let s = 0, hits = 0;
      for (const w of words) if (d.words.has(w)) {
        s += this.idf.get(w)!;
        hits++;
      }
      if (s > best) best = s;
      return { d, s, hits };
    });
    if (best < 1.2) return null;
    const top = scored.filter((x) => x.s >= best - 1e-9);
    // Every word the best match used must be meaningful; a single very common word ("set") isn't enough.
    if (top[0].hits === 1 && this.idf.get(words.find((w) => top[0].d.words.has(w))!)! < 1.5) return null;
    if (top.length === 1) return { kind: 'product', label: top[0].d.p.name, ids: new Set([top[0].d.p.id]) };
    const matched = words.filter((w) => top[0].d.words.has(w));
    const label = matched.map((w) => this.surface(w, top.map((x) => x.d.p.name))).join(' ');
    return { kind: 'group', label: `the ${top.length} ${label} products`, ids: new Set(top.map((x) => x.d.p.id)) };
  }

  /** How the word is written in the product names ("Water" not "water"). */
  private surface(w: string, names: string[]): string {
    for (const n of names) {
      const m = n.split(/[\s,–-]+/).find((x) => stem(x.toLowerCase().replace(/[^a-z0-9]/g, '')) === w);
      if (m) return m.replace(/[^A-Za-z0-9]/g, '');
    }
    return w;
  }

  category(text: string): Target | null {
    return this.named(text, this.f.categories(), (p) => p.category, 'category');
  }

  supplier(text: string): Target | null {
    return this.named(text, this.f.suppliers(), (p) => p.supplier, 'supplier');
  }

  private named(text: string, names: string[], get: (p: LocalProduct) => string, kind: 'category' | 'supplier'): Target | null {
    let best: { name: string; score: number } | null = null;
    for (const name of names) {
      const ws = tokens(name).filter((w) => w.length > 2 && !['and', 'the', 'ltd', 'co', 'inc', 'limited', 'company', 'supplies', 'supply'].includes(w));
      if (!ws.length) continue;
      const qs = tokens(text);
      const hit = ws.filter((w) => qs.some((q) => close(q, w))).length;
      // Category: all its words; supplier: its most distinctive (first) word is enough.
      const ok = kind === 'category' ? hit === ws.length : hit >= 1 && qs.some((q) => close(q, ws[0]));
      if (ok && (!best || hit > best.score)) best = { name, score: hit };
    }
    if (!best) return null;
    const ids = new Set(this.f.products.filter((p) => (get(p) || '').trim() === best!.name).map((p) => p.id));
    return { kind, label: best.name, ids };
  }

  channel(text: string): Target | null {
    const m = /\b(ebay|amazon|shopify|etsy|tik ?tok|website|web shop|webshop|my site|online store)\b/.exec(text.toLowerCase());
    if (!m) return null;
    const key = m[1].startsWith('tik') ? 'tiktok' : /web|site|online/.test(m[1]) ? 'shopify' : m[1];
    if (!this.f.channels().includes(key)) return { kind: 'channel', label: key, ids: new Set(), channel: key };
    return { kind: 'channel', label: key, ids: new Set(this.f.products.map((p) => p.id)), channel: key };
  }

  /** Splits "compare A and B" / "A vs B" into the two products or families ("the black and white earbuds" works too). */
  pair(text: string): [Target, Target] | null {
    const body = text.replace(/^.*?\b(compare|comparing|comparison of|difference between)\b/, '').replace(/\?$/, '');
    const parts = body.split(/\s+(?:vs\.?|versus|and|with|to|or|against)\s+/);
    if (parts.length < 2) return null;
    const best = (opts: string[]) => {
      let pick: Target | null = null;
      for (const o of opts) {
        const r = this.products(o);
        if (r && (!pick || r.ids.size < pick.ids.size)) pick = r;
      }
      return pick;
    };
    for (let i = 1; i < parts.length; i++) {
      const x = parts.slice(0, i).join(' '), y = parts.slice(i).join(' ');
      const xw = x.trim().split(/\s+/), yw = y.trim().split(/\s+/);
      // "black" borrows "earbuds" from the other side; "white" borrows the start of the first.
      const a = best([x, `${x} ${yw.slice(1).join(' ')}`]), b = best([y, `${xw.slice(0, -1).join(' ')} ${y}`]);
      if (a && b && [...a.ids].some((id) => !b.ids.has(id))) return [a, b];
    }
    return null;
  }
}

/** "in October", but "the last 30 days", "this week so far", "yesterday" as they are. */
export function inP(p: Period): string {
  return /^(the |this |last |today|yesterday|all time|\d{4} so far)/.test(p.label) ? p.label : `in ${p.label}`;
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
