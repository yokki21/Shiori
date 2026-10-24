// Catálogo propio de Shiori (catalog/catalog.json): cómics con su código,
// portada, precio y fecha, para añadirlos al instante al escanear.
//
// Formato (versión 2):
//   img, imgq: prefijo y parámetros de las portadas (cover puede ser una ruta relativa)
//   series: [{ name, publisher, type, ean?, issn?, issues: { "1": { title?, cover, price, date, isbn?, pages?, authors?, issn?, a? } } }]
//   extras: [{ title, cover, price, date, isbn?, issn?, a?, ... }]   (sueltos, sin número)
//   El suplemento de las grapas numera la colección ISSN, no la serie: "a" es ese número cuando
//   no coincide con el de la serie (una ISSN puede seguir de un volumen a otro o agrupar miniseries).
//   isbn:   { "978…": { title, series, number, ... } }   (versión 1, se sigue aceptando)

let data = null;
let loading = null;
const byIssn = new Map();
const byKey = new Map();
const byIsbn = new Map();
const byAddon = new Map();   // issn -> Map(número del suplemento -> ficha)
let index = [];   // [{ t: título normalizado, get: () => ficha }] para la búsqueda
const key = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

// Sin tildes, en minúsculas y con las siglas juntas (D.I.O.S.E.S. → dioses, S.H.I.E.L.D. → shield)
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(?:[a-z0-9]\.){2,}[a-z0-9]?\.?/g, (m) => m.replace(/\./g, ''));

const coverUrl = (c) => (!c || /^https?:/.test(c) ? c || null : `${data.img || ''}${c}${data.imgq || ''}`);

export function loadCatalog() {
  if (!loading) {
    loading = fetch('catalog/catalog.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => {
        data = j || { series: [], isbn: {}, extras: [] };
        index = [];
        const addAddon = (issn, a, get) => {
          if (!byAddon.has(issn)) byAddon.set(issn, new Map());
          if (!byAddon.get(issn).has(a)) byAddon.get(issn).set(a, get);
        };
        for (const s of data.series || []) {
          // Para cada ISSN, la serie con más números (la que se ofrece si no se lee el número)
          if (s.issn && Object.keys(s.issues).length > Object.keys(byIssn.get(s.issn)?.issues || {}).length) byIssn.set(s.issn, s);
          if (!byKey.has(key(s.name))) byKey.set(key(s.name), s);
          for (const [n, it] of Object.entries(s.issues || {})) {
            const get = () => catalogIssue(s, n);
            if (it.isbn) byIsbn.set(it.isbn, get);
            if (it.issn || s.issn) addAddon(it.issn || s.issn, it.a ?? +n, get);
            index.push({ t: fold(it.title || `${s.name} ${n}`), s: fold(s.name), n: +n, get });
          }
        }
        for (const [code, it] of Object.entries(data.isbn || {})) {
          const get = () => ({ ...it, cover: coverUrl(it.cover), isbn: code, publishedDate: it.date || '' });
          byIsbn.set(code, get);
          index.push({ t: fold(it.title), s: fold(it.series || it.title), n: it.number ?? 0, get });
        }
        for (const it of data.extras || []) {
          const { a, line, ...rest } = it;
          const get = () => ({ publisher: 'Panini', type: 'americano', ...rest, cover: coverUrl(it.cover), publishedDate: it.date || '' });
          if (it.isbn) byIsbn.set(it.isbn, get);
          if (it.issn && it.a != null) addAddon(it.issn, it.a, get);
          index.push({ t: fold(it.title), s: fold(it.title), n: 0, get });
        }
        index.sort((a, b) => a.s.localeCompare(b.s) || a.n - b.n);
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
  return byKey.get(key(name)) || (issn && byIssn.get(issn)) || null;
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
    cover: coverUrl(it.cover), price: it.price ?? null, publishedDate: it.date || '',
    ...((it.issn || series.issn) && { issn: it.issn || series.issn }),
    ...((it.issn || series.issn) === series.issn && series.ean && { barcode: series.ean }),
    ...(it.isbn && { isbn: it.isbn }), ...(it.pages && { pages: it.pages }), ...(it.authors && { authors: it.authors }),
  };
}

// Grapa por su ISSN y el número del suplemento
export function catalogByIssue(issn, a) {
  const get = byAddon.get(issn)?.get(a);
  return get ? get() : null;
}

// Número recién salido que aún no está en el catálogo: si la colección ISSN tiene una serie
// principal, se deduce su número a partir del último conocido (hasta 6 números más allá).
export function catalogNextIssue(issn, a) {
  const s = byIssn.get(issn);
  if (!s) return null;
  let last = null;
  for (const [n, it] of Object.entries(s.issues)) {
    if ((it.issn || s.issn) !== issn) continue;
    const an = it.a ?? +n;
    if (!last || an > last.a) last = { a: an, n: +n, it };
  }
  if (!last || a <= last.a || a - last.a > 6) return null;
  const n = last.n + (a - last.a);
  return {
    title: `${s.name} ${n}`, series: s.name, number: n, publisher: s.publisher || '', type: s.type || null,
    price: last.it.price ?? null, issn, cover: null, publishedDate: '',
  };
}

// Números de suplemento conocidos de una ISSN (para completar los suplementos de 2 cifras)
export const catalogAddons = (issn) => [...(byAddon.get(issn)?.keys() || [])];

export function catalogByIsbn(code) {
  const get = byIsbn.get(code);
  return get ? { ...get(), isbn: code } : null;
}

// Búsqueda local por título (para «Buscar por título»). Primero las series que se llaman como lo
// buscado («lobezno 3» → Lobezno 3 antes que «100% Marvel. Lobezno: Primera Clase 3»).
export function searchCatalog(q, limit = 20) {
  if (!data) return [];
  const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const tests = words.map((w) => (/^\d+$/.test(w) ? ((t) => new RegExp(`(^|\\D)0*${+w}(\\D|$)`).test(t)) : (t) => t.includes(w)));
  const name = words.filter((w) => !/^\d+$/.test(w)).join(' ');
  const score = (e) => {
    const sk = e.s.replace(/[^a-z0-9]+/g, ' ').trim();
    if (sk === name) return 0;
    if (sk.startsWith(name)) return 1;
    if (e.t.replace(/[^a-z0-9]+/g, ' ').trim().startsWith(name)) return 2;
    return 3;
  };
  const hits = [];
  for (const e of index) if (tests.every((f) => f(e.t))) hits.push(e);
  return hits
    .map((e, i) => ({ e, i, sc: score(e) }))
    .sort((a, b) => a.sc - b.sc || a.i - b.i)
    .slice(0, limit)
    .map(({ e }) => ({ ...e.get(), fromCatalog: true }));
}

// Series del catálogo cuyo nombre contiene lo buscado (para añadir una serie entera a deseados)
export function searchCatalogSeries(q, limit = 5) {
  if (!data) return [];
  const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w && !/^\d+$/.test(w));
  if (!words.length) return [];
  const name = words.join(' ');
  const hits = [];
  for (const s of data.series || []) {
    const k = key(s.name);
    if (!words.every((w) => k.includes(w))) continue;
    hits.push({ s, sc: k === name ? 0 : k.startsWith(name) ? 1 : 2, n: Object.keys(s.issues).length });
  }
  hits.sort((a, b) => a.sc - b.sc || b.n - a.n);
  return hits.slice(0, limit).map(({ s }) => s);
}

// Todos los números de una serie del catálogo (solo los ya publicados si `released`)
export function catalogSeriesItems(series, { released = true } = {}) {
  const now = new Date().toISOString().slice(0, 10);
  return Object.keys(series.issues)
    .filter((n) => !released || !series.issues[n].date || series.issues[n].date <= now)
    .map((n) => catalogIssue(series, n));
}
