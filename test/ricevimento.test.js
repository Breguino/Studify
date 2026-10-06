import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guessRole } from "../public/js/material-roles.js";
import { questionsToAsk, ricevimentoText } from "../public/js/ricevimento.js";
import { MODULE_PRINCIPLES, materialText } from "../shared/prompts.js";

const QUIZ = readFileSync(new URL("./fixtures/Quiz Moodle Microeconomia.txt", import.meta.url), "utf8");

test("domande per il ricevimento: dai dubbi che l'app ha già trovato, le più utili prima", () => {
  const exam = {
    moduleBuiltAt: "B",
    module: {
      topics: [{ id: "t1", title: "Domanda", importance: 3 }, { id: "t2", title: "Elasticità", importance: 3 }],
      flashcards: [], questions: [{ id: "q1", topicId: "t2" }, { id: "q2", topicId: "t2" }, { id: "q3", topicId: "t2" }],
      gaps: [
        "Le dispense definiscono l'elasticità con il segno, il libro in valore assoluto: chiedi al docente.",
        "Soluzione ufficiale da controllare — Esercitazione 3 · es. 2: il prezzo dovrebbe essere 30, non 35.",
        "Il monopolio naturale è solo sulle slide: studialo sul libro.",
        "Manca la teoria dei giochi (attesa per un corso di microeconomia).",
      ],
    },
    qstats: { q1: { recent: [0, 0] }, q2: { recent: [1, 0] }, q3: { recent: [0] } },
    srs: {}, learned: {},
    books: [{ id: "b", title: "Principi di economia", main: true, moduleBuiltAt: "B", toc: [{ n: "1", title: "Dieci principi", page: 3 }, { n: "5", title: "L'elasticità", page: 89 }], links: { t2: ["5"] } }],
    materials: [{ id: "m", kind: "notes", role: "quiz", title: "Quiz 1", text: QUIZ }],
  };
  const qs = questionsToAsk(exam);
  assert.deepEqual(qs.map((q) => [q.kind, q.on]), [["formato", true], ["contrasto", true], ["soluzione", true], ["programma", true], ["quiz", true], ["fonte", false], ["dubbio", false]]);
  assert.match(qs[2].text, /^Esercitazione 3 · es\. 2: il prezzo dovrebbe essere 30, non 35\. — La soluzione ufficiale è giusta\?$/);
  assert.match(qs[3].text, /Principi di economia cap\. 1 «Dieci principi»/);
  assert.equal(qs[4].text, "Nel quiz «Quiz 1», la domanda 5: qual è la risposta corretta?");
  assert.match(qs[6].text, /^Su «Elasticità» sbaglio spesso/);
  assert.ok(!qs.some((q) => /teoria dei giochi/.test(q.text)), "una lacuna qualunque non è una domanda per il docente");
  exam.formatSource = { text: "Scritto con esercizi (scheda dell'insegnamento)" };
  assert.ok(!questionsToAsk(exam).some((q) => q.kind === "formato"), "se il formato viene da una fonte, non si chiede");
});

test("dopo: le risposte diventano un materiale «Ricevimento», di prima mano per l'AI", () => {
  assert.equal(ricevimentoText("12 ott 2026", [{ question: "Il cap. 1 è nel programma?", answer: "No, si parte dal 4." }, { question: "Altro?", answer: " " }]),
    "Ricevimento con il docente del 12 ott 2026\n\nDomanda: Il cap. 1 è nel programma?\nRisposta del docente: No, si parte dal 4.");
  assert.equal(guessRole("Ricevimento 12 ottobre.txt"), "appunti");
  assert.equal(materialText({ role: "appunti", ricevimento: true, title: "Ricevimento del 12 ott", text: "x" }), '<appunti_studente titolo="Ricevimento del 12 ott" ricevimento="sì">\nx\n</appunti_studente>');
  assert.match(MODULE_PRINCIPLES, /ricevimento="sì"[\s\S]*di prima mano e prevalgono[\s\S]*non riportarlo più in "gaps"[\s\S]*examHints/);
});
