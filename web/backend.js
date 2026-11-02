// Versione web: lo stato (esami, modulo, progressi) è sincronizzato su Supabase con lo stesso codice della pagina Claude;
// i file caricati (PDF, foto) stanno in questo browser (IndexedDB) e, con i piani a pagamento, anche online, in un
// archivio privato (web/files.js): un altro dispositivo li scarica la prima volta che servono.
// Una copia dello stato resta anche qui, per studiare senza connessione (web/offline.js).
import { cloud } from "../artifact/backend.js";
import { toast } from "../public/js/ui.js";
import { withLocalCopy } from "./offline.js";
import { conflictMessage } from "../public/js/merge.js";
import { PLANS } from "../public/js/plans.js";
import { bytesLabel, fileTitles, MAX_FILE_BYTES, referencedFiles, withOnlineFiles } from "./files.js";

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
    ? toast(conflictMessage(names), "info")
    : toast(what === "offline"
      ? "Sei senza connessione: continua pure a studiare. Le modifiche restano su questo dispositivo e vanno online appena torna la rete."
      : "Di nuovo online: le modifiche fatte senza connessione sono salvate.", what === "offline" ? "info" : "ok")), // offline non è un errore
  // arrivate modifiche da un altro dispositivo mentre l'app era aperta: lo store le prende, l'app ridisegna
  onMerge: (state) => dispatchEvent(new CustomEvent("studify:merged", { detail: state })),
});
globalThis.addEventListener?.("online", () => synced.retry()); // nelle prove in Node non ci sono eventi del browser

const files = withOnlineFiles({
  remote: async () => (await window.claude?.use?.("user"))?.id?.().then((id) => (id ? window.claude.use("files") : null)),
  local: {
    get: (id) => safe(() => tx("readonly", (s) => s.get(id)), () => mem.get(id)),
    put: (id, data) => safe(() => tx("readwrite", (s) => s.put(data, id)), () => mem.set(id, data)),
    has: (id) => safe(() => tx("readonly", (s) => s.getKey(id)), () => (mem.has(id) ? id : undefined)).then((k) => k !== undefined),
    del: (id) => safe(() => tx("readwrite", (s) => s.delete(id)), () => mem.delete(id)),
  },
  formOf: (id) => referencedFiles(lastState).get(id) ?? "blob",
  notify: (what, arg) => toast(what === "quota"
    ? `Lo spazio online per PDF e foto è pieno (${bytesLabel(arg?.quota ?? 0)} del piano ${PLANS[arg?.plan]?.name ?? ""}): i file nuovi restano solo su questo dispositivo.`
    : tooLargeMessage(names(arg)), "info"),
});
let lastState = null; // per rimettere online i file che mancano quando torna la rete
const syncFiles = (state) => {
  lastState = state ?? lastState;
  if (lastState) setTimeout(() => files.sync(lastState), 3000); // dopo il primo disegno: non rallenta l'apertura
};
globalThis.addEventListener?.("online", () => syncFiles());

const names = (ids = []) => {
  const titles = fileTitles(lastState);
  return [...new Set(ids.map((id) => titles.get(id)).filter(Boolean))];
};
const quoted = (list) => list.map((t) => `«${t}»`).join(", ");
const LIMIT = bytesLabel(MAX_FILE_BYTES);

/** Avviso per i file oltre il limite del bucket: restano su questo dispositivo, e lo si dice invece di tacerlo. */
export function tooLargeMessage(titles) {
  if (!titles.length) return `Un file supera i ${LIMIT}: resta solo su questo dispositivo, online non ci sta.`;
  return titles.length === 1
    ? `${quoted(titles)} supera i ${LIMIT}: resta solo su questo dispositivo, online non ci sta. Per averlo altrove, dividilo in parti più piccole.`
    : `${quoted(titles)} superano i ${LIMIT}: restano solo su questo dispositivo, online non ci stanno. Per averli altrove, dividili in parti più piccole.`;
}

/** Righe per l'account: i file dei materiali che non sono online e perché ([] se sono tutti online o non si sa ancora). */
export function filesStatusLines({ tooLarge = [], elsewhere = [] }, titles) {
  const list = (ids) => [...new Set(ids.map((id) => titles.get(id)).filter(Boolean))];
  const lines = [];
  const big = list(tooLarge);
  const away = list(elsewhere);
  if (big.length) lines.push(`Solo su questo dispositivo, perché superano i ${LIMIT}: ${quoted(big)}.`);
  if (away.length) lines.push(`Non ancora online: ${quoted(away)}. Apri Studify una volta dal dispositivo dove li hai caricati e vanno online da soli.`);
  return lines;
}

/** Il messaggio quando un file non c'è né qui né online. */
export function missingFileMessage(title, online) {
  const name = `«${title || "Questo file"}»`;
  return online
    ? `${name} non è né in questo browser né online: aprilo una volta dal dispositivo dove l'hai caricato, così va online da solo. Oppure caricalo di nuovo qui con «Carica di nuovo» nei materiali.`
    : null; // senza spazio online: il messaggio di sempre (public/js/files.js)
}

export const backend = {
  ...cloud,
  name: "supabase",
  noPersistMessage: "Non riesco a raggiungere l'archivio online: le modifiche non verranno salvate. Controlla la connessione e ricarica la pagina.",
  init: async () => {
    const r = await synced.init();
    syncFiles(r?.state);
    return r;
  },
  write: (state) => ((lastState = state), synced.write(state)),
  stage: (state) => ((lastState = state), synced.stage(state)), // copia locale subito, a ogni modifica (store.save); lo stato vivo serve ai nomi dei file negli avvisi
  refresh: () => synced.refresh(), // tornando sull'app: il lavoro fatto intanto su un altro dispositivo
  putFile: (id, data) => files.put(id, data),
  getFile: (id) => files.get(id),
  hasFile: (id) => files.has(id),
  delFile: (id) => files.del(id),
  missingFileMessage: (title) => missingFileMessage(title, (files.lastUsage()?.quota ?? 0) > 0),
  files, // spazio online (account, materiali)
  filesStatus: () => filesStatusLines(files.status(), fileTitles(lastState)),
};
