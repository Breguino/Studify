// Stato dell'app. In memoria + persistenza su IndexedDB (i PDF superano la quota di localStorage).
// Lo stato è un unico oggetto serializzabile; i file binari stanno in uno store separato.
import { today } from "./dates.js";

const DB = "studify";
const VERSION = 1;
let db = null;
let persistent = false;
let timer = null;

export const state = { version: VERSION, exams: [] };

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

export const isPersistent = () => persistent;

export async function init() {
  try {
    db = await open();
    const saved = await tx("kv", "readonly", (s) => s.get("state"));
    if (saved && Array.isArray(saved.exams)) Object.assign(state, saved);
    persistent = true;
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    persistent = false; // es. finestra privata: l'app funziona ma i dati vanno persi alla chiusura
  }
}

/** Salvataggio con debounce: chiamalo dopo ogni modifica. */
export function save() {
  if (!persistent) return;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export async function flush() {
  if (!persistent) return;
  try {
    await tx("kv", "readwrite", (s) => s.put(JSON.parse(JSON.stringify(state)), "state"));
  } catch (e) {
    console.error("salvataggio fallito", e);
  }
}
addEventListener("pagehide", flush);

export const putFile = (id, data) => (persistent ? tx("files", "readwrite", (s) => s.put(data, id)) : (memFiles.set(id, data), Promise.resolve()));
export const getFile = (id) => (persistent ? tx("files", "readonly", (s) => s.get(id)) : Promise.resolve(memFiles.get(id)));
export const delFile = (id) => (persistent ? tx("files", "readwrite", (s) => s.delete(id)) : (memFiles.delete(id), Promise.resolve()));
const memFiles = new Map();

/* ------------------------------- esami -------------------------------- */

export const getExam = (id) => state.exams.find((e) => e.id === id);

export function newExam(fields) {
  const exam = {
    id: crypto.randomUUID?.() ?? String(Date.now()),
    name: "",
    university: "",
    date: "",
    type: "scritto",
    level: 2,
    hoursPerDay: 3,
    sessionMinutes: 25,
    language: "italiano",
    materials: [],
    module: null,
    srs: {},
    qstats: {},
    learned: {},
    done: {},
    activity: {},
    plan: null,
    createdAt: today(),
    ...fields,
  };
  state.exams.push(exam);
  save();
  return exam;
}

export async function deleteExam(id) {
  const e = getExam(id);
  if (!e) return;
  for (const m of e.materials) if (m.fileId) await delFile(m.fileId);
  state.exams = state.exams.filter((x) => x.id !== id);
  save();
}

export function logActivity(exam, n = 1) {
  const d = today();
  exam.activity[d] = (exam.activity[d] ?? 0) + n;
}

/* ------------------------- esportazione / importazione ------------------------- */

export async function exportAll() {
  const files = {};
  for (const e of state.exams) for (const m of e.materials) if (m.fileId) files[m.fileId] = await getFile(m.fileId);
  return JSON.stringify({ app: "studify", version: VERSION, state, files });
}

export async function importAll(json) {
  const data = JSON.parse(json);
  if (data.app !== "studify" || !Array.isArray(data.state?.exams)) throw new Error("File di backup non valido.");
  state.exams = data.state.exams;
  for (const [id, f] of Object.entries(data.files ?? {})) await putFile(id, f);
  await flush();
}
