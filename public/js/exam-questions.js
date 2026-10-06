// Elenchi di domande d'esame (spesso raccolte dagli studenti, tipiche dell'orale): una domanda per voce, con le ripetizioni.
// A differenza dei temi d'esame scritti, queste vanno nel quiz: all'orale le domande si ripetono e conviene saperle tutte.
import { isLessonHeading, isPaperHeading } from "./lessons.js";
import { roleOf } from "./material-roles.js";
import { sliceText } from "./module-update.js";

const MARKER = /^\s*(?:[-*•–—▪◦·]|\d{1,3}\s*[.)°]|[a-z]\)|\(\d{1,3}\))\s+/i;
const COUNTS = [
  /\s*[([]\s*(?:x|×)\s*(\d{1,2})\s*[)\]]\s*$/i, // (x3) [×3]
  /\s+(?:x|×)\s*(\d{1,2})\s*$/i, // x3
  /\s*\(\s*(?:chiest[ao]\s+|uscit[ao]\s+)?(\d{1,2})\s+volte\s*\)\s*$/i, // (3 volte), (chiesta 3 volte)
  /\s*\[(\d{1,2})\]\s*$/, // [3]
];
const OFTEN = /\s*\(\s*(?:chiest[ao]\s+|uscit[ao]\s+)?(?:molto\s+)?(?:spesso|frequente|sempre)\s*\)\s*$/i;

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();

/** Una riga che fa da intestazione di gruppo («Appello del 12/01/2024», «## Orale di giugno», «Domande sul monopolio:»). */
const isGroup = (line) => {
  const l = line.trim();
  if (MARKER.test(l) || /\?\s*$/.test(l)) return false;
  return isPaperHeading(l) || isLessonHeading(l) || /^#{1,4}\s+\S/.test(l) || (l.length <= 60 && /:\s*$/.test(l));
};

/** «Cos'è l'elasticità? (x3)» → { text: "Cos'è l'elasticità?", count: 3 } */
function stripCount(text) {
  let t = text.trim();
  for (const re of COUNTS) {
    const m = t.match(re);
    if (m) return { text: t.slice(0, m.index).trim(), count: Math.max(1, Number(m[1])) };
  }
  const often = t.match(OFTEN);
  if (often) return { text: t.slice(0, often.index).trim(), count: 2, often: true };
  return { text: t, count: 1 };
}

/**
 * Le domande di un elenco. Una voce è una riga con un segno d'elenco («-», «1.», «a)») o che finisce con «?»; una riga senza segno
 * subito sotto una voce la continua. Le intestazioni (date, appelli, «##», righe che finiscono con «:») sono il contesto.
 * Domande uguali si sommano. Se nessuna riga ha la forma di una voce, ogni riga è una domanda.
 * @returns {{text: string, count: number, when: string[], often?: boolean}[]}
 */
export function parseQuestions(text) {
  const lines = String(text ?? "").replace(/\r/g, "").replace(/\f/g, "\n\n").split("\n");
  const raw = [];
  let ctx = "";
  let prev = null;
  for (const line of lines) {
    const l = line.trim();
    if (!l) { prev = null; continue; }
    if (isGroup(l)) { ctx = l.replace(/^#{1,4}\s*/, "").replace(/:\s*$/, "").slice(0, 80); prev = null; continue; }
    if (MARKER.test(l) || /\?\s*(?:[([].{0,20}[)\]])?\s*$/.test(l)) {
      prev = { line: l.replace(MARKER, ""), ctx };
      raw.push(prev);
    } else if (prev) prev.line += ` ${l}`;
    else raw.push({ line: l, ctx, loose: true });
  }
  const items = raw.filter((r) => !r.loose).length >= 3 ? raw.filter((r) => !r.loose) : raw;
  const out = [];
  const byKey = new Map();
  for (const r of items) {
    const { text: t, count, often } = stripCount(r.line);
    if (norm(t).length < 6 || t.length > 400) continue;
    const k = norm(t);
    const have = byKey.get(k);
    if (have) {
      have.count += count;
      if (r.ctx && !have.when.includes(r.ctx)) have.when.push(r.ctx);
      continue;
    }
    const q = { text: t, count, when: r.ctx ? [r.ctx] : [], ...(often ? { often: true } : {}) };
    byKey.set(k, q);
    out.push(q);
  }
  return out;
}

/** Chiave stabile di una domanda (non cambia se cambiano l'ordine o le pagine scelte). */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Domande di un materiale di tipo «domande» (delle pagine scelte, o di `range`). */
export function questionsOf(m, range = m.pages) {
  if (roleOf(m) !== "domande" || m.kind !== "notes") return [];
  return parseQuestions(sliceText(m.text, range)).map((q) => ({ ...q, key: `${m.id}#${hash(norm(q.text))}`, materialId: m.id }));
}

/** «(chiesta spesso)» vale 2 ma va detto com'è scritto; le ripetizioni vere si contano. */
export const countLabel = (q, times, often) => (q.often && q.count === 2 ? often : q.count > 1 ? times(q.count) : "");

/**
 * Il testo che l'AI riceve al posto dell'elenco: una riga per domanda con un id «D12», le ripetizioni e il contesto.
 * `next` = primo numero libero; `map` si arricchisce con id → chiave.
 */
export function numberedQuestions(qs, next, map) {
  return qs.map((q, i) => {
    const id = `D${next + i}`;
    map.set(id, q.key);
    return `${id}. ${q.text}${countLabel(q, (n) => ` (chiesta ${n} volte)`, " (chiesta spesso)")}${q.when.length ? ` [${q.when.join("; ")}]` : ""}`;
  }).join("\n");
}

/** Tutte le domande d'esame dei materiali; la stessa domanda in due elenchi conta due volte (due testimonianze). */
export const allExamQuestions = (exam) => exam.materials.flatMap((m) => questionsOf(m));

/**
 * Quanto è chiesta ciascuna domanda del modulo e ciascun argomento, e quali domande dell'elenco non sono ancora nel quiz.
 * @returns {{list: object[], total: number, weight: (q: object) => number, perTopic: Map<string, {questions: number, weight: number}>, linked: Set<string>, uncovered: object[], inQuiz: object[]}}
 */
export function examQuestionStats(exam) {
  const list = allExamQuestions(exam);
  const count = new Map(list.map((q) => [q.key, q.count]));
  const total = list.reduce((s, q) => s + q.count, 0);
  const weight = (q) => (q.examRefs ?? []).reduce((s, k) => s + (count.get(k) ?? 0), 0);
  const inQuiz = (exam.module?.questions ?? []).filter((q) => weight(q) > 0);
  const linked = new Set(inQuiz.flatMap((q) => q.examRefs));
  const perTopic = new Map();
  for (const q of inQuiz) {
    const a = perTopic.get(q.topicId) ?? { questions: 0, weight: 0 };
    perTopic.set(q.topicId, { questions: a.questions + 1, weight: a.weight + weight(q) });
  }
  return { list, total, weight, perTopic, linked, inQuiz, uncovered: list.filter((q) => !linked.has(q.key)) };
}

/** Argomento chiesto molto più della media: almeno 3 volte e almeno una volta e mezza la sua quota (con almeno 10 domande). */
export function hotByQuestions(exam) {
  const s = examQuestionStats(exam);
  const n = exam.module?.topics.length || 1;
  const hot = new Set();
  if (s.total < 10) return hot;
  for (const [id, a] of s.perTopic) if (a.weight >= 3 && a.weight / s.total >= 1.5 / n) hot.add(id);
  return hot;
}

/* ------------------------- solo per la modalità demo e le prove ------------------------- */

/** Domande del quiz finte (modalità demo) dalle righe «D12. …»: argomento dalle parole del titolo. */
export function demoExamQuestions(text, topics) {
  const words = topics.map((t) => ({ id: t.id, w: norm(t.title).split(" ").filter((x) => x.length > 5).map((x) => x.slice(0, 7)) }));
  return [...String(text ?? "").matchAll(/^(D\d+)\. (.+?)(?: \(chiesta[^)]*\))?(?: \[[^\]]*\])?$/gm)].map(([, id, q]) => ({
    kind: "open", prompt: q, options: [], correctIndex: -1, examRefs: [id],
    topicId: (words.find((t) => t.w.some((x) => norm(q).includes(x))) ?? topics[0]).id,
    modelAnswer: `[DEMO] Risposta modello a «${q}» (con Claude viene scritta dai tuoi materiali).`, explanation: "[DEMO]",
    rubric: ["Definizione corretta", "Un esempio"], followUp: "E se il prezzo raddoppia, che cosa cambia?",
  }));
}

/** Dopo una generazione completa: gli examRefs «D12» del modulo diventano le chiavi delle domande (id della richiesta → chiave). */
export function remapExamRefs(mod, map) {
  for (const q of mod.questions ?? []) {
    if (!q.examRefs) continue;
    q.examRefs = [...new Set(q.examRefs.map((d) => map.get(d)).filter(Boolean))];
    if (!q.examRefs.length) { delete q.examRefs; delete q.followUp; }
  }
  return mod;
}
