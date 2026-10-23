// Series: las que tienes, qué números, cuántos faltan y cuánto costaría completarlas.

import { $, esc, euro, plural, ranges, coverHTML, toast, openDialog, confirmSheet, parseIntOrNull } from '../util.js';
import { byId, removeComic, saveSeriesMeta, state } from '../store.js';
import { seriesList, findSeries, missingIssueData } from '../series.js';
import { catalogIssue } from '../catalog.js';
import { openDetail, newDraft, commitDraft } from '../comic.js';

const costText = (g) => {
  if (g.complete) return 'Completa';
  if (!g.missing.length) return g.knownTotal ? 'Completa' : 'Al día';
  if (g.missingCost == null) return '';
  return `${g.costEstimated ? '≈ ' : ''}${euro(g.missingCost)} para completarla`;
};

export function renderSeries() {
  const list = seriesList();
  const box = $('#series-list');
  $('#series-count').textContent = list.length ? plural(list.length, 'serie', 'series') : '';
  if (!list.length) {
    box.innerHTML = `<div class="empty"><h2>Aún no hay series</h2><p>Cuando añadas cómics con número (Absolute Batman 3, One Piece 12…) se agrupan aquí y verás cuáles te faltan.</p></div>`;
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
        <p class="meta">Tienes ${g.owned}${of}${g.missing.length ? ` · <b>te faltan ${g.missing.length}</b>` : ''}</p>
        <div class="bar" role="img" aria-label="${pct}% de la serie"><i style="width:${pct}%"></i></div>
        <p class="cost${g.complete ? ' done' : ''}">${esc(costText(g))}</p>
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
  const cells = [];
  for (let n = 1; n <= g.max; n++) {
    const c = g.byNum.get(n);
    if (c) {
      cells.push(`<button class="vol own${c.reading === 'leido' ? ' read' : ''}" data-id="${esc(c.id)}" aria-label="Nº ${n}, lo tienes${c.reading === 'leido' ? ', leído' : ''}">${coverHTML(c)}<span class="vol-n">${n}</span>${c.reading === 'leido' ? '<span class="mark-read"><svg><use href="#i-check"/></svg></span>' : ''}</button>`);
    } else {
      const it = g.cat ? catalogIssue(g.cat, n) : null;
      cells.push(`<button class="vol miss" data-n="${n}" aria-label="Nº ${n}, te falta">${coverHTML(it || { series: g.name, number: n })}<span class="vol-n">${n}</span>${it?.price != null ? `<span class="vol-price">${euro(it.price)}</span>` : ''}</button>`);
    }
  }
  const meta = state.seriesMeta.get(g.key) || {};
  $('#series-body').innerHTML = `
    <div class="series-stats">
      <div><b>${g.owned}${g.knownTotal || g.missing.length ? `/${g.max}` : ''}</b><span>tienes</span></div>
      <div><b>${g.read}</b><span>leídos</span></div>
      <div><b>${g.missing.length}</b><span>te faltan</span></div>
      <div><b>${g.missingCost != null && g.missing.length ? `${g.costEstimated ? '≈' : ''}${euro(g.missingCost)}` : '—'}</b><span>completarla</span></div>
    </div>
    ${g.missing.length ? `<p class="muted small">Te faltan los números ${ranges(g.missing)}.${g.costEstimated ? ' El precio es aproximado: donde no conozco el precio uso la media de lo que has pagado.' : ''} Toca uno que tengas para añadirlo.</p>` : ''}
    ${!g.knownTotal && !g.cat ? '<p class="muted small">No sé cuántos números tiene esta serie: indícalo abajo para ver también los que faltan al final.</p>' : ''}
    <div class="vols">${cells.join('')}</div>
    <p class="muted small">Has gastado ${euro(g.spent)} en esta serie${g.publisher ? ` · ${esc(g.publisher)}` : ''}.</p>
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
  const own = e.target.closest('.vol.own');
  if (own) { openDetail(byId(own.dataset.id)); return; }
  const miss = e.target.closest('.vol.miss');
  if (miss) {
    const n = +miss.dataset.n;
    const ok = await confirmSheet({ title: `${g.name} ${n}`, text: '¿Lo tienes? Se añadirá a tu biblioteca.', ok: 'Lo tengo, añadir' });
    if (!ok) return;
    const d = await commitDraft(newDraft(missingIssueData(g, n)));
    toast(`Añadido: ${d.title}`, 'Deshacer', () => removeComic(d.id));
    return;
  }
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
