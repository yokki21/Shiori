// Deseados: lo que quieres para tu colección y aún no tienes.
// Se busca en el catálogo y se apunta un cómic suelto o una serie entera; al escanearlo o
// marcarlo como «Ya lo tengo», pasa a la biblioteca.

import { $, esc, euro, plural, seriesKey, coverHTML, toast } from '../util.js';
import { wanted, byId, saveComic, removeComic, findAny } from '../store.js';
import { loadCatalog, searchCatalog, searchCatalogSeries, catalogSeriesItems } from '../catalog.js';
import { openDetail, newDraft } from '../comic.js';

export { findAny };

export async function addWish(it) {
  const d = newDraft(it);
  d.status = 'deseo';
  d.purchaseDate = null;
  await saveComic(d);
  return d;
}

const byOrder = (a, b) => seriesKey(a.series || a.title).localeCompare(seriesKey(b.series || b.title), 'es') || (a.number ?? 0) - (b.number ?? 0);

export function renderWish() {
  const list = [...wanted()].sort(byOrder);
  const total = list.reduce((s, c) => s + (c.price || 0), 0);
  $('#wish-count').textContent = list.length
    ? `${plural(list.length, 'deseado', 'deseados')}${total ? `, ${euro(total)} en total` : ''}`
    : '';
  const grid = $('#wish-grid');
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><div class="seal-big" lang="ja" aria-hidden="true">願</div><h2>Aún no deseas nada</h2><p>Busca arriba una serie, una grapa o un tomo y apúntalo. Cuando lo escanees, pasará solo a tu biblioteca.</p></div>`;
    return;
  }
  grid.innerHTML = list.map((c) => `
    <button class="book wish" data-id="${esc(c.id)}">
      <div class="book-art">${coverHTML(c)}${c.price != null ? `<span class="tag-price">${euro(c.price)}</span>` : ''}</div>
      <i class="ledge" aria-hidden="true"></i>
      <span class="cap">${esc(c.title || c.series || 'Sin título')}</span>
    </button>`).join('');
}

// ---------- Búsqueda en el catálogo ----------
let found = { series: [], items: [] };

function stateOf(it) {
  const c = findAny(it);
  if (!c) return '';
  return c.status === 'deseo' ? 'wish' : 'own';
}

function renderResults() {
  const box = $('#wish-results');
  const q = $('#wish-input').value.trim();
  if (!q) { box.innerHTML = ''; return; }
  const seriesRows = found.series.map((s, i) => {
    const items = catalogSeriesItems(s);
    const missing = items.filter((it) => !findAny(it));
    const cost = missing.reduce((t, it) => t + (it.price || 0), 0);
    const first = items[0] || { series: s.name };
    return `<div class="row series-row">
      ${coverHTML(first)}
      <span class="row-main"><b>${esc(s.name)}</b><span>Serie entera: ${plural(items.length, 'número', 'números')}${missing.length && missing.length < items.length ? `, te faltan ${missing.length}` : ''}${cost ? `, ${euro(cost)}` : ''}</span></span>
      ${missing.length ? `<button class="row-add" data-series="${i}">Desear serie</button>` : '<span class="row-state">Completa</span>'}
    </div>`;
  }).join('');
  const itemRows = found.items.map((it, i) => {
    const st = stateOf(it);
    return `<div class="row">
      ${coverHTML(it)}
      <span class="row-main"><b>${esc(it.title)}</b><span>${esc([it.price != null ? euro(it.price) : '', it.publishedDate?.slice(0, 4)].filter(Boolean).join(', '))}</span></span>
      ${st === 'own' ? '<span class="row-state">La tienes</span>' : st === 'wish' ? '<span class="row-state wished">Deseado</span>' : `<button class="row-add" data-item="${i}">Lo quiero</button>`}
    </div>`;
  }).join('');
  box.innerHTML = seriesRows + itemRows || '<p class="muted small">No está en el catálogo. Si lo tienes delante, escanéalo o añádelo con el botón +.</p>';
}

let timer;
async function search() {
  const q = $('#wish-input').value.trim();
  if (!q) { found = { series: [], items: [] }; renderResults(); return; }
  await loadCatalog();
  found = { series: searchCatalogSeries(q, 3), items: searchCatalog(q, 20) };
  renderResults();
}

export function setupWish() {
  $('#wish-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); search(); $('#wish-input').blur(); });
  $('#wish-input').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  $('#wish-results').addEventListener('click', async (e) => {
    const b = e.target.closest('.row-add');
    if (!b) return;
    if (b.dataset.item != null) {
      const d = await addWish(found.items[+b.dataset.item]);
      toast(`Añadido a deseados: ${d.title}`, 'Deshacer', () => removeComic(d.id));
    } else {
      const s = found.series[+b.dataset.series];
      const missing = catalogSeriesItems(s).filter((it) => !findAny(it));
      const ids = [];
      for (const it of missing) ids.push((await addWish(it)).id);
      toast(`${s.name}: ${plural(ids.length, 'número añadido', 'números añadidos')} a deseados`, 'Deshacer', async () => { for (const id of ids) await removeComic(id); });
    }
    renderResults();
  });
  $('#wish-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.book');
    if (b) openDetail(byId(b.dataset.id));
  });
}

// Tras escanear o añadir algo, los resultados reflejan si ya lo tienes
export const refreshWishResults = () => { if ($('#wish-input').value.trim()) renderResults(); };
