// Búsqueda de datos de un cómic por ISBN o por título.
// Fuentes: Google Books (principal) y Open Library (respaldo).
// Google Books sin clave comparte una cuota global que suele estar agotada
// (error 429), así que se puede configurar una clave propia en Ajustes.

import { isValidEan13 } from './ean.js';

const GB = 'https://www.googleapis.com/books/v1/volumes';
const OL = 'https://openlibrary.org/api/books';
const OL_SEARCH = 'https://openlibrary.org/search.json';

let googleKey = '';
export function setGoogleKey(k) { googleKey = (k || '').trim(); }
const gbUrl = (params) => `${GB}?${params}${googleKey ? `&key=${encodeURIComponent(googleKey)}` : ''}`;

// Traduce un fallo de Google Books a algo que se pueda explicar
export function googleProblem(err) {
  if (!err) return null;
  if (err.status === 429) return googleKey ? 'quota-own' : 'quota';
  if (err.status === 400 || err.status === 403) return googleKey ? 'badkey' : 'blocked';
  return 'network';
}

export function normalizeIsbn(raw) {
  const s = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13) return isValidEan13(s) ? s : null;
  if (s.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += +s[i] * (10 - i);
    const c = (11 - (sum % 11)) % 11;
    if ((c === 10 ? 'X' : String(c)) !== s[9]) return null;
    const core = '978' + s.slice(0, 9);
    let t = 0;
    for (let i = 0; i < 12; i++) t += +core[i] * (i % 2 ? 3 : 1);
    return core + ((10 - (t % 10)) % 10);
  }
  return null;
}

export const isIsbn = (code) => /^97[89]\d{10}$/.test(code);

async function getJson(url, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const https = (u) => (u ? u.replace(/^http:/, 'https:').replace('&edge=curl', '') : null);

function idsOf(vi) {
  const out = {};
  for (const id of vi.industryIdentifiers || []) out[id.type] = id.identifier;
  return out;
}

function mapVolume(v) {
  const vi = v.volumeInfo || {};
  const ids = idsOf(vi);
  const price = v.saleInfo?.listPrice || v.saleInfo?.retailPrice;
  return {
    title: vi.title || '',
    subtitle: vi.subtitle || '',
    authors: (vi.authors || []).join(', '),
    publisher: vi.publisher || '',
    publishedDate: vi.publishedDate || '',
    pages: vi.pageCount || null,
    cover: https(vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail),
    categories: (vi.categories || []).join(' / '),
    description: vi.description || '',
    isbn: ids.ISBN_13 || normalizeIsbn(ids.ISBN_10) || '',
    price: price && price.currencyCode === 'EUR' ? price.amount : null,
  };
}

async function googleByIsbn(code) {
  const tries = [`q=isbn:${code}`, `q=${code}`];
  for (const q of tries) {
    const j = await getJson(gbUrl(`${q}&country=ES&maxResults=10`));
    const items = j.items || [];
    const hit = items.find((v) => {
      const ids = idsOf(v.volumeInfo || {});
      return ids.ISBN_13 === code || normalizeIsbn(ids.ISBN_10) === code;
    });
    if (hit) return mapVolume(hit);
  }
  return null;
}

async function openLibraryByIsbn(code) {
  const j = await getJson(`${OL}?bibkeys=ISBN:${code}&format=json&jscmd=data`);
  const d = j['ISBN:' + code];
  if (!d) return null;
  return {
    title: d.title || '',
    subtitle: d.subtitle || '',
    authors: (d.authors || []).map((a) => a.name).join(', '),
    publisher: d.publishers?.[0]?.name || '',
    publishedDate: d.publish_date || '',
    pages: d.number_of_pages || null,
    cover: d.cover?.medium || d.cover?.large || null,
    categories: (d.subjects || []).map((s) => s.name).join(' / '),
    description: '',
    isbn: code,
    price: null,
  };
}

function probeImage(url, ms = 6000) {
  return new Promise((res) => {
    const img = new Image();
    const t = setTimeout(() => res(false), ms);
    img.onload = () => { clearTimeout(t); res(img.naturalWidth > 10); };
    img.onerror = () => { clearTimeout(t); res(false); };
    img.src = url;
  });
}

// Devuelve { status: 'ok' | 'notfound' | 'offline', data, google }
// `google` explica por qué falló Google Books (cuota, clave…), si falló.
export async function lookupCode(code) {
  if (!navigator.onLine) return { status: 'offline' };
  const [gb, ol] = await Promise.allSettled([googleByIsbn(code), isIsbn(code) ? openLibraryByIsbn(code) : null]);
  const a = gb.status === 'fulfilled' ? gb.value : null;
  const b = ol.status === 'fulfilled' ? ol.value : null;
  const google = gb.status === 'rejected' ? googleProblem(gb.reason) : null;
  if (!a && !b) {
    const failed = gb.status === 'rejected' && google === 'network' && (ol.status === 'rejected' || !isIsbn(code));
    return { status: failed ? 'offline' : 'notfound', google };
  }
  const data = { ...(b || {}), ...(a || {}) };
  for (const k of Object.keys(b || {})) if (!data[k] && b[k]) data[k] = b[k];
  if (!data.cover && isIsbn(code)) {
    const url = `https://covers.openlibrary.org/b/isbn/${code}-M.jpg?default=false`;
    if (await probeImage(url)) data.cover = url;
  }
  data.isbn = code;
  return { status: 'ok', data: enrich(data), google };
}

async function googleSearch(q) {
  const j = await getJson(gbUrl(`q=${encodeURIComponent(q)}&langRestrict=es&printType=books&maxResults=20&country=ES`));
  return (j.items || []).map((v) => enrich(mapVolume(v)));
}

// Open Library: se queda con las ediciones españolas (ISBN 978-84…).
// El título puede venir en japonés; al elegirlo se busca la edición por ISBN.
async function openLibrarySearch(q) {
  const j = await getJson(`${OL_SEARCH}?q=${encodeURIComponent(q)}&fields=title,author_name,publisher,isbn,cover_i&limit=60`);
  const out = [];
  for (const d of j.docs || []) {
    const isbns = (d.isbn || []).filter((i) => /^97[89]84\d{8}$/.test(i) && isValidEan13(i));
    for (const isbn of isbns.slice(0, 3)) {
      out.push(enrich({
        title: d.title || '', subtitle: '', authors: (d.author_name || []).join(', '),
        publisher: (d.publisher || []).find((p) => /planeta|norma|ivrea|panini|ecc|milky|arechi|distrito|kitsune|tomodomo|glénat|glenat|editores/i.test(p)) || '',
        publishedDate: '', pages: null, categories: '', description: '', price: null,
        cover: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
        isbn, needsLookup: true,
      }));
    }
    if (out.length >= 24) break;
  }
  return out;
}

// Devuelve { results, google } con los resultados de ambas fuentes
export async function searchTitle(q) {
  const [gb, ol] = await Promise.allSettled([googleSearch(q), openLibrarySearch(q)]);
  const results = [];
  const seen = new Set();
  for (const r of [...(gb.status === 'fulfilled' ? gb.value : []), ...(ol.status === 'fulfilled' ? ol.value : [])]) {
    const k = r.isbn || r.title;
    if (seen.has(k)) continue;
    seen.add(k); results.push(r);
  }
  if (gb.status === 'rejected' && ol.status === 'rejected') throw gb.reason;
  return { results, google: gb.status === 'rejected' ? googleProblem(gb.reason) : null };
}

// Prueba la conexión con Google Books (para Ajustes)
export async function testGoogle() {
  try {
    const j = await getJson(gbUrl('q=isbn:9788468471495&maxResults=1'));
    return { ok: true, n: j.totalItems || 0 };
  } catch (e) {
    return { ok: false, problem: googleProblem(e), status: e.status || null };
  }
}

// ---------- Interpretación del título ----------

const NUM_RE = /^(.*?)[\s,.:;\-–(]*(?:n\.?\s?[ºo°]\.?|nº|núm\.?|num\.?|número|numero|vol\.?|volumen|tomo|#)\s*0*(\d{1,4})(?:\s*(?:\/|de)\s*0*(\d{1,4}))?\)?(.*)$/i;

export function parseTitle(title = '', subtitle = '') {
  const full = [title, subtitle].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  let m = full.match(NUM_RE);
  if (m && m[1].trim()) {
    return { series: cleanSeries(m[1]), number: +m[2], total: m[3] ? +m[3] : null };
  }
  // "Chainsaw Man 5", "Berserk Maximum 03" (sin año)
  m = full.match(/^(.*\D)\s0*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?$/);
  if (m) return { series: cleanSeries(m[1]), number: +m[2], total: m[3] ? +m[3] : null };
  // subtítulo numérico: "One Piece" + "105"
  if (/^\d{1,3}$/.test(subtitle.trim())) return { series: cleanSeries(title), number: +subtitle, total: null };
  return { series: '', number: null, total: null };
}

function cleanSeries(s) {
  return s.replace(/[\s,.:;\-–(]+$/, '').replace(/\s+/g, ' ').trim();
}

const PUBLISHERS = [
  [/planeta/i, 'Planeta Cómic'], [/ivrea/i, 'Ivrea'], [/norma/i, 'Norma Editorial'],
  [/panini/i, 'Panini'], [/\becc\b/i, 'ECC Ediciones'], [/milky/i, 'Milky Way'],
  [/arechi/i, 'Arechi Manga'], [/distrito/i, 'Distrito Manga'], [/kitsune/i, 'Kitsune Books'],
  [/tomodomo/i, 'Tomodomo'], [/moztros/i, 'Moztros'], [/ooso/i, 'Ooso Cómics'],
  [/astiberri/i, 'Astiberri'], [/dolmen/i, 'Dolmen'], [/fandogamia/i, 'Fandogamia'],
];

export function normalizePublisher(p = '') {
  for (const [re, name] of PUBLISHERS) if (re.test(p)) return name;
  return p.trim();
}

const MANGA_PUB = new Set(['Ivrea', 'Milky Way', 'Arechi Manga', 'Distrito Manga', 'Kitsune Books', 'Tomodomo', 'Moztros', 'Ooso Cómics']);
const US_RE = /(spider|batman|superman|x-men|patrulla-x|vengadores|avengers|marvel|\bdc\b|hulk|\bthor\b|daredevil|lobezno|wolverine|deadpool|\bflash\b|wonder woman|liga de la justicia|capit[aá]n am[eé]rica|iron man|joker|lobezno|venom|green lantern|linterna verde|aquaman|harley|punisher|castigador|f[aá]bulas|invencible|walking dead)/i;

export function guessType(publisher, categories = '', title = '') {
  if (/manga/i.test(categories)) return 'manga';
  if (/superhero|superh[eé]roe/i.test(categories) || US_RE.test(title)) return 'americano';
  if (MANGA_PUB.has(publisher)) return 'manga';
  return null;
}

function enrich(d) {
  const publisher = normalizePublisher(d.publisher);
  const p = parseTitle(d.title, d.subtitle);
  const sub = (d.subtitle || '').trim();
  let title = (d.title || '').trim();
  if (sub) title += /^(\d|n\.?\s?º|nº|n°|núm|vol|tomo|#)/i.test(sub) ? ` ${sub}` : `: ${sub}`;
  return {
    ...d,
    title,
    publisher,
    series: p.series,
    number: p.number,
    seriesTotal: p.total,
    type: guessType(publisher, d.categories, d.title),
  };
}
