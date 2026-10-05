import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOfficial, demoAssign, isSolutionsFile, officialExercises, orphanSolutions, pendingOfficial, sameExercise, splitExercises, stemOf } from "../public/js/exercises.js";
import { buildPlan } from "../public/js/planner.js";
import { normalizeAssignments } from "../shared/normalize.js";
import { assignPrompt, transcribePrompt } from "../shared/prompts.js";

const INLINE = `Esercitazione 4 — Monopolio
Esercizio 1
Domanda P = 50 - Q, MC = 10. Trovare Q e P.
Soluzione
MR = 50 - 2Q.

Q = 20, P = 30.

Esercizio 2
Calcolare il markup.
Soluzione: markup = (P - MC)/P = 2/3.

Esercizio 3
Spiegare la perdita secca.`;

test("esercizi e soluzioni: sotto ogni esercizio, in una sezione in fondo, in un file a parte", () => {
  assert.deepEqual(splitExercises(INLINE), [
    { n: "1", text: "Domanda P = 50 - Q, MC = 10. Trovare Q e P.", solution: "MR = 50 - 2Q.\n\nQ = 20, P = 30." },
    { n: "2", text: "Calcolare il markup.", solution: "markup = (P - MC)/P = 2/3." },
    { n: "3", text: "Spiegare la perdita secca.", solution: "" },
  ]);
  const end = splitExercises("1. Calcola la media di 2, 4, 6.\n2. Calcola la varianza.\n   1. sottrai la media\nSOLUZIONI\n1. La media è 4.\n2. La varianza è 8/3.");
  assert.deepEqual(end.map((e) => [e.n, e.solution]), [["1", "La media è 4."], ["2", "La varianza è 8/3."]], "numerazione «1.»: i passaggi numerati non diventano esercizi");
  assert.equal(end[1].text, "Calcola la varianza.\n   1. sottrai la media");
  assert.deepEqual(splitExercises("Esercizio 1\nTesto uno.\nEsercizio 2\nTesto due.\n\nSoluzione dell'esercizio 2\nDue.\nSoluzione esercizio 1\nUno.").map((e) => e.solution), ["Uno.", "Due."], "«Soluzione dell'esercizio n» in qualsiasi ordine");
  assert.deepEqual(splitExercises("Soluzioni esercitazione 3\nEsercizio 1\nQ = 60.\nEsercizio 2\nElastica.", { solutionsOnly: true }).map((e) => [e.n, e.solution]), [["1", "Q = 60."], ["2", "Elastica."]]);
  assert.deepEqual(splitExercises("Appunti senza esercizi numerati."), []);
});

test("file delle soluzioni abbinato a quello degli esercizi dal nome", () => {
  assert.ok(isSolutionsFile({ title: "Esercitazione 3 - soluzioni" }) && !isSolutionsFile({ title: "Esercitazione 3" }));
  assert.ok(!isSolutionsFile({ title: "Esercitazione 4 con soluzioni" }) && !isSolutionsFile({ title: "Esercizi e svolgimenti" }), "esercizi con le soluzioni dentro");
  assert.equal(stemOf("Esercitazione 3 - Soluzioni (da PDF)"), stemOf("Esercitazione 3"));
  assert.notEqual(stemOf("Esercitazione 3 - soluzioni"), stemOf("Esercitazione 4"));
  const exam = { materials: [
    { id: "a", kind: "notes", role: "esercizi", title: "Esercitazione 3", text: "Esercizio 1\nCon Q = 100 - 2P trova l'elasticità in P = 20.\nEsercizio 2\nÈ elastica?" },
    { id: "b", kind: "notes", role: "esercizi", title: "Esercitazione 3 - soluzioni", text: "Esercizio 1\nQ = 60, elasticità 0,67.\nEsercizio 2\nNo: anelastica." },
    { id: "c", kind: "notes", role: "esercizi", title: "Soluzioni esercitazione 9", text: "Esercizio 1\nx" },
    { id: "d", kind: "notes", role: "appunti", title: "Esercizio 1", text: "Esercizio 1\nnon è un'esercitazione" },
  ] };
  const ex = officialExercises(exam);
  assert.deepEqual(ex.map((e) => [e.key, e.solution, e.solutionFrom, e.label]), [["a#1", "Q = 60, elasticità 0,67.", "b", "Esercitazione 3 · es. 1"], ["a#2", "No: anelastica.", "b", "Esercitazione 3 · es. 2"]]);
  assert.deepEqual(orphanSolutions(exam).map((m) => m.id), ["c"], "soluzioni senza il loro file di esercizi");
});

test("stesso esercizio scritto in due modi: parole e numeri uguali, LaTeX a parte", () => {
  assert.ok(sameExercise("Domanda P = 50 - Q, costo marginale MC = 10. Trovare quantità e prezzo.", "La domanda è $P=50-Q$ e il costo marginale $MC=10$: trovare quantità e prezzo del monopolista."));
  assert.ok(!sameExercise("Domanda P = 50 - Q, costo marginale MC = 10. Trovare quantità e prezzo.", "Domanda $P=80-Q$, costo marginale $MC=20$. Trovare quantità e prezzo."), "dati diversi: un altro esercizio");
  assert.ok(sameExercise("Con Q = 100 - 2P calcolare l'elasticità al prezzo nel punto P = 20.", "La domanda è $Q=100-2P$. Calcola l'elasticità al prezzo nel punto $P=20$ e dì se la domanda è elastica o anelastica."), "riscritto con più parole, stessi dati");
});

test("nel quiz: la copia dell'AI prende la soluzione ufficiale, gli altri entrano con l'argomento scelto, i cambi del testo si aggiornano", () => {
  const mod = { topics: [{ id: "t1" }, { id: "t5" }], questions: [
    { id: "q3", topicId: "t5", kind: "problem", prompt: "Domanda $P=50-Q$, $MC=10$: trovare $Q$ e $P$.", modelAnswer: "AI", explanation: "", rubric: ["r"] },
  ] };
  const exs = [
    { key: "m#1", text: "Domanda P = 50 - Q, MC = 10. Trovare Q e P.", solution: "MR = 50 - 2Q.\n\nQ = 20, P = 30.", label: "Es. 4 · es. 1" },
    { key: "m#2", text: "Calcolare il markup del monopolista.", solution: "2/3", label: "Es. 4 · es. 2" },
    { key: "m#3", text: "Spiegare la perdita secca.", solution: "", label: "Es. 4 · es. 3" },
    { key: "m#4", text: "Altro esercizio sul monopolio.", solution: "x", label: "Es. 4 · es. 4" },
  ];
  const r = applyOfficial(mod, exs, new Map([["m#2", { topicId: "t5", rubric: ["Formula del markup"] }], ["m#4", { topicId: "t42", rubric: [] }]]), "2026-10-05T10:00:00Z");
  assert.deepEqual([r.linked, r.added], [1, 1]);
  assert.deepEqual(mod.questions[0].official, { key: "m#1", source: "Es. 4 · es. 1" });
  assert.equal(mod.questions[0].modelAnswer, "MR = 50 - 2Q.\n\nQ = 20, P = 30.", "la soluzione ufficiale sostituisce quella dell'AI");
  assert.equal(mod.questions[0].prompt, "Domanda P = 50 - Q, MC = 10. Trovare Q e P.", "e anche il testo: restano una coppia");
  assert.equal(mod.questions[0].id, "q3", "stessa domanda: i progressi restano");
  assert.deepEqual(mod.questions[1], { id: "q4", topicId: "t5", kind: "problem", prompt: "Calcolare il markup del monopolista.", options: [], correctIndex: -1, modelAnswer: "2/3", explanation: "Soluzione ufficiale (Es. 4 · es. 2).", rubric: ["Formula del markup"], official: { key: "m#2", source: "Es. 4 · es. 2" }, addedAt: "2026-10-05T10:00:00Z" });
  assert.equal(mod.questions.length, 2, "senza soluzione o con un argomento inesistente non entra");
  const again = applyOfficial(mod, [{ ...exs[1], text: "Calcolare il markup del monopolista (formule rilette).", solution: "$\\frac{2}{3}$" }]);
  assert.deepEqual([again.added, again.refreshed], [0, 1]);
  assert.equal(mod.questions[1].prompt, "Calcolare il markup del monopolista (formule rilette).");
  const exam = { materials: [{ id: "m", kind: "notes", role: "esercizi", title: "Es. 4", text: INLINE }], module: mod };
  assert.deepEqual(pendingOfficial(exam).map((e) => e.key), [], "es. 1 e 2 già nel quiz, il 3 non ha soluzione");
  exam.materials[0].text += "\n\nEsercizio 5\nNuovo esercizio.\nSoluzione\n42.";
  assert.deepEqual(pendingOfficial(exam).map((e) => e.key), ["m#5"], "un esercizio aggiunto al materiale è da mettere nel quiz");
});

test("assegnazione: solo esercizi e argomenti esistenti; prompt con testo e soluzione ufficiale", () => {
  const m = normalizeAssignments({ assign: [{ id: "E1", topicId: "t1", rubric: ["a", ""], note: "" }, { id: "E1", topicId: "t2", rubric: [], note: "" }, { id: "E2", topicId: "t9", rubric: [], note: "" }, { id: "E7", topicId: "t1", rubric: [], note: "" }] }, { ids: ["E1", "E2"], topicIds: ["t1", "t2"] });
  assert.deepEqual([...m], [["E1", { topicId: "t1", rubric: ["a"], note: "" }]]);
  const p = assignPrompt({ exam: { name: "Micro", type: "problemi", level: 2, daysLeft: 9 }, topics: [{ id: "t1", title: "Monopolio" }], exercises: [{ id: "E1", label: "Es. 4 · es. 1", text: "Trovare Q", solution: "Q = 20" }] });
  assert.match(p, /t1: Monopolio[\s\S]*<esercizio id="E1" titolo="Es\. 4 · es\. 1">\nTrovare Q\n<soluzione_ufficiale>\nQ = 20\n<\/soluzione_ufficiale>/);
  assert.match(transcribePrompt({ from: 6, count: 5, title: "Es", pdf: true }), /le pagine da 6 a 10 di «Es» \(sono le pagine del PDF allegato, in ordine\)/);
  assert.deepEqual(demoAssign([{ id: "E1", text: "il monopolista", solution: "a\n\nb" }], [{ id: "t1", title: "Domanda" }, { id: "t5", title: "Monopolio" }]).map((a) => [a.topicId, a.rubric.length]), [["t5", 2]]);
});

test("piano: dopo lo studio, l'esercitazione sull'argomento", () => {
  const topics = [{ id: "t1", title: "Domanda", importance: 3, difficulty: 2 }, { id: "t5", title: "Monopolio", importance: 3, difficulty: 2, officialCount: 4 }];
  const plan = buildPlan({ examDate: "2026-11-05", examType: "problemi", level: 2, hoursPerDay: 3, topics, learned: {}, today: "2026-10-05", start: "2026-10-05" });
  const t = plan.days.flatMap((d) => d.tasks).filter((x) => x.key === "off-t5");
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].mode, t[0].topicIds, t[0].title], ["official", ["t5"], "Esercitazione su Monopolio: prova da solo, poi la soluzione ufficiale"]);
});
