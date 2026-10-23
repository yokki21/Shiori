// Agrupa la colección por series y calcula lo que falta y lo que costaría completarla.

import { owned, state, getVersion } from './store.js';
import { catalogSeriesFor, catalogIssue, catalogLoaded } from './catalog.js';
import { seriesKey, today } from './util.js';

let cache = { v: -1, cat: false, list: [] };

export function seriesList() {
  if (cache.v === getVersion() && cache.cat === catalogLoaded()) return cache.list;
  const map = new Map();
  const all = owned();
  const priced = all.filter((c) => c.price != null);
  const globalAvg = priced.length ? priced.reduce((s, c) => s + c.price, 0) / priced.length : null;

  for (const c of all) {
    if (!c.series || c.number == null) continue;
    const k = seriesKey(c.series);
    if (!k) continue;
    let g = map.get(k);
    if (!g) { g = { key: k, name: c.series, items: [], byNum: new Map(), updated: 0, issn: null }; map.set(k, g); }
    g.items.push(c);
    if (!g.byNum.has(c.number)) g.byNum.set(c.number, c);
    g.updated = Math.max(g.updated, c.createdAt || 0, c.updatedAt || 0);
    if (c.issn) g.issn = c.issn;
  }

  const list = [];
  for (const g of map.values()) {
    const meta = state.seriesMeta.get(g.key) || {};
    const cat = catalogSeriesFor(g.name, g.issn);
    const nums = [...g.byNum.keys()];
    // Del catálogo solo cuentan los números ya publicados (no las preventas)
    const now = today();
    const released = cat ? Object.entries(cat.issues).filter(([, it]) => !it.date || it.date <= now).map(([n]) => +n) : [];
    const catMax = released.length ? Math.max(...released) : 0;
    g.cat = cat;
    if (cat) g.name = cat.name;
    g.total = meta.total || catMax || null;
    g.max = Math.min(500, Math.max(g.total || 0, ...nums));
    g.finished = !!meta.finished;
    g.owned = g.byNum.size;
    g.read = [...g.byNum.values()].filter((c) => c.reading === 'leido').length;
    g.spent = g.items.reduce((s, c) => s + (c.price || 0), 0);
    g.missing = [];
    for (let n = 1; n <= g.max; n++) if (!g.byNum.has(n)) g.missing.push(n);

    // Precio de lo que falta: el del catálogo si se conoce; si no, la media de lo que has pagado
    const own = g.items.filter((c) => c.price != null);
    const avg = own.length ? own.reduce((s, c) => s + c.price, 0) / own.length : globalAvg;
    let cost = 0;
    let estimated = false;
    let known = true;
    for (const n of g.missing) {
      const it = cat ? catalogIssue(cat, n) : null;
      if (it?.price != null) cost += it.price;
      else if (avg != null) { cost += avg; estimated = true; } else known = false;
    }
    g.missingCost = known ? Math.round(cost * 100) / 100 : null;
    g.costEstimated = estimated;
    g.knownTotal = !!(g.total || g.finished);
    g.complete = g.missing.length === 0 && g.knownTotal;

    const lastOwned = [...g.byNum.values()].sort((a, b) => b.number - a.number)[0];
    g.cover = lastOwned;
    const counts = new Map();
    for (const c of g.items) if (c.publisher) counts.set(c.publisher, (counts.get(c.publisher) || 0) + 1);
    g.publisher = cat?.publisher || [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    list.push(g);
  }
  list.sort((a, b) => b.updated - a.updated);
  cache = { v: getVersion(), cat: catalogLoaded(), list };
  return list;
}

export const findSeries = (key) => seriesList().find((g) => g.key === key);

// Ficha para un número que falta (del catálogo si existe; si no, una plantilla)
export function missingIssueData(g, n) {
  const it = g.cat ? catalogIssue(g.cat, n) : null;
  if (it) return { ...it, issn: g.cat.issn, barcode: g.cat.ean };
  const ref = g.cover || g.items[0] || {};
  return {
    title: `${g.name} ${n}`, series: g.name, number: n,
    publisher: ref.publisher || '', type: ref.type || null, issn: g.issn || null,
  };
}
