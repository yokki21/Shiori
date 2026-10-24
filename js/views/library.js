// Biblioteca: tus cómics, con buscador y filtro de leídos.

import { $, $$, esc, norm, seriesKey, plural, coverHTML } from '../util.js';
import { state, owned, byId, setSetting } from '../store.js';
import { openDetail } from '../comic.js';

const PAGE = 60;
const filters = { q: '', read: '' };
let list = [];
let shown = 0;
let observer = null;

export function renderLibrary() {
  const all = owned();
  let l = all;
  if (filters.q) {
    const q = norm(filters.q);
    l = l.filter((c) => norm(`${c.title} ${c.series} ${c.publisher} ${c.authors} ${c.isbn} ${c.issn || ''}`).includes(q));
  }
  if (filters.read === 'leido') l = l.filter((c) => c.reading === 'leido');
  if (filters.read === 'pendiente') l = l.filter((c) => c.reading !== 'leido');
  const bySeries = (a, b) => seriesKey(a.series || a.title).localeCompare(seriesKey(b.series || b.title), 'es') || (a.number ?? 0) - (b.number ?? 0);
  const sorters = {
    recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    series: bySeries,
    title: (a, b) => norm(a.title).localeCompare(norm(b.title), 'es'),
  };
  list = [...l].sort(sorters[state.settings.sort] || sorters.recent);

  const filtered = filters.q || filters.read;
  $('#lib-count').textContent = all.length ? (filtered ? `${list.length} de ${plural(all.length, 'cómic', 'cómics')}` : plural(all.length, 'cómic', 'cómics')) : '';
  $('#lib-tools').hidden = !all.length;
  const grid = $('#lib-grid');
  if (!all.length) {
    grid.innerHTML = `<div class="empty"><div class="seal-big" lang="ja" aria-hidden="true">棚</div><h2>Tu estantería está vacía</h2><p>Escanea el código de barras de la contraportada y el cómic se añade solo, con portada y todo.</p><button class="btn primary" data-action="scan">Escanear mi primer cómic</button></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><h2>Nada por aquí</h2><p>Ningún cómic coincide con la búsqueda.</p></div>`;
    return;
  }
  grid.innerHTML = '';
  shown = 0;
  more();
}

// Pinta la estantería por partes: las primeras portadas y el resto al hacer scroll
function more() {
  const grid = $('#lib-grid');
  $('#lib-sentinel')?.remove();
  const slice = list.slice(shown, shown + PAGE);
  grid.insertAdjacentHTML('beforeend', slice.map((c) => `
    <button class="book" data-id="${esc(c.id)}">
      <div class="book-art">${coverHTML(c)}${c.reading === 'leido' ? '<span class="mark-read" title="Leído" lang="ja">済</span>' : ''}</div>
      <i class="ledge" aria-hidden="true"></i>
      <span class="cap">${esc(c.title || c.series || 'Sin título')}</span>
    </button>`).join(''));
  shown += slice.length;
  if (shown < list.length) {
    grid.insertAdjacentHTML('beforeend', '<div id="lib-sentinel" aria-hidden="true"></div>');
    observer ??= new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: '600px' });
    observer.observe($('#lib-sentinel'));
  }
}

let searchTimer;
export function setupLibrary() {
  $('#lib-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.book');
    if (b) openDetail(byId(b.dataset.id));
  });
  $('#lib-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filters.q = e.target.value; renderLibrary(); }, 150);
  });
  $('#lib-filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filters.read = b.dataset.read;
    $$('#lib-filters .chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    renderLibrary();
  });
  $('#lib-sort').value = state.settings.sort;
  $('#lib-sort').addEventListener('change', (e) => { setSetting('sort', e.target.value); renderLibrary(); });
}
