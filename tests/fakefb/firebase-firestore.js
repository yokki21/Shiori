// Firestore simulado para las pruebas: guarda la «nube» en localStorage.
const cloud = () => JSON.parse(localStorage.getItem('fakecloud') || '{}');
const save = (c) => localStorage.setItem('fakecloud', JSON.stringify(c));
const listeners = [];
export function getFirestore() { return {}; }
export function collection(db, ...path) { return { path: path.join('/') }; }
export function doc(col, id) { return { path: col.path + '/' + id, col: col.path, id }; }
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
export async function setDoc(ref, val) { const c = cloud(); c[ref.path] = val; save(c); window.__fbWrites = (window.__fbWrites || 0) + 1; }
export function writeBatch() {
  const ops = [];
  return { set: (r, v) => ops.push([r, v]), commit: async () => { const c = cloud(); for (const [r, v] of ops) c[r.path] = v; save(c); window.__fbWrites = (window.__fbWrites || 0) + ops.length; } };
}
export function onSnapshot(q, cb) {
  window.__fbReads = (window.__fbReads || 0);
  setTimeout(() => { const docs = docsOf(q); window.__fbReads += docs.length; cb({ docs, docChanges: () => [] }); }, 0);
  return () => {};
}
