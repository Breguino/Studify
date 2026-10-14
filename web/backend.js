// Versione web: lo stato (esami, modulo, progressi) è sincronizzato su Supabase con lo stesso codice della pagina Claude;
// i file caricati (PDF, foto) restano in questo browser (IndexedDB), non vengono inviati a nessun server.
// Una copia dello stato resta anche qui, per studiare senza connessione (web/offline.js).
import { backend as cloud } from "../artifact/backend.js";
import { toast } from "../public/js/ui.js";
import { withLocalCopy } from "./offline.js";

const DB = "studify-web-files";
let db = null;
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 2);
  req.onupgradeneeded = () => {
    const names = req.result.objectStoreNames;
    if (!names.contains("files")) req.result.createObjectStore("files");
    if (!names.contains("state")) req.result.createObjectStore("state"); // copia dello stato, per utente
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const tx = async (mode, fn, store = "files") => {
  db ??= await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};
const mem = new Map();
const safe = (fn, fallback) => fn().catch(fallback); // finestra privata o IndexedDB bloccato: in memoria

/** All'uscita dall'account: i file e la copia dei dati non devono restare a chi usa lo stesso computer dopo. */
export const clearLocalFiles = () => new Promise((resolve) => {
  db?.close();
  db = null;
  mem.clear();
  const req = indexedDB.deleteDatabase(DB);
  req.onsuccess = req.onerror = req.onblocked = () => resolve();
});

const synced = withLocalCopy({
  cloud,
  local: {
    get: (uid) => tx("readonly", (s) => s.get(uid), "state"),
    set: (uid, record) => tx("readwrite", (s) => s.put(record, uid), "state"),
  },
  uid: async () => (await window.claude?.use?.("user"))?.id?.() ?? null,
  notify: (what, names = []) => (what === "conflict"
    ? toast(`${names.map((n) => `«${n}»`).join(", ")}: ${names.length === 1 ? "l'hai modificato" : "li hai modificati"} sia qui sia su un altro dispositivo. Ho tenuto la versione online e aggiunto quella di questo dispositivo come copia «(da questo dispositivo)»: tieni quella giusta ed elimina l'altra.`, "info")
    : toast(what === "offline"
      ? "Sei senza connessione: continua pure a studiare. Le modifiche restano su questo dispositivo e vanno online appena torna la rete."
      : "Di nuovo online: le modifiche fatte senza connessione sono salvate.", what === "offline" ? "info" : "ok")), // offline non è un errore
  // arrivate modifiche da un altro dispositivo mentre l'app era aperta: lo store le prende, l'app ridisegna
  onMerge: (state) => dispatchEvent(new CustomEvent("studify:merged", { detail: state })),
});
globalThis.addEventListener?.("online", () => synced.retry()); // nelle prove in Node non ci sono eventi del browser

export const backend = {
  ...cloud,
  name: "supabase",
  noPersistMessage: "Non riesco a raggiungere l'archivio online: le modifiche non verranno salvate. Controlla la connessione e ricarica la pagina.",
  init: () => synced.init(),
  write: (state) => synced.write(state),
  stage: (state) => synced.stage(state), // copia locale subito, a ogni modifica (store.save)
  putFile: (id, data) => safe(() => tx("readwrite", (s) => s.put(data, id)), () => mem.set(id, data)),
  getFile: (id) => safe(() => tx("readonly", (s) => s.get(id)), () => mem.get(id)),
  hasFile: (id) => safe(() => tx("readonly", (s) => s.getKey(id)), () => (mem.has(id) ? id : undefined)).then((k) => k !== undefined),
  delFile: (id) => safe(() => tx("readwrite", (s) => s.delete(id)), () => mem.delete(id)),
};
