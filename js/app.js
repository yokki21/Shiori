// Arranque y navegación de Shiori.

import { $, $$, setupDialogs, toast, plural, seriesKey } from './util.js';
import { state, loadStore, onChange, startCloud, saveComic } from './store.js';
import { setGoogleKey } from './lookup.js';
import { loadCatalog, catalogByIsbn } from './catalog.js';
import { refreshDetail, setComicHooks } from './comic.js';
import { openScanner, openAdd, handleCode } from './scan.js';
import { renderLibraryView, setupLibrary, setLibMode, libMode } from './views/library.js';
import { renderUpcoming, setupUpcoming } from './views/upcoming.js';
import { renderSeriesSheet, setupSeries, openSeries } from './views/series.js';
import { renderProfile, renderSettings, renderAccount, setupProfile } from './views/profile.js';
import { renderWish, setupWish, refreshWishResults } from './views/wish.js';

const VIEWS = {
  library: { title: 'Biblioteca', tag: () => (libMode() === 'series' ? '全巻' : '本棚'), render: renderLibraryView },
  new: { title: 'Novedades', tag: '新刊', render: renderUpcoming },
  wish: { title: 'Deseados', tag: '欲しい', render: renderWish },
  profile: { title: 'Perfil', tag: '記録', render: () => { renderProfile(); renderSettings(); } },
};
let current = 'library';

function showView(name) {
  if (name === 'series') { setLibMode('series'); name = 'library'; }   // Series vive dentro de Biblioteca
  current = name;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.tab[data-view]').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('#screen-title').textContent = VIEWS[name].title;
  const tag = VIEWS[name].tag;
  $('#screen-tag').textContent = typeof tag === 'function' ? tag() : tag;   // etiqueta de la balda: estantería, colección completa, registro
  VIEWS[name].render();
  window.scrollTo({ top: 0 });
}

// Tras cada cambio en los datos se repinta lo visible (una vez por fotograma)
let pending = false;
function render() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    VIEWS[current].render();
    refreshDetail();
    refreshWishResults();
    if ($('#sheet-series').open) renderSeriesSheet();
  });
}

// Cómics guardados antes de que el catálogo los conociera: se completa la serie y el número que falten
async function fillFromCatalog() {
  for (const c of [...state.comics]) {
    if (!c.isbn || (c.series && c.number != null)) continue;
    const it = catalogByIsbn(c.isbn);
    if (!it?.series || it.number == null) continue;
    if (c.series && seriesKey(c.series) !== seriesKey(it.series)) continue;
    await saveComic({ ...c, series: it.series, number: it.number });
  }
}

async function init() {
  setupDialogs();
  try {
    await loadStore();
  } catch {
    toast('No se puede guardar en este navegador (¿modo privado?)');
  }
  setGoogleKey(state.settings.googleKey || '');
  setComicHooks({ openSeries, openFind: () => openAdd({ focus: true }) });
  setupLibrary();
  setupSeries();
  setupProfile();
  setupWish();
  setupUpcoming();
  onChange(render);

  $$('.tab[data-view]').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#btn-scan').addEventListener('click', openScanner);
  $('#btn-add').addEventListener('click', () => openAdd({ focus: true }));
  $('#brand').addEventListener('click', () => { setLibMode('comics'); showView('library'); });   // el logo lleva a la página principal
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="scan"]')) openScanner(); });

  loadCatalog().then(fillFromCatalog).then(render);
  startCloud({
    onUser: () => { renderAccount(); render(); },
    onProfile: () => { renderAccount(); render(); },
    onStatus: () => { renderAccount(); if (current === 'profile') render(); },
    onSynced: ({ down }) => { if (down) toast(`Tu cuenta tenía ${plural(down, 'cambio', 'cambios')} y ya están en este dispositivo`); },
  });

  showView('library');
  if (location.hash === '#scan') openScanner();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Acceso para pruebas, solo con ?debug
  if (new URLSearchParams(location.search).has('debug')) window.shiori = { state, handleCode, openAdd };
}

init();
