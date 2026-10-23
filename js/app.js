import { db, uid } from './db.js';
import { loadCatalog, catalogSeries, catalogIssue, catalogByIsbn, searchCatalog } from './catalog.js';
import { Scanner, scanFile } from './scanner.js';
import { lookupCode, searchTitle, normalizeIsbn, isIsbn, isIssnEan, issnFromEan, eanFromIssn, parseTitle, normalizePublisher, guessType, setGoogleKey, testGoogle } from './lookup.js';

// ---------- Estado ----------
const state = {
  comics: [],
  seriesMeta: new Map(),
  view: 'library',
  filters: { q: '', reading: '', type: '', sort: 'recent' },
  scanDest: 'coleccion',
  burst: false,
  autoAdd: true,
  lastType: 'manga',
  monthSel: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const seriesKey = (name) => norm(name).replace(/[^a-z0-9]+/g, ' ').trim();
const fmtEuro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const euro = (n) => fmtEuro.format(n || 0);
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hue(s) {
  let h = 0;
  for (const ch of norm(s)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function parsePrice(v) {
  const s = String(v ?? '').replace(/[^\d,.]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  return Number.isFinite(n) ? n : null;
}
function parseIntOrNull(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function ranges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(', ');
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function coverHTML(c) {
  const label = c.series || c.title || 'Sin título';
  const img = c.coverData || c.cover;
  return `<div class="cover"><div class="cover-ph" style="--h:${hue(label)}"><span class="t">${esc(label)}</span>${c.number != null ? `<span class="n">${c.number}</span>` : ''}</div>${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
}

const byId = (id) => state.comics.find((c) => c.id === id);
const owned = () => state.comics.filter((c) => c.status === 'coleccion');

// ---------- Capas (para que el botón atrás del móvil cierre lo abierto) ----------
// Cada hoja o pantalla abierta añade una entrada al historial; si se pide
// abrir otra mientras el navegador aún está retrocediendo, se espera a que
// termine para no descuadrar el historial.
const layers = [];
let ignorePops = 0;
let navWaiters = [];
let navTimer;
function navSettled() {
  ignorePops = 0;
  clearTimeout(navTimer);
  navWaiters.splice(0).forEach((f) => f());
}
function afterNav() {
  return ignorePops ? new Promise((r) => navWaiters.push(r)) : Promise.resolve();
}
function goBack(n) {
  ignorePops++;
  clearTimeout(navTimer);
  navTimer = setTimeout(navSettled, 1000); // por si el navegador no avisa
  history.go(-n);
}
function pushLayer(close) {
  const item = { close, pushed: false, cancelled: false };
  layers.push(item);
  afterNav().then(() => {
    if (item.cancelled) return;
    history.pushState({ shiori: true }, '');
    item.pushed = true;
  });
}
window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    if (--ignorePops === 0) navSettled();
    return;
  }
  // Botón atrás del móvil: cierra lo último que se abrió
  const item = layers.pop();
  if (item) { item.cancelled = true; item.close(); }
});
function closeTopLayer() {
  const item = layers.pop();
  if (!item) return;
  item.cancelled = true;
  item.close();
  if (item.pushed) goBack(1);
}
function closeAllLayers() {
  const items = layers.splice(0).reverse();
  let n = 0;
  for (const it of items) { it.cancelled = true; it.close(); if (it.pushed) n++; }
  if (n) goBack(n);
  return Promise.resolve();
}
function openDialog(dlg) {
  dlg.showModal();
  pushLayer(() => dlg.open && dlg.close());
}
$$('dialog').forEach((dlg) => {
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeTopLayer(); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeTopLayer();
    else if (e.target === dlg) closeTopLayer(); // toque fuera de la hoja
  });
});

// ---------- Aviso ----------
let toastTimer;
function toast(text, action, fn) {
  const t = $('#toast');
  $('#toast-text').textContent = text;
  const b = $('#toast-action');
  b.hidden = !action;
  if (action) { b.textContent = action; b.onclick = () => { t.hidden = true; fn(); }; }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3200);
}

// ---------- Persistencia ----------
async function saveComic(c) {
  c.updatedAt = Date.now();
  await db.put('comics', c);
  const i = state.comics.findIndex((x) => x.id === c.id);
  if (i >= 0) state.comics[i] = c; else state.comics.push(c);
  requestPersistence();
}
async function removeComic(id) {
  await db.del('comics', id);
  state.comics = state.comics.filter((c) => c.id !== id);
}
async function saveSeriesMeta(meta) {
  await db.put('series', meta);
  state.seriesMeta.set(meta.key, meta);
}
let persistAsked = false;
function requestPersistence() {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}

// ---------- Navegación ----------
function showView(name) {
  state.view = name;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === name));
  $('#screen-title').textContent = $(`#view-${name}`).dataset.title;
  render();
  window.scrollTo({ top: 0 });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
$('#btn-settings').addEventListener('click', () => showView('settings'));

function render() {
  ({ library: renderLibrary, series: renderSeries, wishlist: renderWishlist, stats: renderStats, settings: renderSettings })[state.view]();
  renderDatalists();
}

function renderDatalists() {
  const names = [...new Set(state.comics.map((c) => c.series).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#series-options').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  const pubs = [...new Set(state.comics.map((c) => c.publisher).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#publisher-options').innerHTML = pubs.map((n) => `<option value="${esc(n)}">`).join('');
}

// ---------- Biblioteca ----------
function renderLibrary() {
  const f = state.filters;
  const all = owned();
  let list = all;
  if (f.q) {
    const q = norm(f.q);
    list = list.filter((c) => norm([c.title, c.series, c.publisher, c.authors, c.isbn, c.issn].join(' ')).includes(q));
  }
  if (f.reading) list = list.filter((c) => c.reading === f.reading);
  if (f.type) list = list.filter((c) => c.type === f.type);
  const bySeries = (a, b) => (seriesKey(a.series || a.title)).localeCompare(seriesKey(b.series || b.title), 'es') || (a.number ?? 0) - (b.number ?? 0);
  const sorters = {
    recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    series: bySeries,
    title: (a, b) => norm(a.title).localeCompare(norm(b.title), 'es'),
    publisher: (a, b) => norm(a.publisher || '~').localeCompare(norm(b.publisher || '~'), 'es') || bySeries(a, b),
  };
  list = [...list].sort(sorters[f.sort]);

  const filtered = f.q || f.reading || f.type;
  $('#lib-count').textContent = all.length ? (filtered ? `${list.length} de ${plural(all.length, 'cómic', 'cómics')}` : plural(all.length, 'cómic', 'cómics')) : '';
  const grid = $('#lib-grid');
  if (!all.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Tu estantería está vacía</h2><p>Escanea el código de barras de la contraportada de un tomo y Shiori lo añade solo.</p><button class="btn primary" data-action="scan">Escanear mi primer cómic</button></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Nada por aquí</h2><p>Ningún cómic coincide con la búsqueda o los filtros.</p></div>`;
    return;
  }
  grid.innerHTML = list.map((c) => `
    <button class="book" data-id="${c.id}">
      <div class="book-art">${coverHTML(c)}${c.reading === 'leyendo' ? '<span class="mark-reading" title="Leyendo"></span>' : ''}${c.reading === 'leido' ? '<span class="mark-read" title="Leído"><svg><use href="#i-check"/></svg></span>' : ''}</div>
      <div class="cap">${esc(c.title || c.series || 'Sin título')}</div>
      <div class="sub">${esc(c.publisher || (c.isbn ? 'ISBN ' + c.isbn : ''))}</div>
    </button>`).join('');
}

$('#lib-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.book');
  if (b) editComic(byId(b.dataset.id));
});
$('#lib-search').addEventListener('input', (e) => { state.filters.q = e.target.value; renderLibrary(); });
$('#lib-filters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.filters.reading = b.dataset.reading;
  $$('#lib-filters .chip').forEach((x) => x.classList.toggle('on', x === b));
  renderLibrary();
});
$('#lib-types').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.filters.type = b.dataset.type;
  $$('#lib-types .chip').forEach((x) => x.classList.toggle('on', x === b));
  renderLibrary();
});
$('#lib-sort').addEventListener('change', (e) => { state.filters.sort = e.target.value; db.setKv('sort', e.target.value); renderLibrary(); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-action="scan"]')) openScanner(); });

// ---------- Series ----------
function seriesGroups() {
  const map = new Map();
  for (const c of state.comics) {
    if (!c.series || c.number == null) continue;
    const k = seriesKey(c.series);
    if (!k) continue;
    let g = map.get(k);
    if (!g) { g = { key: k, name: c.series, items: [], updated: 0 }; map.set(k, g); }
    g.items.push(c);
    g.updated = Math.max(g.updated, c.updatedAt || 0);
  }
  for (const g of map.values()) {
    const meta = state.seriesMeta.get(g.key) || {};
    g.total = meta.total || null;
    g.finished = !!meta.finished;
    g.byNum = new Map();
    for (const c of g.items) {
      const prev = g.byNum.get(c.number);
      if (!prev || (prev.status !== 'coleccion' && c.status === 'coleccion')) g.byNum.set(c.number, c);
    }
    const nums = [...g.byNum.keys()];
    g.max = Math.min(400, Math.max(g.total || 0, ...nums));
    const own = [...g.byNum.values()].filter((c) => c.status === 'coleccion');
    g.owned = own.length;
    g.read = own.filter((c) => c.reading === 'leido').length;
    g.missing = [];
    g.missingFree = []; // huecos que aún no están en Lo quiero
    for (let n = 1; n <= g.max; n++) {
      const c = g.byNum.get(n);
      if (!c || c.status !== 'coleccion') g.missing.push(n);
      if (!c) g.missingFree.push(n);
    }
    const count = (key) => { const m = new Map(); for (const c of g.items) if (c[key]) m.set(c[key], (m.get(c[key]) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
    g.publisher = count('publisher');
    g.type = count('type');
  }
  return [...map.values()];
}

function volState(c) {
  if (!c) return 'miss';
  if (c.status !== 'coleccion') return 'wish';
  return c.reading === 'leido' ? 'read' : 'own';
}
const VOL_LABEL = { read: 'leído', own: 'sin leer', wish: 'en Lo quiero', miss: 'te falta' };

function renderSeries() {
  const groups = seriesGroups().sort((a, b) => (b.owned > 0) - (a.owned > 0) || b.updated - a.updated);
  const box = $('#series-list');
  $('#series-count').textContent = groups.length ? plural(groups.length, 'serie', 'series') : '';
  if (!groups.length) {
    box.innerHTML = `<div class="empty"><h2>Aún no hay series</h2><p>Cuando añadas tomos con número (One Piece nº 3, Batman vol. 2…) se agrupan aquí y verás qué números te faltan.</p></div>`;
    return;
  }
  box.innerHTML = `
    <div class="legend">
      <span><i class="sp read"></i>Leído</span><span><i class="sp own"></i>Sin leer</span><span><i class="sp wish"></i>Lo quiero</span><span><i class="sp miss"></i>Te falta</span>
    </div>` + groups.map((g) => {
    const complete = g.missing.length === 0 && (g.finished || g.total);
    const meta = [
      `Tienes ${g.owned}${g.total ? ` de ${g.total}` : ''}`,
      g.missing.length ? `te faltan <b>${g.missing.length}</b>` : (complete ? 'completa' : ''),
      g.owned ? plural(g.read, 'leído', 'leídos') : '',
    ].filter(Boolean).join(', ');
    const spines = [];
    for (let n = 1; n <= g.max; n++) { const s = volState(g.byNum.get(n)); spines.push(`<i class="sp ${s}" title="nº ${n}: ${VOL_LABEL[s]}"></i>`); }
    return `<button class="series-row" data-key="${esc(g.key)}"><h3>${esc(g.name)}</h3><p class="meta">${meta.charAt(0).toUpperCase() + meta.slice(1)}${g.publisher ? `. ${esc(g.publisher)}` : ''}</p><div class="spines">${spines.join('')}</div></button>`;
  }).join('');
}
$('#series-list').addEventListener('click', (e) => {
  const r = e.target.closest('.series-row');
  if (r) openSeries(r.dataset.key);
});

let openSeriesKey = null;
function openSeries(key) {
  openSeriesKey = key;
  renderSeriesSheet();
  if (!$('#sheet-series').open) openDialog($('#sheet-series'));
}
function renderSeriesSheet() {
  const g = seriesGroups().find((x) => x.key === openSeriesKey);
  if (!g) { closeTopLayer(); return; }
  $('#series-heading').textContent = g.name;
  const vols = [];
  for (let n = 1; n <= g.max; n++) {
    const c = g.byNum.get(n); const s = volState(c);
    vols.push(`<button class="vol ${s}" data-n="${n}" ${c ? `data-id="${c.id}"` : ''} aria-label="Número ${n}: ${VOL_LABEL[s]}">${n}</button>`);
  }
  $('#series-body').innerHTML = `
    <p class="muted">Tienes ${g.owned}${g.total ? ` de ${g.total}` : ''} y has leído ${g.read}. ${g.missingFree.length ? 'Toca un número que te falte para añadirlo a Lo quiero.' : ''}</p>
    <div class="vols">${vols.join('')}</div>
    ${g.missingFree.length ? `<button class="btn wide" id="series-add-gaps">Añadir ${plural(g.missingFree.length, 'hueco', 'huecos')} a Lo quiero</button>` : ''}
    <div class="panel" style="margin-top:18px">
      <h2>Datos de la serie</h2>
      <p class="muted small">Indica cuántos tomos tiene para ver también los que faltan al final.</p>
      <div class="series-form" style="margin-top:10px">
        <label class="field num" style="margin:0"><span>Tomos en total</span><input id="series-total" inputmode="numeric" value="${g.total ?? ''}" placeholder="?"></label>
        <label class="check"><input type="checkbox" id="series-finished" ${g.finished ? 'checked' : ''}>Serie terminada</label>
        <button class="btn primary small" id="series-save">Guardar</button>
      </div>
    </div>`;
}
$('#series-body').addEventListener('click', async (e) => {
  const v = e.target.closest('.vol');
  const g = seriesGroups().find((x) => x.key === openSeriesKey);
  if (!g) return;
  if (v) {
    if (v.dataset.id) { editComic(byId(v.dataset.id)); return; }
    const c = await addWishPlaceholder(g, +v.dataset.n);
    renderSeriesSheet(); render();
    toast(`Nº ${v.dataset.n} añadido a Lo quiero`, 'Deshacer', async () => { await removeComic(c.id); renderSeriesSheet(); render(); });
    return;
  }
  if (e.target.id === 'series-add-gaps') {
    const added = [];
    for (const n of g.missingFree) added.push(await addWishPlaceholder(g, n));
    renderSeriesSheet(); render();
    toast(`${plural(added.length, 'número añadido', 'números añadidos')} a Lo quiero`, 'Deshacer', async () => { for (const c of added) await removeComic(c.id); renderSeriesSheet(); render(); });
  }
  if (e.target.id === 'series-save') {
    await saveSeriesMeta({ key: g.key, name: g.name, total: parseIntOrNull($('#series-total').value), finished: $('#series-finished').checked });
    renderSeriesSheet(); render();
    toast('Serie actualizada');
  }
});

async function addWishPlaceholder(g, n) {
  const now = Date.now();
  const c = {
    id: uid(), isbn: '', title: `${g.name} nº ${n}`, series: g.name, number: n,
    publisher: g.publisher || '', authors: '', type: g.type || state.lastType,
    status: 'deseo', reading: 'pendiente', price: null, purchaseDate: null, notes: '',
    cover: null, coverData: null, pages: null, createdAt: now, updatedAt: now,
  };
  await saveComic(c);
  return c;
}

// ---------- Lo quiero ----------
function renderWishlist() {
  const wish = state.comics.filter((c) => c.status === 'deseo').sort((a, b) =>
    seriesKey(a.series || a.title).localeCompare(seriesKey(b.series || b.title), 'es') || (a.number ?? 0) - (b.number ?? 0));
  const priced = wish.filter((c) => c.price != null);
  const sum = priced.reduce((s, c) => s + c.price, 0);
  $('#wish-summary').innerHTML = wish.length ? `
    <div class="wish-total">
      <div>${priced.length ? `<div class="big">${euro(sum)}</div><span class="muted small">${priced.length === wish.length ? 'Coste de tu lista' : `Coste de los ${priced.length} que tienen precio`}</span>` : '<span class="muted small">Añade precios para saber cuánto te costaría la lista.</span>'}</div>
      <span class="muted">${plural(wish.length, 'cómic', 'cómics')}</span>
    </div>` : '';
  const list = $('#wish-list');
  const gaps = seriesGroups().filter((g) => g.owned > 0 && g.missingFree.length > 0).sort((a, b) => b.updated - a.updated);
  const gapsHTML = gaps.length ? `
    <div class="gaps">
      <h2>Huecos en tus series</h2>
      <p class="muted small">Números que te faltan y aún no están en la lista.</p>
      ${gaps.map((g) => `<div class="gap-row"><div><b>${esc(g.name)}</b><br><span>Faltan ${ranges(g.missingFree)}</span></div><button class="btn small" data-gap="${esc(g.key)}">Añadir</button></div>`).join('')}
    </div>` : '';
  if (!wish.length) {
    list.innerHTML = `<div class="empty"><h2>Tu lista está vacía</h2><p>Si ves algo en la tienda que quieres comprar más adelante, escanéalo con «Lo quiero» activado.</p><button class="btn primary" data-action="scan-wish">Escanear para Lo quiero</button></div>` + gapsHTML;
    return;
  }
  list.innerHTML = wish.map((c) => `
    <div class="row">
      ${coverHTML(c)}
      <button class="row-main" data-id="${c.id}"><b>${esc(c.title || c.series)}</b><span>${esc([c.publisher, c.price != null ? euro(c.price) : ''].filter(Boolean).join(', ') || 'Sin precio')}</span></button>
      <button class="btn small" data-bought="${c.id}">Lo tengo</button>
    </div>`).join('') + gapsHTML;
}
$('#wish-list').addEventListener('click', async (e) => {
  const main = e.target.closest('.row-main');
  if (main) { editComic(byId(main.dataset.id)); return; }
  const bought = e.target.closest('[data-bought]');
  if (bought) {
    const c = byId(bought.dataset.bought);
    editComic({ ...c, status: 'coleccion', purchaseDate: today(), reading: 'pendiente' }, 'Revisa el precio y guarda para pasarlo a tu colección.');
    return;
  }
  const gap = e.target.closest('[data-gap]');
  if (gap) {
    const g = seriesGroups().find((x) => x.key === gap.dataset.gap);
    const added = [];
    for (const n of g.missingFree) added.push(await addWishPlaceholder(g, n));
    render();
    toast(`${plural(added.length, 'número añadido', 'números añadidos')} de ${g.name}`, 'Deshacer', async () => { for (const c of added) await removeComic(c.id); render(); });
  }
  if (e.target.closest('[data-action="scan-wish"]')) { setScanDest('deseo'); openScanner(); }
});

// ---------- Estadísticas ----------
function renderStats() {
  const own = owned();
  const box = $('#stats');
  if (!own.length) {
    box.innerHTML = `<div class="empty"><h2>Sin datos todavía</h2><p>Cuando tengas cómics en tu colección verás aquí cuánto llevas gastado, qué editoriales compras y cuánto te queda por leer.</p></div>`;
    return;
  }
  const priced = own.filter((c) => c.price != null);
  const spent = priced.reduce((s, c) => s + c.price, 0);
  const read = own.filter((c) => c.reading === 'leido').length;
  const reading = own.filter((c) => c.reading === 'leyendo').length;
  const pend = own.length - read - reading;
  const pendValue = own.filter((c) => c.reading !== 'leido' && c.price != null).reduce((s, c) => s + c.price, 0);

  // Gasto de los últimos 12 meses
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), sum: 0, n: 0 });
  }
  for (const c of own) {
    const ds = c.purchaseDate || (c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : null);
    if (!ds) continue;
    const [y, m] = ds.split('-').map(Number);
    const slot = months.find((x) => x.y === y && x.m === m - 1);
    if (slot) { slot.n++; slot.sum += c.price || 0; }
  }
  const maxSum = Math.max(...months.map((x) => x.sum), 0.01);
  if (state.monthSel == null) state.monthSel = 11;
  const sel = months[state.monthSel];

  // Editoriales
  const pubs = new Map();
  for (const c of own) {
    const k = c.publisher || 'Sin editorial';
    const p = pubs.get(k) || { n: 0, sum: 0 };
    p.n++; p.sum += c.price || 0; pubs.set(k, p);
  }
  const pubList = [...pubs].sort((a, b) => b[1].n - a[1].n);
  const top = pubList.slice(0, 7);
  if (pubList.length > 7) {
    const rest = pubList.slice(7).reduce((acc, [, p]) => ({ n: acc.n + p.n, sum: acc.sum + p.sum }), { n: 0, sum: 0 });
    top.push([`Otras (${pubList.length - 7})`, rest]);
  }
  const maxPub = Math.max(...top.map(([, p]) => p.n));

  const manga = own.filter((c) => c.type === 'manga').length;
  const us = own.filter((c) => c.type === 'americano').length;
  const other = own.length - manga - us;
  const pct = (n) => `${(n / own.length) * 100}%`;
  const groups = seriesGroups().filter((g) => g.owned > 0);
  const complete = groups.filter((g) => g.missing.length === 0 && (g.finished || g.total)).length;

  box.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${own.length}</div><div class="l">${own.length === 1 ? 'cómic' : 'cómics'}</div></div>
      <div class="kpi"><div class="v">${euro(spent).replace(/,00\s/, ' ')}</div><div class="l">gastado</div></div>
      <div class="kpi"><div class="v">${Math.round((read / own.length) * 100)}%</div><div class="l">leído</div></div>
    </div>

    <section class="stat-block">
      <h2>Gasto por mes</h2>
      <p>Últimos 12 meses, según la fecha de compra.${priced.length < own.length ? ` ${plural(own.length - priced.length, 'cómic no tiene', 'cómics no tienen')} precio.` : ''}</p>
      <div class="months" role="list">
        ${months.map((x, i) => `<button class="month ${x.sum === 0 ? 'zero' : ''} ${i === state.monthSel ? 'sel' : ''}" data-i="${i}" role="listitem" aria-label="${MONTHS_LONG[x.m]} ${x.y}: ${euro(x.sum)}, ${plural(x.n, 'tomo', 'tomos')}"><i style="height:${Math.max(1.5, (x.sum / maxSum) * 100)}%"></i></button>`).join('')}
      </div>
      <div class="month-labels">${months.map((x) => `<span>${MONTHS[x.m].charAt(0)}</span>`).join('')}</div>
      <p class="month-readout"><b>${MONTHS_LONG[sel.m].charAt(0).toUpperCase() + MONTHS_LONG[sel.m].slice(1)} ${sel.y}</b>: ${euro(sel.sum)} en ${plural(sel.n, 'tomo', 'tomos')}</p>
    </section>

    <section class="stat-block">
      <h2>Lectura</h2>
      <p>${pend ? `Tienes ${plural(pend, 'tomo', 'tomos')} sin empezar${pendValue ? ` y ${euro(pendValue)} por leer en total` : ''}.` : 'Lo tienes todo al día.'}</p>
      <div class="split">${read ? `<i class="s-read" style="width:${pct(read)}"></i>` : ''}${reading ? `<i class="s-reading" style="width:${pct(reading)}"></i>` : ''}${pend ? `<i class="s-pend" style="width:${pct(pend)}"></i>` : ''}</div>
      <div class="split-legend"><span><i class="s-read" style="background:var(--ai)"></i>Leídos ${read}</span><span><i style="background:var(--beni)"></i>Leyendo ${reading}</span><span><i style="background:var(--ink-3);opacity:.45"></i>Pendientes ${pend}</span></div>
    </section>

    <section class="stat-block">
      <h2>Por editorial</h2>
      <p>Tomos en tu colección y lo que has gastado en cada una.</p>
      <div class="hbars">${top.map(([name, p]) => `<div class="hbar"><span class="name">${esc(name)}</span><span class="track"><i style="width:${(p.n / maxPub) * 72}%"></i><em>${p.n}${p.sum ? `, ${euro(p.sum)}` : ''}</em></span></div>`).join('')}</div>
    </section>

    <section class="stat-block">
      <h2>Manga y americano</h2>
      <div class="split" style="margin-top:10px">${manga ? `<i class="s-manga" style="width:${pct(manga)}"></i>` : ''}${us ? `<i class="s-us" style="width:${pct(us)}"></i>` : ''}${other ? `<i class="s-other" style="width:${pct(other)}"></i>` : ''}</div>
      <div class="split-legend"><span><i style="background:var(--ai)"></i>Manga ${manga}</span><span><i style="background:var(--beni)"></i>Americano ${us}</span>${other ? `<span><i style="background:var(--ink-3);opacity:.45"></i>Otros ${other}</span>` : ''}</div>
    </section>

    <section class="stat-block">
      <h2>Más datos</h2>
      <p style="font-size:15px;color:var(--ink)">
        Precio medio por tomo: <b>${priced.length ? euro(spent / priced.length) : 'sin datos'}</b><br>
        Series en marcha: <b>${groups.length - complete}</b>${complete ? `, completas: <b>${complete}</b>` : ''}<br>
        En Lo quiero: <b>${state.comics.filter((c) => c.status === 'deseo').length}</b>
      </p>
    </section>`;
}
$('#stats').addEventListener('click', (e) => {
  const m = e.target.closest('.month');
  if (m) { state.monthSel = +m.dataset.i; renderStats(); }
});

// ---------- Ajustes ----------
$('#auto-add').addEventListener('change', (e) => {
  state.autoAdd = e.target.checked;
  db.setKv('autoAdd', state.autoAdd);
});

$('#google-save').addEventListener('click', async () => {
  const k = $('#google-key').value.trim();
  setGoogleKey(k);
  await db.setKv('googleKey', k);
  await runGoogleTest();
});
$('#google-test').addEventListener('click', runGoogleTest);
async function runGoogleTest() {
  const out = $('#google-status');
  out.textContent = 'Probando…';
  const r = await testGoogle();
  out.textContent = r.ok
    ? 'Google Books funciona correctamente.'
    : ({ quota: 'Sin clave propia: la cuota compartida está agotada. Añade tu clave.', 'quota-own': 'Tu clave ha gastado las búsquedas de hoy.', badkey: 'Google rechaza esta clave. Comprueba que la copiaste entera, que la Books API está activada y que la restricción de sitio incluye yokki21.github.io.', blocked: 'Google ha rechazado la petición.', down: 'Tu clave está bien, pero Google Books está fallando ahora mismo. Vuelve a probar más tarde.', network: 'No hay conexión con Google Books.' }[r.problem] || 'Error desconocido') + (r.status ? ` (error ${r.status})` : '');
}

async function renderSettings() {
  const last = await db.getKv('lastBackup');
  $('#last-backup').textContent = last
    ? `Última copia: ${new Date(last).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Aún no has guardado ninguna copia.';
  $('#btn-share').hidden = !(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));
  let info = '';
  if (navigator.storage?.persisted) {
    const p = await navigator.storage.persisted();
    info = p ? 'El navegador no borrará tus datos por su cuenta.' : 'El navegador podría borrar los datos si el móvil se queda sin espacio. Instalar Shiori en la pantalla de inicio lo evita en la mayoría de móviles.';
  }
  if (navigator.storage?.estimate) {
    const { usage } = await navigator.storage.estimate();
    if (usage > 200000) info += ` Ocupa unos ${(usage / 1048576).toFixed(1).replace('.', ',')} MB.`;
  }
  $('#storage-info').textContent = `${plural(state.comics.length, 'cómic guardado', 'cómics guardados')} en este dispositivo. ${info}`;
}

function backupFile() {
  const data = { app: 'shiori', version: 1, exportedAt: new Date().toISOString(), comics: state.comics, series: [...state.seriesMeta.values()] };
  return new File([JSON.stringify(data, null, 1)], `shiori-${today()}.json`, { type: 'application/json' });
}
$('#btn-export').addEventListener('click', async () => {
  const f = backupFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f); a.download = f.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  await db.setKv('lastBackup', Date.now());
  renderSettings();
});
$('#btn-share').addEventListener('click', async () => {
  try {
    await navigator.share({ files: [backupFile()], title: 'Copia de Shiori' });
    await db.setKv('lastBackup', Date.now());
    renderSettings();
  } catch { /* cancelado */ }
});
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== 'shiori' || !Array.isArray(data.comics)) {
    toast('Ese archivo no es una copia de Shiori');
    return;
  }
  if (!confirm(`La copia tiene ${plural(data.comics.length, 'cómic', 'cómics')}. Se añadirán a tu biblioteca y se actualizarán los que ya tengas. ¿Continuar?`)) return;
  let added = 0, updated = 0;
  const merged = [];
  for (const raw of data.comics) {
    if (!raw || !raw.id) continue;
    const match = byId(raw.id) || (raw.isbn ? state.comics.find((c) => c.isbn === raw.isbn) : null);
    const c = { ...raw, id: match ? match.id : raw.id };
    if (match) updated++; else added++;
    merged.push(c);
    const i = state.comics.findIndex((x) => x.id === c.id);
    if (i >= 0) state.comics[i] = c; else state.comics.push(c);
  }
  await db.putMany('comics', merged);
  for (const s of data.series || []) if (s?.key) { await db.put('series', s); state.seriesMeta.set(s.key, s); }
  toast(`Importado: ${added} nuevos y ${updated} actualizados`);
  render();
});
$('#btn-wipe').addEventListener('click', async () => {
  if (!confirm('¿Borrar toda la biblioteca de este dispositivo? No se puede deshacer si no tienes una copia.')) return;
  await db.clear('comics'); await db.clear('series');
  state.comics = []; state.seriesMeta.clear();
  toast('Biblioteca borrada');
  render();
});

// ---------- Ficha de cómic ----------
let draft = null;
let draftIsNew = false;
const form = $('#comic-form');
const F = form.elements;

function newDraft(data, dest) {
  const now = Date.now();
  const d = {
    id: uid(), isbn: data.isbn || '', title: data.title || '', series: data.series || '', number: data.number ?? null,
    publisher: data.publisher || '', authors: data.authors || '', pages: data.pages || null,
    cover: data.cover || null, coverData: null, type: data.type || state.lastType,
    status: dest, reading: 'pendiente', price: data.price ?? null,
    purchaseDate: dest === 'coleccion' ? today() : null, publishedDate: data.publishedDate || '',
    notes: '', createdAt: now, updatedAt: now, seriesTotal: data.seriesTotal || null,
  };
  // Si ya estaba ese número de la serie en Lo quiero sin ISBN, lo reutiliza
  const ph = d.series && d.number != null && state.comics.find((c) => c.status === 'deseo' && !c.isbn && seriesKey(c.series) === seriesKey(d.series) && c.number === d.number);
  if (ph) { d.id = ph.id; d.createdAt = ph.createdAt; if (ph.price != null && d.price == null) d.price = ph.price; }
  return d;
}

function setSeg(name, value) {
  $$(`.seg[data-name="${name}"] button`, form).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  if (name === 'status') $$('[data-only="coleccion"]', form).forEach((el) => { el.hidden = value !== 'coleccion'; });
}
$$('.seg', form).forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  draft[seg.dataset.name] = b.dataset.v;
  setSeg(seg.dataset.name, b.dataset.v);
  if (seg.dataset.name === 'status' && b.dataset.v === 'coleccion' && !F.purchaseDate.value) F.purchaseDate.value = today();
}));

function fillForm() {
  const d = draft;
  F.title.value = d.title || '';
  F.series.value = d.series || '';
  F.number.value = d.number ?? '';
  F.price.value = d.price != null ? d.price.toFixed(2).replace('.', ',') : '';
  F.purchaseDate.value = d.purchaseDate || '';
  F.publisher.value = d.publisher || '';
  F.authors.value = d.authors || '';
  F.isbn.value = d.isbn || '';
  F.pages.value = d.pages ?? '';
  F.notes.value = d.notes || '';
  setSeg('status', d.status); setSeg('reading', d.reading); setSeg('type', d.type || 'otro');
  refreshCover();
  $('#comic-delete').hidden = draftIsNew;
  $('#comic-retry').hidden = !(d.isbn && (!d.title || !d.cover));
  $('#issn-field').hidden = !d.issn;
  $('#isbn-field').hidden = !!d.issn && !d.isbn;
  $('#issn-value').value = d.issn ? `${d.issn}${d.addon ? `  (código ${d.addon})` : ''}` : '';
  $('#comic-search').hidden = !(draftIsNew && !d.title);
}
function refreshCover() {
  $('#comic-cover').innerHTML = coverHTML({ ...draft, title: F.title.value || draft.title, series: F.series.value || draft.series, number: parseIntOrNull(F.number.value) });
  $('#cover-remove').hidden = !(draft.cover || draft.coverData);
}

function openComic(d, { isNew = false, notice = '', warn = false } = {}) {
  draft = { ...d };
  draftIsNew = isNew;
  $('#comic-heading').textContent = isNew ? (d.status === 'deseo' ? 'Añadir a Lo quiero' : 'Añadir a tu colección') : 'Editar cómic';
  $('#comic-save').textContent = isNew ? 'Añadir' : 'Guardar';
  const n = $('#comic-notice');
  n.hidden = !notice; n.textContent = notice; n.classList.toggle('warn', warn);
  fillForm();
  $('#sheet-comic .sheet-body').scrollTop = 0;
  openDialog($('#sheet-comic'));
}
function editComic(c, notice) {
  if (!c) return;
  openComic(c, { notice });
}

form.addEventListener('input', (e) => {
  if (['title', 'series', 'number'].includes(e.target.name)) refreshCover();
});
F.title.addEventListener('change', () => {
  // Al escribir el título a mano, propone serie y número si están vacíos
  if (F.series.value || F.number.value) return;
  const p = parseTitle(F.title.value);
  if (p.series) { F.series.value = p.series; F.number.value = p.number ?? ''; refreshCover(); }
});
F.publisher.addEventListener('change', () => {
  F.publisher.value = normalizePublisher(F.publisher.value);
  const t = guessType(F.publisher.value, '', F.title.value);
  if (t && draftIsNew) { draft.type = t; setSeg('type', t); }
});

$('#cover-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 520 / bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    draft.coverData = c.toDataURL('image/jpeg', 0.82);
    refreshCover();
  } catch {
    toast('No se ha podido leer la foto');
  }
});
$('#cover-remove').addEventListener('click', () => { draft.cover = null; draft.coverData = null; refreshCover(); });

$('#comic-retry').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const code = normalizeIsbn(F.isbn.value) || F.isbn.value.replace(/\D/g, '');
  if (!code) return;
  btn.disabled = true; btn.textContent = 'Buscando…';
  const res = await lookupCode(code);
  btn.disabled = false; btn.textContent = 'Buscar datos otra vez';
  if (res.status !== 'ok') { toast(res.status === 'offline' ? 'Sin conexión. Prueba más tarde.' : 'Sigue sin aparecer en las bases de datos'); return; }
  const d = res.data;
  const keep = (k, v) => { if (v && !F[k].value) F[k].value = v; };
  keep('title', d.title); keep('series', d.series); keep('number', d.number ?? '');
  keep('publisher', d.publisher); keep('authors', d.authors); keep('pages', d.pages ?? '');
  if (d.price != null && !F.price.value) F.price.value = d.price.toFixed(2).replace('.', ',');
  if (d.cover && !draft.cover && !draft.coverData) draft.cover = d.cover;
  if (d.type) { draft.type = d.type; setSeg('type', d.type); }
  refreshCover();
  toast('Datos completados');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = draft;
  d.title = F.title.value.trim();
  d.series = F.series.value.trim();
  d.number = parseIntOrNull(F.number.value);
  if (!d.title) d.title = d.series ? `${d.series}${d.number != null ? ` nº ${d.number}` : ''}` : (d.isbn ? `ISBN ${d.isbn}` : '');
  if (!d.title) { F.title.focus(); toast('Ponle al menos un título'); return; }
  d.price = parsePrice(F.price.value);
  d.purchaseDate = d.status === 'coleccion' ? (F.purchaseDate.value || null) : null;
  d.publisher = normalizePublisher(F.publisher.value);
  d.authors = F.authors.value.trim();
  d.isbn = normalizeIsbn(F.isbn.value) || F.isbn.value.replace(/\D/g, '');
  d.pages = parseIntOrNull(F.pages.value);
  d.notes = F.notes.value.trim();
  if (!d.reading) d.reading = 'pendiente';

  // Mismo ISBN ya guardado con otro id: se actualiza ese en lugar de duplicar
  const dup = d.isbn && state.comics.find((c) => c.isbn === d.isbn && c.id !== d.id);
  if (dup) { d.id = dup.id; d.createdAt = dup.createdAt; }
  // Al pasar a la colección, retira el hueco de Lo quiero de ese mismo número
  if (d.status === 'coleccion' && d.series && d.number != null) {
    const ph = state.comics.find((c) => c.id !== d.id && c.status === 'deseo' && !c.isbn && seriesKey(c.series) === seriesKey(d.series) && c.number === d.number);
    if (ph) await removeComic(ph.id);
  }
  // Total de tomos que venía en el título ("nº 3/24")
  if (d.seriesTotal && d.series && !state.seriesMeta.get(seriesKey(d.series))?.total) {
    await saveSeriesMeta({ key: seriesKey(d.series), name: d.series, total: d.seriesTotal, finished: false });
  }
  delete d.seriesTotal;
  await saveComic(d);
  if (d.type && d.type !== 'otro') { state.lastType = d.type; db.setKv('lastType', d.type); }
  const wasNew = draftIsNew;
  closeTopLayer();
  if ($('#sheet-series').open) renderSeriesSheet();
  render();
  toast(wasNew ? (d.status === 'deseo' ? 'Añadido a Lo quiero' : 'Añadido a tu colección') : 'Cambios guardados');
});

$('#comic-delete').addEventListener('click', async () => {
  const c = byId(draft.id);
  if (!c || !confirm(`¿Eliminar «${c.title}» de Shiori?`)) return;
  await removeComic(c.id);
  closeTopLayer();
  if ($('#sheet-series').open) renderSeriesSheet();
  render();
  toast('Eliminado', 'Deshacer', async () => { await saveComic(c); if ($('#sheet-series').open) renderSeriesSheet(); render(); });
});

// ---------- Escáner ----------
let scanner = null;
const scanEl = $('#scanner');
const status = (t) => { $('#scan-status').textContent = t; };

function setScanDest(dest) {
  state.scanDest = dest;
  $$('.scan-modes button').forEach((b) => b.classList.toggle('on', b.dataset.dest === dest));
}
$('.scan-modes').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setScanDest(b.dataset.dest);
});

async function openScanner() {
  scanEl.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#burst-log').innerHTML = '';
  $('#scan-torch').hidden = true;
  $('#scan-torch').classList.remove('on');
  status('Apunta al código de barras de la contraportada');
  pushLayer(stopScanner);
  if (!window.isSecureContext) {
    status('La cámara solo funciona si abres Shiori desde https. Mientras tanto, escribe el ISBN o usa una foto.');
    return;
  }
  scanner = new Scanner($('#scan-video'), { onCode: onScanned, onError: () => {} });
  try {
    await scanner.start();
    if (scanEl.hidden) { scanner.stop(); return; } // se cerró mientras arrancaba
    $('#scan-torch').hidden = !scanner.torchAvailable;
  } catch (err) {
    scanner = null;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    status(denied
      ? 'Shiori no tiene permiso para usar la cámara. Actívalo en los ajustes del navegador, o escribe el ISBN.'
      : 'No se ha podido abrir la cámara. Escribe el ISBN o usa una foto del código.');
  }
}
function stopScanner() {
  scanner?.stop();
  scanner = null;
  scanEl.hidden = true;
  document.body.style.overflow = '';
}
$('#btn-scan').addEventListener('click', openScanner);
$('#scan-close').addEventListener('click', closeTopLayer);
$('#scan-torch').addEventListener('click', async (e) => {
  const on = !e.currentTarget.classList.contains('on');
  if (await scanner?.setTorch(on)) e.currentTarget.classList.toggle('on', on);
});
$('#scan-burst').addEventListener('click', (e) => {
  state.burst = !state.burst;
  e.currentTarget.setAttribute('aria-pressed', String(state.burst));
  status(state.burst ? 'Ráfaga: cada código se guarda solo. Ve pasando tomos.' : 'Apunta al código de barras de la contraportada');
});

function flashHit() {
  const f = $('.scan-frame');
  f.classList.add('hit');
  setTimeout(() => f.classList.remove('hit'), 500);
  navigator.vibrate?.(35);
}

let lastSeen = { code: null, at: 0 };
async function onScanned(code, addon) {
  // El mismo tomo sigue delante de la cámara: no repetir
  const key = `${code}|${addon || ''}`;
  const repeat = lastSeen.code === key && Date.now() - lastSeen.at < 4000;
  lastSeen = { code: key, at: Date.now() };
  if (repeat) return;
  scanner?.pause();
  flashHit();
  await handleCode(code, { fromScanner: true, addon });
}

// Ya está en Shiori: avisa (o en ráfaga, lo apunta y sigue)
async function handleExisting(existing, burst, dest) {
  if (burst && !scanEl.hidden) {
    if (existing.status === 'deseo' && dest === 'coleccion') {
      await saveComic({ ...existing, status: 'coleccion', purchaseDate: today() });
      burstLog(existing, 'Pasado de Lo quiero a tu colección');
      render();
    } else {
      burstLog(existing, existing.status === 'coleccion' ? 'Ya lo tienes' : 'Ya está en Lo quiero');
    }
    scanner?.pause(1600);
    return;
  }
  await closeAllLayers();
  if (existing.status === 'deseo' && dest === 'coleccion') {
    openComic({ ...existing, status: 'coleccion', purchaseDate: today() }, { notice: 'Estaba en Lo quiero. Al guardar pasa a tu colección.' });
  } else {
    openComic(existing, { notice: existing.status === 'coleccion' ? 'Ya lo tienes en tu colección.' : 'Ya está en tu lista de Lo quiero.' });
  }
}

// ---------- Revistas y grapas con ISSN ----------
// El ISSN identifica la colección, no cada número, así que no hay base de
// datos que consultar: Shiori aprende la serie de los números que ya tienes
// y saca el número del suplemento de 2 o 5 cifras cuando se puede leer.
function issnContext(issn) {
  const same = state.comics.filter((c) => c.issn === issn).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const ref = same.find((c) => c.series) || same[0];
  return {
    series: ref?.series || '', publisher: ref?.publisher || '', type: ref?.type || null,
    price: ref?.price ?? null, nums: same.map((c) => c.number).filter((n) => n != null),
  };
}

function guessIssueNumber(addon, nums) {
  const max = nums.length ? Math.max(...nums) : null;
  if (addon) {
    let n = parseInt(addon, 10);
    // 5 cifras: o el número tal cual (00042) o la convención americana (3 cifras de número + portada + impresión)
    if (addon.length === 5 && n >= 1000) n = parseInt(addon.slice(0, 3), 10);
    // 2 cifras: solo las dos últimas del número; se completa con lo que ya tienes
    if (addon.length === 2 && max != null && max >= 100) {
      let cand = Math.floor(max / 100) * 100 + n;
      if (cand < max - 50) cand += 100;
      n = cand;
    }
    if (n > 0) return { n, from: 'addon' };
  }
  if (max != null) return { n: max + 1, from: 'next' };
  return { n: null, from: null };
}

async function handleIssn(code, addon, { burst, quick, dest }) {
  const issn = issnFromEan(code);
  const ctx = issnContext(issn);
  await loadCatalog();
  const cat = catalogSeries(issn);
  if (cat) Object.assign(ctx, { series: cat.name, publisher: cat.publisher || ctx.publisher, type: cat.type || ctx.type });
  const g = guessIssueNumber(addon, ctx.nums);
  if (g.from === 'addon') {
    const existing = state.comics.find((c) => c.issn === issn && c.number === g.n);
    if (existing) { await handleExisting(existing, burst || quick, dest); return; }
  }
  // Serie del catálogo pero sin número leído (ISSN escrito a mano, foto sin el código pequeño…):
  // se elige el número tocando su portada
  if (cat && g.from !== 'addon' && !burst) { await openIssuePicker(cat, code, dest); return; }
  const issue = cat && g.n != null ? catalogIssue(cat, g.n) : null;
  const d = newDraft(issue || {
    title: ctx.series && g.n != null ? `${ctx.series} nº ${g.n}` : '',
    series: ctx.series, number: g.n, publisher: ctx.publisher, type: ctx.type, price: ctx.price,
  }, dest);
  Object.assign(d, { issn, barcode: code, addon: addon || null });

  // Serie conocida y número leído del código: se añade sin preguntar
  if (burst || (quick && ctx.series && g.from === 'addon')) {
    if (!d.title) d.title = `Revista ISSN ${issn}${g.n != null ? ` nº ${g.n}` : ''}`;
    delete d.seriesTotal;
    await saveComic(d);
    await announceAdded(d, ctx.series ? `${dest === 'deseo' ? 'Añadido a Lo quiero' : 'Añadido'}${g.from === 'next' ? ' (revisa el número)' : ''}` : 'Revista nueva: ponle el nombre de la serie luego');
    return;
  }
  await closeAllLayers();
  const num = g.from === 'addon'
    ? ` El número ${g.n} sale del código pequeño de la derecha: compruébalo.`
    : g.from === 'next' ? ` No he podido leer el número; te propongo el ${g.n}, el siguiente al último que tienes.` : '';
  const notice = cat
    ? `Es ${cat.name} (${cat.publisher}).${g.from === 'addon' ? '' : ' No he podido leer el número en el código pequeño: escríbelo y guarda.'}`
    : ctx.series
    ? `Revista con ISSN ${issn}: es de tu serie ${ctx.series}.${num}`
    : `Este cómic lleva ISSN (${issn}), que identifica la colección y no cada número, así que no sale en las bases de datos. Escribe el nombre de la serie una vez: los próximos números de esta colección se rellenarán solos.${g.n != null ? ` El código pequeño indica el nº ${g.n}.` : ''}`;
  // Sin enfocar ningún campo a mano: en iPhone desplaza la pantalla y la ficha se queda fuera de la vista
  openComic(d, { isNew: true, notice, warn: !ctx.series });
}

// Recorrido común: escáner, ISBN escrito o foto
async function handleCode(code, { fromScanner = false, addon = null } = {}) {
  const dest = state.scanDest;
  const burst = state.burst && fromScanner;
  const quick = state.autoAdd; // añadir sin abrir la ficha si se encuentra (cámara, ISBN escrito o foto)
  if (isIssnEan(code)) { await handleIssn(code, addon, { burst, quick, dest }); return; }
  const existing = state.comics.find((c) => c.isbn === code);
  if (existing) { await handleExisting(existing, burst || quick, dest); return; }

  status(`Buscando ${code}…`);
  await loadCatalog();
  const fromCat = catalogByIsbn(code);
  const res = fromCat ? { status: 'ok', data: fromCat } : await lookupCode(code);
  const d = newDraft(res.status === 'ok' ? res.data : { isbn: code }, dest);

  if (burst || (quick && res.status === 'ok' && d.title)) {
    if (!d.title) d.title = `ISBN ${code}`;
    await finishDraftExtras(d);
    await saveComic(d);
    if (d.type && d.type !== 'otro') { state.lastType = d.type; db.setKv('lastType', d.type); }
    await announceAdded(d, res.status === 'ok' ? (dest === 'deseo' ? 'Añadido a Lo quiero' : 'Añadido') : 'No encontrado: completa los datos luego');
    return;
  }

  await closeAllLayers();
  const gProblem = res.google && res.google !== 'network' ? ` ${GOOGLE_MSG[res.google]}` : '';
  const notices = {
    ok: '',
    notfound: isIsbn(code)
      ? (gProblem
        ? `No está en Open Library y Google Books no ha respondido.${gProblem} Mientras tanto, prueba «Buscar por título» o rellénalo a mano.`
        : 'No he encontrado este ISBN en ninguna de las bases de datos. Prueba «Buscar por título» o rellénalo a mano.')
      : `Este código (${code}) no es un ISBN; suele pasar con las grapas de quiosco. Prueba «Buscar por título» o rellénalo a mano.`,
    offline: 'Sin conexión. Guárdalo con el ISBN y luego pulsa «Buscar datos otra vez».',
  };
  openComic(d, { isNew: true, notice: notices[res.status], warn: res.status !== 'ok' });
}

const GOOGLE_MSG = {
  quota: 'La cuota gratuita compartida de Google Books está agotada: añade tu propia clave en Ajustes.',
  'quota-own': 'Has gastado las búsquedas diarias de tu clave de Google Books; mañana se renuevan.',
  badkey: 'Google Books rechaza tu clave: revísala en Ajustes.',
  blocked: 'Google Books ha rechazado la búsqueda.',
  down: 'Google Books está fallando ahora mismo (es un problema suyo, no de tu clave).',
};

// Línea en el escáner con lo que se acaba de leer: «Editar» abre la ficha y «Deshacer» lo quita
function burstLog(c, text) {
  const log = $('#burst-log');
  const el = document.createElement('div');
  el.className = 'burst-item';
  const img = c.coverData || c.cover;
  const isNew = /^Añadido|^No encontrado|^Revista nueva/.test(text);
  el.innerHTML = `${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : '<i class="ph"></i>'}<span><b>${esc(c.title)}</b><br>${esc(text)}</span><button data-a="edit">Editar</button>${isNew ? '<button data-a="undo">Deshacer</button>' : ''}`;
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'undo') { await removeComic(c.id); render(); el.remove(); }
    if (a === 'edit') { const cur = byId(c.id); if (!cur) return; await closeAllLayers(); editComic(cur); }
  });
  log.prepend(el);
  while (log.children.length > 3) log.lastChild.remove();
}

// Avisa de lo añadido: en el escáner, como línea de la lista; fuera, con un aviso y «Deshacer»
async function announceAdded(d, text) {
  render();
  if (!scanEl.hidden) { burstLog(d, text); scanStatusAfterAdd(); return; }
  await closeAllLayers();
  toast(`${text}: ${d.title}`, 'Deshacer', async () => { await removeComic(d.id); render(); });
}

// Selector de número por portada para una serie del catálogo
let picking = null;
async function openIssuePicker(cat, code, dest) {
  await closeAllLayers();
  picking = { cat, code, dest };
  $('#pick-heading').textContent = cat.name;
  const nums = Object.keys(cat.issues).map(Number).sort((a, b) => a - b);
  $('#pick-body').innerHTML = `
    <p class="muted">Es ${esc(cat.name)} (${esc(cat.publisher)}). Toca el número que tienes${dest === 'deseo' ? ' para añadirlo a Lo quiero' : ''}.</p>
    <div class="pick-grid">${nums.map((n) => {
      const it = catalogIssue(cat, n);
      const have = state.comics.find((c) => c.issn === cat.issn && c.number === n);
      return `<button class="pick${have ? ' owned' : ''}" data-n="${n}">${coverHTML(it)}<span class="cap">Nº ${n}</span>${have ? `<span class="have">${have.status === 'coleccion' ? 'Lo tienes' : 'En Lo quiero'}</span>` : ''}</button>`;
    }).join('')}</div>`;
  openDialog($('#sheet-pick'));
}
$('#pick-body').addEventListener('click', async (e) => {
  const b = e.target.closest('.pick');
  if (!b || !picking) return;
  const { cat, code, dest } = picking;
  const n = +b.dataset.n;
  const have = state.comics.find((c) => c.issn === cat.issn && c.number === n);
  if (have) { await closeAllLayers(); editComic(have); return; }
  const d = newDraft(catalogIssue(cat, n), dest);
  Object.assign(d, { issn: cat.issn, barcode: code || cat.ean || null });
  if (!state.autoAdd) { await closeAllLayers(); openComic(d, { isNew: true }); return; }
  delete d.seriesTotal;
  await saveComic(d);
  await announceAdded(d, dest === 'deseo' ? 'Añadido a Lo quiero' : 'Añadido');
});

function scanStatusAfterAdd() {
  status(state.burst ? 'Ráfaga: cada código se guarda solo. Ve pasando tomos.' : 'Listo. Escanea el siguiente o cierra.');
  scanner?.pause(1400);
}

// Lo que hace «Guardar» además de guardar, para cuando se añade sin ficha
async function finishDraftExtras(d) {
  if (d.status === 'coleccion' && d.series && d.number != null) {
    const ph = state.comics.find((c) => c.id !== d.id && c.status === 'deseo' && !c.isbn && seriesKey(c.series) === seriesKey(d.series) && c.number === d.number);
    if (ph) await removeComic(ph.id);
  }
  if (d.seriesTotal && d.series && !state.seriesMeta.get(seriesKey(d.series))?.total) {
    await saveSeriesMeta({ key: seriesKey(d.series), name: d.series, total: d.seriesTotal, finished: false });
  }
  delete d.seriesTotal;
}

// Escribir ISBN / buscar por título
let findMode = 'isbn';
function openFind(mode) {
  findMode = mode;
  scanner?.pause();
  const input = $('#find-input');
  $('#find-heading').textContent = mode === 'isbn' ? 'Escribir ISBN' : 'Buscar por título';
  input.value = '';
  input.inputMode = mode === 'isbn' ? 'numeric' : 'text';
  input.placeholder = mode === 'isbn' ? '978… o 1234-5678' : 'Ej.: Chainsaw Man 5';
  $('#find-hint').textContent = mode === 'isbn' ? 'Los 13 dígitos que hay bajo el código de barras, el ISBN de 10 o el ISSN de la revista (8 caracteres).' : 'Busca en Google Books y en Open Library. Incluye el número para afinar: «Berserk 3».';
  $('#find-results').innerHTML = mode === 'title' ? '<button class="btn wide" id="find-manual">Añadir a mano</button>' : '';
  openDialog($('#sheet-find'));
  setTimeout(() => input.focus(), 80);
}
$('#sheet-find').addEventListener('close', () => scanner?.resume());
$('#scan-manual').addEventListener('click', () => openFind('isbn'));
$('#scan-title').addEventListener('click', () => openFind('title'));
$('#btn-find').addEventListener('click', () => openFind('title'));
$('#comic-search').addEventListener('click', async () => {
  await closeAllLayers();
  openFind('title');
});

let lastResults = [];
$('#find-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#find-input').value.trim();
  if (!q) return;
  if (findMode === 'isbn') {
    const digits = q.replace(/[^0-9Xx]/g, '');
    const code = normalizeIsbn(q) || eanFromIssn(q) || (/^\d{13}$/.test(digits) ? digits : null);
    if (!code) { $('#find-hint').textContent = digits.length === 8 ? 'Ese ISSN no es válido. Revisa los dígitos.' : 'Ese ISBN no es válido. Revisa los dígitos.'; return; }
    await handleCode(code);
    return;
  }
  const box = $('#find-results');
  box.innerHTML = '<div class="spinner"></div>';
  let google = null;
  try {
    await loadCatalog();
    const local = searchCatalog(q);
    try {
      ({ results: lastResults, google } = await searchTitle(q));
    } catch (e) {
      if (!local.length) throw e;
      lastResults = [];
    }
    const seenIsbn = new Set(local.map((r) => r.isbn).filter(Boolean));
    lastResults = [...local, ...lastResults.filter((r) => !r.isbn || !seenIsbn.has(r.isbn))];
  } catch {
    box.innerHTML = '<p class="muted">No se ha podido buscar. Comprueba la conexión.</p><button class="btn wide" id="find-manual">Añadir a mano</button>';
    return;
  }
  const note = google && google !== 'network' ? `<p class="notice warn">Solo resultados de Open Library. ${GOOGLE_MSG[google]}</p>` : '';
  box.innerHTML = note + (lastResults.length
    ? lastResults.map((r, i) => `<div class="row">${coverHTML(r)}<button class="row-main" data-r="${i}"><b>${esc(r.title)}</b><span>${esc([r.publisher, r.publishedDate?.slice(0, 4), r.isbn].filter(Boolean).join(', '))}</span></button><button class="btn small" data-r="${i}">Elegir</button></div>`).join('')
    : '<p class="muted">Sin resultados.</p>') + '<button class="btn wide" id="find-manual">Añadir a mano</button>';
});
$('#find-results').addEventListener('click', async (e) => {
  if (e.target.id === 'find-manual') {
    const q = $('#find-input').value.trim();
    const p = parseTitle(q);
    const d = newDraft({ title: q, series: p.series, number: p.number }, state.scanDest);
    await closeAllLayers();
    openComic(d, { isNew: true });
    return;
  }
  const b = e.target.closest('[data-r]');
  if (!b) return;
  let r = lastResults[+b.dataset.r];
  if (r.isbn && state.comics.some((c) => c.isbn === r.isbn)) { await handleCode(r.isbn); return; }
  if (r.issn) {
    const have = state.comics.find((c) => c.issn === r.issn && c.number === r.number);
    if (have) { await closeAllLayers(); openComic(have, { notice: have.status === 'coleccion' ? 'Ya lo tienes en tu colección.' : 'Ya está en tu lista de Lo quiero.' }); return; }
  }
  if (r.needsLookup && r.isbn) {
    // Resultado de Open Library: trae los datos de esa edición concreta
    b.disabled = true;
    const res = await lookupCode(r.isbn);
    if (res.status === 'ok') {
      const ed = res.data;
      const cjk = /[\u3040-\u30ff\u4e00-\u9fff]/.test(r.title);
      // Se conserva el título de la búsqueda («ONE PIECE 5»), que trae serie y número;
      // el de la edición suele ser el del capítulo y va detrás. Si la búsqueda vino en japonés, manda la edición.
      const keep = !cjk && r.series;
      r = {
        ...r, ...ed, cover: ed.cover || null,
        title: keep ? (ed.title && !norm(ed.title).includes(norm(r.series)) ? `${r.title}: ${ed.title}` : r.title) : ed.title || r.title,
        series: keep ? r.series : ed.series || r.series,
        number: keep ? r.number : ed.number ?? r.number,
        publisher: ed.publisher || r.publisher,
      };
    }
    else r = { ...r, cover: null };
  }
  const d = newDraft(r, state.scanDest);
  if (r.issn) Object.assign(d, { issn: r.issn, barcode: r.barcode || null });
  await closeAllLayers();
  openComic(d, { isNew: true });
});

$('#scan-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  scanner?.pause();
  status('Leyendo la foto…');
  const hit = await scanFile(file).catch(() => null);
  if (!hit) {
    status('No encuentro ningún código en la foto. Prueba con otra más cerca, recta y sin reflejos.');
    scanner?.resume();
    return;
  }
  flashHit();
  await handleCode(hit.code, { addon: hit.addon });
});

// ---------- Arranque ----------
async function init() {
  try {
    const [comics, series, lastType, sort, gkey, autoAdd] = await Promise.all([db.all('comics'), db.all('series'), db.getKv('lastType'), db.getKv('sort'), db.getKv('googleKey'), db.getKv('autoAdd')]);
    state.autoAdd = autoAdd !== false;
    $('#auto-add').checked = state.autoAdd;
    setGoogleKey(gkey || '');
    $('#google-key').value = gkey || '';
    state.comics = comics;
    const fix = comics.filter((c) => /^977\d{10}$/.test(c.isbn || ''));
    for (const c of fix) { c.issn = issnFromEan(c.isbn); c.barcode = c.isbn; c.isbn = ''; }
    if (fix.length) await db.putMany('comics', fix);
    for (const s of series) state.seriesMeta.set(s.key, s);
    if (lastType) state.lastType = lastType;
    if (sort) { state.filters.sort = sort; $('#lib-sort').value = sort; }
  } catch {
    toast('No se puede guardar en este navegador (¿modo privado?)');
  }
  loadCatalog();
  showView('library');
  if (location.hash === '#scan') openScanner();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();

// Para pruebas desde la consola
window.shiori = { state, handleCode, render, openFind };
