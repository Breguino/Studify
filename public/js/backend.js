// Persistenza predefinita: IndexedDB del browser (i PDF superano la quota di localStorage).
// La versione pubblicata come pagina Claude sostituisce questo modulo con uno basato su `db`.
const DB = "studify";
let db = null;

const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = (store, mode, fn) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

const memFiles = new Map();
let ok = false;

export const backend = {
  name: "idb",
  debounceMs: 60,
  /** @returns {Promise<{state: object|null, persistent: boolean}>} */
  async init() {
    try {
      db = await open();
      const state = (await tx("kv", "readonly", (s) => s.get("state"))) ?? null;
      ok = true;
      navigator.storage?.persist?.().catch(() => {});
      return { state, persistent: true };
    } catch {
      return { state: null, persistent: false }; // es. finestra privata: i dati vanno persi alla chiusura
    }
  },
  async write(state) {
    if (!ok) return;
    await tx("kv", "readwrite", (s) => s.put(JSON.parse(JSON.stringify(state)), "state"));
  },
  putFile: (id, data) => (ok ? tx("files", "readwrite", (s) => s.put(data, id)) : (memFiles.set(id, data), Promise.resolve())),
  getFile: (id) => (ok ? tx("files", "readonly", (s) => s.get(id)) : Promise.resolve(memFiles.get(id))),
  delFile: (id) => (ok ? tx("files", "readwrite", (s) => s.delete(id)) : (memFiles.delete(id), Promise.resolve())),
};
