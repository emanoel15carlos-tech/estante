// Small IndexedDB store for things too big for localStorage (the text of a narrated PDF).
// Stays in this browser only; every call fails soft when storage is blocked.
const DB = 'estante';
const STORE = 'narracoes';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { resolve(req && req.result); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}

export const getNarration = (id) => run('readonly', (s) => s.get(id)).catch(() => null);
export const saveNarration = (id, value) => run('readwrite', (s) => s.put(value, id)).then(() => true, () => false);
export const deleteNarration = (id) => run('readwrite', (s) => s.delete(id)).catch(() => null);
