import { test } from "node:test";
import assert from "node:assert/strict";
import { guessRole } from "../public/js/material-roles.js";
import { demoMethods, fade, guidedPlan, splitSteps } from "../public/js/worked.js";
import { buildPlan } from "../public/js/planner.js";
import { compactModule, applyUpdate } from "../public/js/module-update.js";
import { exampleChecker, normalizeModule } from "../shared/normalize.js";
import { materialText, moduleDigest, practiceTasks } from "../shared/prompts.js";

const SVOLTI = `Esercitazione 4 — esercizi svolti in aula

Esercizio 1 — Equilibrio del monopolista
Domanda $P = 50 - Q$, costo marginale costante $MC = 10$. Trovare quantità e prezzo del monopolista.

Il ricavo totale è $RT = PQ = 50Q - Q^2$, quindi $MR = 50 - 2Q$.

Condizione di ottimo: $MR = MC$, cioè $50 - 2Q = 10$, da cui $Q^* = 20$.

Il prezzo si legge sulla domanda: $P^* = 50 - 20 = 30$.

Esercizio 2 — Elasticità in un punto
Data la domanda Q = 100 - 2P, calcolare l'elasticità nel punto P = 20.

Q(20) = 60; dQ/dP = -2; elasticità = 2 * 20/60 = 0,67.`;

test("tipo dal nome: esercizi svolti dal docente", () => {
  for (const n of ["Esercizi svolti Micro.pdf", "esercizi_risolti_lez5.pdf", "Svolgimenti esercitazione 3.pdf", "Esercitazione svolta 2.docx"]) assert.equal(guessRole(n, true), "svolti", n);
  assert.equal(guessRole("Esercitazione 3 soluzioni.pdf", true), "esercizi");
  assert.equal(guessRole("Temi d'esame svolti.pdf", true), "esami", "una prova d'esame con le soluzioni resta una prova");
});

test("controllo degli esercizi «copiati»: parole e numeri devono esserci, il LaTeX non conta", () => {
  const check = exampleChecker(SVOLTI);
  assert.equal(check("Domanda $P=50-Q$, costo marginale costante $MC=10$. Trovare quantità e prezzo del monopolista."), true);
  assert.equal(check("Data la domanda $Q=100-2P$, calcolare l'elasticità nel punto $P=20$."), true, "formule in LaTeX nel copiato: va bene");
  assert.equal(check("Domanda $P=80-2Q$, costo marginale costante $MC=14$. Trovare quantità e prezzo del monopolista."), false, "stesso testo, dati inventati");
  assert.equal(check("$x^2$"), null, "solo una formula: non verificabile");
  assert.equal(exampleChecker(SVOLTI, { hasPdf: true })("Con costo totale C = 9999 + 777Q trova il massimo profitto dell'impresa"), null, "con un PDF non si può escludere");
});

test("normalizzazione: metodi con passaggi, esercizio inventato scartato (e segnalato), method delle domande verificato", () => {
  const raw = { title: "T", overview: "", gaps: [], examHints: [], flashcards: [], topics: [{ id: "a", title: "Monopolio", methods: [
    { name: "Equilibrio del monopolista", steps: ["Scrivi $MR$", "Poni $MR=MC$", "Leggi il prezzo sulla domanda"], problem: "Domanda $P = 50 - Q$, costo marginale costante $MC = 10$. Trovare quantità e prezzo del monopolista.", solution: "$MR=50-2Q$\n\n$Q^*=20$", source: "Esercitazione 4, es. 1" },
    { name: "Metodo inventato", steps: ["a", "b"], problem: "Con costo totale C = 9999 + 777Q e prezzo 4321 trovare la quantità ottima", solution: "Q = 12", source: "" },
    { name: "Un passaggio solo", steps: ["a"], problem: "", solution: "", source: "" },
  ] }], questions: [
    { topicId: "a", kind: "problem", prompt: "Domanda $P=80-Q$, $MC=20$: quantità?", options: [], correctIndex: -1, modelAnswer: "$MR=80-2Q$\n\n$Q=30$", explanation: "", rubric: [], method: "equilibrio del MONOPOLISTA" },
    { topicId: "a", kind: "problem", prompt: "Altro", options: [], correctIndex: -1, modelAnswer: "x", explanation: "", rubric: [], method: "Metodo inventato" },
  ] };
  const mod = normalizeModule(raw, [], { checkExample: exampleChecker(SVOLTI) });
  const t = mod.topics[0];
  assert.deepEqual(t.methods.map((m) => [m.name, m.steps.length, m.verified]), [["Equilibrio del monopolista", 3, true]]);
  assert.match(mod.gaps.at(-1), /Il metodo «Metodo inventato» non corrisponde agli esercizi svolti caricati/);
  assert.equal(mod.questions[0].method, "Equilibrio del monopolista", "nome del metodo com'è nell'argomento");
  assert.ok(!("method" in mod.questions[1]), "metodo scartato: la domanda resta un esercizio normale");
  assert.ok(!("methods" in normalizeModule({ ...raw, topics: [{ id: "a", title: "X" }] }).topics[0]), "senza esercizi svolti niente methods");
});

test("aggiornamento: i metodi nuovi si aggiungono all'argomento esistente, senza doppioni", () => {
  const exam = { materials: [], qstats: {}, srs: {}, learned: {}, module: { topics: [{ id: "t5", title: "Monopolio", importance: 2, summary: "s", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", sourceIds: [],
    methods: [{ name: "Equilibrio del monopolista", steps: ["a", "b"], problem: "", solution: "", source: "", verified: false }] }], flashcards: [], questions: [], gaps: [], sources: [] } };
  const delta = { topics: [{ id: "t5", title: "Monopolio", summary: "", methods: [
    { name: "Equilibrio del monopolista", steps: ["x", "y"], problem: "", solution: "", source: "" },
    { name: "Elasticità in un punto", steps: ["Calcola Q", "Deriva", "Applica la formula"], problem: "Data la domanda Q = 100 - 2P, calcolare l'elasticità nel punto P = 20.", solution: "Q(20) = 60", source: "es. 2" },
  ] }], flashcards: [], gaps: [], examHints: [], questions: [{ topicId: "t5", kind: "problem", prompt: "Q = 90 - 2P, elasticità in P = 15?", options: [], correctIndex: -1, modelAnswer: "a\n\nb\n\nc", explanation: "", rubric: [], method: "Elasticità in un punto" }] };
  const added = applyUpdate(exam, { delta }, [], "2026-10-05T10:00:00Z", { sentText: SVOLTI });
  assert.equal(added.methods, 1);
  assert.deepEqual(exam.module.topics[0].methods.map((m) => m.name), ["Equilibrio del monopolista", "Elasticità in un punto"]);
  assert.equal(exam.module.questions[0].method, "Elasticità in un punto");
  assert.deepEqual(compactModule(exam.module).topics[0].methods, ["Equilibrio del monopolista", "Elasticità in un punto"]);
  assert.match(moduleDigest(compactModule(exam.module)), /Metodi del docente già presenti: Equilibrio del monopolista; Elasticità in un punto/);
});

test("esercizi guidati: passaggi, completamento, da dove partire", () => {
  assert.deepEqual(splitSteps("a\n\n$$x$$\n\n\nb"), ["a", "$$x$$", "b"]);
  assert.deepEqual(fade("1\n\n2\n\n3\n\n4\n\n5"), { shown: ["1", "2"], hidden: ["3", "4", "5"] });
  const method = { name: "M" };
  const qs = [
    { id: "q1", topicId: "t", kind: "problem", modelAnswer: "a\n\nb", method: "M" },
    { id: "q2", topicId: "t", kind: "problem", modelAnswer: "a\n\nb\n\nc", method: "M" },
    { id: "q3", topicId: "t", kind: "problem", modelAnswer: "a\n\nb\n\nc" },
    { id: "q4", topicId: "t", kind: "open", modelAnswer: "a\n\nb\n\nc" },
  ];
  const exam = { level: 2, qstats: {}, module: { questions: qs } };
  const p = guidedPlan(exam, "t", method);
  assert.equal(p.complete.id, "q2", "da completare: dello stesso metodo, con almeno 3 passaggi");
  assert.equal(p.solo.id, "q1", "da solo: un altro dello stesso metodo");
  assert.deepEqual(p.steps, ["example", "complete", "solo"]);
  assert.deepEqual(guidedPlan({ ...exam, level: 4 }, "t", method).steps, ["solo"], "livello alto: subito da solo");
  assert.deepEqual(guidedPlan({ ...exam, qstats: { q1: { recent: [0.9] }, q3: { recent: [0.8] } } }, "t", method).steps, ["solo"], "esercizi già riusciti: subito da solo");
});

test("piano: dopo «Studia» gli esercizi guidati sui metodi del docente, con il loro tempo", () => {
  const topics = [{ id: "t1", title: "Domanda", importance: 3, difficulty: 2 }, { id: "t2", title: "Monopolio", importance: 3, difficulty: 2, methods: [{ name: "Equilibrio del monopolista" }, { name: "Discriminazione" }, { name: "Terzo" }] }];
  const plan = buildPlan({ examDate: "2026-11-05", examType: "problemi", level: 2, hoursPerDay: 3, topics, learned: {}, today: "2026-10-05", start: "2026-10-05" });
  const tasks = plan.days.flatMap((d) => d.tasks);
  const g = tasks.filter((t) => t.kind === "guided");
  assert.deepEqual(g.map((t) => [t.topicId, t.methodIndex, t.title]), [["t2", 0, "Esercizi guidati: Equilibrio del monopolista (metodo del docente)"], ["t2", 1, "Esercizi guidati: Discriminazione (metodo del docente)"]], "al massimo 2 per argomento");
  const day = plan.days.find((d) => d.tasks.some((t) => t.kind === "guided"));
  assert.ok(day.tasks.some((t) => t.kind === "learn" && t.topicId === "t2"), "lo stesso giorno dello studio");
});

test("prompt: regola sugli esercizi svolti, tag, compito aggiuntivo", () => {
  assert.equal(materialText({ role: "svolti", title: "Es", text: "x" }), '<esercizi_svolti titolo="Es">\nx\n</esercizi_svolti>');
  assert.match(practiceTasks(["svolti"]), /un metodo \(topic\.methods\) con un esercizio svolto copiato/);
});

test("modalità demo: un metodo per esercizio svolto, con testo e svolgimento copiati", () => {
  const m = demoMethods(SVOLTI, [{ id: "t2", title: "Elasticità" }, { id: "t5", title: "Monopolio" }]);
  assert.deepEqual(m.map((x) => [x.topicId, x.method.name]), [["t5", "Equilibrio del monopolista"], ["t2", "Elasticità in un punto"]]);
  assert.match(m[0].method.problem, /^Domanda \$P = 50 - Q\$/);
  assert.equal(splitSteps(m[0].method.solution).length, 3);
  assert.equal(exampleChecker(SVOLTI)(m[0].method.problem), true);
});
