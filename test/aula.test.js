import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOfficial, officialExercises } from "../public/js/exercises.js";
import { guessRole } from "../public/js/material-roles.js";
import { buildPlan } from "../public/js/planner.js";

const SHEET = "Esercitazione 6\nEsercizio 1\nCon Q = 100 - 2P trovare l'elasticità in P = 20.\nEsercizio 2\nIl monopolista ha MC = 10 e P = 50 - Q: trovare Q e P.";
const NOTES = "Esercitazione in aula del 6 ottobre\nEs. 1\nQ = 60, dQ/dP = -2\nelasticità = -2 · 20/60 = -0,67 [?]\nEs. 2\nMR = 50 - 2Q = 10 → Q = 20, P = 30";

test("esercitazione in aula: il foglio dal sito, le soluzioni negli appunti presi alla lavagna (abbinati a mano, non ufficiali)", () => {
  assert.equal(guessRole("Appunti esercitazione 6.txt"), "appunti", "gli appunti dell'esercitazione non sono il foglio");
  assert.equal(guessRole("Appunti in aula 6 ottobre.pdf", true), "appunti");
  assert.equal(guessRole("Esercitazione in aula 6.pdf", true), "esercizi");
  const exam = { materials: [
    { id: "s", kind: "notes", role: "esercizi", title: "Esercitazione 6", text: SHEET },
    { id: "n", kind: "notes", role: "appunti", handwritten: true, title: "Appunti a mano — 6 ottobre", text: NOTES },
  ] };
  assert.deepEqual(officialExercises(exam).map((e) => e.solution), ["", ""], "senza abbinamento: nessuna soluzione");
  exam.materials[0].classNotesId = "n";
  const ex = officialExercises(exam);
  assert.deepEqual(ex.map((e) => [e.key, e.aula, e.solutionFrom]), [["s#1", true, "n"], ["s#2", true, "n"]]);
  assert.match(ex[0].solution, /^Q = 60, dQ\/dP = -2\nelasticità = -2 · 20\/60 = -0,67 \[\?\]$/);
  const mod = { topics: [{ id: "t2" }, { id: "t5" }], questions: [] };
  applyOfficial(mod, ex, new Map([["s#1", { topicId: "t2", rubric: ["Q = 60"] }], ["s#2", { topicId: "t5", rubric: [] }]]), "2026-10-06T10:00:00Z");
  assert.deepEqual(mod.questions[0].official, { key: "s#1", source: "Esercitazione 6 · es. 1", aula: true });
  assert.equal(mod.questions[0].explanation, "Soluzione svolta in aula, dai tuoi appunti (Esercitazione 6 · es. 1).");
  // poi arriva il file delle soluzioni ufficiali: la soluzione e l'etichetta cambiano, i progressi (stessa domanda) restano
  exam.materials[0].classNotesId = null;
  exam.materials.push({ id: "o", kind: "notes", role: "esercizi", title: "Esercitazione 6 - soluzioni", text: "Esercizio 1\nQ = 60; elasticità -0,67.\nEsercizio 2\nQ = 20, P = 30." });
  const r = applyOfficial(mod, officialExercises(exam));
  assert.equal(r.refreshed >= 2, true);
  assert.deepEqual([mod.questions[0].id, mod.questions[0].official, mod.questions[0].modelAnswer], ["q1", { key: "s#1", source: "Esercitazione 6 · es. 1" }, "Q = 60; elasticità -0,67."]);
});

test("piano: «poi la soluzione vista in aula»", () => {
  const topics = [{ id: "t2", title: "Elasticità", importance: 3, difficulty: 2, officialCount: 1, officialClassOnly: true }];
  const plan = buildPlan({ examDate: "2026-11-05", examType: "problemi", level: 2, hoursPerDay: 3, topics, learned: {}, today: "2026-10-05", start: "2026-10-05" });
  assert.deepEqual(plan.days.flatMap((d) => d.tasks).filter((x) => x.key === "off-t2").map((x) => x.title), ["Esercitazione su Elasticità: prova da solo, poi la soluzione vista in aula"]);
});
