import { test } from "node:test";
import assert from "node:assert/strict";
import { guessRole } from "../public/js/material-roles.js";
import { allExamQuestions, examQuestionStats, hotByQuestions, numberedQuestions, parseQuestions, questionsOf, remapExamRefs } from "../public/js/exam-questions.js";
import { applyExamBoost } from "../public/js/past-exams.js";
import { applyUpdate } from "../public/js/module-update.js";
import { pickQuestions } from "../public/js/progress.js";
import { chapterPrompt, materialText, practiceTasks } from "../shared/prompts.js";
import { examQuestionLines, identityRefs, normalizeModule } from "../shared/normalize.js";

const ELENCO = `Domande orale Microeconomia (raccolte dai rappresentanti)

Appello del 12/01/2024
- Cos’è l’elasticità della domanda? (x3)
- Differenza tra concorrenza perfetta e monopolio
  con il grafico
- Il surplus del consumatore (chiesta spesso)

Appello del 9/02/2024
1. Cos'è l'elasticità della domanda?
2) Perché il monopolio genera una perdita secca?
3. Vincolo di bilancio [2]

Note: portate il libretto`;

test("tipo dal nome: elenchi di domande d'esame", () => {
  for (const n of ["Domande d'esame Micro.docx", "domande_orale.pdf", "Domande dell'orale 2024.txt", "Domande uscite.md", "Domande frequenti esame.pdf"])
    assert.equal(guessRole(n), "domande", n);
  assert.equal(guessRole("Temi d'esame 2024.pdf", true), "esami");
  assert.equal(guessRole("Esame 2023.pdf", true), "esami");
});

test("elenco di domande: voci, continuazioni, ripetizioni, appelli come contesto", () => {
  const qs = parseQuestions(ELENCO);
  assert.deepEqual(qs.map((q) => [q.text, q.count]), [
    ["Cos’è l’elasticità della domanda?", 4],
    ["Differenza tra concorrenza perfetta e monopolio con il grafico", 1],
    ["Il surplus del consumatore", 2],
    ["Perché il monopolio genera una perdita secca?", 1],
    ["Vincolo di bilancio", 2],
  ]);
  assert.deepEqual(qs[0].when, ["Appello del 12/01/2024", "Appello del 9/02/2024"], "la stessa domanda in due appelli");
  assert.equal(qs[2].often, true);
  assert.deepEqual(parseQuestions("Elasticità\nMonopolio e perdita secca\nSurplus del consumatore").map((q) => q.text), ["Elasticità", "Monopolio e perdita secca", "Surplus del consumatore"], "senza segni d'elenco: una domanda per riga");
  assert.deepEqual(parseQuestions("Lezione 1\f- Domanda uno sul mercato?\f- Domanda due sui costi?").map((q) => q.text), ["Domanda uno sul mercato?", "Domanda due sui costi?"], "testo diviso in pagine");
});

test("chiavi stabili e voci numerate «D…» per l'AI", () => {
  const m = { id: "m1", kind: "notes", role: "domande", title: "Domande", text: ELENCO };
  const a = questionsOf(m);
  const b = questionsOf({ ...m, text: ELENCO.split("\n").reverse().join("\n") });
  assert.ok(a.every((q) => /^m1#[0-9a-z]+$/.test(q.key)));
  assert.ok(a.filter((q) => q.text === "Vincolo di bilancio").every((q) => b.some((x) => x.key === q.key)), "la chiave non dipende dall'ordine");
  const map = new Map();
  const text = numberedQuestions(a, 3, map);
  assert.equal(text.split("\n")[0], "D3. Cos’è l’elasticità della domanda? (chiesta 4 volte) [Appello del 12/01/2024; Appello del 9/02/2024]");
  assert.equal(text.split("\n")[2], "D5. Il surplus del consumatore (chiesta spesso) [Appello del 12/01/2024]");
  assert.equal(map.get("D3"), a[0].key);
  assert.equal(materialText({ role: "domande", title: "Domande", text }).split("\n")[0], '<domande_esame titolo="Domande">');
  assert.deepEqual([...examQuestionLines([{ role: "domande", text }, { role: "appunti", text: "D9. non è un elenco" }]).keys()], ["D3", "D4", "D5", "D6", "D7"]);
  assert.deepEqual(questionsOf({ ...m, role: "appunti" }), [], "solo i materiali di tipo domande");
});

test("normalizzazione: examRefs solo verso domande vere, poi tradotti nelle chiavi", () => {
  const materials = [{ role: "domande", text: "D1. Cos'è l'elasticità?\nD2. Il monopolio" }];
  const raw = { title: "T", overview: "", gaps: [], examHints: [], topics: [{ id: "t1", title: "Elasticità" }], flashcards: [], questions: [
    { topicId: "t1", kind: "open", prompt: "Cos'è l'elasticità?", modelAnswer: "a", explanation: "", rubric: ["r"], options: [], correctIndex: -1, examRefs: ["D1", "D9"], followUp: "E il ricavo?" },
    { topicId: "t1", kind: "open", prompt: "Altra", modelAnswer: "a", explanation: "", rubric: [], options: [], correctIndex: -1, examRefs: ["D7"], followUp: "x" },
  ] };
  const mod = normalizeModule(raw, [], { examRefs: identityRefs(materials) });
  assert.deepEqual(mod.questions[0].examRefs, ["D1"]);
  assert.equal(mod.questions[0].followUp, "E il ricavo?");
  assert.ok(!("examRefs" in mod.questions[1]) && !("followUp" in mod.questions[1]), "riferimento inventato: domanda normale, senza approfondimento");
  remapExamRefs(mod, new Map([["D1", "m1#abc"]]));
  assert.deepEqual(mod.questions[0].examRefs, ["m1#abc"]);
  assert.ok(!("examRefs" in normalizeModule(raw, []).questions[0]), "senza elenco nessun examRefs");
});

const baseExam = () => ({
  materials: [{ id: "m1", kind: "notes", role: "domande", title: "Domande", text: ELENCO }],
  module: { topics: [{ id: "t1", title: "Elasticità", importance: 2 }, { id: "t2", title: "Monopolio", importance: 2 }, { id: "t3", title: "Surplus", importance: 1 }, { id: "t4", title: "Consumatore", importance: 2 }],
    flashcards: [], gaps: [], sources: [],
    questions: [{ id: "q1", topicId: "t1", kind: "open", prompt: "Che cos'è l'elasticità della domanda?", modelAnswer: "", explanation: "", rubric: [], options: [], correctIndex: -1 }] },
  srs: {}, qstats: { q1: { n: 1, recent: [0.2], last: 0.2 } }, learned: {}, materialIds: [],
});

test("aggiornamento: domande d'esame nuove nel quiz, una domanda già presente diventa d'esame e tiene i progressi", () => {
  const exam = baseExam();
  const qs = questionsOf(exam.materials[0]);
  const map = new Map();
  numberedQuestions(qs, 1, map);
  const delta = { topics: [], flashcards: [], gaps: [], examHints: [], questions: [
    { topicId: "t1", kind: "open", prompt: "Che cos'è l'elasticità della domanda?", modelAnswer: "m", explanation: "", rubric: [], options: [], correctIndex: -1, examRefs: ["D1"], followUp: "E il ricavo totale?" },
    { topicId: "t2", kind: "open", prompt: "Perché il monopolio genera una perdita secca?", modelAnswer: "m", explanation: "", rubric: ["r"], options: [], correctIndex: -1, examRefs: ["D4"], followUp: "Disegnala" },
    { topicId: "t2", kind: "open", prompt: "Concorrenza perfetta e monopolio: differenze", modelAnswer: "m", explanation: "", rubric: ["r"], options: [], correctIndex: -1, examRefs: ["D2"], followUp: "" },
  ] };
  const added = applyUpdate(exam, { delta }, ["m1"], "2026-10-05T10:00:00Z", { sentText: "", examRefs: map });
  assert.equal(added.examQuestions, 3);
  assert.equal(added.questions, 0, "le domande d'esame si contano a parte");
  assert.equal(exam.module.questions.length, 3, "la domanda già presente non si duplica");
  const q1 = exam.module.questions.find((q) => q.id === "q1");
  assert.deepEqual(q1.examRefs, [map.get("D1")]);
  assert.equal(q1.followUp, "E il ricavo totale?");
  assert.deepEqual(exam.qstats.q1.recent, [0.2], "i progressi restano");

  const s = examQuestionStats(exam);
  assert.equal(s.total, 10);
  assert.equal(s.inQuiz.length, 3);
  assert.equal(s.weight(q1), 4);
  assert.deepEqual(Object.fromEntries(s.perTopic), { t1: { questions: 1, weight: 4 }, t2: { questions: 2, weight: 2 } });
  assert.deepEqual(s.uncovered.map((q) => q.text), ["Il surplus del consumatore", "Vincolo di bilancio"], "quelle non ancora nel quiz");
  assert.deepEqual([...hotByQuestions(exam)], ["t1"], "4 su 10 con 4 argomenti: più di una volta e mezza la quota (15%)");
  assert.deepEqual(applyExamBoost(exam), ["t1"]);
  assert.equal(exam.module.topics[0].importance, 3);
  // tolto l'elenco: niente più domande d'esame (gli examRefs restano ma non pesano), l'importanza torna come prima
  exam.materials = [];
  assert.equal(examQuestionStats(exam).inQuiz.length, 0);
  applyExamBoost(exam);
  assert.equal(exam.module.topics[0].importance, 2);
  assert.equal(allExamQuestions(exam).length, 0);
});

test("quiz: a parità di stato prima le domande chieste più spesso", () => {
  const qs = [{ id: "a", topicId: "t1" }, { id: "b", topicId: "t1" }, { id: "c", topicId: "t1" }];
  const w = { a: 1, b: 5, c: 3 };
  assert.deepEqual(pickQuestions(qs, {}, 3, { blocked: true, rng: () => 0, bonus: (q) => (w[q.id] - 1) * 0.1 }).map((q) => q.id), ["b", "c", "a"]);
  assert.deepEqual(pickQuestions(qs, { a: { n: 1, recent: [0] } }, 3, { blocked: true, rng: () => 0, bonus: (q) => (w[q.id] - 1) * 0.1 }).map((q) => q.id), ["a", "b", "c"], "gli errori restano i primi");
});

test("prompt: regola sulle domande d'esame, compito aggiuntivo, capitolo della dispensa", () => {
  assert.match(practiceTasks(["domande"]), /una question per OGNI domanda distinta/);
  assert.equal(practiceTasks(["appunti"]), "");
  const p = chapterPrompt({ exam: { name: "Micro", type: "orale", level: 2, daysLeft: 9 }, topic: { title: "Elasticità", importance: 3 }, outline: [], examQuestions: ["Cos'è l'elasticità?"] });
  assert.match(p, /### Domande uscite all'esame[^\n]*\n- Cos'è l'elasticità\?/);
  assert.ok(!/Domande uscite/.test(chapterPrompt({ exam: { name: "Micro", type: "orale", level: 2, daysLeft: 9 }, topic: { title: "E", importance: 2 }, outline: [] })));
});
