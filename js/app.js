// Arranque y navegación de Shiori.

import { $, $$, setupDialogs, toast, plural } from './util.js';
import { state, loadStore, onChange, startCloud } from './store.js';
import { setGoogleKey } from './lookup.js';
import { loadCatalog } from './catalog.js';
import { refreshDetail, setComicHooks } from './comic.js';
import { openScanner, openAdd, handleCode } from './scan.js';
import { renderLibrary, setupLibrary } from './views/library.js';
import { renderSeries, renderSeriesSheet, setupSeries, openSeries } from './views/series.js';
import { renderProfile, renderSettings, renderAccount, setupProfile } from './views/profile.js';

const VIEWS = {
  library: { title: 'Biblioteca', tag: '本棚', render: renderLibrary },
  series: { title: 'Series', tag: '全巻', render: renderSeries },
  profile: { title: 'Perfil', tag: '記録', render: () => { renderProfile(); renderSettings(); } },
};
let current = 'library';

function showView(name) {
  current = name;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.tab[data-view]').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('#screen-title').textContent = VIEWS[name].title;
  $('#screen-tag').textContent = VIEWS[name].tag;   // etiqueta de la balda: estantería, colección completa, registro
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
    if ($('#sheet-series').open) renderSeriesSheet();
  });
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
  onChange(render);

  $$('.tab[data-view]').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#btn-scan').addEventListener('click', openScanner);
  $('#btn-add').addEventListener('click', () => openAdd({ focus: true }));
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="scan"]')) openScanner(); });

  loadCatalog().then(render);
  startCloud({
    onUser: () => { renderAccount(); render(); },
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
