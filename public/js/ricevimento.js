// Ricevimento: le domande da fare al docente, raccolte da ciò che l'app sa già. Solo lui può sciogliere certi dubbi: due fonti che
// non concordano, una soluzione ufficiale che sembra sbagliata, un capitolo del libro che forse è nel programma, una domanda di quiz
// senza risposta, com'è fatto l'esame. Le risposte diventano un materiale («Ricevimento del …»): le sue parole, di prima mano.
import { uncoveredChapters } from "./books.js";
import { quizItems } from "./exercises.js";
import { topicStats } from "./progress.js";

const CONFLICT = /non concordan|contrast|diversament|dicono .*,? (?:il|la|le|i) |chiedi(?:lo)? al docente|chiedere al docente|refuso|da chiarire/i;
const SOLUTION = /^Soluzione ufficiale da controllare — /;
const ONLY = /solo (?:sulle slide|negli appunti di un collega)/i;

/**
 * Le domande da proporre, le più utili prima: com'è l'esame (se non viene da una fonte), contrasti tra le fonti, soluzioni
 * ufficiali dubbie, capitoli del programma che i materiali non coprono, domande dei quiz senza risposta, argomenti solo sulle
 * slide, e l'argomento dove sbagli di più. `on` = proposta già spuntata.
 * @returns {{key: string, kind: string, text: string, why: string, on: boolean}[]}
 */
export function questionsToAsk(exam) {
  const out = [];
  const add = (key, kind, text, why, on = true) => out.push({ key, kind, text, why, on });
  if (!exam.formatSource?.text)
    add("formato", "formato", "Com'è l'esame? Scritto, orale o tutti e due; quanto dura; che cosa si può portare (calcolatrice, formulario); quanto pesa ogni parte; c'è un esonero?",
      "Il tipo di prova nell'app non viene dalla scheda dell'insegnamento né dal docente.");
  const gaps = exam.module?.gaps ?? [];
  gaps.forEach((g, i) => {
    if (SOLUTION.test(g)) add(`gap${i}`, "soluzione", `${g.replace(SOLUTION, "")} — La soluzione ufficiale è giusta?`, "Claude pensa che la soluzione ufficiale possa avere un errore: non l'ha corretta.");
    else if (CONFLICT.test(g)) add(`gap${i}`, "contrasto", g, "Due fonti non dicono la stessa cosa: qual è la versione che vuole all'esame?");
  });
  const books = uncoveredChapters(exam).filter((x) => x.book.kind !== "dispense");
  if (books.length)
    add("programma", "programma", `Questi capitoli del libro sono nel programma? ${books.slice(0, 8).map((x) => `${x.book.title} cap. ${x.chapter.n} «${x.chapter.title}»`).join("; ")}${books.length > 8 ? "; …" : ""}`,
      "Il libro li comprende, ma nei tuoi materiali non ci sono.");
  const noAnswer = new Map();
  for (const e of quizItems(exam)) if (!e.solution) noAnswer.set(e.materialId, [...(noAnswer.get(e.materialId) ?? []), e.n]);
  for (const [mid, ns] of noAnswer) {
    const m = exam.materials.find((x) => x.id === mid);
    add(`quiz-${mid}`, "quiz", `Nel quiz «${String(m?.title ?? "").replace(/ \(da PDF\)$/, "")}», ${ns.length === 1 ? "la domanda" : "le domande"} ${ns.join(", ")}: qual è la risposta corretta?`,
      "La revisione su Moodle non la mostra: senza, quelle domande restano fuori dal quiz.");
  }
  gaps.forEach((g, i) => { if (ONLY.test(g) && !out.some((x) => x.key === `gap${i}`)) add(`gap${i}`, "fonte", `${g} Dove lo studio, ed è nel programma?`, "Non c'è una spiegazione nei tuoi materiali.", false); });
  if (exam.module) {
    const stats = topicStats(exam.module, exam.srs ?? {}, exam.qstats ?? {}, exam.learned ?? {});
    const weak = exam.module.topics.filter((t) => stats[t.id]?.attempted >= 3 && (stats[t.id].quiz ?? 1) < 0.5).sort((a, b) => stats[a.id].quiz - stats[b.id].quiz)[0];
    if (weak) add(`weak-${weak.id}`, "dubbio", `Su «${weak.title}» sbaglio spesso: porto un esercizio che non mi torna e chiedo in quale passaggio sbaglio.`,
      `Nel quiz ne hai giuste meno della metà (${Math.round(stats[weak.id].quiz * 100)}%). Una domanda precisa, su un esercizio, rende più di «non ho capito l'argomento».`, false);
  }
  return out;
}

/** Il testo del materiale «Ricevimento del …»: domande e risposte, una coppia per paragrafo. */
export function ricevimentoText(date, pairs) {
  return [`Ricevimento con il docente del ${date}`, ...pairs.filter((p) => p.answer?.trim()).map((p) => `Domanda: ${p.question.trim()}\nRisposta del docente: ${p.answer.trim()}`)].join("\n\n");
}
