// Intermediario para consultar la Base de datos de libros editados en España
// (Agencia del ISBN, Ministerio de Cultura) desde Shiori.
//
// El buscador del Ministerio no permite llamadas desde otras webs (CORS) y
// necesita una sesión, así que este Worker de Cloudflare hace la consulta y
// devuelve JSON. Se despliega gratis en https://dash.cloudflare.com (Workers).
//
//   GET /?isbn=9788468471563   → ficha de ese ISBN
//   GET /?q=chainsaw man       → lista de títulos (ISBN, título, editorial, año)

const BASE = 'https://www.cultura.gob.es/webISBN/';
const ALLOWED = ['https://yokki21.github.io'];

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const okOrigin = ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    const isbn = (url.searchParams.get('isbn') || '').replace(/\D/g, '');
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (!/^97[89]\d{10}$/.test(isbn) && q.length < 2) return json({ error: 'Falta ?isbn= o ?q=' }, 400, cors);

    // Caché de 7 días en Cloudflare para no repetir consultas al Ministerio
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.shiori/${isbn ? 'isbn/' + isbn : 'q/' + encodeURIComponent(q.toLowerCase())}`);
    const hit = await cache.match(cacheKey);
    if (hit) return withCors(hit, cors);

    try {
      const cookie = await session();
      const list = await search(cookie, isbn ? { isbn } : { q });
      let body;
      if (isbn) {
        if (!list.links.length) body = { found: false };
        else body = { found: true, ...(await detail(cookie, list.links[0])), isbn };
      } else {
        body = { results: list.items };
      }
      const res = json(body, 200, { 'Cache-Control': 'public, max-age=604800' });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return withCors(res, cors);
    } catch (e) {
      return json({ error: 'No se ha podido consultar el Ministerio', detail: String(e).slice(0, 200) }, 502, cors);
    }
  },
};

async function session() {
  const r = await fetch(`${BASE}tituloSimpleFilter.do?cache=init&prev_layout=busquedaisbn&layout=busquedaisbn&language=es`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Shiori; consulta personal de colección)' },
  });
  const raw = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  const cookie = raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('sin sesión');
  return cookie;
}

async function getText(path, cookie, init = {}) {
  const r = await fetch(path.startsWith('http') ? path : BASE + path.replace(/^\/?webISBN\//, ''), {
    ...init,
    headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 (Shiori; consulta personal de colección)', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new TextDecoder('iso-8859-1').decode(await r.arrayBuffer());
}

async function search(cookie, { isbn = '', q = '' }) {
  const body = new URLSearchParams({
    'params.forzaQuery': 'N', 'params.cdispo': 'A', 'params.cisbnExt': isbn,
    'params.liConceptosExt[0].texto': q, 'params.orderByFormId': '1',
    action: 'Buscar', language: 'es', prev_layout: 'busquedaisbn', layout: 'busquedaisbn',
  });
  const html = await getText('tituloSimpleDispatch.do', cookie, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const links = [...new Set([...html.matchAll(/(tituloDetalle\.do\?[^"'\s>]+)/g)].map((m) => decodeEntities(m[1]).replace(/;jsessionid=[^?]*/, '')))];
  const text = toText(html);
  const items = [];
  for (const chunk of text.split(/ISBN 13:/).slice(1)) {
    const isbn = (chunk.match(/^\s*([\d-]{13,17})/) || [])[1];
    const t = chunk.match(/Título:\s*([\s\S]*?)\s*(?:\[[^\]]*\]\s*)?\((\d{4})\)/);
    if (!isbn || !t) continue;
    const pub = (chunk.match(/Editorial\/es:\s*([\s\S]*?)\s*(?:Seleccionar|Ordenar por|Resultados|$)/) || [])[1] || '';
    items.push({ isbn: isbn.replace(/-/g, ''), title: clean(t[1]), year: t[2], publisher: clean(pub.replace(/\s*\[.*$/, '')) });
    if (items.length >= 40) break;
  }
  return { links, items };
}

async function detail(cookie, link) {
  const html = await getText(link, cookie);
  const cells = [...html.matchAll(/<(th|td|dt|dd)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(toText(m[2])));
  const get = (label) => {
    const i = cells.findIndex((c) => c.replace(/:$/, '').toLowerCase() === label.toLowerCase());
    return i >= 0 ? cells[i + 1] || '' : '';
  };
  const precio = get('Precio').match(/([\d.,]+)/);
  return {
    title: get('Título'),
    authors: get('Autor/es').replace(/\s*\[Ver títulos\]/g, ''),
    publisher: get('Publicación') || get('Editorial/es'),
    collection: get('Colección').replace(/\s*\[Ver títulos\]/g, ''),
    date: get('Fecha Edición'),
    subjects: get('Materia/s'),
    description: get('Descripción'),
    // El Ministerio guarda el precio sin IVA (4 % en libros)
    priceNoVat: precio ? parseFloat(precio[1].replace(',', '.')) : null,
  };
}

function toText(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ordm: 'º', ordf: 'ª', iexcl: '¡', iquest: '¿', ccedil: 'ç', agrave: 'à', egrave: 'è', ograve: 'ò' };
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return named[e] ?? m;
  });
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function withCors(res, cors) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  return r;
}
