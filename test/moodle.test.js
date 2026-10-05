import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyOfficial, pendingOfficial, quizItems } from "../public/js/exercises.js";
import { guessRole, isPractice, ROLES } from "../public/js/material-roles.js";
import { keepOrder, parseMoodleQuiz, usable } from "../public/js/moodle.js";
import { buildPlan } from "../public/js/planner.js";
import { ASSIGN_RULES, MODULE_PRINCIPLES, materialText, practiceTasks } from "../shared/prompts.js";

const PAGE = readFileSync(new URL("./fixtures/Quiz Moodle Microeconomia.txt", import.meta.url), "utf8");

test("revisione di un quiz Moodle copiata: domande, alternative, risposta del docente; via punteggi e navigazione", () => {
  const qs = parseMoodleQuiz(PAGE);
  assert.deepEqual(qs.map((q) => [q.n, q.kind, q.options.length, q.correct]), [["1", "mcq", 4, [0]], ["2", "mcq", 2, [0]], ["3", "short", 0, []], ["4", "multi", 3, [0, 2]], ["5", "mcq", 3, []]]);
  assert.equal(qs[0].text, "Se l'elasticità della domanda al prezzo è pari a -2, un aumento del prezzo dell'1% fa:");
  assert.deepEqual(qs[0].options, ["diminuire la quantità domandata del 2%", "aumentare la quantità domandata del 2%", "diminuire la quantità domandata dello 0,5%", "restare invariata la quantità domandata"], "«a.» su una riga e il testo sotto");
  assert.deepEqual([qs[1].options, qs[1].answer], [["Vero", "Falso"], "Vero"], "Vero/Falso, risposta tra apici");
  assert.match(qs[1].feedback, /^è la condizione del primo ordine/);
  assert.equal(qs[2].answer, "60", "risposta breve: quella del docente, non quella data («Risposta: 50»)");
  assert.equal(qs[4].answer, "", "il docente non mostra la risposta: resta senza");
  assert.ok(!qs.some((q) => /Punteggio|Contrassegna|Termina revisione|Risposta (corretta|errata)/.test(`${q.text} ${q.options.join(" ")} ${q.feedback}`)));
  assert.deepEqual(qs.map(usable), [true, true, true, true, false], "senza la risposta del docente non si usa");
  // in inglese
  const en = parseMoodleQuiz("Question 1\nCorrect\nMark 1.00 out of 1.00\nFlag question\nQuestion text\nMR equals MC at the optimum.\nSelect one:\nTrue\nFalse\nThe correct answer is 'True'.\nQuestion 2\nIncorrect\nMark 0.00 out of 1.00\nQuestion text\nPick the inferior good\nSelect one:\na. bus rides\nb. caviar\nThe correct answer is: bus rides");
  assert.deepEqual(en.map((q) => [q.kind, q.correct]), [["mcq", [0]], ["mcq", [0]]]);
  assert.equal(parseMoodleQuiz("1. Che cos'è l'elasticità?\n2. Definisci il monopolio."), null, "un elenco di domande qualunque non è un quiz Moodle");
  assert.equal(parseMoodleQuiz("Domanda 1\nScegli un'alternativa:\na. x\nb. y"), null, "una sola domanda: troppo poco per dirlo");
  assert.ok(keepOrder(["a", "tutte le precedenti"]) && keepOrder(["sia a che b", "c"]), "l'ordine resta se un'alternativa rimanda alle altre");
  assert.ok(keepOrder(["Vero", "Falso"]) && !keepOrder(["price taker", "price maker", "monopolista"]), "Vero/Falso restano in quest'ordine; le altre si mescolano");
});

test("nel quiz così come sono: scelta singola resta a scelta multipla, risposta breve diventa esercizio, più risposte una domanda aperta", () => {
  const exam = { materials: [{ id: "m", kind: "notes", role: "quiz", title: "Quiz 1 (da PDF)", text: PAGE }], module: null };
  const items = quizItems(exam);
  assert.deepEqual(items.map((e) => [e.key, e.kind, !!e.solution]), [["m#1", "mcq", true], ["m#2", "mcq", true], ["m#3", "problem", true], ["m#4", "open", true], ["m#5", "mcq", false]]);
  assert.equal(items[0].label, "Quiz 1 · domanda 1");
  assert.match(items[3].text, /a\. è la somma orizzontale[\s\S]*\(Più alternative possono essere giuste: quali\?\)/);
  assert.equal(items[3].solution, "a. è la somma orizzontale delle domande individuali\nc. si sposta se cambia il reddito dei consumatori");
  const mod = { topics: [{ id: "t1" }, { id: "t2" }, { id: "t5" }], questions: [
    { id: "q7", topicId: "t2", kind: "mcq", prompt: "Se l'elasticità della domanda al prezzo è pari a $-2$, un aumento del prezzo dell'1% fa:", options: ["x", "y", "z", "w"], correctIndex: 2, explanation: "AI", rubric: [] },
  ] };
  const assign = new Map([["m#2", { topicId: "t5", rubric: ["r"] }], ["m#3", { topicId: "t1", rubric: ["Q = 100 - 40 = 60"] }], ["m#4", { topicId: "t1", rubric: [] }]]);
  const r = applyOfficial(mod, items, assign, "2026-10-05T10:00:00Z");
  assert.deepEqual([r.linked, r.added], [1, 3], "la copia dell'AI prende la domanda del docente; la 5 (senza risposta) resta fuori");
  assert.deepEqual([mod.questions[0].id, mod.questions[0].correctIndex, mod.questions[0].options[0], mod.questions[0].official], ["q7", 0, "diminuire la quantità domandata del 2%", { key: "m#1", source: "Quiz 1 · domanda 1", quiz: true }]);
  const tf = mod.questions.find((q) => q.official?.key === "m#2");
  assert.deepEqual([tf.kind, tf.options, tf.correctIndex, tf.topicId, tf.rubric, tf.modelAnswer], ["mcq", ["Vero", "Falso"], 0, "t5", [], ""]);
  assert.match(tf.explanation, /^è la condizione del primo ordine[\s\S]*\(Risposta del docente: Quiz 1 · domanda 2\.\)$/, "spiegazione: il feedback del docente");
  const short = mod.questions.find((q) => q.official?.key === "m#3");
  assert.deepEqual([short.kind, short.modelAnswer, short.rubric], ["problem", "60", ["Q = 100 - 40 = 60"]]);
  exam.module = mod;
  assert.deepEqual(pendingOfficial(exam).map((e) => e.key), []);
});

test("tipo, regole per l'AI e piano", () => {
  assert.equal(ROLES.quiz, "Quiz del docente (Moodle)");
  for (const n of ["Quiz Moodle cap 3.txt", "Quiz 2 - Monopolio.html", "Test di autovalutazione 1.pdf", "Questionario elasticità.txt"]) assert.equal(guessRole(n, n.endsWith(".pdf")), "quiz", n);
  assert.equal(guessRole("Domande d'esame quiz.txt"), "domande");
  assert.ok(isPractice({ role: "quiz" }), "non diventano flashcard in modalità base");
  assert.equal(materialText({ role: "quiz", title: "Quiz 1", text: "x" }), '<quiz_docente titolo="Quiz 1">\nx\n</quiz_docente>');
  assert.match(MODULE_PRINCIPLES, /quiz del docente \(tag quiz_docente[\s\S]*NON copiarle e non farne flashcard[\s\S]*la domanda rovesciata[\s\S]*"gaps"/);
  assert.match(practiceTasks(["quiz"]), /Ci sono quiz del docente: le domande mcq imitino il loro stile/);
  assert.match(ASSIGN_RULES, /quiz del docente[\s\S]*l'alternativa giusta/);
  const topics = [{ id: "t5", title: "Monopolio", importance: 3, difficulty: 2, officialCount: 2, officialQuizOnly: true }, { id: "t2", title: "Elasticità", importance: 3, difficulty: 2, officialCount: 1 }];
  const plan = buildPlan({ examDate: "2026-11-05", examType: "test", level: 2, hoursPerDay: 3, topics, learned: {}, today: "2026-10-05", start: "2026-10-05" });
  const titles = plan.days.flatMap((d) => d.tasks).filter((x) => /^off-/.test(x.key)).map((x) => x.title);
  assert.deepEqual(titles.sort(), ["Esercitazione su Elasticità: prova da solo, poi la soluzione ufficiale", "Quiz del docente su Monopolio: rispondi senza guardare, poi la sua risposta"]);
});
