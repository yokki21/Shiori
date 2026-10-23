// Almacenamiento local con IndexedDB (aguanta miles de cómics y fotos de portada).

const DB_NAME = 'shiori';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('comics')) {
          const s = db.createObjectStore('comics', { keyPath: 'id' });
          s.createIndex('isbn', 'isbn');
        }
        if (!db.objectStoreNames.contains('series')) db.createObjectStore('series', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

function txDone(t) {
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}

export const db = {
  async all(name) { return done((await store(name)).getAll()); },
  async put(name, value) { return done((await store(name, 'readwrite')).put(value)); },
  async del(name, key) { return done((await store(name, 'readwrite')).delete(key)); },
  async putMany(name, values) {
    const d = await open();
    const t = d.transaction(name, 'readwrite');
    const s = t.objectStore(name);
    for (const v of values) s.put(v);
    return txDone(t);
  },
  async clear(name) { return done((await store(name, 'readwrite')).clear()); },
  async get(name, key) { return done((await store(name)).get(key)); },
  async setKv(key, value) { return done((await store('kv', 'readwrite')).put(value, key)); },
  async getKv(key) { return done((await store('kv')).get(key)); },
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
