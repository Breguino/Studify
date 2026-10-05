// Libretto: gli insegnamenti del piano di studi superati e da superare, con voti, CFU e media. Il libretto ufficiale resta quello
// dell'ateneo (Esse3 o simili): qui si copia incollandolo, per vedere insieme a che punto sei e che cosa preparare dopo.
import { findCourse } from "./curriculum.js";

/** «28», «30L», «30 e lode», «30/30», «IDO», «idoneo», «approvato» → voto. null se non è un voto. */
export function parseGrade(s) {
  const t = String(s ?? "").trim().toLowerCase();
  if (/^(ido(neo|nea|neità)?|approvat[oa]|superat[oa]|sufficiente|ok)$/.test(t)) return { idoneo: true };
  const m = t.match(/^(1[89]|2\d|30)\s*(?:\/\s*30)?\s*(l|e\s*lode|cum\s*laude|\+\s*lode|lode)?$/);
  return m ? { grade: Number(m[1]), laude: !!m[2] && m[1] === "30" } : null;
}

export const gradeLabel = (p) => (p?.idoneo ? "idoneo" : p?.grade ? `${p.grade}${p.laude ? " e lode" : ""}` : "");

/** Le opzioni di un gruppo a scelta contano solo se superate o scelte; un «a scelta» senza gruppo è un blocco di CFU da fare. */
export const counts = (c) => c.kind !== "a_scelta" || !c.group || !!c.passed || !!c.planned;

/**
 * A che punto sei: esami e CFU superati sul totale, media ponderata sui CFU (la lode vale 30; le idoneità non entrano) e base di
 * laurea stimata (media × 110 / 30: molti atenei la calcolano così, alcuni aggiungono bonus o tolgono il voto peggiore).
 */
export function careerStats(courses) {
  const list = (courses ?? []).filter(counts);
  const passed = list.filter((c) => c.passed);
  const graded = passed.filter((c) => c.passed.grade && c.cfu > 0);
  const cfuGraded = graded.reduce((s, c) => s + c.cfu, 0);
  const average = cfuGraded ? graded.reduce((s, c) => s + c.passed.grade * c.cfu, 0) / cfuGraded : null;
  const simple = graded.length ? graded.reduce((s, c) => s + c.passed.grade, 0) / graded.length : null;
  return {
    total: list.length,
    passed: passed.length,
    cfuTotal: list.reduce((s, c) => s + (c.cfu || 0), 0),
    cfuPassed: passed.reduce((s, c) => s + (c.cfu || 0), 0),
    average: average == null ? null : Math.round(average * 100) / 100,
    simple: simple == null ? null : Math.round(simple * 100) / 100,
    base110: average == null ? null : Math.round(((average * 110) / 30) * 100) / 100,
    laudes: passed.filter((c) => c.passed.laude).length,
    todo: list.filter((c) => !c.passed),
  };
}

const DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;
const GRADE = /(?:^|[\s|;,\t-])(30\s*(?:e\s*lode|cum\s*laude|l\b)|(?:1[89]|2\d|30)(?:\s*\/\s*30)?|ido(?:neo|nea|neità)?|approvat[oa])(?=$|[\s|;,\t-])/i;
const NOISE = /\b(superat[ao]|frequentat[ao]|pianificat[ao]|esame|voto|data|peso|cfu|crediti|stato|anno|codice|attività didattica|didattica|obbligatorio|a scelta|ad|af)\b/gi;

/**
 * Libretto copiato da Esse3 (o simili): righe con un voto e una data → insegnamenti superati, abbinati al piano se possibile.
 * Le righe senza voto (da sostenere, frequentate) si ignorano.
 * @returns {{name: string, cfu: number, passed: {grade?: number, laude?: boolean, idoneo?: boolean, date: string}, course: object|null}[]}
 */
export function parseLibretto(text, courses = []) {
  const out = [];
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    const d = line.match(DATE);
    if (!d) continue;
    const rest = line.replace(DATE, " ");
    const g = rest.match(GRADE);
    const grade = g && parseGrade(g[1].replace(/\s*\/\s*30$/, ""));
    if (!grade) continue;
    // i CFU: il numero accanto a «CFU», altrimenti l'ultimo numero piccolo della riga (in Esse3 prima c'è l'anno di corso)
    const body = rest.replace(g[0], " ").replace(/\b[A-Z]{0,4}\d{3,}\b/g, " ");
    const explicit = body.match(/\b(\d{1,2})(?:[.,]0+)?\s*(?:cfu|crediti)\b/i);
    const small = [...body.matchAll(/(?:^|[\s|;\t])(\d{1,2})(?:[.,]0+)?(?=$|[\s|;\t])/g)].map((x) => Number(x[1])).filter((n) => n >= 1 && n <= 30);
    const cfu = explicit ? Number(explicit[1]) : small.length > 1 ? small.at(-1) : small[0] && small[0] >= 2 ? small[0] : 0;
    // il nome: il pezzo di testo più lungo, senza codici, numeri e parole del libretto
    const name = rest.replace(g[0], " ").split(/[|\t;]| - | – /).map((p) => p.replace(/\b[A-Z]{0,4}\d{3,}\b/g, " ").replace(/\b\d+(?:[.,]\d+)?\b/g, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim())
      .sort((a, b) => b.length - a.length)[0];
    if (!name || name.length < 3) continue;
    const date = `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    out.push({ name, cfu, passed: { ...grade, date }, course: findCourse(courses, name) });
  }
  return out;
}

/** Gli esami dell'app che corrispondono a un insegnamento (per nome). */
export const examsFor = (exams, course) => (exams ?? []).filter((e) => findCourse([course], e.name));
