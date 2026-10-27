/* StockPilot engine for the browser preview: a line-by-line port of the backend's
 * importer.py, services_import.py, forecasting.py, fees.py and services.py.
 * Tables (column names, platform fingerprints, guides, fees) come from the backend as CFG. */
(function (root) {
  'use strict';
  const CFG = root.ENGINE_CONFIG;
  const DAY = 86400000;

  // ------------------------------------------------------------------ importer
  const norm = (h) => String(h ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
  const MAX_ROWS = 250000, MAX_QTY_PER_LINE = 100000, MAX_UNIT_PRICE = 1000000;
  const TOO_MANY_ROWS = `This file has more than ${MAX_ROWS.toLocaleString('en-US')} rows. Download a shorter date range (for example the last 12 months) and upload that.`;
  const KNOWN = new Set(Object.values(CFG.role_synonyms).flat());
  const SKIP_STATUS = /cancel|refund|return|void|fail|declin|unpaid|pending payment/i;
  const MONTH_FIRST = new Set(['etsy', 'amazon', 'tiktok', 'shopify']);

  class ImportProblem extends Error {}

  function sniffDelimiter(sample) {
    const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
    let best = ',', bestScore = -1;
    for (const d of [',', '\t', ';', '|']) {
      const counts = lines.map((l) => l.split(d).length - 1);
      if (!counts.length) continue;
      const freq = {};
      for (const c of counts) freq[c] = (freq[c] || 0) + 1;
      let common = 0, cnt = 0;
      for (const [k, v] of Object.entries(freq)) if (v > cnt || (v === cnt && +k > common)) { common = +k; cnt = v; }
      const score = common ? common * cnt : 0;
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  function parseCsv(text, delim) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
  }

  function rowHits(r) { return r.reduce((n, c) => n + (KNOWN.has(norm(c)) ? 1 : 0), 0); }
  function headerScore(rows) { return rows.length ? Math.max(...rows.slice(0, 15).map(rowHits)) : -1; }

  /** name + ArrayBuffer -> [{sheet, rows}] */
  function readTables(name, buf) {
    const lower = (name || '').toLowerCase();
    const bytes = new Uint8Array(buf);
    if (!bytes.length) throw new ImportProblem('The file is empty.');
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      if (!root.XLSX) throw new ImportProblem("Excel files can't be read here right now. Save it as CSV and try again.");
      let wb;
      try { wb = root.XLSX.read(bytes, { type: 'array', cellDates: true }); }
      catch { throw new ImportProblem("We couldn't open this Excel file. Try saving it again as .xlsx or CSV."); }
      const sheets = [];
      for (const sn of wb.SheetNames) {
        const raw = root.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
        const rows = raw.map((r) => r.map(cellText)).filter((r) => r.some((c) => c));
        if (rows.length > MAX_ROWS) throw new ImportProblem(TOO_MANY_ROWS);
        if (headerScore(rows) >= 2) sheets.push({ sheet: sn, rows });
      }
      if (!sheets.length) throw new ImportProblem("We couldn't find sales or stock columns in this Excel file. Make sure the first rows of a sheet have headings like Date, Product, Quantity, Price or Stock.");
      return sheets;
    }
    if (lower.endsWith('.xls') || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
      throw new ImportProblem('This is an old Excel file (.xls). Open it in Excel or Google Sheets and choose File > Save as > .xlsx or CSV, then upload that.');
    }
    if (/\.(numbers|pdf|zip)$/.test(lower)) throw new ImportProblem('Please upload a CSV, TXT or Excel (.xlsx) file.');
    let text;
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) text = new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes);
    else if (bytes.subarray(0, 4096).includes(0)) throw new ImportProblem("This doesn't look like a sales or stock file. Please upload the CSV, TXT or Excel file you downloaded.");
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { text = new TextDecoder('windows-1252').decode(bytes); } // Excel on Windows saves CSV this way
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = parseCsv(text, sniffDelimiter(text.slice(0, 20000)));
    if (rows.length > MAX_ROWS) throw new ImportProblem(TOO_MANY_ROWS);
    return [{ sheet: '', rows }];
  }

  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
    if (typeof v === 'number' && Number.isInteger(v)) return String(v);
    return String(v).trim();
  }

  function findHeader(rows) {
    let bi = 0, bh = -1;
    rows.slice(0, 15).forEach((r, i) => { const h = rowHits(r); if (h > bh) { bi = i; bh = h; } });
    return bi;
  }

  function detectPlatform(headers) {
    const have = new Set(headers.map(norm));
    for (const [platform, kind, needed] of CFG.platform_signatures) if (needed.every((n) => have.has(n))) return [platform, kind];
    return ['spreadsheet', null];
  }

  function mapColumns(headers, platform) {
    const normed = headers.map(norm), mapping = {}, used = new Set();
    for (const [role, syns] of Object.entries(CFG.platform_overrides[platform] || {})) {
      const idx = normed.findIndex((h) => syns.includes(h));
      if (idx >= 0) { mapping[role] = idx; used.add(idx); }
    }
    for (const [role, syns] of Object.entries(CFG.role_synonyms)) {
      if (role in mapping) continue;
      for (const syn of syns) {
        const idx = normed.findIndex((h, i) => h === syn && !used.has(i));
        if (idx >= 0) { mapping[role] = idx; used.add(idx); break; }
      }
    }
    for (const [role, syns] of Object.entries(CFG.role_synonyms)) {
      if (role in mapping) continue;
      for (const syn of syns) {
        if (syn.length < 4) continue;
        const idx = normed.findIndex((h, i) => !used.has(i) && h.startsWith(syn));
        if (idx >= 0) { mapping[role] = idx; used.add(idx); break; }
      }
    }
    return mapping;
  }

  const requiredRoles = (kind) => (kind === 'orders' ? ['date', 'quantity'] : ['stock']);

  function missingFor(kind, mapping) {
    const m = requiredRoles(kind).filter((r) => !(r in mapping));
    if (!['sku', 'item_id', 'name'].some((r) => r in mapping)) m.push('name');
    return m;
  }

  function analyse(rows) {
    if (!rows.length) throw new ImportProblem('The file is empty.');
    const h = findHeader(rows), headers = rows[h];
    let [platform, kind] = detectPlatform(headers);
    const mapping = mapColumns(headers, platform);
    if (platform === 'shopify') delete mapping.line_total;
    // Most uploads are sales files: only call it a stock list when it has stock or cost columns and no dates.
    if (!kind) kind = ('stock' in mapping || 'cost' in mapping) && !('date' in mapping) ? 'stock' : 'orders';
    if (kind === 'stock' && !('stock' in mapping) && 'quantity' in mapping) { mapping.stock = mapping.quantity; delete mapping.quantity; }
    const missing = missingFor(kind, mapping);
    const confident = !missing.length && (platform !== 'spreadsheet' || Object.keys(mapping).length >= 3);
    return { platform, kind, header_row: h, columns: headers, mapping, missing, confident };
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const year4 = (y) => (y < 100 ? 2000 + y : y);

  function parseDate(value, dayFirst) {
    let v = String(value ?? '').trim();
    if (!v) return null;
    v = v.replace(/\s*(PST|PDT|EST|EDT|CST|CDT|MST|MDT|GMT|UTC|BST|CET|CEST|AEST|AEDT)$/i, '');
    // A spreadsheet date serial (days since 30 Dec 1899) that lost its date format, e.g. 46299 = 2026-10-03.
    if (/^\d{5}(\.\d+)?$/.test(v) && +v >= 30000 && +v <= 80000) return Date.UTC(1899, 11, 30) + Math.round(+v * DAY);
    let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
    if (m) {
      let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      if (m[7] && m[7] !== 'Z') {
        const sign = m[7][0] === '-' ? -1 : 1, hh = +m[7].slice(1, 3), mm = +m[7].slice(-2);
        t -= sign * (hh * 60 + mm) * 60000;
      }
      return t;
    }
    m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (m) {
      let a = +m[1], b = +m[2];
      let day, mon;
      if (dayFirst === false) { mon = a; day = b; }
      else if (dayFirst === true) { day = a; mon = b; }
      else if (a > 12) { day = a; mon = b; } else if (b > 12) { mon = a; day = b; } else { day = a; mon = b; }
      let hh = +(m[4] || 0);
      if (m[7]) { const pm = m[7].toUpperCase() === 'PM'; if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; }
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
      return Date.UTC(year4(+m[3]), mon - 1, day, hh, +(m[5] || 0), +(m[6] || 0));
    }
    m = v.match(/^([A-Za-z]{3,9})[\s-](\d{1,2}),?[\s-](\d{2,4})$/);
    if (m && MONTHS[m[1].toLowerCase().slice(0, 3)] !== undefined) return Date.UTC(year4(+m[3]), MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]);
    m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})$/);
    if (m && MONTHS[m[2].toLowerCase().slice(0, 3)] !== undefined) return Date.UTC(year4(+m[3]), MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]);
    return null;
  }

  function guessDayFirst(values) {
    let f = false, s = false;
    for (const v of values) {
      const m = String(v || '').match(/^\s*(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
      if (!m) continue;
      f = f || +m[1] > 12; s = s || +m[2] > 12;
    }
    if (f && !s) return true;
    if (s && !f) return false;
    return null;
  }

  function parseNumber(value) {
    let v = String(value ?? '').trim();
    if (!v) return null;
    const neg = v.startsWith('(') && v.endsWith(')');
    const m = v.replace(/[\s ]/g, '').match(/-?\d+(?:[.,]\d+)*/);
    if (!m) return null;
    let s = m[0];
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    const n = parseFloat(s);
    if (Number.isNaN(n)) return null;
    return neg ? -n : n;
  }

  const slug = (t) => (t.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ITEM');

  function productKey(sku, itemId, name, platform) {
    if (sku) return [sku.toUpperCase(), sku];
    if (itemId) { const made = `${platform.toUpperCase().slice(0, 6)}-${itemId}`; return [made.toUpperCase(), made]; }
    if (name) { const made = slug(name); return [made, made]; }
    return ['', ''];
  }

  const isFooter = (r) => /record\(s\) downloaded|seller id :|^total\b|^totals\b/.test(r.join(' ').toLowerCase()) && r.filter((c) => c).length <= 3;

  function extract(rows, a) {
    const out = { orders: [], stock: [], skipped_cancelled: 0, skipped_invalid: 0, problems: [], first: null, last: null };
    const body = rows.slice(a.header_row + 1), m = a.mapping;
    const get = (r, role) => (m[role] !== undefined && m[role] < r.length ? String(r[m[role]] ?? '').trim() : '');
    if (a.kind === 'orders') {
      let dayFirst = guessDayFirst(body.slice(0, 2000).map((r) => get(r, 'date')));
      if (dayFirst === null && MONTH_FIRST.has(a.platform)) dayFirst = false;
      const cancelledCol = a.columns.findIndex((h) => ['cancelledat', 'cancelleddate'].includes(norm(h)));
      let lastOrder = '', lastDate = '';
      const cancelledOrders = new Set(), seen = {}, latestOk = Date.now() + DAY; // time zones can put today's orders on "tomorrow"
      body.forEach((r, i) => {
        if (isFooter(r)) return;
        const orderRef = get(r, 'order_id') || lastOrder;
        const rawDate = get(r, 'date') || (orderRef === lastOrder ? lastDate : '');
        lastOrder = orderRef; lastDate = rawDate;
        const status = get(r, 'status');
        const cancelled = cancelledCol >= 0 && cancelledCol < r.length && String(r[cancelledCol]).trim();
        if (cancelled || (status && SKIP_STATUS.test(status)) || (orderRef && cancelledOrders.has(orderRef))) {
          if (orderRef) cancelledOrders.add(orderRef);
          out.skipped_cancelled++; return;
        }
        const name = get(r, 'name');
        const [key, sku] = productKey(get(r, 'sku'), get(r, 'item_id'), name, a.platform);
        const qRaw = get(r, 'quantity');
        const qty = qRaw ? parseNumber(qRaw) : 1;
        const when = parseDate(rawDate, dayFirst);
        let price = parseNumber(get(r, 'unit_price'));
        const reason = !key ? 'no product name or SKU' : when === null ? 'no readable date' : when > latestOk ? 'date is in the future'
          : qty === null || qty <= 0 ? 'no quantity' : qty > MAX_QTY_PER_LINE ? 'quantity looks wrong' : price !== null && Math.abs(price) > MAX_UNIT_PRICE ? 'price looks wrong' : '';
        if (reason) {
          out.skipped_invalid++;
          if (out.problems.length < 20) out.problems.push(`Row ${i + a.header_row + 2}: ${reason}`);
          return;
        }
        const quantity = Math.round(qty);
        const total = parseNumber(get(r, 'line_total'));
        if (CFG.line_total_price_platforms.includes(a.platform) && price !== null) price = price / quantity;
        if (price === null && total !== null) price = total / quantity;
        let channel = get(r, 'channel') || CFG.platform_names[a.platform] || '';
        if (a.platform === 'spreadsheet' && channel === CFG.platform_names.spreadsheet) channel = '';
        let ident = [a.platform, orderRef, key, quantity, when, price].join('|');
        seen[ident] = (seen[ident] || 0) + 1;
        ident += '#' + seen[ident];
        out.orders.push({ key, sku, name: name || sku, quantity, unit_price: price, when, order_ref: orderRef, channel: channel.toLowerCase(), import_key: ident });
        if (out.first === null || when < out.first) out.first = when;
        if (out.last === null || when > out.last) out.last = when;
      });
    } else {
      const merged = new Map();
      body.forEach((r) => {
        if (isFooter(r)) return;
        const name = get(r, 'name');
        const [key, sku] = productKey(get(r, 'sku'), get(r, 'item_id'), name, a.platform);
        if (!key) { out.skipped_invalid++; return; }
        const stock = parseNumber(get(r, 'stock')), lead = parseNumber(get(r, 'lead_time_days'));
        const rec = {
          key, sku, name: name || sku, stock: stock !== null ? Math.round(stock) : null,
          price: parseNumber(get(r, 'unit_price')), cost: parseNumber(get(r, 'cost')),
          category: get(r, 'category'), supplier: get(r, 'supplier'), lead_time_days: lead !== null && lead >= 0 && lead <= 180 ? Math.trunc(lead) : null,
        };
        const prev = merged.get(key);
        if (!prev) merged.set(key, rec);
        else {
          for (const f of ['stock', 'price', 'cost', 'lead_time_days']) if (rec[f] !== null) prev[f] = rec[f];
          for (const f of ['category', 'supplier']) if (rec[f]) prev[f] = rec[f];
          if (rec.name && (!prev.name || prev.name === prev.sku)) prev.name = rec.name;
        }
      });
      out.stock = [...merged.values()];
    }
    return out;
  }

  const fmtD = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function summary(a, x, now) {
    const platform = CFG.platform_names[a.platform] || a.platform;
    let headline;
    if (a.kind === 'orders') {
      const products = new Set(x.orders.map((o) => o.key)).size;
      const units = x.orders.reduce((s, o) => s + o.quantity, 0);
      const span = x.first !== null ? ` from ${fmtD(x.first)} to ${fmtD(x.last)}` : '';
      headline = `We found ${plural(units, 'item')} sold across ${plural(products, 'product')}${span}` + (a.platform === 'spreadsheet' ? '.' : ` in your ${platform} file.`);
    } else {
      headline = `We found ${plural(x.stock.length, 'product')} with stock levels` + (a.platform === 'spreadsheet' ? '.' : ` in your ${platform} file.`);
    }
    const notes = [];
    if (x.skipped_cancelled) notes.push(`${plural(x.skipped_cancelled, 'cancelled or refunded order')} will be left out.`);
    if (x.skipped_invalid) notes.push(`${plural(x.skipped_invalid, 'row')} will be skipped because a date, product or quantity was missing or unreadable.`);
    if (a.kind === 'orders' && x.last !== null && x.last < now - 21 * DAY) notes.push('The newest sale in this file is over 3 weeks old. Download a file that includes recent sales for better forecasts.');
    if (a.kind === 'orders' && x.first !== null && x.last - x.first < 42 * DAY) notes.push('This file covers less than 6 weeks. Forecasts get much better with 3 months or more of sales.');
    return { headline, notes };
  }

  function describe(a) {
    return Object.entries(a.mapping).sort((p, q) => p[1] - q[1]).map(([role, idx]) => ({ role, label: CFG.role_labels[role], column: a.columns[idx] }));
  }

  // ------------------------------------------------------------------ store (services_import + catalogue)
  function newStore() { return { products: [], sales: [], keys: new Set(), nextId: 1, user: { niche: '', market: '', currency: 'USD', store_name: '', fees: {} } }; }

  function findProduct(store, key, name) {
    const nn = norm(name);
    return store.products.find((p) => p.sku.toUpperCase() === key.toUpperCase()) || (name ? store.products.find((p) => norm(p.name) === nn) : undefined);
  }

  function addProduct(store, fields) {
    const p = Object.assign({ id: store.nextId++, sku: '', name: '', category: '', cost_price: 0, sell_price: 0, stock_qty: 0, incoming_qty: 0, lead_time_days: 7, supplier: '', fulfilment: 'own_stock', stock_known: true, stage: 'active', source: '', created_at: Date.now() }, fields);
    store.products.push(p);
    return p;
  }

  /** sheets: [{a, x}] already extracted. Mirrors services_import.confirm_job. */
  function applyImport(store, sheets) {
    const created = [], updated = new Set();
    let added = 0, dupes = 0, cancelled = 0, units = 0;
    for (const { a, x } of sheets.filter((s) => s.a.kind === 'stock')) {
      for (const rec of x.stock) {
        let p = findProduct(store, rec.key, rec.name);
        if (!p) { p = addProduct(store, { sku: rec.sku || rec.key, name: rec.name, stock_qty: rec.stock || 0, stock_known: rec.stock !== null, source: a.platform }); created.push(p); }
        else updated.add(p.id);
        if (rec.stock !== null) { p.stock_qty = rec.stock; p.stock_known = true; }
        if (rec.price !== null) p.sell_price = rec.price;
        if (rec.cost !== null) p.cost_price = rec.cost;
        if (rec.category) p.category = rec.category;
        if (rec.supplier) p.supplier = rec.supplier;
        if (rec.lead_time_days !== null) p.lead_time_days = rec.lead_time_days;
        if (rec.name && p.name === p.sku) p.name = rec.name;
      }
    }
    for (const { a, x } of sheets.filter((s) => s.a.kind === 'orders')) {
      cancelled += x.skipped_cancelled;
      const prices = {};
      for (const o of x.orders) if (o.unit_price !== null) (prices[o.key] = prices[o.key] || []).push(o.unit_price);
      const median = (arr) => { const s = [...arr].sort((p, q) => p - q), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
      for (const o of x.orders) {
        if (store.keys.has(o.import_key)) { dupes++; continue; }
        let p = findProduct(store, o.key, o.name);
        if (!p) {
          p = addProduct(store, { sku: o.sku || o.key, name: o.name || o.key, sell_price: prices[o.key] ? Math.round(median(prices[o.key]) * 100) / 100 : 0, stock_known: false, source: a.platform });
          created.push(p);
        } else if (p.sell_price === 0 && prices[o.key]) p.sell_price = Math.round(median(prices[o.key]) * 100) / 100;
        store.sales.push({ pid: p.id, qty: o.quantity, price: o.unit_price !== null ? o.unit_price : p.sell_price, when: o.when, channel: o.channel, order: o.order_ref });
        store.keys.add(o.import_key);
        added++; units += o.quantity;
      }
    }
    const active = store.products.filter((p) => p.stage === 'active');
    const lines = [];
    if (added) lines.push(`Added ${plural(added, 'sale')} (${plural(units, 'item')} sold).`);
    if (dupes) lines.push(`Skipped ${plural(dupes, 'sale')} you had already uploaded.`);
    if (created.length) lines.push(`Created ${plural(created.length, 'new product')}.`);
    if (updated.size) lines.push(`Updated ${plural(updated.size, 'product')}.`);
    if (cancelled) lines.push(`Left out ${plural(cancelled, 'cancelled or refunded order')}.`);
    return {
      sales_added: added, duplicates_skipped: dupes, products_created: created.length, products_updated: updated.size,
      summary: lines.length ? lines : ['Nothing was added: no row had a date, product and quantity we could read.'],
      needs_stock: active.filter((p) => !p.stock_known), needs_cost: active.filter((p) => p.cost_price <= 0),
    };
  }

  // ------------------------------------------------------------------ forecasting
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const pstdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  const clip = (a) => a.map((v) => Math.max(0, v));

  function weeklyBuckets(points, end, weeks) {
    const b = new Array(weeks).fill(0), start = end - 7 * weeks * DAY;
    for (const [t, q] of points) {
      if (t < start || t >= end) continue;
      b[Math.min(Math.floor((t - start) / (7 * DAY)), weeks - 1)] += q;
    }
    return b;
  }
  const trimLeading = (y) => { const i = y.findIndex((v) => v > 0); return i < 0 ? [] : y.slice(i); };

  function sesFit(y) {
    let best = [Infinity, 0.3, y[y.length - 1]];
    for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      let level = y[0], sse = 0;
      for (const v of y.slice(1)) { sse += (v - level) ** 2; level += alpha * (v - level); }
      if (sse < best[0]) best = [sse, alpha, level];
    }
    return [best[1], best[2]];
  }
  const mMean4 = (y, h) => new Array(h).fill(mean(y.slice(-4)));
  const mSes = (y, h) => new Array(h).fill(sesFit(y)[1]);
  function mHolt(y, h) {
    let best = null;
    const init = y.length >= 4 ? (mean(y.slice(2, 4)) - mean(y.slice(0, 2))) / 2 : y[1] - y[0];
    for (const alpha of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) for (const beta of [0.05, 0.1, 0.2, 0.3]) for (const phi of [0.8, 0.9, 0.98]) {
      let level = y[0], trend = init, sse = 0;
      for (const v of y.slice(1)) {
        const fc = level + phi * trend; sse += (v - fc) ** 2;
        const nl = alpha * v + (1 - alpha) * fc; trend = beta * (nl - level) + (1 - beta) * phi * trend; level = nl;
      }
      if (best === null || sse < best[0]) {
        const out = []; let damp = 0;
        for (let k = 1; k <= h; k++) { damp += phi ** k; out.push(level + damp * trend); }
        best = [sse, out];
      }
    }
    return best[1];
  }
  function mTheta(y, h) {
    const n = y.length, [alpha, level] = sesFit(y), tm = (n - 1) / 2, ym = mean(y);
    let den = 0, num = 0;
    for (let t = 0; t < n; t++) { den += (t - tm) ** 2; num += (t - tm) * (y[t] - ym); }
    const slope = num / (den || 1), a = Math.max(alpha, 0.05), out = [];
    for (let k = 1; k <= h; k++) out.push(level + (slope / 2) * (k - 1 + 1 / a - (1 - a) ** n / a));
    return out;
  }
  function mSeasonal(y, h) {
    const n = y.length, now = mean(y.slice(-8)), then = mean(y.slice(n - 52 - 8, n - 52));
    let scale = then > 0 ? now / then : 1; scale = Math.min(Math.max(scale, 0.25), 4);
    const out = [];
    for (let k = 1; k <= h; k++) { const i = n - 52 + k - 1; out.push(mean(y.slice(Math.max(0, i - 1), i + 2)) * scale); }
    return out;
  }
  function mCroston(y, h, alpha = 0.15) {
    const d = []; y.forEach((v, i) => { if (v > 0) d.push([i, v]); });
    if (!d.length) return new Array(h).fill(0);
    let z = d[0][1], p = d[0][0] + 1, last = d[0][0];
    for (const [i, v] of d.slice(1)) { z += alpha * (v - z); p += alpha * ((i - last) - p); last = i; }
    return new Array(h).fill(((1 - alpha / 2) * z) / p);
  }
  function mTsb(y, h, alpha = 0.15, beta = 0.1) {
    const first = y.find((v) => v > 0) || 0;
    let prob = y.filter((v) => v > 0).length / y.length, size = first;
    for (const v of y) { if (v > 0) { prob += beta * (1 - prob); size += alpha * (v - size); } else prob += beta * (0 - prob); }
    return new Array(h).fill(prob * size);
  }
  const CONTINUOUS = { mean4: mMean4, ses: mSes, damped_trend: mHolt, theta: mTheta };
  const INTERMITTENT = { croston_sba: mCroston, tsb: mTsb, mean4: mMean4, ses: mSes };
  const MODEL_LABELS = CFG.model_labels;

  function quantile(vals, q) {
    const s = [...vals].sort((a, b) => a - b); if (!s.length) return 0;
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  function forecastWeekly(raw, horizon = 4) {
    const y = trimLeading(raw);
    if (!y.length) { const z = new Array(horizon).fill(0); return { method: 'none', history: [], weeks: z, lower: z, upper: z, trend: 'no_sales', trend_pct: 0, confidence: 'low', residual_std: 0, accuracy: null, tested_weeks: 0, models: [], seasonal: false, intermittent: false, next_week: 0 }; }
    if (y.length < 4) {
      const w = y.map((_, i) => i + 1), rate = y.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((s, v) => s + v, 0);
      const std = y.length > 1 ? pstdev(y) : rate * 0.5;
      const lower = [], upper = [];
      for (let k = 1; k <= horizon; k++) { lower.push(Math.max(0, rate - 1.2816 * std * Math.sqrt(k))); upper.push(rate + 1.2816 * std * Math.sqrt(k)); }
      return { method: 'recent_mean', history: y, weeks: new Array(horizon).fill(rate), lower, upper, trend: 'new', trend_pct: 0, confidence: 'low', residual_std: std, accuracy: null, tested_weeks: 0, models: [], seasonal: false, intermittent: false, next_week: rate };
    }
    const n = y.length, zeroShare = y.filter((v) => v === 0).length / n, intermittent = zeroShare >= 0.3;
    const methods = Object.assign({}, intermittent ? INTERMITTENT : CONTINUOUS);
    if (!intermittent && n >= 60) methods.seasonal = mSeasonal;
    const nOrig = Math.min(8, n - 6), origins = [];
    for (let o = n - nOrig; o < n && nOrig > 0; o++) origins.push(o);
    const backtest = {}, scores = {};
    for (const [name, fn] of Object.entries(methods)) {
      const usable = name === 'seasonal' ? origins.filter((o) => o >= 60) : origins, rows = [];
      for (const o of usable) { const steps = Math.min(horizon, n - o), fc = clip(fn(y.slice(0, o), steps)); for (let k = 0; k < steps; k++) rows.push([o, k, fc[k]]); }
      if (!rows.length) continue;
      let err = 0, act = 0;
      for (const [o, k, f] of rows) { err += Math.abs(y[o + k] - f); act += y[o + k]; }
      backtest[name] = rows; scores[name] = err / (act || 1);
    }
    let weights = {};
    const names = Object.keys(scores);
    if (names.length) {
      const ranked = names.sort((a, b) => scores[a] - scores[b]).slice(0, 3);
      const inv = Object.fromEntries(ranked.map((m) => [m, 1 / Math.max(scores[m], 0.02)])), tot = Object.values(inv).reduce((s, v) => s + v, 0);
      for (const m of ranked) weights[m] = inv[m] / tot;
    } else {
      const nm = intermittent ? ['mean4', 'ses'] : ['mean4', 'ses', 'damped_trend'];
      for (const m of nm) weights[m] = 1 / nm.length;
    }
    const point = new Array(horizon).fill(0);
    for (const [m, w] of Object.entries(weights)) clip(methods[m](y, horizon)).forEach((v, k) => { point[k] += w * v; });
    const blend = new Map();
    for (const [m, w] of Object.entries(weights)) for (const [o, k, f] of backtest[m] || []) { const key = o + ':' + k; blend.set(key, (blend.get(key) || 0) + w * f); }
    let common = new Set(blend.keys());
    for (const m of Object.keys(weights)) { const s = new Set((backtest[m] || []).map(([o, k]) => o + ':' + k)); common = new Set([...common].filter((key) => s.has(key))); }
    const misses = {};
    for (const key of common) { const [o, k] = key.split(':').map(Number); (misses[k] = misses[k] || []).push(y[o + k] - blend.get(key)); }
    let accuracy = null;
    const tested = (misses[0] || []).length;
    if (tested >= 4) {
      let err = 0, act = 0;
      for (const key of common) { const [o, k] = key.split(':').map(Number); if (k === 0) { err += Math.abs(y[o] - blend.get(key)); act += y[o]; } }
      accuracy = Math.max(0, 1 - err / (act || 1));
    }
    const pooled = Object.values(misses).flat();
    const residStd = pooled.length >= 8 ? Math.sqrt(mean((misses[0] || pooled).map((e) => e * e))) : y.length > 2 ? pstdev(y.slice(-12)) : point[0] * 0.5;
    const lower = [], upper = [];
    for (let k = 0; k < horizon; k++) {
      const spread = 1.5 * Math.sqrt(Math.max(residStd ** 2, point[k]) * (1 + 0.15 * k));
      let lo = -spread, hi = spread;
      const errs = misses[k] || [];
      if (errs.length >= 6) { lo = Math.min(lo, quantile(errs, 0.1)); hi = Math.max(hi, quantile(errs, 0.9)); }
      lower.push(Math.max(0, Math.min(point[k], point[k] + lo)));
      upper.push(Math.max(point[k], point[k] + hi));
    }
    const recent = mean(y.slice(-4));
    let trendPct;
    if (n >= 8 && mean(y.slice(-8, -4)) > 0) trendPct = (recent - mean(y.slice(-8, -4))) / mean(y.slice(-8, -4));
    else trendPct = recent > 0 ? (point[0] - recent) / recent : 0;
    const trend = trendPct >= 0.15 ? 'rising' : trendPct <= -0.15 ? 'declining' : 'stable';
    const confidence = accuracy === null ? 'low' : accuracy >= 0.75 && n >= 12 ? 'high' : accuracy >= 0.55 ? 'medium' : 'low';
    const models = Object.keys(weights).sort((a, b) => weights[b] - weights[a]).map((m) => ({ name: m, label: MODEL_LABELS[m], weight: weights[m], wape: scores[m] ?? null }));
    return { method: 'ensemble', history: y, weeks: point, lower, upper, trend, trend_pct: trendPct, confidence, residual_std: residStd, accuracy, tested_weeks: tested, models, seasonal: 'seasonal' in weights, intermittent, next_week: point[0] };
  }

  function planStock(fc, stock, incoming, lead, today, coverWeeks = 2, fulfilment = 'own_stock', stockKnown = true) {
    const weekly = fc.next_week, horizonWeeks = Math.max(0, lead) / 7 + coverWeeks;
    const safety = weekly > 0 ? Math.ceil(1.2816 * fc.residual_std * Math.sqrt(Math.max(horizonWeeks, 1))) : 0;
    let demand = 0, remaining = horizonWeeks, i = 0;
    while (remaining > 0) { demand += (fc.weeks.length ? fc.weeks[Math.min(i, fc.weeks.length - 1)] : 0) * Math.min(1, remaining); remaining -= 1; i++; }
    const target = weekly > 0 ? Math.ceil(demand + safety) : 0;
    const notes = [];
    const plan = (status, cover, days, date, reorder, reason) => ({ status, weeks_of_cover: cover, stockout_in_days: days, stockout_date: date, reorder_qty: reorder, safety_stock: safety, target_stock: target, reason, notes, order_by: null });
    if (!stockKnown) {
      if (weekly <= 0.05) return Object.assign(plan('no_demand', null, null, null, 0, 'No recent sales.'), { safety_stock: 0, target_stock: 0 });
      return plan('stock_unknown', null, null, null, 0, `Add your stock count to get reorder advice. You need about ${target} units available to cover the next ${Math.round(horizonWeeks)} weeks.`);
    }
    let days = null;
    if (weekly > 0) { let left = stock; for (let d = 0; d < 7 * 26; d++) { const rate = fc.weeks[Math.min(Math.floor(d / 7), fc.weeks.length - 1)] / 7; if (left <= 1e-6) { days = d; break; } left -= rate; } }
    const cover = weekly > 0 ? stock / weekly : null;
    let reorder = weekly > 0 ? Math.max(0, Math.ceil(demand + safety - stock - incoming)) : 0, status, reason;
    if (weekly <= 0.05) { status = stock > 0 ? 'dead_stock' : 'no_demand'; reason = stock > 0 ? 'Stock on hand but almost no recent sales.' : 'No recent sales.'; reorder = 0; }
    else if (stock <= 0) { status = 'out_of_stock'; reason = 'Out of stock while customers are still buying.'; }
    else if (days !== null && days <= lead + 3) { status = 'reorder_now'; reason = `Runs out in about ${days} days, but the supplier needs about ${lead} days.`; }
    else if (days !== null && days <= lead + 14) { status = 'low'; reason = `About ${days} days of stock left.`; }
    else if (cover !== null && cover > 12) { status = 'overstock'; reason = `${Math.round(cover)} weeks of stock at the current sales rate.`; reorder = 0; }
    else { status = 'healthy'; reason = 'Stock covers expected sales.'; reorder = 0; }
    if (fulfilment === 'dropship') { notes.push("Dropship item: the stock figure is your supplier's. Check they can cover this amount."); if (status === 'reorder_now' || status === 'out_of_stock') notes.push("Line up a backup supplier so your listing doesn't go out of stock."); }
    if (incoming && reorder) notes.push(`The ${incoming} units already on order are taken off the suggested order.`);
    const date = days !== null ? new Date(today + days * DAY).toISOString().slice(0, 10) : null;
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const orderBy = status === 'out_of_stock' ? iso(today) : (status === 'reorder_now' || status === 'low') && days !== null ? iso(today + Math.max(0, days - lead) * DAY) : null;
    return Object.assign(plan(status, cover, days, date, reorder, reason), { order_by: orderBy });
  }

  // ------------------------------------------------------------------ calendar
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(year, month - 1, day);
  }
  function nthWeekday(year, month, weekday, n) { // weekday: 0=Mon..6=Sun (Python convention)
    let t = Date.UTC(year, month - 1, 1); const py = (new Date(t).getUTCDay() + 6) % 7;
    t += ((weekday - py + 7) % 7) * DAY; return t + (n - 1) * 7 * DAY;
  }
  function shoppingEvents(year) {
    const bf = nthWeekday(year, 11, 3, 4) + DAY, ea = easter(year);
    return [
      [Date.UTC(year, 1, 14), "Valentine's Day", 'all'], [ea - 21 * DAY, "Mother's Day (UK)", 'UK'], [ea, 'Easter', 'all'],
      [nthWeekday(year, 5, 6, 2), "Mother's Day (US)", 'US'], [nthWeekday(year, 6, 6, 3), "Father's Day (US & UK)", 'US, UK'],
      [Date.UTC(year, 9, 31), 'Halloween', 'all'], [Date.UTC(year, 10, 11), "Singles' Day (11.11)", 'all'],
      [bf, 'Black Friday', 'all'], [bf + 3 * DAY, 'Cyber Monday', 'all'], [Date.UTC(year, 11, 25), 'Christmas', 'all'], [Date.UTC(year, 11, 26), 'Boxing Day', 'UK, AU, CA'],
    ];
  }
  function upcomingEvents(nowMs, weeks = 6) {
    const today = Math.floor(nowMs / DAY) * DAY, end = today + weeks * 7 * DAY, y = new Date(today).getUTCFullYear(), out = [];
    for (const yr of [y, y + 1]) for (const [d, name, markets] of shoppingEvents(yr)) if (d >= today && d <= end) out.push({ date: new Date(d).toISOString().slice(0, 10), name, markets, in_days: Math.round((d - today) / DAY) });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ------------------------------------------------------------------ fees + services
  const ALIASES = [['ebay', 'ebay'], ['amazon', 'amazon'], ['etsy', 'etsy'], ['tiktok', 'tiktok'], ['shopify', 'shopify'], ['web', 'shopify'], ['shop_app', 'shopify'], ['instagram', 'shopify'], ['online store', 'shopify']];
  const channelKey = (c) => { c = (c || '').toLowerCase(); for (const [n, k] of ALIASES) if (c.includes(n)) return k; return 'other'; };
  function feeTable(userFees) {
    const t = JSON.parse(JSON.stringify(CFG.default_fees));
    for (const [k, v] of Object.entries(userFees || {})) if (t[k]) for (const f of ['pct', 'fixed']) if (typeof v[f] === 'number' && v[f] >= 0) t[k][f] = v[f];
    return t;
  }
  const saleFee = (t, ch, rev) => { const f = t[channelKey(ch)]; return (rev * f.pct) / 100 + f.fixed; };

  function productStats(store, products, now) {
    const t = feeTable(store.user.fees), d7 = now - 7 * DAY, d30 = now - 30 * DAY, st = {};
    for (const p of products) st[p.id] = { units_7d: 0, units_30d: 0, revenue_30d: 0, fees_30d: 0, last_sold_at: null };
    for (const s of store.sales) {
      const x = st[s.pid]; if (!x || s.when >= now) continue;
      if (s.when >= d30) { x.units_30d += s.qty; x.revenue_30d += s.qty * s.price; x.fees_30d += saleFee(t, s.channel, s.qty * s.price); }
      if (s.when >= d7) x.units_7d += s.qty;
      if (x.last_sold_at === null || s.when > x.last_sold_at) x.last_sold_at = s.when;
    }
    for (const p of products) {
      const x = st[p.id], daily = x.units_30d / 30;
      x.days_of_stock = daily > 0 && p.stock_known ? Math.round((p.stock_qty / daily) * 10) / 10 : null;
      x.profit_30d = x.revenue_30d - x.fees_30d - x.units_30d * p.cost_price;
      x.fee_per_unit = x.units_30d ? x.fees_30d / x.units_30d : null;
      x.margin_pct = p.sell_price > 0 ? (p.sell_price - p.cost_price) / p.sell_price : null;
    }
    return st;
  }

  const activeProducts = (store) => store.products.filter((p) => p.stage === 'active').sort((a, b) => a.name.localeCompare(b.name));

  function dashboard(store, now) {
    const products = activeProducts(store), byId = new Map(products.map((p) => [p.id, p])), t = feeTable(store.user.fees);
    const pct = (c, p) => (p === 0 ? null : (c - p) / p);
    const win = (a, b) => {
      const rows = store.sales.filter((s) => s.when >= a && s.when < b && byId.has(s.pid));
      const revenue = rows.reduce((x, s) => x + s.qty * s.price, 0), cost = rows.reduce((x, s) => x + s.qty * byId.get(s.pid).cost_price, 0);
      const fee = rows.reduce((x, s) => x + saleFee(t, s.channel, s.qty * s.price), 0), orders = new Set(rows.map((s, i) => s.order || 'r' + i)).size;
      return { revenue, fees: fee, profit: revenue - cost - fee, units: rows.reduce((x, s) => x + s.qty, 0), orders, avg_order_value: orders ? revenue / orders : 0 };
    };
    const kpis = {};
    for (const [label, days] of [['7d', 7], ['30d', 30]]) {
      const cur = win(now - days * DAY, now), prev = win(now - 2 * days * DAY, now - days * DAY);
      cur.change = Object.fromEntries(['revenue', 'profit', 'units', 'orders'].map((k) => [k, pct(cur[k], prev[k])]));
      kpis[label] = cur;
    }
    const day0 = Math.floor((now - 29 * DAY) / DAY) * DAY, daily = [];
    for (let i = 0; i < 30; i++) daily.push({ date: new Date(day0 + i * DAY).toISOString().slice(0, 10), revenue: 0, units: 0 });
    const channels = {};
    for (const s of store.sales) {
      if (!byId.has(s.pid) || s.when < day0 || s.when >= now) continue;
      const i = Math.floor((s.when - day0) / DAY); if (i >= 0 && i < 30) { daily[i].revenue += s.qty * s.price; daily[i].units += s.qty; }
      const c = s.channel || 'direct'; channels[c] = (channels[c] || 0) + s.qty * s.price;
    }
    const st = productStats(store, products, now);
    const top = [...products].sort((a, b) => st[b.id].revenue_30d - st[a.id].revenue_30d).slice(0, 5);
    const low = products.filter((p) => p.stock_known && p.stock_qty > 0 && st[p.id].days_of_stock !== null && st[p.id].days_of_stock <= Math.max(14, p.lead_time_days + 7)).sort((a, b) => st[a.id].days_of_stock - st[b.id].days_of_stock);
    const out = products.filter((p) => p.stock_known && p.stock_qty <= 0 && st[p.id].units_30d > 0);
    const dead = products.filter((p) => p.stock_qty > 0 && st[p.id].units_30d === 0);
    const unknown = products.filter((p) => !p.stock_known), costMissing = products.filter((p) => p.cost_price <= 0 && st[p.id].units_30d > 0);
    const todo = [];
    if (unknown.length) todo.push({ key: 'stock', count: unknown.length, text: `Add stock counts for ${unknown.length} products to get reorder advice.` });
    if (costMissing.length) todo.push({ key: 'cost', count: costMissing.length, text: `Add what you pay per item for ${costMissing.length} products so profit is correct.` });
    const pos = (p) => Math.max(0, p.stock_qty);
    return {
      kpis, daily, stats: st, todo,
      channels: Object.entries(channels).sort((a, b) => b[1] - a[1]).map(([channel, revenue]) => ({ channel, revenue })),
      inventory: { skus: products.length, units_on_hand: products.reduce((x, p) => x + (p.stock_known ? pos(p) : 0), 0), stock_value_cost: products.reduce((x, p) => x + pos(p) * p.cost_price, 0), stock_value_retail: products.reduce((x, p) => x + pos(p) * p.sell_price, 0), out_of_stock: out.length, low_stock: low.length, dead_stock: dead.length, stock_unknown: unknown.length, cost_missing: costMissing.length },
      top_sellers: top, low_stock: low.slice(0, 10), dead_stock: dead.slice(0, 10),
    };
  }

  function uncensor(h, stock, known) { return known && stock <= 0 && h.length > 1 && h[h.length - 1] === 0 && h.slice(0, -1).some((v) => v) ? h.slice(0, -1) : h; }

  function rank(store, products, now) {
    const cutoff = now - 56 * DAY, rev = {};
    for (const s of store.sales) if (s.when >= cutoff && s.when < now) rev[s.pid] = (rev[s.pid] || 0) + s.qty;
    return [...products].sort((a, b) => (rev[b.id] || 0) * b.sell_price - (rev[a.id] || 0) * a.sell_price);
  }

  function productForecast(store, p, now, horizon = 4) {
    const pts = store.sales.filter((s) => s.pid === p.id).map((s) => [s.when, s.qty]);
    const history = weeklyBuckets(pts, now, 104);
    const fc = forecastWeekly(uncensor(history, p.stock_qty, p.stock_known), horizon);
    return { history, fc, plan: planStock(fc, p.stock_qty, p.incoming_qty, p.lead_time_days, now, 2, p.fulfilment, p.stock_known) };
  }

  function forecasts(store, now, maxProducts = null, horizon = 4) {
    const products = activeProducts(store), st = productStats(store, products, now);
    const revenue = Object.values(st).reduce((x, s) => x + s.revenue_30d, 0), fee = Object.values(st).reduce((x, s) => x + s.fees_30d, 0);
    const feeRate = revenue ? fee / revenue : 0;
    const ranked = rank(store, products, now), unlocked = new Set((maxProducts === null ? ranked : ranked.slice(0, maxProducts)).map((p) => p.id));
    const items = [], histTotal = new Array(104).fill(0), units = new Array(horizon).fill(0), rev = new Array(horizon).fill(0), prof = new Array(horizon).fill(0);
    let now$ = 0, soon$ = 0;
    for (const p of ranked) {
      const { history, fc, plan } = productForecast(store, p, now, horizon);
      history.forEach((v, i) => { histTotal[i] += v * p.sell_price; });
      if (!unlocked.has(p.id)) { items.push({ product: p, locked: true }); continue; }
      const feeUnit = st[p.id].fee_per_unit ?? p.sell_price * feeRate, unitProfit = p.sell_price - p.cost_price - feeUnit;
      for (let k = 0; k < horizon; k++) { units[k] += fc.weeks[k]; rev[k] += fc.weeks[k] * p.sell_price; prof[k] += fc.weeks[k] * unitProfit; }
      if (plan.status === 'out_of_stock' || plan.status === 'reorder_now') now$ += plan.reorder_qty * p.cost_price;
      else if (plan.status === 'low') soon$ += plan.reorder_qty * p.cost_price;
      items.push({ product: p, stats: st[p.id], locked: false, forecast: fc, stock_plan: plan, next_week_revenue: fc.next_week * p.sell_price, next_week_profit: fc.next_week * unitProfit });
    }
    const first = histTotal.findIndex((v) => v > 0), storeHist = first < 0 ? [] : histTotal.slice(first);
    const sfc = storeHist.length ? forecastWeekly(storeHist, horizon) : null;
    const rankS = { out_of_stock: 0, reorder_now: 1, low: 2, stock_unknown: 3, dead_stock: 4, overstock: 5, healthy: 6, no_demand: 7 };
    items.sort((a, b) => (a.locked - b.locked) || ((rankS[a.stock_plan?.status] ?? 9) - (rankS[b.stock_plan?.status] ?? 9)) || ((b.next_week_revenue || 0) - (a.next_week_revenue || 0)));
    return {
      store: { weekly_revenue_history: storeHist, next_weeks_units: units, next_weeks_revenue: rev, next_weeks_profit: prof, revenue_band: sfc ? { lower: sfc.lower, upper: sfc.upper } : null, trend: sfc ? sfc.trend : 'no_sales', accuracy: sfc ? sfc.accuracy : null, restock_budget: { now: now$, next_two_weeks: soon$ } },
      events: upcomingEvents(now, horizon + 2), items, locked_count: items.filter((i) => i.locked).length,
    };
  }


  // ------------------------------------------------------------------ insights (mirrors backend app/insights.py)
  const SYMBOLS = { USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$' };
  const BIG_EVENTS = new Set(['Black Friday', 'Cyber Monday', 'Christmas', 'Boxing Day', "Singles' Day (11.11)", "Valentine's Day", "Mother's Day (UK)", "Mother's Day (US)", "Father's Day (US & UK)"]);
  const r2 = (v) => Math.round(v * 100) / 100;
  function money(v, currency) {
    const a = Math.abs(v), s = a >= 100 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sym = SYMBOLS[currency];
    return (v < 0 ? '-' : '') + (sym ? sym + s : `${s} ${currency}`);
  }

  /** 80/20: A = the few products making ~80% of profit, B = next 15%, C = the tail, plus losing ones. */
  function focusList(store, products, now, days = 90) {
    const since = now - days * DAY, t = feeTable(store.user.fees), agg = new Map(products.map((p) => [p.id, { units: 0, revenue: 0, fees: 0 }]));
    for (const s of store.sales) {
      const a = agg.get(s.pid); if (!a || s.when < since || s.when >= now) continue;
      a.units += s.qty; a.revenue += s.qty * s.price; a.fees += saleFee(t, s.channel, s.qty * s.price);
    }
    const rows = products.map((p) => { const a = agg.get(p.id); return { id: p.id, sku: p.sku, name: p.name, units: a.units, revenue: r2(a.revenue), profit: r2(a.revenue - a.fees - a.units * p.cost_price), cost_known: p.cost_price > 0 }; });
    rows.sort((a, b) => b.profit - a.profit);
    const positive = rows.reduce((x, r) => x + (r.profit > 0 ? r.profit : 0), 0);
    let cum = 0;
    for (const r of rows) {
      if (r.profit < 0) { r.group = 'losing'; r.share = 0; continue; }
      const share = positive ? r.profit / positive : 0, before = cum; cum += share;
      r.share = Math.round(share * 1e4) / 1e4; r.group = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
    }
    const aCount = rows.filter((r) => r.group === 'A').length, sold = rows.filter((r) => r.units > 0);
    const summary = !positive || !sold.length ? 'Not enough sales yet to see where your profit comes from.'
      : aCount / sold.length > 0.6 ? 'Your profit is spread across most of your products, so no single one carries the store.'
      : `${aCount} of your ${sold.length} selling products make about 80% of your profit. Never let them run out.`;
    return { days, total_profit: r2(rows.reduce((x, r) => x + r.profit, 0)), summary, missing_cost: sold.filter((r) => !r.cost_known).length, items: rows };
  }

  /** Pairs of products often in the same order, with lift (how much more often than chance). */
  function bundles(store, products, now, days = 180, minTogether = 3) {
    const since = now - days * DAY, names = new Map(products.map((p) => [p.id, p.name])), orders = new Map();
    for (const s of store.sales) {
      if (!s.order || !names.has(s.pid) || s.when < since || s.when >= now || s.order.startsWith('manual')) continue;
      if (!orders.has(s.order)) orders.set(s.order, new Set());
      orders.get(s.order).add(s.pid);
    }
    const single = new Map(), pairs = new Map();
    for (const items of orders.values()) {
      for (const i of items) single.set(i, (single.get(i) || 0) + 1);
      if (items.size > 1) {
        const ids = [...items].sort((a, b) => a - b);
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] + ':' + ids[j]; pairs.set(k, (pairs.get(k) || 0) + 1); }
      }
    }
    const out = [];
    for (const [k, together] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
      if (together < minTogether) break;
      const [a, b] = k.split(':').map(Number), lift = single.get(a) && single.get(b) ? (together * orders.size) / (single.get(a) * single.get(b)) : 0;
      if (lift <= 1) continue;
      out.push({ a: { id: a, name: names.get(a) }, b: { id: b, name: names.get(b) }, orders_together: together, lift: r2(lift), tip: `Bought together in ${together} orders. Offer them as a bundle or show one on the other's page.` });
      if (out.length >= 6) break;
    }
    const multi = [...orders.values()].filter((x) => x.size > 1).length;
    const note = out.length ? '' : !orders.size ? "Your sales file has no order numbers, so we can't see which products are bought together." : multi < 10 ? 'Not enough orders with two or more different products yet.' : 'Your customers mostly buy one product at a time, so no strong pairs yet.';
    return { days, orders: orders.size, multi_item_orders: multi, pairs: out, note };
  }

  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };

  /** This week's prioritised to-do list from the numbers alone. */
  function smartPlan(forecast, dash, focus, bundleData, currency, today = '') {
    const when = (iso) => (today && iso <= today ? 'today' : `by ${fmtDate(iso)}`);
    const m = (v) => money(v, currency), items = forecast.items.filter((it) => !it.locked), actions = [];
    const add = (priority, kind, title, detail, sku = '') => actions.push({ priority, kind, title, detail, sku });
    const aGroup = new Set(focus.items.filter((r) => r.group === 'A').map((r) => r.id));
    for (const it of items) {
      const p = it.product, fc = it.forecast, plan = it.stock_plan, star = aGroup.has(p.id) ? " It's one of your top earners." : '';
      if (plan.status === 'out_of_stock') add('high', 'restock_urgent', `Restock ${p.name} today: order ${plan.reorder_qty} units`, `Sold out while customers still buy about ${Math.round(fc.next_week)} a week.${star}`, p.sku);
      else if (plan.status === 'reorder_now') add('high', 'reorder', `Order ${plan.reorder_qty} × ${p.name} ${when(plan.order_by)}`, `${plan.reason}${star}`, p.sku);
    }
    for (const it of items) { const p = it.product, plan = it.stock_plan; if (plan.status === 'low' && plan.order_by) add('medium', 'reorder', `Plan an order of ${plan.reorder_qty} × ${p.name} ${when(plan.order_by)}`, plan.reason, p.sku); }
    const unknown = items.filter((it) => it.stock_plan.status === 'stock_unknown');
    if (unknown.length) add('medium', 'setup', `Add stock counts for ${unknown.length} products`, "Without them we can't tell you when to reorder. It takes a minute on the Stock & costs screen.");
    if (dash.inventory.cost_missing) add('medium', 'setup', `Add your cost per item for ${dash.inventory.cost_missing} products`, 'Profit and the restock budget need what you pay per item.');
    const rising = items.filter((it) => it.forecast.trend === 'rising' && (it.forecast.accuracy || 0) >= 0.55).sort((a, b) => b.next_week_revenue - a.next_week_revenue).slice(0, 2);
    for (const it of rising) { const pc = Math.round(it.forecast.trend_pct * 100); add('medium', 'promote', `Push ${it.product.name}: sales up ${pc}%`, `Sales rose ${pc}% over the last 4 weeks. A short video or a featured spot could add to it.`, it.product.sku); }
    const top = [...items].sort((a, b) => b.next_week_revenue - a.next_week_revenue).slice(0, 3);
    const window = Math.max(21, ...top.map((it) => it.product.lead_time_days + 10));
    const ev = (forecast.events || []).find((e) => BIG_EVENTS.has(e.name) && e.in_days <= window);
    if (ev) add('medium', 'marketing', `Get ready for ${ev.name} in ${ev.in_days} days`, `Check stock on your best sellers. Units to have available: ${top.map((it) => `${it.product.name} (${it.stock_plan.target_stock})`).join(', ')}.`);
    const pairFor = new Map();
    for (const pr of bundleData.pairs || []) { if (!pairFor.has(pr.a.id)) pairFor.set(pr.a.id, pr.b.name); if (!pairFor.has(pr.b.id)) pairFor.set(pr.b.id, pr.a.name); }
    const best = items.reduce((b, it) => (!b || it.next_week_revenue > b.next_week_revenue ? it : b), null);
    const dead = items.filter((it) => it.stock_plan.status === 'dead_stock').sort((a, b) => b.product.stock_qty * b.product.cost_price - a.product.stock_qty * a.product.cost_price).slice(0, 2);
    for (const it of dead) {
      const p = it.product, partner = pairFor.get(p.id) || (best && best !== it ? best.product.name : null);
      add('low', 'clear_stock', `Clear ${p.name}: ${m(p.stock_qty * p.cost_price)} tied up`, `${p.stock_qty} in stock and no sales in 30 days. ${partner ? `Bundle it with ${partner}` : 'Try a bundle'}, or a 15–20% discount.`, p.sku);
    }
    for (const it of items) if (it.stock_plan.status === 'overstock') add('low', 'reorder', `Pause reordering ${it.product.name}`, it.stock_plan.reason, it.product.sku);
    const k7 = dash.kpis['7d'], st = forecast.store, change = k7.change.revenue;
    const trendWord = change == null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}% on the week before`;
    const firstHigh = actions.find((a) => a.priority === 'high'), budget = st.restock_budget.now;
    return {
      headline: firstHigh ? firstHigh.title : 'Nothing urgent this week. Use the time to grow your best sellers.',
      summary: `Last 7 days: ${m(k7.revenue)} revenue and ${m(k7.profit)} profit after fees${trendWord}. ${focus.summary}`,
      next_week_outlook: `Expect about ${Math.round(st.next_weeks_units[0])} units, ${m(st.next_weeks_revenue[0])} revenue and ${m(st.next_weeks_profit[0])} profit next week.` + (budget > 0 ? ` Orders to place now cost about ${m(budget)}.` : ''),
      actions: actions.slice(0, 10), made_by: 'numbers',
    };
  }

  function priceForMargin(cost, shipping, feePct, feeFixed, ad, margin) { const keep = 1 - feePct / 100 - margin; return keep > 0 ? r2((cost + shipping + feeFixed + ad) / keep) : null; }
  /** What one sale really earns, and how much advertising it can afford. */
  function profitCalc(price, cost, shipping, feePct, feeFixed, ad = 0) {
    const fee = (price * feePct) / 100 + feeFixed, before = price - cost - shipping - fee, profit = before - ad;
    return { price_for_30pct_margin: priceForMargin(cost, shipping, feePct, feeFixed, ad, 0.3), fees: r2(fee), profit_before_ads: r2(before), profit: r2(profit), margin_pct: price ? Math.round((profit / price) * 1000) / 10 : 0, max_ad_cost_per_sale: r2(Math.max(0, before)), break_even_roas: before > 0 ? r2(price / before) : null };
  }

  root.Engine = { ImportProblem, readTables, analyse, extract, summary, describe, missingFor, requiredRoles, parseDate, parseNumber, newStore, applyImport, addProduct, findProduct, weeklyBuckets, forecastWeekly, planStock, upcomingEvents, feeTable, channelKey, productStats, activeProducts, dashboard, forecasts, productForecast, focusList, bundles, smartPlan, profitCalc, money, fmtDate, DAY };
})(typeof window !== 'undefined' ? window : globalThis);
