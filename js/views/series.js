// Series: las que tienes, qué números, cuántos faltan y cuánto costaría completarlas.

import { $, esc, euro, plural, ranges, seriesKey, coverHTML, toast, openDialog, parseIntOrNull } from '../util.js';
import { byId, saveSeriesMeta, setRead, state, wanted, wishToOwned, saveComic, removeComic } from '../store.js';
import { seriesList, findSeries, missingIssueData } from '../series.js';
import { catalogIssue } from '../catalog.js';
import { openDetail, openPreview, newDraft, commitDraft } from '../comic.js';

const costText = (g) => {
  if (g.complete) return 'Completa';
  if (!g.missing.length) return g.knownTotal ? 'Completa' : 'Al día';
  if (g.missingCost == null) return '';
  return `${g.costEstimated ? '≈ ' : ''}${euro(g.missingCost)} para completarla`;
};

export function renderSeries(q = '') {
  const all = seriesList();
  const key = seriesKey(q);
  const list = key ? all.filter((g) => g.key.includes(key)) : all;
  const box = $('#series-list');
  $('#series-count').textContent = all.length ? (key ? `${list.length} de ${plural(all.length, 'serie', 'series')}` : plural(all.length, 'serie', 'series')) : '';
  if (all.length && !list.length) { box.innerHTML = '<div class="empty"><h2>Nada por aquí</h2><p>Ninguna serie coincide con la búsqueda.</p></div>'; return; }
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="seal-big" lang="ja" aria-hidden="true">巻</div><h2>Aún no hay series</h2><p>Cuando añadas cómics con número (Absolute Batman 3, One Piece 12…) se agrupan aquí y verás cuáles te faltan.</p></div>`;
    return;
  }
  box.innerHTML = list.map((g) => {
    const pct = g.max ? Math.round((g.owned / g.max) * 100) : 100;
    const of = g.knownTotal || g.missing.length ? ` de ${g.max}` : '';
    return `
    <button class="series-card" data-key="${esc(g.key)}">
      <div class="series-thumb">${coverHTML(g.cover)}</div>
      <div class="series-info">
        <h3>${esc(g.name)}</h3>
        <p class="meta">Tienes ${g.owned}${of}${g.missing.length ? `, <b>te faltan ${g.missing.length}</b>` : ''}</p>
        <div class="obi${g.complete || !g.missing.length ? ' done' : ''}" role="img" aria-label="${pct}% de la serie. ${esc(costText(g))}">
          <span>${esc(costText(g)) || `${pct}%`}</span><i style="width:${pct}%"><span>${esc(costText(g)) || `${pct}%`}</span></i>
        </div>
      </div>
    </button>`;
  }).join('');
}

// ---------- Hoja de una serie ----------
let openKey = null;

export function openSeries(key) {
  openKey = key;
  renderSeriesSheet();
  const dlg = $('#sheet-series');
  if (!dlg.open) openDialog(dlg);
}

export function renderSeriesSheet() {
  if (!$('#sheet-series').open && openKey == null) return;
  const g = findSeries(openKey);
  if (!g) { $('#series-body').innerHTML = '<p class="muted">Esta serie ya no tiene cómics.</p>'; return; }
  $('#series-heading').textContent = g.name;
  // Colecciones sin número impreso (Must-Have, Essentials): cada tomo se nombra por su título
  const loose = !!g.cat?.unnumbered;
  const label = (n, c) => {
    if (!loose) return n;
    let t = c?.title || (g.cat ? catalogIssue(g.cat, n)?.title : '') || '';
    if (t.toLowerCase().startsWith(g.name.toLowerCase())) t = t.slice(g.name.length).replace(/^[.:]?\s*/, '');
    return esc(t || n);
  };
  const wishNums = new Map(wanted().filter((c) => seriesKey(c.series || '') === g.key).map((c) => [c.number, c]));
  const cells = [];
  for (let n = 1; n <= g.max; n++) {
    const c = g.byNum.get(n);
    if (c) {
      const read = c.reading === 'leido';
      const name = loose ? label(n, c) : `Nº ${n}`;
      // El sello 済 de la esquina marca o desmarca el tomo como leído sin abrir su ficha
      cells.push(`<div class="vol-cell"><button class="vol own${read ? ' read' : ''}" data-id="${esc(c.id)}" aria-label="${name}, lo tienes${read ? ', leído' : ''}">${coverHTML(c)}<span class="vol-n${loose ? ' t' : ''}">${label(n, c)}</span></button><button class="vol-read${read ? ' on' : ''}" data-read="${esc(c.id)}" aria-pressed="${read}" aria-label="${name}: ${read ? 'quitar de leídos' : 'marcar como leído'}" title="${read ? 'Leído' : 'Marcar como leído'}" lang="ja">済</button></div>`);
    } else {
      const it = g.cat ? catalogIssue(g.cat, n) : null;
      const name = loose ? label(n) : `Nº ${n}`;
      // En los que faltan: ✓ «lo tengo» lo añade a la biblioteca y 済 lo añade ya leído, sin pasar por la ficha
      cells.push(`<div class="vol-cell"><button class="vol miss" data-n="${n}" aria-label="${name}, te falta">${coverHTML(it || { series: g.name, number: n })}<span class="vol-n${loose ? ' t' : ''}">${label(n)}</span>${it?.price != null ? `<span class="vol-price">${euro(it.price)}</span>` : ''}${wishNums.has(n) ? '<span class="vol-wish">Deseado</span>' : ''}</button><button class="vol-have" data-have="${n}" aria-label="${name}: lo tengo, añadir a la biblioteca" title="Lo tengo"><svg aria-hidden="true"><use href="#i-check"/></svg></button><button class="vol-read" data-readnew="${n}" aria-pressed="false" aria-label="${name}: lo tengo y ya lo he leído" title="Lo tengo y está leído" lang="ja">済</button></div>`);
    }
  }
  const meta = state.seriesMeta.get(g.key) || {};
  $('#series-body').innerHTML = `
    <div class="series-stats">
      <div><b>${g.owned}${g.knownTotal || g.missing.length ? `/${g.max}` : ''}</b><span>tienes</span></div>
      <div><b>${g.read}</b><span>leídos</span></div>
      <div><b>${g.missing.length}</b><span>te faltan</span></div>
      <div><b>${g.missingCost != null && g.missing.length ? `${g.costEstimated ? '≈' : ''}${g.missingCost >= 1000 ? `${Math.round(g.missingCost).toLocaleString('es-ES')} €` : euro(g.missingCost)}` : '—'}</b><span>completarla</span></div>
    </div>
    ${g.missing.length ? `<p class="muted small">${loose ? `Te faltan ${plural(g.missing.length, 'tomo', 'tomos')} de la colección.` : `Te faltan los números ${ranges(g.missing)}.`}${g.costEstimated ? ' El precio es aproximado: donde no conozco el precio uso la media de lo que has pagado.' : ''} Marca ✓ los que tengas o 済 si además los has leído; toca la portada para ver su ficha o apuntarlo en deseados.</p>` : ''}
    ${!g.knownTotal && !g.cat ? '<p class="muted small">No sé cuántos números tiene esta serie: indícalo abajo para ver también los que faltan al final.</p>' : ''}
    <div class="vols">${cells.join('')}</div>
    <p class="muted small">Has gastado ${euro(g.spent)} en esta serie${g.publisher ? ` de ${esc(g.publisher)}` : ''}.</p>
    <details class="series-edit">
      <summary>Datos de la serie</summary>
      <div class="series-form">
        <label class="field num"><span>Números en total</span><input id="series-total" inputmode="numeric" value="${esc(meta.total ?? '')}" placeholder="${g.cat ? esc(Object.keys(g.cat.issues).length) : '?'}"></label>
        <label class="check"><input type="checkbox" id="series-finished" ${meta.finished ? 'checked' : ''}>Serie terminada</label>
        <button class="btn primary small" id="series-save">Guardar</button>
      </div>
    </details>`;
}

$('#series-body').addEventListener('click', async (e) => {
  const g = findSeries(openKey);
  if (!g) return;
  // Añadir un número que falta directamente (y leído, si es el sello 済)
  const add = e.target.closest('[data-have], [data-readnew]');
  if (add) {
    const n = +(add.dataset.have || add.dataset.readnew);
    const read = add.dataset.readnew != null;
    const w = wanted().find((c) => seriesKey(c.series || '') === g.key && c.number === n);
    let d;
    if (w) { await wishToOwned(w); d = byId(w.id); } else d = await commitDraft(newDraft(missingIssueData(g, n)));
    if (read) await setRead(byId(d.id), true);
    toast(`${read ? 'Añadido y leído' : 'Añadido'}: ${d.title}`, 'Deshacer', () => (w ? saveComic(w) : removeComic(d.id)));
    return;
  }
  const rb = e.target.closest('.vol-read');
  if (rb) {
    const c = byId(rb.dataset.read);
    if (!c) return;
    const read = c.reading !== 'leido';
    await setRead(c, read);
    toast(read ? `Leído: ${c.title}` : `Sin leer: ${c.title}`, 'Deshacer', () => setRead({ ...byId(c.id) }, !read));
    return;
  }
  const own = e.target.closest('.vol.own');
  if (own) { openDetail(byId(own.dataset.id)); return; }
  const miss = e.target.closest('.vol.miss');
  if (miss) { openPreview(missingIssueData(g, +miss.dataset.n)); return; }   // su ficha: verla, desearla o añadirla
  if (e.target.id === 'series-save') {
    await saveSeriesMeta({ key: g.key, name: g.name, total: parseIntOrNull($('#series-total').value), finished: $('#series-finished').checked });
    toast('Serie actualizada');
  }
});

export function setupSeries() {
  $('#series-list').addEventListener('click', (e) => {
    const r = e.target.closest('.series-card');
    if (r) openSeries(r.dataset.key);
  });
  $('#sheet-series').addEventListener('close', () => { openKey = null; });
}
