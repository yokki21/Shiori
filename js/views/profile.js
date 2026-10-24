// Perfil: estadísticas de la colección, cuenta y ajustes.

import { $, esc, euro, euroShort, plural, MONTHS, MONTHS_LONG, toast, openDialog, closeTopLayer, confirmSheet } from '../util.js';
import { state, owned, wanted, setSetting, setProfile, wipeLocal, backupFile, parseBackup, importBackup } from '../store.js';
import { seriesList } from '../series.js';
import { syncAvailable, signIn, signUp, signInGoogle, resetPassword, signOutUser, authMessage, USERNAME_RE, claimUsername, usernameFree, savePhoto } from '../sync.js';
import { setGoogleKey, testGoogle } from '../lookup.js';
import { db } from '../db.js';

let monthSel = 11;

function stats() {
  const own = owned();
  const priced = own.filter((c) => c.price != null);
  const spent = priced.reduce((s, c) => s + c.price, 0);
  const read = own.filter((c) => c.reading === 'leido').length;
  const groups = seriesList();
  const complete = groups.filter((g) => g.complete).length;
  const toComplete = groups.reduce((s, g) => s + (g.missingCost || 0), 0);
  const approx = groups.some((g) => g.costEstimated && g.missing.length);
  const year = new Date().getFullYear();
  const dateOf = (c) => c.purchaseDate || (c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : null);
  const thisYear = own.filter((c) => dateOf(c)?.startsWith(String(year)));
  const priciest = priced.reduce((m, c) => (!m || c.price > m.price ? c : m), null);

  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), sum: 0, n: 0 });
  }
  for (const c of own) {
    const ds = dateOf(c);
    if (!ds) continue;
    const [y, m] = ds.split('-').map(Number);
    const slot = months.find((x) => x.y === y && x.m === m - 1);
    if (slot) { slot.n++; slot.sum += c.price || 0; }
  }
  const pubs = new Map();
  for (const c of own) {
    const k = c.publisher || 'Sin editorial';
    const p = pubs.get(k) || { n: 0, sum: 0 };
    p.n++; p.sum += c.price || 0; pubs.set(k, p);
  }
  const ratedList = own.filter((c) => c.rating);
  return {
    rated: ratedList.length, avgRating: ratedList.length ? ratedList.reduce((t, c) => t + c.rating, 0) / ratedList.length : 0,
    own, priced, spent, read, groups, complete, toComplete, approx, months,
    pubs: [...pubs].sort((a, b) => b[1].n - a[1].n),
    yearSpent: thisYear.reduce((s, c) => s + (c.price || 0), 0), yearN: thisYear.length, year, priciest,
  };
}

// Foto de perfil, o la inicial del nombre como sello
export function avatarHTML(big = false) {
  const p = state.profile;
  const u = state.user;
  const initial = (p.username || u?.email || 'S')[0].toUpperCase();
  return p.photo && u
    ? `<div class="avatar photo${big ? ' big' : ''}" aria-hidden="true"><img src="${esc(p.photo)}" alt=""></div>`
    : `<div class="avatar${big ? ' big' : ''}" aria-hidden="true">${esc(initial)}</div>`;
}

export function renderProfile() {
  const s = stats();
  const u = state.user;
  const p = state.profile;
  const who = u ? (p.username ? `@${p.username}` : (u.displayName || u.email)) : 'Tu colección';
  const sub = u
    ? (p.username ? esc(state.syncStatus || 'Guardado en tu cuenta') : 'Elige tu nombre de usuario en «Cuenta»')
    : (syncAvailable ? 'Sin cuenta: tus cómics solo están en este dispositivo' : 'Tus cómics están guardados en este dispositivo');
  $('#profile-head').innerHTML = `
    ${avatarHTML()}
    <div class="who">
      <h2>${esc(who)}</h2>
      <p class="muted small">${sub}</p>
    </div>
    ${syncAvailable ? `<button class="btn small" id="open-account">${u ? 'Cuenta' : 'Crear cuenta'}</button>` : ''}`;

  const box = $('#profile-stats');
  if (!s.own.length) {
    box.innerHTML = `<div class="empty"><div class="seal-big" lang="ja" aria-hidden="true">記</div><h2>Sin datos todavía</h2><p>Cuando escanees tus cómics verás aquí cuánto llevas invertido, cuánto has leído y lo que te falta.</p></div>`;
    return;
  }
  const maxSum = Math.max(...s.months.map((x) => x.sum), 0.01);
  const sel = s.months[monthSel];
  const top = s.pubs.slice(0, 6);
  if (s.pubs.length > 6) {
    const rest = s.pubs.slice(6).reduce((a, [, p]) => ({ n: a.n + p.n, sum: a.sum + p.sum }), { n: 0, sum: 0 });
    top.push([`Otras (${s.pubs.length - 6})`, rest]);
  }
  const maxPub = Math.max(...top.map(([, p]) => p.n));
  const pctRead = Math.round((s.read / s.own.length) * 100);

  box.innerHTML = `
    <div class="receipt kpis">
      <div class="receipt-head"><b>Shiori 栞</b><span>${esc(new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>
      <div class="rc"><span class="l">${s.own.length === 1 ? 'Cómic' : 'Cómics'}</span><i class="dots"></i><b class="v">${s.own.length}</b></div>
      <div class="rc"><span class="l">Leídos</span><i class="dots"></i><b class="v">${s.read} (${pctRead}%)</b></div>
      <div class="rc"><span class="l">${s.groups.length === 1 ? 'Serie' : 'Series'}${s.complete ? ` (${s.complete} completa${s.complete === 1 ? '' : 's'})` : ''}</span><i class="dots"></i><b class="v">${s.groups.length}</b></div>
      <div class="rc"><span class="l">Gastado en ${s.year}</span><i class="dots"></i><b class="v">${euroShort(s.yearSpent)}</b></div>
      ${wanted().length ? `<div class="rc"><span class="l">Deseados</span><i class="dots"></i><b class="v">${wanted().length}</b></div>` : ''}
      ${s.rated ? `<div class="rc"><span class="l">Tu nota media (${s.rated})</span><i class="dots"></i><b class="v">${s.avgRating.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ★</b></div>` : ''}
      <div class="rc"><span class="l">Completar tus series</span><i class="dots"></i><b class="v">${s.toComplete ? `${s.approx ? '≈ ' : ''}${euroShort(s.toComplete)}` : '—'}</b></div>
      <div class="rc total"><span class="l">Total invertido</span><i class="dots"></i><b class="v">${euroShort(s.spent)}</b></div>
    </div>

    <section class="stat-block">
      <h3>Gasto por mes</h3>
      <p>Últimos 12 meses, según la fecha de compra.${s.priced.length < s.own.length ? ` ${plural(s.own.length - s.priced.length, 'cómic no tiene', 'cómics no tienen')} precio.` : ''}</p>
      <div class="months">
        ${s.months.map((x, i) => `<button class="month ${x.sum === 0 ? 'zero' : ''} ${i === monthSel ? 'sel' : ''}" data-i="${i}" aria-label="${MONTHS_LONG[x.m]} ${x.y}: ${euro(x.sum)}, ${plural(x.n, 'cómic', 'cómics')}"><i style="height:${Math.max(1.5, (x.sum / maxSum) * 100)}%"></i></button>`).join('')}
      </div>
      <div class="month-labels">${s.months.map((x) => `<span>${MONTHS[x.m].charAt(0)}</span>`).join('')}</div>
      <p class="month-readout"><b>${MONTHS_LONG[sel.m].charAt(0).toUpperCase() + MONTHS_LONG[sel.m].slice(1)} ${sel.y}</b>: ${euro(sel.sum)} en ${plural(sel.n, 'cómic', 'cómics')}</p>
    </section>

    <section class="stat-block">
      <h3>Por editorial</h3>
      <div class="hbars">${top.map(([name, p]) => `<div class="hbar"><span class="name">${esc(name)}</span><span class="track"><i style="width:${(p.n / maxPub) * 70}%"></i><em>${p.n}${p.sum ? ` · ${euro(p.sum)}` : ''}</em></span></div>`).join('')}</div>
    </section>

    <section class="stat-block facts-block">
      <h3>Más datos</h3>
      <dl class="facts">
        <div><dt>Precio medio</dt><dd>${s.priced.length ? euro(s.spent / s.priced.length) : '—'}</dd></div>
        ${s.priciest ? `<div><dt>El más caro</dt><dd>${esc(s.priciest.title)} (${euro(s.priciest.price)})</dd></div>` : ''}
        <div><dt>Sin leer</dt><dd>${plural(s.own.length - s.read, 'cómic', 'cómics')}</dd></div>
      </dl>
    </section>`;
}

// ---------- Ajustes ----------
export async function renderSettings() {
  $('#auto-add').checked = state.settings.autoAdd;
  $('#google-key').value = state.settings.googleKey || '';
  const last = await db.getKv('lastBackup');
  $('#last-backup').textContent = last
    ? `Última copia: ${new Date(last).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Aún no has guardado ninguna copia.';
}

function setupSettings() {
  $('#auto-add').addEventListener('change', (e) => setSetting('autoAdd', e.target.checked));

  $('#btn-export').addEventListener('click', async () => {
    const f = backupFile();
    if (navigator.canShare?.({ files: [f] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [f], title: 'Copia de Shiori' }); } catch { return; }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    await db.setKv('lastBackup', Date.now());
    renderSettings();
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const data = parseBackup(await file.text());
    if (!data) { toast('Ese archivo no es una copia de Shiori'); return; }
    const ok = await confirmSheet({ title: 'Importar copia', text: `La copia tiene ${plural(data.comics.length, 'cómic', 'cómics')}. Se añadirán los que no tengas y, de los que ya tienes, se quedará la versión más reciente.`, ok: 'Importar' });
    if (!ok) return;
    const r = await importBackup(data);
    toast(`Importado: ${r.added} nuevos, ${r.updated} actualizados`);
  });

  $('#google-save').addEventListener('click', async () => {
    const k = $('#google-key').value.trim();
    setGoogleKey(k);
    await setSetting('googleKey', k);
    runGoogleTest();
  });
  $('#google-test').addEventListener('click', runGoogleTest);

  $('#btn-wipe').addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Borrar este dispositivo',
      text: state.user
        ? 'Se borrarán tus cómics de este móvil y se cerrará la sesión. En tu cuenta siguen guardados: al volver a entrar, vuelven.'
        : 'Se borrarán todos tus cómics de este móvil. Sin cuenta ni copia de seguridad, no se pueden recuperar.',
      ok: 'Borrar', danger: true,
    });
    if (!ok) return;
    if (state.user) await signOutUser();
    await wipeLocal();
    toast('Datos de este dispositivo borrados');
  });
}

async function runGoogleTest() {
  const out = $('#google-status');
  out.textContent = 'Probando…';
  const r = await testGoogle();
  out.textContent = r.ok
    ? 'Google Books funciona correctamente.'
    : ({
      quota: 'Sin clave propia la cuota compartida está agotada. Añade tu clave.',
      'quota-own': 'Tu clave ha gastado las búsquedas de hoy.',
      badkey: 'Google rechaza esta clave. Comprueba que esté entera, que la Books API esté activada y que la restricción incluya yokki21.github.io.',
      down: 'Tu clave está bien, pero Google Books está fallando ahora mismo. Prueba más tarde.',
      blocked: 'Google ha rechazado la petición.',
      network: 'No hay conexión con Google Books.',
    }[r.problem] || 'Error desconocido') + (r.status ? ` (error ${r.status})` : '');
}

// ---------- Cuenta ----------
export function renderAccount() {
  const u = state.user;
  $('#account-login').hidden = !!u;
  $('#account-in').hidden = !u;
  if (u) {
    $('#acc-avatar').outerHTML = avatarHTML(true).replace('class="avatar', 'id="acc-avatar" class="avatar');
    $('#acc-photo-remove').hidden = !state.profile.photo;
    if (document.activeElement !== $('#acc-username')) $('#acc-username').value = state.profile.username || '';
    $('#acc-who').textContent = u.email || u.displayName || 'tu cuenta';
    $('#sync-status').textContent = state.syncStatus;
    $('#acc-pass').value = '';
  }
}

function setupAccount() {
  const msg = (t, ok = false) => { const m = $('#acc-msg'); m.textContent = t; m.classList.toggle('ok', ok); };
  $('#account-login').addEventListener('submit', (e) => e.preventDefault());
  $('#account-login').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const email = $('#acc-email').value.trim();
    const pass = $('#acc-pass').value;
    msg('');
    try {
      if (act === 'in') await signIn(email, pass);
      if (act === 'up') await signUp(email, pass);
      if (act === 'google') await signInGoogle();
      if (act === 'reset') {
        if (!email) { msg('Escribe tu correo arriba y vuelve a pulsar.'); return; }
        await resetPassword(email);
        msg('Te he enviado un correo para cambiar la contraseña.', true);
        return;
      }
      closeTopLayer();
      toast(act === 'up' ? 'Cuenta creada. Tu biblioteca se está guardando en ella.' : 'Sesión iniciada');
    } catch (err) {
      msg(authMessage(err));
    }
  });
  // Nombre de usuario: único; se comprueba al escribir y se reserva al guardar
  const nameMsg = (t, cls = '') => { const m = $('#acc-name-msg'); m.textContent = t; m.className = `small ${cls || 'muted'}`; };
  const HINT = 'De 3 a 20 caracteres: letras minúsculas, números, punto y guion bajo. Es único: nadie más puede tener el mismo.';
  let checkTimer;
  $('#acc-username').addEventListener('input', (e) => {
    const v = e.target.value.toLowerCase().replace(/\s+/g, '');
    if (v !== e.target.value) e.target.value = v;
    clearTimeout(checkTimer);
    if (!v || v === state.profile.username) { nameMsg(HINT); return; }
    if (!USERNAME_RE.test(v)) { nameMsg(HINT, 'warn-text'); return; }
    checkTimer = setTimeout(async () => {
      try {
        const free = await usernameFree(v);
        if ($('#acc-username').value === v) nameMsg(free ? `@${v} está libre.` : `@${v} ya lo tiene otra persona.`, free ? 'ok-text' : 'warn-text');
      } catch { nameMsg(HINT); }
    }, 350);
  });
  $('#acc-name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#acc-username').value.trim().toLowerCase();
    if (!USERNAME_RE.test(v)) { nameMsg(HINT, 'warn-text'); return; }
    if (v === state.profile.username) return;
    const btn = $('#acc-name-save');
    btn.disabled = true;
    try {
      await claimUsername(v, state.profile.username);
      await setProfile({ username: v });
      nameMsg(`Ahora eres @${v}.`, 'ok-text');
      toast(`Nombre de usuario: @${v}`);
    } catch (err) {
      nameMsg(err.code === 'taken' ? `@${v} ya lo tiene otra persona. Prueba con otro.`
        : err.code === 'permission-denied' ? 'El servidor no deja guardar nombres: falta actualizar las reglas de Firestore.'
        : 'No se ha podido guardar. Comprueba la conexión.', 'warn-text');
    } finally { btn.disabled = false; }
  });

  // Foto de perfil: se recorta en cuadrado y se reduce para guardarla en la cuenta
  $('#acc-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 240;
      cv.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 240, 240);
      const photo = cv.toDataURL('image/jpeg', 0.82);
      await savePhoto(photo);
      await setProfile({ photo });
      toast('Foto de perfil cambiada');
    } catch (err) {
      toast(err?.code === 'permission-denied' ? 'El servidor no deja guardar la foto: revisa las reglas de Firestore.' : 'No se ha podido guardar la foto');
    }
  });
  $('#acc-photo-remove').addEventListener('click', async () => {
    try { await savePhoto(''); await setProfile({ photo: '' }); toast('Foto quitada'); } catch { toast('No se ha podido quitar la foto'); }
  });

  $('#acc-out').addEventListener('click', async () => {
    await signOutUser();
    closeTopLayer();
    toast('Sesión cerrada. Tus cómics siguen en este dispositivo.');
  });
}

export function setupProfile() {
  $('#profile-head').addEventListener('click', (e) => {
    if (e.target.closest('#open-account')) { renderAccount(); openDialog($('#sheet-account')); }
  });
  $('#profile-stats').addEventListener('click', (e) => {
    const m = e.target.closest('.month');
    if (m) { monthSel = +m.dataset.i; renderProfile(); }
  });
  setupSettings();
  setupAccount();
}
