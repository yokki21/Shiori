// Firestore simulado para las pruebas: guarda la «nube» en localStorage.
const cloud = () => JSON.parse(localStorage.getItem('fakecloud') || '{}');
const save = (c) => localStorage.setItem('fakecloud', JSON.stringify(c));
const listeners = [];
export function getFirestore() { return {}; }
export function collection(db, ...path) { return { path: path.join('/') }; }
export function doc(col, ...ids) {
  if (!col?.path) { const path = ids.join('/'); return { path, col: ids.slice(0, -1).join('/'), id: ids.at(-1) }; } // doc(db, 'users', uid)
  return { path: col.path + '/' + ids[0], col: col.path, id: ids[0] };
}
export function where(field, op, value) { return { field, op, value }; }
export function query(col, w) { return { ...col, where: w }; }
function docsOf(q) {
  const depth = q.path.split('/').length + 1;
  return Object.entries(cloud())
    .filter(([p]) => p.startsWith(q.path + '/') && p.split('/').length === depth)
    .filter(([, v]) => !q.where || (v[q.where.field] ?? 0) > q.where.value)
    .map(([p, v]) => ({ id: p.split('/').pop(), data: () => v, metadata: { hasPendingWrites: false } }));
}
export async function getDocs(q) { return { docs: docsOf(q) }; }
function notify() { for (const l of listeners) l(); }
export async function setDoc(ref, val, opt) { const c = cloud(); c[ref.path] = opt?.merge ? { ...(c[ref.path] || {}), ...val } : val; save(c); window.__fbWrites = (window.__fbWrites || 0) + 1; }
export function writeBatch() {
  const ops = [];
  return { set: (r, v) => ops.push([r, v]), commit: async () => { const c = cloud(); for (const [r, v] of ops) c[r.path] = v; save(c); window.__fbWrites = (window.__fbWrites || 0) + ops.length; } };
}
export function onSnapshot(q, cb) {
  window.__fbReads = (window.__fbReads || 0);
  setTimeout(() => { const docs = docsOf(q); window.__fbReads += docs.length; cb({ docs, docChanges: () => [] }); }, 0);
  return () => {};
}
// Documentos sueltos y transacciones (perfil y nombres de usuario)
const snapOf = (path) => { const v = cloud()[path]; return { exists: () => v !== undefined, data: () => v, id: path.split('/').pop() }; };
export async function getDoc(ref) { return snapOf(ref.path); }
export async function deleteDoc(ref) { const c = cloud(); delete c[ref.path]; save(c); }
export async function runTransaction(db, fn) {
  const ops = [];
  const tx = {
    get: async (ref) => snapOf(ref.path),
    set: (ref, val, opt) => { ops.push(['set', ref, val, opt]); return tx; },
    delete: (ref) => { ops.push(['del', ref]); return tx; },
  };
  const r = await fn(tx);
  const c = cloud();
  for (const [op, ref, val, opt] of ops) {
    if (op === 'del') delete c[ref.path];
    else c[ref.path] = opt?.merge ? { ...(c[ref.path] || {}), ...val } : val;
  }
  save(c);
  return r;
}
