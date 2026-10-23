// Catálogo propio de Shiori (catalog/catalog.json): cómics con su código,
// portada, precio y fecha, para añadirlos al instante al escanear.
//
// Formato:
//   series: [{ name, publisher, type, ean, issn, issues: { "1": { title, cover, price, date } } }]
//   isbn:   { "978…": { title, series, number, publisher, type, cover, price, date } }
//   extras: [{ title, cover, price, date, publisher, type }]   (sin código conocido; solo búsqueda)

let data = null;
let loading = null;
const byIssn = new Map();
const byKey = new Map();
const key = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function loadCatalog() {
  if (!loading) {
    loading = fetch('catalog/catalog.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => {
        data = j || { series: [], isbn: {}, extras: [] };
        for (const s of data.series || []) {
          if (s.issn) byIssn.set(s.issn, s);
          byKey.set(key(s.name), s);
        }
        return data;
      });
  }
  return loading;
}

// Serie del catálogo para un ISSN ("3081-6009")
export function catalogSeries(issn) {
  return byIssn.get(issn) || null;
}

// Serie del catálogo por su nombre (o por el ISSN de alguno de sus números)
export function catalogSeriesFor(name, issn) {
  return (issn && byIssn.get(issn)) || byKey.get(key(name)) || null;
}

export const catalogLoaded = () => !!data;

// Ficha de un número concreto de una serie del catálogo
export function catalogIssue(series, n) {
  const it = series?.issues?.[String(n)];
  if (!it) return null;
  return {
    title: it.title || `${series.name} ${n}`,
    series: series.name, number: +n,
    publisher: series.publisher || '', type: series.type || null,
    cover: it.cover || null, price: it.price ?? null, publishedDate: it.date || '',
  };
}

export function catalogByIsbn(code) {
  const it = data?.isbn?.[code];
  return it ? { ...it, isbn: code, publishedDate: it.date || '' } : null;
}

// Búsqueda local por título (para «Buscar por título»)
export function searchCatalog(q, limit = 20) {
  if (!data) return [];
  const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  const matches = (title) => {
    const t = fold(title);
    return words.every((w) => (/^\d+$/.test(w) ? new RegExp(`\\b0*${+w}\\b`).test(t) : t.includes(w)));
  };
  for (const s of data.series || []) {
    for (const n of Object.keys(s.issues || {})) {
      const it = catalogIssue(s, n);
      if (matches(it.title)) out.push({ ...it, issn: s.issn, barcode: s.ean, fromCatalog: true });
    }
  }
  for (const [code, it] of Object.entries(data.isbn || {})) {
    if (matches(it.title)) out.push({ ...it, isbn: code, publishedDate: it.date || '', fromCatalog: true });
  }
  for (const it of data.extras || []) {
    if (matches(it.title)) out.push({ ...it, publishedDate: it.date || '', fromCatalog: true });
  }
  // Primero los números más bajos de cada serie
  out.sort((a, b) => fold(a.series || a.title).localeCompare(fold(b.series || b.title)) || (a.number ?? 0) - (b.number ?? 0));
  return out.slice(0, limit);
}
