// Estado de la biblioteca, guardado local (IndexedDB) y nube (Firebase).

import { db } from './db.js';
import { initSync, pushComic, pushDelete, pushSeries } from './sync.js';
import { today } from './util.js';

export const state = {
  comics: [],
  seriesMeta: new Map(), // clave de serie → { key, name, total, finished, updatedAt }
  deleted: {}, // id → fecha de borrado (para que los borrados lleguen a la nube)
  settings: { autoAdd: true, lastType: 'manga', sort: 'recent', googleKey: '' },
  user: null,
  syncStatus: '',
};

// Índices para no recorrer la colección entera en cada búsqueda
const idx = { byId: new Map(), byIsbn: new Map() };
let version = 0;
const listeners = new Set();

export const getVersion = () => version;
export const onChange = (fn) => listeners.add(fn);
function changed() {
  version++;
  listeners.forEach((fn) => fn());
}
function reindex() {
  idx.byId = new Map(state.comics.map((c) => [c.id, c]));
  idx.byIsbn = new Map(state.comics.filter((c) => c.isbn).map((c) => [c.isbn, c]));
}
function indexOne(c) {
  idx.byId.set(c.id, c);
  if (c.isbn) idx.byIsbn.set(c.isbn, c);
}
function unindex(c) {
  if (!c) return;
  idx.byId.delete(c.id);
  if (c.isbn && idx.byIsbn.get(c.isbn) === c) idx.byIsbn.delete(c.isbn);
}

export const byId = (id) => idx.byId.get(id);
export const byIsbn = (code) => idx.byIsbn.get(code);
export const byIssue = (issn, n) => state.comics.find((c) => c.issn === issn && c.number === n && c.status !== 'deseo');

let ownedCache = { v: -1, list: [] };
// La colección (los cómics de la antigua lista «Lo quiero» se guardan pero no se muestran)
export function owned() {
  if (ownedCache.v !== version) ownedCache = { v: version, list: state.comics.filter((c) => c.status !== 'deseo') };
  return ownedCache.list;
}

export async function loadStore() {
  const [comics, series, settings, deleted] = await Promise.all([
    db.all('comics'), db.all('series'), db.getKv('settings'), db.getKv('deleted'),
  ]);
  // Ajustes de versiones anteriores, guardados por separado
  const legacy = settings ? {} : {
    autoAdd: await db.getKv('autoAdd'), lastType: await db.getKv('lastType'),
    sort: await db.getKv('sort'), googleKey: await db.getKv('googleKey'),
  };
  Object.assign(state.settings, Object.fromEntries(Object.entries({ ...legacy, ...(settings || {}) }).filter(([, v]) => v != null)));
  state.comics = comics.map(migrate);
  for (const s of series) state.seriesMeta.set(s.key, s);
  state.deleted = deleted || {};
  reindex();
  // Guarda las migraciones que haya hecho falta
  const fixed = state.comics.filter((c, i) => c !== comics[i]);
  if (fixed.length) await db.putMany('comics', fixed);
  changed();
}

// Lectura simplificada a leído / sin leer; ISSN que se guardó como ISBN en versiones viejas
function migrate(c) {
  let out = c;
  if (c.reading === 'leyendo') out = { ...out, reading: 'pendiente' };
  if (/^977\d{10}$/.test(c.isbn || '')) out = { ...out, barcode: c.isbn, isbn: '' };
  return out;
}

export async function setSetting(key, value) {
  state.settings[key] = value;
  await db.setKv('settings', state.settings);
}

export async function saveComic(c) {
  c.updatedAt = Date.now();
  if (!c.reading) c.reading = 'pendiente';
  if (!c.status) c.status = 'coleccion';
  await db.put('comics', c);
  const i = state.comics.findIndex((x) => x.id === c.id);
  if (i >= 0) { unindex(state.comics[i]); state.comics[i] = c; } else state.comics.push(c);
  indexOne(c);
  if (state.deleted[c.id]) { delete state.deleted[c.id]; db.setKv('deleted', state.deleted); }
  pushComic(c);
  requestPersistence();
  changed();
  return c;
}

export async function removeComic(id) {
  const c = byId(id);
  await db.del('comics', id);
  state.comics = state.comics.filter((x) => x.id !== id);
  unindex(c);
  const at = Date.now();
  state.deleted[id] = at;
  db.setKv('deleted', state.deleted);
  pushDelete(id, at);
  changed();
}

export async function setRead(c, read) {
  return saveComic({ ...c, reading: read ? 'leido' : 'pendiente', readAt: read ? today() : null });
}

export async function saveSeriesMeta(meta) {
  meta.updatedAt = Date.now();
  await db.put('series', meta);
  state.seriesMeta.set(meta.key, meta);
  pushSeries(meta);
  changed();
}

// Borra la biblioteca SOLO de este dispositivo (la nube no se toca)
export async function wipeLocal() {
  await Promise.all([db.clear('comics'), db.clear('series')]);
  await db.setKv('deleted', {});
  await db.setKv('owner', null);
  await db.setKv('lastSync', null);
  state.comics = [];
  state.seriesMeta.clear();
  state.deleted = {};
  reindex();
  changed();
}

let persistAsked = false;
function requestPersistence() {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}

// ---------- Copia de seguridad ----------
export function backupFile() {
  const data = { app: 'shiori', version: 2, exportedAt: new Date().toISOString(), comics: state.comics, series: [...state.seriesMeta.values()] };
  return new File([JSON.stringify(data)], `shiori-${today()}.json`, { type: 'application/json' });
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || data.app !== 'shiori' || !Array.isArray(data.comics)) return null;
  return data;
}

// Se queda con la versión más reciente de cada cómic: una copia vieja no deshace cambios nuevos
export async function importBackup(data) {
  let added = 0, updated = 0, kept = 0;
  const writes = [];
  for (const raw of data.comics) {
    if (!raw || typeof raw.id !== 'string') continue;
    const c = migrate({ ...raw });
    const cur = byId(c.id) || (c.isbn ? byIsbn(c.isbn) : null);
    if (cur) {
      if ((c.updatedAt || 0) <= (cur.updatedAt || 0)) { kept++; continue; }
      c.id = cur.id;
      updated++;
    } else {
      if (state.deleted[c.id] && state.deleted[c.id] >= (c.updatedAt || 0)) { kept++; continue; }
      added++;
    }
    writes.push(c);
  }
  await db.putMany('comics', writes);
  for (const c of writes) {
    const i = state.comics.findIndex((x) => x.id === c.id);
    if (i >= 0) state.comics[i] = c; else state.comics.push(c);
    pushComic(c);
  }
  for (const s of data.series || []) {
    if (!s?.key) continue;
    const cur = state.seriesMeta.get(s.key);
    if (cur && (cur.updatedAt || 0) >= (s.updatedAt || 0)) continue;
    await db.put('series', s);
    state.seriesMeta.set(s.key, s);
    pushSeries(s);
  }
  reindex();
  changed();
  return { added, updated, kept };
}

// ---------- Nube ----------
export function startCloud({ onUser, onStatus, onSynced }) {
  return initSync({
    getLocal: () => ({ comics: state.comics, series: state.seriesMeta, deleted: state.deleted }),
    // Los datos del móvil pertenecen a una cuenta: si entra otra, no se mezclan
    async beforeSync(user) {
      const owner = await db.getKv('owner');
      if (owner && owner !== user.uid) await wipeLocal();
      await db.setKv('owner', user.uid);
    },
    getLastSync: async (uid) => ((await db.getKv('lastSync')) || {})[uid] || 0,
    setLastSync: async (uid, t) => { const m = (await db.getKv('lastSync')) || {}; m[uid] = t; await db.setKv('lastSync', m); },
    async applyComic(c) {
      const m = migrate(c);
      await db.put('comics', m);
      const i = state.comics.findIndex((x) => x.id === m.id);
      if (i >= 0) { unindex(state.comics[i]); state.comics[i] = m; } else state.comics.push(m);
      indexOne(m);
      if (state.deleted[m.id]) { delete state.deleted[m.id]; db.setKv('deleted', state.deleted); }
      changed();
    },
    async applyDelete(id) {
      const c = byId(id);
      if (!c) return;
      await db.del('comics', id);
      state.comics = state.comics.filter((x) => x.id !== id);
      unindex(c);
      changed();
    },
    async applySeries(meta) {
      await db.put('series', meta);
      state.seriesMeta.set(meta.key, meta);
      changed();
    },
    onUser(u) { state.user = u; onUser?.(u); },
    onStatus(t) { state.syncStatus = t; onStatus?.(t); },
    onSynced,
  });
}
