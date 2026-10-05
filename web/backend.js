// Versione web: lo stato (esami, modulo, progressi) è sincronizzato su Supabase con lo stesso codice della pagina Claude;
// i file caricati (PDF, foto) restano in questo browser (IndexedDB), non vengono inviati a nessun server.
import { backend as cloud } from "../artifact/backend.js";

const DB = "studify-web-files";
let db = null;
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore("files");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const tx = async (mode, fn) => {
  db ??= await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction("files", mode);
    const r = fn(t.objectStore("files"));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};
const mem = new Map();
const safe = (fn, fallback) => fn().catch(fallback); // finestra privata o IndexedDB bloccato: in memoria

/** All'uscita dall'account: i file non devono restare a chi usa lo stesso computer dopo. */
export const clearLocalFiles = () => new Promise((resolve) => {
  db?.close();
  db = null;
  mem.clear();
  const req = indexedDB.deleteDatabase(DB);
  req.onsuccess = req.onerror = req.onblocked = () => resolve();
});

export const backend = {
  ...cloud,
  name: "supabase",
  noPersistMessage: "Non riesco a raggiungere l'archivio online: le modifiche non verranno salvate. Controlla la connessione e ricarica la pagina.",
  putFile: (id, data) => safe(() => tx("readwrite", (s) => s.put(data, id)), () => mem.set(id, data)),
  getFile: (id) => safe(() => tx("readonly", (s) => s.get(id)), () => mem.get(id)),
  delFile: (id) => safe(() => tx("readwrite", (s) => s.delete(id)), () => mem.delete(id)),
};
