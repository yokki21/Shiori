// Buscar: todo el catálogo (Panini, Planeta, Norma…) por título, serie o ISBN.
// Una serie abre su hoja (lo que tienes y lo que falta); un cómic abre su ficha, desde la que se puede
// apuntar en deseados o añadir a la biblioteca.

import { $, esc, euro, plural, seriesKey, coverHTML } from '../util.js';
import { findAny } from '../store.js';
import { loadCatalog, searchCatalog, searchCatalogSeries, catalogSeriesItems, catalogByIsbn } from '../catalog.js';
import { openPreview } from '../comic.js';
import { openSeries } from './series.js';

let found = { series: [], items: [] };
let timer;

const year = (d) => (d ? d.slice(0, 4) : '');

export function renderSearch() {
  const box = $('#search-results');
  const q = $('#search-input').value.trim();
  if (!q) {
    box.innerHTML = `<div class="empty"><div class="seal-big" lang="ja" aria-hidden="true">探</div><h2>Busca en el catálogo</h2><p>Más de 32.000 cómics y mangas de Panini, Planeta Cómic, Norma, Ivrea y ECC. Toca uno para ver su ficha, apuntarlo en deseados o añadirlo a tu biblioteca.</p></div>`;
    return;
  }
  const seriesRows = found.series.map((s, i) => {
    const items = catalogSeriesItems(s);
    const mine = items.filter((it) => findAny(it)?.status === 'coleccion').length;
    return `<button class="row series-row" data-series="${i}">
      ${coverHTML(items[0] || { series: s.name })}
      <span class="row-main"><b>${esc(s.name)}</b><span>${esc([s.publisher, plural(items.length, 'número', 'números'), mine ? `tienes ${mine}` : ''].filter(Boolean).join(', '))}</span></span>
      <span class="row-go" aria-hidden="true">›</span>
    </button>`;
  }).join('');
  const itemRows = found.items.map((it, i) => {
    const c = findAny(it);
    const st = c ? (c.status === 'deseo' ? '<span class="row-state wished">Deseado</span>' : '<span class="row-state">La tienes</span>') : '';
    return `<button class="row" data-item="${i}">
      ${coverHTML(it)}
      <span class="row-main"><b>${esc(it.title)}</b><span>${esc([it.publisher, it.price != null ? euro(it.price) : '', year(it.publishedDate)].filter(Boolean).join(', '))}</span></span>
      ${st}
    </button>`;
  }).join('');
  box.innerHTML = (seriesRows ? `<h2 class="section-title">Series</h2>${seriesRows}` : '')
    + (itemRows ? `<h2 class="section-title">Cómics</h2>${itemRows}` : '')
    || '<div class="empty"><h2>Sin resultados</h2><p>No está en el catálogo. Si lo tienes delante, escanéalo o añádelo con el botón +.</p></div>';
}

async function search() {
  const q = $('#search-input').value.trim();
  if (!q) { found = { series: [], items: [] }; renderSearch(); return; }
  if (!found.items.length && !found.series.length) $('#search-results').innerHTML = '<div class="spinner"></div>';
  await loadCatalog();
  const code = q.replace(/[\s-]/g, '');
  const byCode = /^\d{10}(\d{3})?$/.test(code) ? catalogByIsbn(code.length === 10 ? `978${code.slice(0, 9)}` : code) : null;
  found = byCode ? { series: [], items: [byCode] } : { series: searchCatalogSeries(q, 4), items: searchCatalog(q, 40) };
  renderSearch();
}

export function setupSearch() {
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); search(); $('#search-input').blur(); });
  $('#search-input').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  $('#search-results').addEventListener('click', (e) => {
    const r = e.target.closest('.row');
    if (!r) return;
    if (r.dataset.series != null) openSeries(seriesKey(found.series[+r.dataset.series].name));
    else openPreview(found.items[+r.dataset.item]);
  });
}
