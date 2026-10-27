const fs = require('fs');
// Run build_preview.py first; it writes the fixtures to dist/parity.
process.chdir(require('path').join(__dirname, 'dist', 'parity'));
globalThis.ENGINE_CONFIG = JSON.parse(fs.readFileSync('config.json'));
globalThis.XLSX = require('xlsx'); // npm install xlsx@0.18.5
require('./engine.js');
const E = globalThis.Engine;
const expected = JSON.parse(fs.readFileSync('expected.json'));
const now = Date.UTC(2026, 9, 27);
let bad = 0, checked = 0;
const close = (a, b) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)));
const ins = expected._insights; delete expected._insights;
for (const [key, sheets] of Object.entries(expected)) {
  const fn = sheets[0].file;
  const buf = fs.readFileSync(fn);
  const tables = E.readTables(fn, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  sheets.forEach((exp, i) => {
    const { rows } = tables[i];
    const a = E.analyse(rows), x = E.extract(rows, a);
    const mapping = Object.fromEntries(Object.entries(a.mapping).map(([k, v]) => [k, a.columns[v]]));
    const got = { platform: a.platform, kind: a.kind, orders: x.orders.length, units: x.orders.reduce((s, o) => s + o.quantity, 0), stock: x.stock.length, cancelled: x.skipped_cancelled, invalid: x.skipped_invalid, summary: E.summary(a, x, now).headline };
    for (const k of Object.keys(got)) if (got[k] !== exp[k]) { bad++; console.log(`${key}[${i}] ${k}: js=${got[k]} py=${exp[k]}`); }
    if (JSON.stringify(mapping) !== JSON.stringify(exp.mapping)) { bad++; console.log(key, 'mapping', mapping, exp.mapping); }
    const per = {};
    for (const o of x.orders) (per[o.key] = per[o.key] || []).push([o.when, o.quantity]);
    for (const [k, e] of Object.entries(exp.forecasts)) {
      checked++;
      const fc = E.forecastWeekly(E.weeklyBuckets(per[k] || [], now, 104), 4);
      const g = { next: fc.next_week, lo: fc.lower[0], hi: fc.upper[1], acc: fc.accuracy };
      for (const f of ['next', 'lo', 'hi', 'acc']) if (!close(g[f], e[f])) { bad++; console.log(`${key} ${k} ${f}: js=${g[f]} py=${e[f]}`); }
      if (JSON.stringify(fc.models.map((m) => m.name)) !== JSON.stringify(e.models)) { bad++; console.log(key, k, 'models', fc.models.map((m) => m.name), e.models); }
    }
  });
}
// 80/20 focus list, bundles and the profit calculator on a random store
const st = E.newStore();
for (const p of ins.products) E.addProduct(st, p);
st.sales = ins.sales.map(([pid, qty, price, when, channel, order]) => ({ pid, qty, price, when, channel, order }));
const prods = st.products, same = (name, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(name, '\njs', JSON.stringify(a), '\npy', JSON.stringify(b)); } };
same('focus', E.focusList(st, prods, now), ins.focus);
same('bundles', E.bundles(st, prods, now), ins.bundles);
ins.calc_args.forEach((args, i) => same('calc ' + i, E.profitCalc(...args), ins.calc[i]));
console.log(`checked ${checked} product forecasts across ${Object.keys(expected).length} files, plus insights; mismatches: ${bad}`);
