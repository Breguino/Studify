// Studiare in gruppo: un esame si condivide con i compagni come file (il modulo, i libri con l'indice e, se si vuole, il testo dei
// materiali), senza i progressi di chi lo manda: ognuno ripassa con le sue flashcard e i suoi errori. E l'interrogazione a turno:
// chi chiede vede la traccia di risposta, chi risponde no.
import { examQuestionStats } from "./exam-questions.js";
import { topicStats } from "./progress.js";

export const SHARE_APP = "studify-esame";

// i dati personali: progressi, piano, simulazioni, bozze; non partono
const PERSONAL = ["srs", "qstats", "learned", "done", "activity", "plan", "ricevimento", "simDraft", "simulations", "dispensa", "onboarding"];

/**
 * L'esame da mandare al gruppo. Con `materials: false` solo il modulo e i libri; altrimenti anche il testo dei materiali (non i PDF
 * e le foto, troppo grandi, né i riferimenti ai file salvati nel browser).
 */
export function exportExam(exam, { materials = true } = {}) {
  const e = JSON.parse(JSON.stringify(exam));
  for (const k of PERSONAL) delete e[k];
  e.materials = materials ? (e.materials ?? []).filter((m) => m.kind === "notes" && m.text).map(({ fileId, pdfFileId, imageIds, ...m }) => m) : [];
  if (!materials) e.books = (e.books ?? []).filter((b) => b.kind !== "dispense").map((b) => ({ ...b, materialId: null }));
  delete e.id;
  return JSON.stringify({ app: SHARE_APP, version: 1, sharedAt: new Date().toISOString(), exam: e });
}

/**
 * Un esame ricevuto dal gruppo → i campi per un esame nuovo (con i progressi a zero). Il nome si distingue se c'è già.
 * @returns {object} campi per store.newExam
 */
export function importExam(json, existingNames = []) {
  let data;
  try { data = JSON.parse(json); } catch { throw new Error("Il file non è un esame di Studify."); }
  if (data?.app !== SHARE_APP || !data.exam?.name) throw new Error(data?.app === "studify" ? "Questo è un backup completo, non un esame condiviso: importalo da «Dati»." : "Il file non è un esame di Studify.");
  const e = data.exam;
  for (const k of PERSONAL) delete e[k];
  delete e.id;
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  let name = e.name;
  if (taken.has(name.toLowerCase())) name = `${e.name} (dal gruppo)`;
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${e.name} (dal gruppo ${k})`;
  return { ...e, name, materials: (e.materials ?? []).map((m) => ({ ...m, kind: "notes" })), books: e.books ?? [], srs: {}, qstats: {}, learned: {}, done: {}, activity: {}, plan: null, fromGroup: { at: data.sharedAt ?? null } };
}

/**
 * Domande per interrogarsi a turno: prima le domande d'esame vere (le più chieste), poi le aperte e gli esercizi degli argomenti
 * più importanti e meno sicuri per chi interroga. Solo domande con una traccia di risposta (risposta modello o punti).
 */
export function groupQuestions(exam, n = 10) {
  const mod = exam.module;
  if (!mod) return [];
  const { weight } = examQuestionStats(exam);
  const stats = topicStats(mod, exam.srs ?? {}, exam.qstats ?? {}, exam.learned ?? {});
  const imp = new Map(mod.topics.map((t) => [t.id, t.importance ?? 2]));
  const pool = mod.questions.filter((q) => q.kind !== "mcq" && (q.modelAnswer || q.rubric?.length));
  const score = (q) => weight(q) * 10 + (imp.get(q.topicId) ?? 2) * 2 + (1 - (stats[q.topicId]?.score ?? 0));
  const sorted = [...pool].sort((a, b) => score(b) - score(a));
  // non tutte dallo stesso argomento: al massimo 2 per argomento nel primo giro
  const out = [];
  const per = new Map();
  for (const q of sorted) { if ((per.get(q.topicId) ?? 0) >= 2) continue; per.set(q.topicId, (per.get(q.topicId) ?? 0) + 1); out.push(q); if (out.length >= n) return out; }
  for (const q of sorted) { if (!out.includes(q)) out.push(q); if (out.length >= n) break; }
  return out;
}
