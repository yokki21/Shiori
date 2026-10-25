// Utilidades comunes de la interfaz.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(?:[a-z0-9]\.){2,}[a-z0-9]?\.?/g, (m) => m.replace(/\./g, ''));   // siglas juntas: D.I.O.S.E.S. → dioses
export const seriesKey = (name) => norm(name).replace(/[^a-z0-9]+/g, ' ').trim();

const fmtEuro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const euro = (n) => fmtEuro.format(n || 0);
export const euroShort = (n) => euro(n).replace(/,00\s/, ' ');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return String(iso);
  return m[3] ? `${+m[3]} ${MONTHS_LONG[+m[2] - 1]} ${m[1]}` : `${MONTHS_LONG[+m[2] - 1]} ${m[1]}`;
}

export function hue(s) {
  let h = 0;
  for (const ch of norm(s)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function parsePrice(v) {
  const s = String(v ?? '').replace(/[^\d,.]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  return Number.isFinite(n) ? n : null;
}

export function parseIntOrNull(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function ranges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(', ');
}

// Portada (o una portada de color con el nombre si no hay imagen)
// Si falla una portada: las de Planeta en tamaño medio (m_libros) no existen para muchos tomos; se prueba la original
export const IMG_ERR = `if(/\\/m_libros\\//.test(this.src)&&!this.dataset.r){this.dataset.r=1;this.src=this.src.replace('/m_libros/','/original/')}else this.remove()`;

export function coverHTML(c, { lazy = true } = {}) {
  const label = c.series || c.title || 'Sin título';
  const img = c.coverData || c.cover;
  const n = Number.isFinite(c.number) ? c.number : null;
  return `<div class="cover"><div class="cover-ph" style="--h:${hue(label)}"><span class="t">${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ''}</div>${img ? `<img src="${esc(img)}" alt=""${lazy ? ' loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer" onerror="${IMG_ERR}">` : ''}</div>`;
}

// Vibración distinta según lo que pasa al escanear (para escanear una pila sin mirar)
export function haptic(kind) {
  const p = { added: 40, existing: [30, 60, 30], notfound: [120, 50, 120] }[kind];
  try { navigator.vibrate?.(p); } catch { /* sin vibración */ }
}

// ---------- Aviso ----------
let toastTimer;
export function toast(text, action, fn) {
  const t = $('#toast');
  $('#toast-text').textContent = text;
  const b = $('#toast-action');
  b.hidden = !action;
  if (action) b.textContent = action;
  b.onclick = action ? () => { t.hidden = true; fn(); } : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3000);
}

// ---------- Capas: hojas y escáner se cierran con el botón atrás del móvil ----------
const layers = [];
let ignorePops = 0;
let navWaiters = [];
let navTimer;
function navSettled() {
  ignorePops = 0;
  clearTimeout(navTimer);
  navWaiters.splice(0).forEach((f) => f());
}
const afterNav = () => (ignorePops ? new Promise((r) => navWaiters.push(r)) : Promise.resolve());
function goBack(n) {
  ignorePops++;
  clearTimeout(navTimer);
  navTimer = setTimeout(navSettled, 1000);
  history.go(-n);
}
export function pushLayer(close) {
  const item = { close, pushed: false, cancelled: false };
  layers.push(item);
  afterNav().then(() => {
    if (item.cancelled) return;
    history.pushState({ shiori: true }, '');
    item.pushed = true;
  });
}
window.addEventListener('popstate', () => {
  if (ignorePops > 0) { if (--ignorePops === 0) navSettled(); return; }
  const item = layers.pop();
  if (item) { item.cancelled = true; item.close(); }
});
export function closeTopLayer() {
  const item = layers.pop();
  if (!item) return;
  item.cancelled = true;
  item.close();
  if (item.pushed) goBack(1);
}
export function closeAllLayers() {
  const items = layers.splice(0).reverse();
  let n = 0;
  for (const it of items) { it.cancelled = true; it.close(); if (it.pushed) n++; }
  if (n) goBack(n);
}
export function openDialog(dlg) {
  dlg.showModal();
  pushLayer(() => dlg.open && dlg.close());
}
export function setupDialogs() {
  $$('dialog.sheet').forEach((dlg) => {
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeTopLayer(); });
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === dlg) closeTopLayer();
    });
  });
}

// ---------- Confirmación propia (en vez de confirm() del navegador) ----------
// Hoja de confirmación. Con `alt`, ofrece una segunda acción y devuelve 'alt' si se elige.
export function confirmSheet({ title, text, ok = 'Aceptar', danger = false, alt = '' }) {
  return new Promise((resolve) => {
    const dlg = $('#sheet-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const okBtn = $('#confirm-ok');
    okBtn.textContent = ok;
    okBtn.className = `btn wide ${danger ? 'danger-solid' : 'primary'}`;
    const altBtn = $('#confirm-alt');
    altBtn.hidden = !alt;
    altBtn.textContent = alt;
    let answered = false;
    const finish = (v) => { if (answered) return; answered = true; resolve(v); };
    okBtn.onclick = () => { finish(true); closeTopLayer(); };
    altBtn.onclick = () => { finish('alt'); closeTopLayer(); };
    dlg.addEventListener('close', () => finish(false), { once: true });
    openDialog(dlg);
  });
}
