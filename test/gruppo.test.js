import { test } from "node:test";
import assert from "node:assert/strict";
import { questionsOf } from "../public/js/exam-questions.js";
import { exportExam, groupQuestions, importExam } from "../public/js/share.js";

const exam = {
  id: "e1", name: "Microeconomia", date: "2026-11-05", type: "misto", level: 4, hoursPerDay: 5, moduleBuiltAt: "B",
  srs: { c1: { due: "2026-10-06" } }, qstats: { q1: { recent: [1] } }, learned: { t1: true }, done: { x: true }, plan: { days: [] }, simulations: [{ id: "s" }], ricevimento: { answers: { a: "b" } },
  materials: [
    { id: "m1", kind: "notes", role: "appunti", title: "Lezione 1", text: "La domanda è decrescente." },
    { id: "m2", kind: "pdf", role: "libro", title: "Manuale", fileId: "f1" },
    { id: "m3", kind: "notes", role: "dispense", title: "Dispense (da PDF)", text: "Capitolo 1…", fromPdf: true, pdfFileId: "p1" },
    { id: "m4", kind: "notes", role: "appunti", handwritten: true, title: "Appunti a mano", text: "foto trascritta", imageIds: ["i1"] },
  ],
  books: [{ id: "b1", title: "Mankiw", toc: [], materialId: null }, { id: "b2", kind: "dispense", title: "Dispense", materialId: "m3", toc: [] }],
  module: { topics: [{ id: "t1", title: "Domanda", importance: 3 }, { id: "t2", title: "Elasticità", importance: 2 }], flashcards: [{ id: "c1", topicId: "t1" }], questions: [] },
};

test("condividere un esame: il modulo e i materiali di testo, senza progressi né file del browser", () => {
  const out = JSON.parse(exportExam(exam));
  assert.equal(out.app, "studify-esame");
  for (const k of ["id", "srs", "qstats", "learned", "done", "plan", "simulations", "ricevimento"]) assert.equal(k in out.exam, false, k);
  assert.deepEqual(out.exam.materials.map((m) => m.id), ["m1", "m3", "m4"], "il PDF salvato nel browser non parte");
  assert.ok(out.exam.materials.every((m) => !m.fileId && !m.pdfFileId && !m.imageIds));
  assert.equal(out.exam.module.flashcards.length, 1);
  const bare = JSON.parse(exportExam(exam, { materials: false }));
  assert.deepEqual([bare.exam.materials, bare.exam.books.map((b) => b.id)], [[], ["b1"]], "senza materiali: niente dispense tra i libri");
  assert.equal(exam.srs.c1.due, "2026-10-06", "l'esame di chi condivide non cambia");
});

test("importare l'esame di un compagno: un esame nuovo, progressi a zero, nome distinto se c'è già", () => {
  const f = importExam(exportExam(exam), ["Microeconomia", "Microeconomia (dal gruppo)"]);
  assert.equal(f.name, "Microeconomia (dal gruppo 2)");
  assert.deepEqual([f.srs, f.qstats, f.learned, f.plan, "id" in f], [{}, {}, {}, null, false]);
  assert.equal(f.module.topics.length, 2);
  assert.equal(importExam(exportExam(exam), []).name, "Microeconomia");
  assert.throws(() => importExam(JSON.stringify({ app: "studify", state: { exams: [] } })), /backup completo/);
  assert.throws(() => importExam("non json"), /non è un esame di Studify/);
});

test("interrogarsi a turno: prima le domande d'esame vere, poi le aperte degli argomenti importanti, non tutte dallo stesso", () => {
  const list = { id: "dq", kind: "notes", role: "domande", title: "Domande orale", text: "- Che cos'è l'elasticità?\n- Che cos'è l'elasticità?\n- Definisci il monopolio" };
  const key = questionsOf(list).find((q) => /elasticit/.test(q.text)).key;
  const e = { ...exam, srs: {}, qstats: {}, learned: {}, materials: [list], module: { ...exam.module, questions: [
    { id: "a", topicId: "t1", kind: "open", prompt: "Che cos'è la domanda?", modelAnswer: "…", rubric: ["x"] },
    { id: "b", topicId: "t1", kind: "open", prompt: "Perché è decrescente?", modelAnswer: "…", rubric: [] },
    { id: "c", topicId: "t1", kind: "open", prompt: "Spostamenti e movimenti lungo la curva", modelAnswer: "…", rubric: [] },
    { id: "d", topicId: "t2", kind: "open", prompt: "Che cos'è l'elasticità?", modelAnswer: "…", rubric: [], examRefs: [key] },
    { id: "e", topicId: "t2", kind: "mcq", prompt: "Scelta multipla", options: ["a", "b"], correctIndex: 0 },
  ] } };
  const ids = groupQuestions(e, 4).map((q) => q.id);
  assert.equal(ids.length, 4);
  assert.equal(ids[0], "d", "la domanda d'esame vera per prima, anche se l'argomento è meno importante");
  assert.ok(!ids.includes("e"), "niente scelta multipla: si risponde a voce");
  assert.equal(groupQuestions(e, 3).filter((q) => q.topicId === "t1").length, 2, "al più 2 per argomento nel primo giro");
});
