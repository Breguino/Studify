// Stato dell'app. In memoria + persistenza su IndexedDB (i PDF superano la quota di localStorage).
// Lo stato è un unico oggetto serializzabile; i file binari stanno in uno store separato.
import { MissingFileError } from "./files.js";
import { backend } from "./backend.js";
import { today } from "./dates.js";
import { applyMerged } from "./merge.js";

const VERSION = 1;

let persistent = false;
let timer = null;
let onSaveError = null;
export const setSaveErrorHandler = (fn) => { onSaveError = fn; };

export const state = { version: VERSION, exams: [], profile: null };

export const isPersistent = () => persistent;

export async function init() {
  const r = await backend.init();
  if (r.state && Array.isArray(r.state.exams)) Object.assign(state, r.state);
  persistent = r.persistent;
}

/** Salvataggio con debounce: chiamalo dopo ogni modifica. */
let staging = false;
export function save() {
  if (!persistent) return;
  clearTimeout(timer);
  timer = setTimeout(flush, backend.debounceMs);
  // versione web: copia locale subito (una per giro di eventi), così chiudere la pagina prima del salvataggio non perde nulla
  if (backend.stage && !staging) {
    staging = true;
    queueMicrotask(() => { staging = false; backend.stage(state)?.catch?.(() => {}); });
  }
}

export async function flush() {
  if (!persistent) return;
  clearTimeout(timer);
  try {
    await backend.write(state);
  } catch (e) {
    console.error("salvataggio fallito", e);
    onSaveError?.(e);
  }
}
addEventListener("pagehide", flush);
// unione con le modifiche fatte su un altro dispositivo mentre l'app era aperta (artifact/backend.js, web/offline.js)
addEventListener("studify:merged", (e) => applyMerged(state, e.detail)); // gli oggetti restano gli stessi (public/js/merge.js)
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
  // di nuovo in vista (l'app è rimasta aperta mentre si studiava su un altro dispositivo): si riprende quel lavoro
  else if (persistent) backend.refresh?.(state)?.catch?.(() => {});
});

export const putFile = (id, data) => backend.putFile(id, data);
export const getFile = (id) => backend.getFile(id);
/** C'è il file in questo browser? (senza leggerlo, se il backend lo permette) */
export const hasFile = async (id) => (backend.hasFile ? backend.hasFile(id) : (await backend.getFile(id)) != null);
/** Un file che deve esserci: se manca (caricato su un altro dispositivo) un errore che dice che cosa fare. */
export async function requireFile(id, title) {
  const data = id ? await backend.getFile(id) : null;
  if (data == null) throw new MissingFileError(title, backend.missingFileMessage?.(title));
  return data;
}
/** Materiali (di tutti gli esami) che usano il file `id`, tranne `except` (un materiale o un esame). */
const fileUsers = (id, except) => state.exams.flatMap((e) => (e === except ? [] : e.materials ?? []))
  .filter((m) => m !== except && (m.fileId === id || m.pdfFileId === id || (m.imageIds ?? []).includes(id)));
/**
 * Cancella un file del browser, ma solo se nessun altro materiale lo usa: due copie dello stesso esame
 * (per esempio dopo un'unione tra dispositivi) condividono i file. `except`: il materiale o l'esame che lo lascia.
 */
export const delFile = (id, except = null) => (id && !fileUsers(id, except).length ? backend.delFile(id) : Promise.resolve());

/* ------------------------------- esami -------------------------------- */

export const emptyProfile = () => ({ university: "", degree: "", degrees: null, courses: [], sources: [], academicYear: "", caveats: [], fetchedAt: null, studentYear: 0 });

export function profile() {
  state.profile ??= emptyProfile();
  return state.profile;
}

export const getExam = (id) => state.exams.find((e) => e.id === id);

export function newExam(fields) {
  const exam = {
    id: crypto.randomUUID?.() ?? String(Date.now()),
    name: "",
    university: "",
    degree: "",
    cfu: 0,
    year: 0,
    appelli: [], // altri appelli importati: [{date, time, room}]
    formatSource: null,
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
  for (const m of e.materials) for (const f of [m.fileId, m.pdfFileId, ...(m.imageIds ?? [])]) if (f) await delFile(f, e);
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
  // PDF e foto degli appunti a mano; i dati binari della sola sessione (pdfFileId, Blob della pagina Claude) non vanno in JSON
  for (const e of state.exams) for (const m of e.materials) for (const id of [m.fileId, ...(m.imageIds ?? [])]) {
    if (!id || id in files) continue;
    const data = await getFile(id);
    if (typeof data === "string") files[id] = data;
  }
  return JSON.stringify({ app: "studify", version: VERSION, state, files });
}

export async function importAll(json) {
  const data = JSON.parse(json);
  if (data.app !== "studify" || !Array.isArray(data.state?.exams)) throw new Error("File di backup non valido.");
  state.exams = data.state.exams;
  state.profile = data.state.profile ?? null;
  for (const [id, f] of Object.entries(data.files ?? {})) await putFile(id, f);
  await flush();
}
