// Próximas novedades: lo que las editoriales del catálogo aún no han sacado, según las fechas del catálogo.
// Primero lo que te toca (números de tus series y lo que tienes en deseados) y después todo lo demás,
// agrupado por día de salida.

import { $, $$, esc, euro, plural, seriesKey, coverHTML, toast, MONTHS } from '../util.js';
import { owned, wanted, removeComic } from '../store.js';
import { loadCatalog, catalogUpcoming, catalogLoaded } from '../catalog.js';
import { addWish, findAny } from './wish.js';
import { openPreview } from '../comic.js';

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
let line = '';
let pub = '';
let shown = [];

function dayParts(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return { wd: DAYS[d.getDay()], day: d.getDate(), month: MONTHS[d.getMonth()] };
}

// Qué relación tienes con cada novedad
function relation(u) {
  const c = findAny(u.item);
  if (c) return c.status === 'deseo' ? 'wish' : 'own';
  return '';
}

export function renderUpcoming() {
  const list = $('#new-list');
  if (!catalogLoaded()) { list.innerHTML = '<div class="spinner"></div>'; loadCatalog().then(renderUpcoming); return; }
  const all = catalogUpcoming().filter((u) => (!line || u.line === line) && (!pub || u.item.publisher === pub));
  // Tus series: las de la colección y las de deseados (por nombre de serie)
  const mine = new Set([...owned(), ...wanted()].map((c) => seriesKey(c.series || '')).filter(Boolean));
  const yours = [];
  const rest = [];
  for (const u of all) {
    const rel = relation(u);
    const inSeries = u.item.series && mine.has(seriesKey(u.item.series));
    (rel || inSeries ? yours : rest).push({ ...u, rel, inSeries });
  }
  shown = [...yours, ...rest];
  if (!all.length) {
    list.innerHTML = `<div class="empty"><div class="seal-big" lang="ja" aria-hidden="true">新</div><h2>Sin novedades anunciadas</h2><p>Cuando las editoriales anuncien nuevas salidas aparecerán aquí. El catálogo se actualiza cada lunes.</p></div>`;
    return;
  }
  // La fecha solo en el primer cómic de cada día, como en un calendario de salidas
  let prev = '';
  const row = (u, i) => {
    const { wd, day, month } = dayParts(u.item.publishedDate);
    const sameDay = u.item.publishedDate === prev;
    prev = u.item.publishedDate;
    const why = u.rel === 'own' ? '<span class="row-state">Ya lo tienes</span>'
      : u.rel === 'wish' ? '<span class="row-state wished">Deseado</span>'
      : `<button class="row-add" data-i="${i}">Lo quiero</button>`;
    return `<div class="rel${u.inSeries || u.rel ? ' mine' : ''}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(u.item.title)}: ver ficha">
      <span class="rel-date${sameDay ? ' same' : ''}" aria-label="${esc(`${wd} ${day} ${month}`)}">${sameDay ? '' : `<b>${day}</b><span>${esc(month)}</span><span>${esc(wd)}</span>`}</span>
      ${coverHTML(u.item)}
      <span class="row-main"><b>${esc(u.item.title)}</b><span>${esc([u.item.price != null ? euro(u.item.price) : '', u.item.publisher === 'Panini' ? u.line : u.item.publisher].filter(Boolean).join(', '))}</span></span>
      ${why}
    </div>`;
  };
  const last = all.at(-1).item.publishedDate;
  const { day, month } = dayParts(last);
  list.innerHTML = `
    <p class="count">${plural(all.length, 'novedad anunciada', 'novedades anunciadas')} hasta el ${day} ${month}</p>
    ${yours.length ? `<h2 class="section-title">Para ti</h2><p class="muted small sub">Números de tus series y lo que tienes en deseados.</p>${yours.map((u, i) => row(u, i)).join('')}` : ''}
    ${rest.length ? `${(prev = '', '')}<h2 class="section-title">${yours.length ? 'Todo lo demás' : 'Todo lo que sale'}</h2>${rest.map((u, i) => row(u, yours.length + i)).join('')}` : ''}`;
}

export function setupUpcoming() {
  for (const id of ['#new-filters', '#new-pubs']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      if (id === '#new-pubs') pub = b.dataset.pub; else line = b.dataset.line;
      $$(`${id} .chip`).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      renderUpcoming();
    });
  }
  // Tocar una novedad abre su ficha (la tuya si ya la tienes o deseas)
  const open = (row) => { const u = shown[+row.dataset.i]; if (u) openPreview(u.item); };
  $('#new-list').addEventListener('keydown', (e) => { const r = e.target.closest('.rel'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(r); } });
  $('#new-list').addEventListener('click', async (e) => {
    const b = e.target.closest('.row-add');
    if (!b) { const r = e.target.closest('.rel'); if (r) open(r); return; }
    const u = shown[+b.dataset.i];
    if (!u) return;
    const d = await addWish(u.item);
    toast(`Añadido a deseados: ${d.title}`, 'Deshacer', () => removeComic(d.id));
  });
}
