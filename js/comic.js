// Ficha de un cómic: vista con toda su información y el botón de leído, y formulario de edición.

import { $, esc, euro, fmtDate, coverHTML, toast, openDialog, closeTopLayer, closeAllLayers, confirmSheet, parsePrice, parseIntOrNull, seriesKey, today } from './util.js';
import { state, byId, byIsbn, saveComic, removeComic, setRead, saveSeriesMeta, setSetting } from './store.js';
import { lookupCode, normalizeIsbn, parseTitle, normalizePublisher, guessType } from './lookup.js';
import { uid } from './db.js';
import { catalogSeriesFor } from './catalog.js';

const hooks = { openSeries: null, openFind: null };
export const setComicHooks = (h) => Object.assign(hooks, h);

// ---------- Vista de la ficha ----------
let shownId = null;

export function openDetail(c) {
  if (!c) return;
  shownId = c.id;
  renderDetail();
  const dlg = $('#sheet-detail');
  if (!dlg.open) openDialog(dlg);
  $('#sheet-detail .sheet-body').scrollTop = 0;
}

export function refreshDetail() {
  if ($('#sheet-detail').open) renderDetail();
}

function renderDetail() {
  const c = byId(shownId);
  if (!c) { if ($('#sheet-detail').open) closeTopLayer(); return; }
  const read = c.reading === 'leido';
  const facts = [
    ['Editorial', c.publisher],
    ['Precio', c.price != null ? euro(c.price) : ''],
    ['Publicado', fmtDate(c.publishedDate)],
    ['Lo compraste', fmtDate(c.purchaseDate)],
    ['Autores', c.authors],
    ['Páginas', c.pages],
    [c.issn ? 'ISSN' : 'ISBN', c.issn || c.isbn],
  ].filter(([, v]) => v);
  $('#detail-heading').textContent = c.series || 'Cómic';
  $('#detail-body').innerHTML = `
    <div class="detail-top">
      <div class="detail-cover">${coverHTML(c, { lazy: false })}</div>
      <div class="detail-head">
        <h3>${esc(c.title)}</h3>
        ${c.series ? `<button class="link" id="detail-series">${esc(c.series)}${c.number != null && !catalogSeriesFor(c.series)?.unnumbered ? `, nº ${esc(c.number)}` : ''}</button>` : ''}
        <button class="read-toggle${read ? ' is-read' : ''}" id="detail-read" aria-pressed="${read}">
          <span class="stamp" lang="ja" aria-hidden="true">済</span><span>${read ? `Leído${c.readAt ? ` el ${esc(fmtDate(c.readAt))}` : ''}` : 'Marcar como leído'}</span>
        </button>
      </div>
    </div>
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${c.notes ? `<p class="detail-notes">${esc(c.notes)}</p>` : ''}
    <div class="btn-row detail-actions">
      <button class="btn" id="detail-edit">Editar</button>
      <button class="btn danger" id="detail-delete">Eliminar</button>
    </div>`;
}

$('#detail-body').addEventListener('click', async (e) => {
  const c = byId(shownId);
  if (!c) return;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'detail-read') {
    const read = c.reading !== 'leido';
    await setRead(c, read);
    renderDetail();
    toast(read ? 'Marcado como leído' : 'Marcado como sin leer');
  } else if (t.id === 'detail-edit') {
    openEditor({ ...c });
  } else if (t.id === 'detail-series') {
    hooks.openSeries?.(seriesKey(c.series));
  } else if (t.id === 'detail-delete') {
    const ok = await confirmSheet({ title: 'Eliminar cómic', text: `¿Quitar «${c.title}» de tu biblioteca?`, ok: 'Eliminar', danger: true });
    if (!ok) return;
    await removeComic(c.id);
    closeAllLayers();
    toast('Eliminado', 'Deshacer', () => saveComic(c));
  }
});

// ---------- Formulario ----------
let draft = null;
let draftIsNew = false;
const form = $('#comic-form');
const F = form.elements;

export function newDraft(data = {}) {
  const now = Date.now();
  const d = {
    id: uid(), isbn: data.isbn || '', title: data.title || '', series: data.series || '', number: data.number ?? null,
    publisher: data.publisher || '', authors: data.authors || '', pages: data.pages || null,
    cover: data.cover || null, coverData: null, type: data.type || state.settings.lastType,
    status: 'coleccion', reading: 'pendiente', price: data.price ?? null,
    purchaseDate: today(), publishedDate: data.publishedDate || '',
    notes: '', createdAt: now, updatedAt: now, seriesTotal: data.seriesTotal || null,
  };
  if (data.issn) Object.assign(d, { issn: data.issn, barcode: data.barcode || null, addon: data.addon || null });
  return d;
}

export function openEditor(d, { isNew = false, notice = '', warn = false } = {}) {
  draft = { ...d };
  draftIsNew = isNew;
  $('#comic-heading').textContent = isNew ? 'Añadir cómic' : 'Editar cómic';
  $('#comic-save').textContent = isNew ? 'Añadir' : 'Guardar';
  const n = $('#comic-notice');
  n.hidden = !notice; n.textContent = notice; n.classList.toggle('warn', warn);
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
  $('#issn-field').hidden = !d.issn;
  $('#isbn-field').hidden = !!d.issn && !d.isbn;
  $('#issn-value').value = d.issn || '';
  $('#comic-retry').hidden = !(d.isbn && (!d.title || !d.cover));
  $('#comic-search').hidden = !(isNew && !d.title);
  refreshCover();
  renderDatalists();
  $('#sheet-comic .sheet-body').scrollTop = 0;
  openDialog($('#sheet-comic'));
}

function renderDatalists() {
  const uniq = (k) => [...new Set(state.comics.map((c) => c[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#series-options').innerHTML = uniq('series').map((n) => `<option value="${esc(n)}">`).join('');
  $('#publisher-options').innerHTML = uniq('publisher').map((n) => `<option value="${esc(n)}">`).join('');
}

function refreshCover() {
  $('#comic-cover').innerHTML = coverHTML({ ...draft, title: F.title.value || draft.title, series: F.series.value || draft.series, number: parseIntOrNull(F.number.value) });
  $('#cover-remove').hidden = !(draft.cover || draft.coverData);
}

form.addEventListener('input', (e) => { if (['title', 'series', 'number'].includes(e.target.name)) refreshCover(); });
F.title.addEventListener('change', () => {
  if (F.series.value || F.number.value) return;
  const p = parseTitle(F.title.value);
  if (p.series) { F.series.value = p.series; F.number.value = p.number ?? ''; refreshCover(); }
});
F.publisher.addEventListener('change', () => {
  F.publisher.value = normalizePublisher(F.publisher.value);
  const t = guessType(F.publisher.value, '', F.title.value);
  if (t && draftIsNew) draft.type = t;
});

$('#cover-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 520 / bmp.height);
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    draft.coverData = cv.toDataURL('image/jpeg', 0.8);
    refreshCover();
  } catch {
    toast('No se ha podido leer la foto');
  }
});
$('#cover-remove').addEventListener('click', () => { draft.cover = null; draft.coverData = null; refreshCover(); });

$('#comic-search').addEventListener('click', () => { closeAllLayers(); hooks.openFind?.('title'); });

$('#comic-retry').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const code = normalizeIsbn(F.isbn.value);
  if (!code) return;
  btn.disabled = true; btn.textContent = 'Buscando…';
  const res = await lookupCode(code);
  btn.disabled = false; btn.textContent = 'Buscar datos otra vez';
  if (res.status !== 'ok') { toast(res.status === 'offline' ? 'Sin conexión. Prueba más tarde.' : 'Sigue sin aparecer'); return; }
  const d = res.data;
  const keep = (k, v) => { if (v && !F[k].value) F[k].value = v; };
  keep('title', d.title); keep('series', d.series); keep('number', d.number ?? '');
  keep('publisher', d.publisher); keep('authors', d.authors); keep('pages', d.pages ?? '');
  if (d.price != null && !F.price.value) F.price.value = d.price.toFixed(2).replace('.', ',');
  if (d.cover && !draft.cover && !draft.coverData) draft.cover = d.cover;
  if (d.type) draft.type = d.type;
  refreshCover();
  toast('Datos completados');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = draft;
  d.title = F.title.value.trim();
  d.series = F.series.value.trim();
  d.number = parseIntOrNull(F.number.value);
  if (!d.title) d.title = d.series ? `${d.series}${d.number != null ? ` ${d.number}` : ''}` : (d.isbn ? `ISBN ${d.isbn}` : '');
  if (!d.title) { F.title.focus(); toast('Ponle al menos un título'); return; }
  d.price = parsePrice(F.price.value);
  d.purchaseDate = F.purchaseDate.value || null;
  d.publisher = normalizePublisher(F.publisher.value);
  d.authors = F.authors.value.trim();
  d.isbn = d.issn ? '' : (normalizeIsbn(F.isbn.value) || F.isbn.value.replace(/\D/g, ''));
  d.pages = parseIntOrNull(F.pages.value);
  d.notes = F.notes.value.trim();
  const dup = d.isbn && byIsbn(d.isbn);
  if (dup && dup.id !== d.id) { d.id = dup.id; d.createdAt = dup.createdAt; d.reading = dup.reading; }
  const wasNew = draftIsNew;
  await commitDraft(d);
  closeAllLayers();
  toast(wasNew ? `Añadido: ${d.title}` : 'Cambios guardados');
});

// Guarda una ficha nueva o editada con sus efectos (total de la serie, sustituir huecos antiguos)
export async function commitDraft(d) {
  if (d.series && d.number != null) {
    const legacy = state.comics.find((c) => c.id !== d.id && c.status === 'deseo' && seriesKey(c.series) === seriesKey(d.series) && c.number === d.number);
    if (legacy) await removeComic(legacy.id);
  }
  if (d.seriesTotal && d.series && !state.seriesMeta.get(seriesKey(d.series))?.total) {
    await saveSeriesMeta({ key: seriesKey(d.series), name: d.series, total: d.seriesTotal, finished: false });
  }
  delete d.seriesTotal;
  d.status = 'coleccion';
  await saveComic(d);
  if (d.type && d.type !== 'otro' && d.type !== state.settings.lastType) setSetting('lastType', d.type);
  return d;
}

