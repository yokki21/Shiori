// Escanear y añadir: cámara, código escrito, foto y búsqueda por título.

import { $, esc, euro, seriesKey, coverHTML, toast, haptic, openDialog, closeAllLayers, pushLayer, closeTopLayer } from './util.js';
import { state, byIsbn, byIssue, saveComic, removeComic } from './store.js';
import { Scanner, scanFile } from './scanner.js';
import { lookupCode, searchTitle, normalizeIsbn, isIsbn, isIssnEan, issnFromEan, eanFromIssn } from './lookup.js';
import { loadCatalog, catalogSeries, catalogIssue, catalogByIsbn, catalogByIssue, catalogAddons, catalogNextIssue, searchCatalog } from './catalog.js';
import { openDetail, openEditor, newDraft, commitDraft } from './comic.js';

const scanEl = $('#scanner');
let scanner = null;
const status = (t) => { $('#scan-status').textContent = t; };
const scannerOpen = () => !scanEl.hidden;

// ---------- Cámara ----------
export async function openScanner() {
  scanEl.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#scan-log').innerHTML = '';
  $('#scan-torch').hidden = true;
  $('#scan-torch').classList.remove('on');
  status('Apunta al código de barras de la contraportada');
  pushLayer(stopScanner);
  if (!window.isSecureContext) { status('La cámara solo funciona desde https. Usa «Escribir código».'); return; }
  scanner = new Scanner($('#scan-video'), {
    onCode: onScanned,
    onError: (e) => console.warn('Error del lector', e),
  });
  try {
    await scanner.start();
    if (scanEl.hidden) { scanner.stop(); return; }
    $('#scan-torch').hidden = !scanner.torchAvailable;
  } catch (err) {
    scanner = null;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    status(denied
      ? 'Shiori no tiene permiso para usar la cámara. Actívalo en los ajustes del navegador o escribe el código.'
      : 'No se ha podido abrir la cámara. Escribe el código o usa una foto.');
  }
}

function stopScanner() {
  scanner?.stop();
  scanner = null;
  scanEl.hidden = true;
  document.body.style.overflow = '';
}

$('#scan-close').addEventListener('click', closeTopLayer);
$('#scan-torch').addEventListener('click', async (e) => {
  const on = !e.currentTarget.classList.contains('on');
  if (await scanner?.setTorch(on)) e.currentTarget.classList.toggle('on', on);
});
$('#scan-type').addEventListener('click', () => openAdd({ focus: true }));
$('#scan-photo').addEventListener('change', (e) => fromPhoto(e.target));

let lastSeen = { key: null, at: 0 };
async function onScanned(code, addon) {
  const key = `${code}|${addon || ''}`;
  const repeat = lastSeen.key === key && Date.now() - lastSeen.at < 4000;
  lastSeen = { key, at: Date.now() };
  if (repeat) return;
  scanner?.pause();
  const f = $('.scan-frame');
  f.classList.add('hit');
  setTimeout(() => f.classList.remove('hit'), 500);
  await handleCode(code, { addon });
  if (scannerOpen()) scanner?.pause(1300);
}

async function fromPhoto(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  scanner?.pause();
  if (scannerOpen()) status('Leyendo la foto…'); else toast('Leyendo la foto…');
  const hit = await scanFile(file).catch(() => null);
  if (!hit) {
    const msg = 'No encuentro ningún código en la foto. Prueba con otra más cerca, recta y sin reflejos.';
    if (scannerOpen()) { status(msg); scanner?.resume(); } else toast(msg);
    return;
  }
  await handleCode(hit.code, { addon: hit.addon });
}

// ---------- Resultado de una lectura ----------
function logLine(c, text, undo) {
  const log = $('#scan-log');
  const el = document.createElement('div');
  el.className = 'scan-item';
  const img = c.coverData || c.cover;
  el.innerHTML = `${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : '<i class="ph"></i>'}<span><b>${esc(c.title)}</b><br>${esc(text)}</span><button data-a="see">Ver</button>${undo ? '<button data-a="undo">Deshacer</button>' : ''}`;
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'undo') { await removeComic(c.id); el.remove(); }
    if (a === 'see') { closeAllLayers(); openDetail(c); }
  });
  log.prepend(el);
  while (log.children.length > 3) log.lastChild.remove();
}

async function announceAdded(d) {
  haptic('added');
  if (scannerOpen()) { logLine(d, 'Añadido a tu biblioteca', true); status('Listo. Escanea el siguiente o cierra.'); return; }
  closeAllLayers();
  toast(`Añadido: ${d.title}`, 'Deshacer', () => removeComic(d.id));
}

function announceExisting(c) {
  haptic('existing');
  if (scannerOpen()) { logLine(c, 'Ya lo tienes'); status('Ese ya está en tu biblioteca.'); return; }
  closeAllLayers();
  openDetail(c);
  toast('Ya lo tienes en tu biblioteca');
}

// Añade directamente (o abre la ficha para revisar si el usuario lo prefiere)
async function add(data, notice) {
  const d = newDraft(data);
  if (!state.settings.autoAdd) { closeAllLayers(); openEditor(d, { isNew: true, notice: notice || 'Revisa los datos y pulsa «Añadir».' }); return; }
  await commitDraft(d);
  await announceAdded(d);
}

export async function handleCode(code, { addon = null } = {}) {
  await loadCatalog();
  if (isIssnEan(code)) return handleIssn(code, addon);
  const existing = byIsbn(code);
  if (existing) return announceExisting(existing);

  const fromCat = catalogByIsbn(code);
  if (fromCat) return add(fromCat);

  if (scannerOpen()) status(`Buscando ${code}…`);
  const res = await lookupCode(code);
  if (res.status === 'ok' && res.data.title) return add(res.data);

  haptic('notfound');
  closeAllLayers();
  const notices = {
    notfound: isIsbn(code)
      ? 'No he encontrado este cómic en las bases de datos. Rellena lo básico (o pulsa «Buscar por título») y quedará guardado.'
      : `Este código (${code}) no es un ISBN. Rellena lo básico y quedará guardado.`,
    offline: 'Sin conexión. Guárdalo con el ISBN y pulsa «Buscar datos otra vez» cuando tengas internet.',
  };
  openEditor(newDraft({ isbn: isIsbn(code) ? code : '' }), { isNew: true, notice: notices[res.status] || notices.notfound, warn: true });
}

// ---------- Revistas y grapas con ISSN (códigos 977…) ----------
// El ISSN identifica la colección; el número va en el código pequeño (suplemento).
function issueFromAddon(addon, nums) {
  if (!addon) return null;
  let n = parseInt(addon, 10);
  if (addon.length === 5 && n >= 1000) n = parseInt(addon.slice(0, 3), 10); // 3 cifras de número + portada + impresión
  if (addon.length === 2 && nums.length) { // solo las dos últimas cifras
    const max = Math.max(...nums);
    if (max >= 100) { n += Math.floor(max / 100) * 100; if (n < max - 50) n += 100; }
  }
  return n > 0 ? n : null;
}

// Cómic que ya tienes con la misma serie y número (o el mismo ISBN)
function ownedLike(it) {
  if (it.isbn && byIsbn(it.isbn)) return byIsbn(it.isbn);
  const k = seriesKey(it.series || '');
  return state.comics.find((c) => c.status !== 'deseo' && c.number === it.number && k && seriesKey(c.series || '') === k) || null;
}

async function handleIssn(code, addon) {
  const issn = issnFromEan(code);
  const mine = state.comics.filter((c) => c.issn === issn && c.status !== 'deseo');
  const n = issueFromAddon(addon, [...catalogAddons(issn), ...mine.map((c) => c.number).filter((x) => x != null)]);

  // 1. El catálogo sabe qué cómic es ese número de la colección
  const it = n != null ? catalogByIssue(issn, n) : null;
  if (it) {
    const have = ownedLike(it);
    if (have) return announceExisting(have);
    return add({ ...it, issn, barcode: code, addon });
  }
  if (n != null) {
    const existing = byIssue(issn, n);
    if (existing) return announceExisting(existing);
    // Un número nuevo que aún no está en el catálogo: se deduce de los anteriores
    const next = catalogNextIssue(issn, n);
    if (next) {
      const have = ownedLike(next);
      return have ? announceExisting(have) : add({ ...next, barcode: code, addon });
    }
  }
  // 2. Colección conocida pero número sin leer (o que aún no está en el catálogo): se elige por portada
  const cat = catalogSeries(issn);
  if (cat) return openIssuePicker(cat, code);
  // 3. Colección que no está en el catálogo: se aprende de los números que ya tienes
  const ref = mine.find((c) => c.series);
  if (ref && n != null) {
    return add({ title: `${ref.series} ${n}`, series: ref.series, number: n, publisher: ref.publisher, type: ref.type, price: ref.price, issn, barcode: code, addon });
  }
  haptic('notfound');
  closeAllLayers();
  const d = newDraft({ series: ref?.series || '', number: n, publisher: ref?.publisher, type: ref?.type, price: ref?.price, issn, barcode: code, addon });
  openEditor(d, {
    isNew: true, warn: true,
    notice: ref
      ? `Es de tu serie ${ref.series}, pero no he podido leer el número. Escríbelo y guarda.`
      : 'Esta grapa lleva ISSN, que identifica la colección y no cada número. Escribe el nombre de la serie una vez: los próximos números se añadirán solos.',
  });
}

let picking = null;
function openIssuePicker(cat, code) {
  closeAllLayers();
  picking = { cat, code };
  $('#pick-heading').textContent = cat.name;
  // En las series largas, primero los más recientes (lo más probable al escanear una grapa nueva)
  const nums = Object.keys(cat.issues).map(Number).sort((a, b) => a - b);
  if (nums.length > 24) nums.reverse();
  $('#pick-body').innerHTML = `
    <p class="muted">No he podido leer el número. Toca el que tienes.</p>
    <div class="pick-grid">${nums.map((n) => {
      const it = catalogIssue(cat, n);
      const have = ownedLike(it);
      return `<button class="pick${have ? ' owned' : ''}" data-n="${n}">${coverHTML(it, { lazy: true })}<span class="cap">Nº ${n}</span>${have ? '<span class="have">Lo tienes</span>' : ''}</button>`;
    }).join('')}</div>`;
  openDialog($('#sheet-pick'));
}
$('#pick-body').addEventListener('click', async (e) => {
  const b = e.target.closest('.pick');
  if (!b || !picking) return;
  const { cat, code } = picking;
  const it = catalogIssue(cat, +b.dataset.n);
  const have = ownedLike(it);
  if (have) { closeAllLayers(); openDetail(have); return; }
  await add({ ...it, barcode: code || it.barcode });
});

// ---------- Añadir: un buscador para título, ISBN o ISSN ----------
export function openAdd({ focus = false, mode } = {}) {
  const input = $('#add-input');
  input.value = '';
  $('#add-results').innerHTML = '';
  $('#add-hint').textContent = 'Escribe el título (por ejemplo «Chainsaw Man 5»), el ISBN de 13 cifras o el ISSN de una grapa.';
  openDialog($('#sheet-add'));
  if (focus || mode) setTimeout(() => input.focus(), 80);
}

let results = [];
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#add-input').value.trim();
  if (!q) return;
  const digits = q.replace(/[^0-9Xx]/g, '');
  const looksLikeCode = /^[\d\s-]+[Xx]?$/.test(q) && [8, 10, 13].includes(digits.length);
  if (looksLikeCode) {
    const code = normalizeIsbn(q) || eanFromIssn(q) || (/^\d{13}$/.test(digits) ? digits : null);
    if (!code) { $('#add-hint').textContent = 'Ese código no es válido. Revisa los dígitos.'; return; }
    await handleCode(code);
    return;
  }
  const box = $('#add-results');
  box.innerHTML = '<div class="spinner"></div>';
  await loadCatalog();
  const local = searchCatalog(q);
  let remote = [];
  try { remote = (await searchTitle(q)).results; } catch { /* sin red: solo el catálogo */ }
  const seen = new Set(local.map((r) => r.isbn).filter(Boolean));
  results = [...local, ...remote.filter((r) => !r.isbn || !seen.has(r.isbn))].slice(0, 30);
  box.innerHTML = (results.length
    ? results.map((r, i) => `<button class="row" data-r="${i}">${coverHTML(r)}<span class="row-main"><b>${esc(r.title)}</b><span>${esc([r.publisher, r.price != null ? euro(r.price) : '', r.publishedDate?.slice(0, 4)].filter(Boolean).join(' · '))}</span></span><span class="row-add">Añadir</span></button>`).join('')
    : '<p class="muted">Sin resultados.</p>') + '<button class="btn wide" id="add-manual">No está: añadir a mano</button>';
});

$('#add-results').addEventListener('click', async (e) => {
  if (e.target.id === 'add-manual') {
    const q = $('#add-input').value.trim();
    closeAllLayers();
    openEditor(newDraft({ title: q }), { isNew: true });
    return;
  }
  const b = e.target.closest('[data-r]');
  if (!b) return;
  let r = results[+b.dataset.r];
  if (r.isbn && byIsbn(r.isbn)) return announceExisting(byIsbn(r.isbn));
  if (r.fromCatalog && r.series && r.number != null && ownedLike(r)) return announceExisting(ownedLike(r));
  if (r.needsLookup && r.isbn) {
    b.classList.add('busy');
    const res = await lookupCode(r.isbn);
    if (res.status === 'ok') {
      const ed = res.data;
      const cjk = /[぀-ヿ一-鿿]/.test(r.title);
      const keep = !cjk && r.series;
      r = { ...r, ...ed, cover: ed.cover || null, title: keep ? r.title : ed.title || r.title, series: keep ? r.series : ed.series || r.series, number: keep ? r.number : ed.number ?? r.number };
    } else r = { ...r, cover: null };
  }
  await add(r);
});

$('#add-photo').addEventListener('change', (e) => fromPhoto(e.target));
