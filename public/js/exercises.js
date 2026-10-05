// Esercitazioni con le soluzioni: l'app divide il testo in esercizi, trova la soluzione di ciascuno (subito sotto, nella sezione
// «Soluzioni» in fondo o in un file a parte) e li mette nel quiz così come sono. A Claude si chiede solo a quale argomento
// appartengono: testo e soluzione ufficiali non vengono riscritti.
import { roleOf } from "./material-roles.js";
import { parseMoodleQuiz } from "./moodle.js";

const EX = /^\s*(?:#{1,4}\s*)?(?:esercizio|es\.|problema|quesito|exercise)\s*(?:n\.?\s*|nr\.?\s*|n°\s*)?(\d{1,3}[a-z]?)\b\s*[.):—–-]?\s*(.*)$/i;
const SOL_N = /^\s*(?:#{1,4}\s*)?(?:soluzione|svolgimento|risoluzione|solution)\s*(?:dell['’]\s*|del\s+)?(?:esercizio|es\.)?\s*(?:n\.?\s*)?(\d{1,3}[a-z]?)\b\s*[.):—–-]?\s*(.*)$/i;
const SOL_INLINE = /^\s*(?:#{1,4}\s*)?(?:soluzione|svolgimento|risoluzione|solution)\s*[.:—–-]?\s*(.*)$/i;
const SOL_SECTION = /^\s*(?:#{1,4}\s*)?(?:soluzioni|svolgimenti|risoluzioni|solutions)\b(?:\s+(?:degli|dei|agli)\s+esercizi)?\s*[.:]?\s*$/i;
const NUM = /^\s*(\d{1,2})\s*[.)]\s+(.+)$/;

/**
 * Esercizi di un testo, con la soluzione se c'è. Con «Esercizio 3» come titoli; se non ce ne sono, con la numerazione «1.», «2.»
 * (solo se consecutiva: i passaggi numerati dentro uno svolgimento non diventano esercizi).
 * `solutionsOnly`: il testo è un file di sole soluzioni (ogni voce è la soluzione dell'esercizio con quel numero).
 * @returns {{n: string, text: string, solution: string}[]}
 */
export function splitExercises(text, { solutionsOnly = false } = {}) {
  const lines = String(text ?? "").replace(/\r/g, "").replace(/\f/g, "\n").split("\n");
  const run = (useNum) => {
    const items = new Map();
    const order = [];
    let mode = solutionsOnly ? "sol" : "ex";
    let cur = null;
    let target = "text";
    let expect = 1;
    const get = (n) => {
      if (!items.has(n)) { items.set(n, { n, text: "", solution: "" }); order.push(n); }
      return items.get(n);
    };
    const add = (s) => { if (cur) cur[target] += `${s}\n`; };
    for (const line of lines) {
      const ex = useNum ? line.match(NUM) : line.match(EX);
      const okNum = (m) => !useNum || Number(m[1]) === expect;
      if (SOL_SECTION.test(line)) { mode = "sol"; cur = null; expect = 1; continue; }
      const sn = line.match(SOL_N);
      if (sn) { cur = get(sn[1]); target = "solution"; add(sn[2]); continue; }
      if (ex && okNum(ex)) {
        cur = get(ex[1]);
        target = mode === "sol" ? "solution" : "text";
        add(ex[2]);
        expect = Number.parseInt(ex[1], 10) + 1;
        continue;
      }
      const si = mode === "ex" && cur ? line.match(SOL_INLINE) : null;
      if (si) { target = "solution"; add(si[1]); continue; }
      add(line);
    }
    return order.map((n) => items.get(n)).map((x) => ({ n: x.n, text: x.text.trim(), solution: x.solution.trim() })).filter((x) => x.text || x.solution);
  };
  const out = run(false);
  return out.length ? out : run(true);
}

const SOL_WORDS = /\b(soluzion[ei]|svolgiment[oi]|risoluzion[ei]|solutions?)\b/i;
// «Esercitazione 3 - soluzioni» è un file di sole soluzioni; «Esercitazione 4 con soluzioni» ha esercizi e soluzioni insieme
export const isSolutionsFile = (m) => SOL_WORDS.test(m.title ?? "") && !/\b(con|e|and|with)\s+(le\s+|i\s+)?(soluzion|svolgiment|risoluzion|solution)/i.test(m.title ?? "");

/** «Esercitazione 3 - soluzioni (da PDF)» → «esercitazione 3»: per abbinare il file delle soluzioni a quello degli esercizi. */
export const stemOf = (title) => String(title ?? "").toLowerCase().replace(/\(da pdf\)/g, " ").replace(SOL_WORDS, " ").replace(/\b(con|e|delle?|degli|dei)\b/g, " ").replace(/[^a-z0-9àèéìòù]+/g, " ").trim();

const clean = (t) => String(t ?? "").replace(/ \(da PDF\)$/, "");

/**
 * Gli esercizi delle esercitazioni (materiali di tipo «esercizi»), abbinati alle soluzioni. Un file di sole soluzioni si abbina al
 * file degli esercizi con lo stesso nome («Esercitazione 3» ↔ «Esercitazione 3 - soluzioni»). Le soluzioni fatte in aula, negli
 * appunti dello studente, si abbinano a mano (`classNotesId`): sono la sua copia della lavagna, non la soluzione ufficiale (`aula`).
 * @returns {{key: string, materialId: string, n: string, text: string, solution: string, solutionFrom: string|null, label: string, aula?: boolean}[]}
 */
export function officialExercises(exam) {
  const mats = exam.materials.filter((m) => roleOf(m) === "esercizi" && m.kind === "notes" && m.text);
  const solFiles = mats.filter(isSolutionsFile);
  const classNotes = new Set(mats.map((m) => m.classNotesId).filter(Boolean));
  const exFiles = mats.filter((m) => !isSolutionsFile(m) && !classNotes.has(m.id));
  const out = [];
  for (const m of exFiles) {
    const items = splitExercises(m.text);
    const fromClass = m.classNotesId ? exam.materials.find((x) => x.id === m.classNotesId && x.kind === "notes" && x.text) : null;
    const partner = fromClass ?? solFiles.find((s) => stemOf(s.title) === stemOf(m.title));
    const extra = partner ? new Map(splitExercises(partner.text, { solutionsOnly: true }).map((x) => [x.n, x.solution || x.text])) : new Map();
    for (const it of items) {
      if (!it.text) continue;
      const sol = it.solution || extra.get(it.n) || "";
      out.push({ key: `${m.id}#${it.n}`, materialId: m.id, n: it.n, text: it.text, solution: sol, solutionFrom: it.solution ? m.id : sol ? partner.id : null, label: `${clean(m.title)} · es. ${it.n}`,
        ...(fromClass && !it.solution && sol ? { aula: true } : {}) });
    }
  }
  return [...out, ...quizItems(exam)];
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Le domande dei quiz del docente (Moodle) come esercizi con la soluzione ufficiale: a scelta singola e Vero/Falso restano a scelta
 * multipla; a risposta breve diventano esercizi; con più risposte giuste, domande aperte («quali?»). Senza la risposta corretta
 * (il docente non la mostra nella revisione) restano fuori: solution = "".
 */
export function quizItems(exam) {
  const out = [];
  for (const m of exam.materials.filter((x) => roleOf(x) === "quiz" && x.kind === "notes" && x.text)) {
    for (const q of parseMoodleQuiz(m.text) ?? []) {
      const base = { key: `${m.id}#${q.n}`, materialId: m.id, n: q.n, solutionFrom: m.id, label: `${clean(m.title)} · domanda ${q.n}`, quiz: true, feedback: q.feedback };
      if (q.kind === "mcq") out.push({ ...base, kind: "mcq", text: q.text, options: q.options, correctIndex: q.correct.length === 1 ? q.correct[0] : -1, solution: q.correct.length === 1 ? q.options[q.correct[0]] : "" });
      else if (q.kind === "multi") out.push({ ...base, kind: "open", text: `${q.text}\n\n${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n")}\n\n(Più alternative possono essere giuste: quali?)`, solution: q.correct.length ? q.correct.map((i) => `${LETTERS[i]}. ${q.options[i]}`).join("\n") : "" });
      else out.push({ ...base, kind: "problem", text: q.text, solution: q.answer });
    }
  }
  return out;
}

/** Il file di soluzioni che non trova il suo file di esercizi (per dirlo allo studente). */
export const orphanSolutions = (exam) => {
  const mats = exam.materials.filter((m) => roleOf(m) === "esercizi" && m.kind === "notes" && m.text);
  const stems = new Set(mats.filter((m) => !isSolutionsFile(m)).map((m) => stemOf(m.title)));
  return mats.filter((m) => isSolutionsFile(m) && !stems.has(stemOf(m.title)));
};

const plain = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\\[a-z]+/g, " ").replace(/(\d),(\d)/g, "$1.$2").replace(/\{,\}/g, ".");
const words = (s) => new Set(plain(s).match(/[a-z]{5,}/g) ?? []);
const nums = (s) => new Set(plain(s).match(/\d+(?:\.\d+)?/g) ?? []);
const share = (a, b) => (a.size ? [...a].filter((x) => b.has(x)).length / a.size : 1);

/** Stesso esercizio scritto in due modi (per esempio copiato dall'AI con le formule in LaTeX): stesse parole e soprattutto stessi numeri. */
export function sameExercise(a, b) {
  const [wa, wb, na, nb] = [words(a), words(b), nums(a), nums(b)];
  if (wa.size + na.size < 4 || wb.size + nb.size < 4) return false;
  // i numeri contano di più: chi riscrive un esercizio aggiunge parole («La domanda è…»), non cambia i dati
  const sw = [share(wa, wb), share(wb, wa)];
  return Math.max(...sw) >= 0.7 && Math.min(...sw) >= 0.4 && (na.size < 2 || Math.min(share(na, nb), share(nb, na)) >= 0.75);
}

/** Nel modulo una domanda a scelta multipla non ha risposta modello: la risposta è l'alternativa giusta. */
const mcqAnswer = (e) => (e.kind === "mcq" ? "" : e.solution);

/** Domande del modulo che sono esercizi delle esercitazioni (con la soluzione ufficiale). */
export const officialQuestions = (mod) => (mod?.questions ?? []).filter((q) => q.official);

/**
 * Collega o aggiunge al modulo gli esercizi con soluzione: un esercizio già nel quiz (copiato dall'AI) diventa ufficiale e prende la
 * soluzione ufficiale (i suoi progressi restano); gli altri si aggiungono con l'argomento scelto da `assign` (id esercizio → {topicId, rubric}).
 * @returns {{linked: number, added: number, refreshed: number}}
 */
export function applyOfficial(mod, exercises, assign = new Map(), now = new Date().toISOString()) {
  const have = new Set(officialQuestions(mod).map((q) => q.official.key));
  let linked = 0;
  let added = 0;
  let next = mod.questions.reduce((n, q) => Math.max(n, Number(String(q.id).slice(1)) || 0), 0) + 1;
  const topics = new Set(mod.topics.map((t) => t.id));
  const byKey = new Map(officialQuestions(mod).map((q) => [q.official.key, q]));
  let refreshed = 0;
  for (const e of exercises) {
    if (!e.solution) continue;
    const old = byKey.get(e.key);
    if (old) {
      // il materiale è cambiato (per esempio le formule rilette con Claude): testo e soluzione si aggiornano, i progressi restano
      const changed = old.prompt !== e.text || old.modelAnswer !== mcqAnswer(e) || (e.kind === "mcq" && (old.correctIndex !== e.correctIndex || String(old.options) !== String(e.options)));
      if (changed) { Object.assign(old, { prompt: e.text, modelAnswer: mcqAnswer(e), ...(e.kind === "mcq" ? { options: e.options, correctIndex: e.correctIndex } : {}) }); refreshed++; }
      // la soluzione può passare dagli appunti dell'aula al file ufficiale (o viceversa): l'etichetta segue
      if (!!old.official.aula !== !!e.aula) { old.official = { key: e.key, source: e.label, ...(e.aula ? { aula: true } : {}) }; old.explanation = e.aula ? `Soluzione svolta in aula, dai tuoi appunti (${e.label}).` : `Soluzione ufficiale (${e.label}).`; refreshed++; }
      continue;
    }
    if (have.has(e.key)) continue;
    const mcq = e.kind === "mcq";
    const copy = mod.questions.find((q) => !q.official && (q.kind === "mcq") === mcq && sameExercise(q.prompt, e.text));
    const official = { key: e.key, source: e.label, ...(e.quiz ? { quiz: true } : {}), ...(e.aula ? { aula: true } : {}) };
    const explanation = e.quiz ? `${e.feedback ? `${e.feedback} ` : ""}(Risposta del docente: ${e.label}.)` : e.aula ? `Soluzione svolta in aula, dai tuoi appunti (${e.label}).` : `Soluzione ufficiale (${e.label}).`;
    if (copy) {
      // testo e soluzione ufficiali insieme: anche se la somiglianza ingannasse, domanda e soluzione restano della stessa coppia
      Object.assign(copy, { official, prompt: e.text, modelAnswer: mcqAnswer(e), explanation, ...(mcq ? { options: e.options, correctIndex: e.correctIndex } : {}) });
      linked++;
      continue;
    }
    const a = assign.get(e.key);
    if (!a || !topics.has(a.topicId)) continue;
    mod.questions.push({ id: `q${next++}`, topicId: a.topicId, kind: e.kind ?? "problem", prompt: e.text, options: mcq ? e.options : [], correctIndex: mcq ? e.correctIndex : -1, modelAnswer: mcqAnswer(e),
      explanation, rubric: !mcq && a.rubric?.length ? a.rubric : [], official, addedAt: now });
    added++;
  }
  return { linked, added, refreshed };
}

/** Quali esercizi con soluzione non sono ancora nel quiz. */
export function pendingOfficial(exam) {
  const have = new Set(officialQuestions(exam.module).map((q) => q.official.key));
  return officialExercises(exam).filter((e) => e.solution && !have.has(e.key));
}

/* ------------------------- solo per la modalità demo e le prove ------------------------- */

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Argomenti finti (modalità demo) dalle parole del titolo; rubrica dai passaggi della soluzione. */
export function demoAssign(exercises, topics) {
  const w = topics.map((t) => ({ id: t.id, w: norm(t.title).split(/[^a-z]+/).filter((x) => x.length > 5).map((x) => x.slice(0, 7)) }));
  return exercises.map((e) => ({ id: e.id, topicId: (w.find((t) => t.w.some((x) => norm(e.text).includes(x))) ?? topics[0]).id,
    rubric: String(e.solution).split(/\n\s*\n/).filter(Boolean).slice(0, 4).map((p, i) => `Passaggio ${i + 1} come nella soluzione ufficiale`) }));
}
