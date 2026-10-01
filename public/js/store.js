// Stato dell'app. In memoria + persistenza su IndexedDB (i PDF superano la quota di localStorage).
// Lo stato è un unico oggetto serializzabile; i file binari stanno in uno store separato.
import { backend } from "./backend.js";
import { today } from "./dates.js";

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
export function save() {
  if (!persistent) return;
  clearTimeout(timer);
  timer = setTimeout(flush, backend.debounceMs);
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
addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

export const putFile = (id, data) => backend.putFile(id, data);
export const getFile = (id) => backend.getFile(id);
export const delFile = (id) => backend.delFile(id);

/* ------------------------------- esami -------------------------------- */

export const emptyProfile = () => ({ university: "", degree: "", courses: [], sources: [], academicYear: "", caveats: [], fetchedAt: null });

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
  state.profile = data.state.profile ?? null;
  for (const [id, f] of Object.entries(data.files ?? {})) await putFile(id, f);
  await flush();
}
