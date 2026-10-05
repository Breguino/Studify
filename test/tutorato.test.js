import { test } from "node:test";
import assert from "node:assert/strict";
import { guessRole, isTutorFile } from "../public/js/material-roles.js";
import { methodByTutor, saidByTutor } from "../public/js/provenance.js";
import { buildPlan } from "../public/js/planner.js";
import { DISPENSA_SYSTEM, MODULE_PRINCIPLES, materialText, pdfTitle } from "../shared/prompts.js";

test("tutorato: tipo dal nome, ma «dal tutorato» e non «del docente»", () => {
  assert.equal(guessRole("Tutorato 3.pdf", true), "esercizi", "non le dispense del docente (il tipo di ripiego per i PDF)");
  assert.equal(guessRole("Tutorato 3 - esercizi svolti.txt"), "svolti");
  assert.equal(guessRole("Tutorato 3 - registrazione.srt"), "sbobine", "una registrazione resta una sbobina");
  assert.ok(isTutorFile("Tutorato 3.pdf") && isTutorFile("Esercizi del tutor") && !isTutorFile("Esercitazione 3"));
  assert.equal(materialText({ role: "svolti", tutor: true, title: "Tutorato 3", text: "x" }), '<esercizi_svolti titolo="Tutorato 3" autore="tutor">\nx\n</esercizi_svolti>');
  assert.equal(pdfTitle({ role: "esercizi", tutor: true, title: "Tutorato 3", pages: "" }), "Esercizi (dal tutorato) — Tutorato 3");
  assert.match(MODULE_PRINCIPLES, /autore="tutor"[\s\S]*non come parola del\s+docente[\s\S]*segui il docente e\s+scrivilo in "gaps"[\s\S]*«Tutorato:»[\s\S]*di seconda mano/);
  assert.match(DISPENSA_SYSTEM, /TUTORATO \(autore="tutor"\)[\s\S]*\[Tutorato\]/);
});

test("da dove viene: frasi sull'esame e metodi presi dai materiali del tutorato", () => {
  const exam = { materials: [
    { id: "a", role: "sbobine", tutor: true, title: "Tutorato 3", text: "[0:00]\n\nIl prof ha detto che all'esame lo chiede sempre, il punto di chiusura." },
    { id: "b", role: "sbobine", title: "Lezione 5", text: "Questo all'esame lo chiedo sempre: l'elasticità." },
    { id: "c", role: "svolti", tutor: true, title: "Tutorato 3 svolti", text: "Esercizio 1\nUn'impresa ha costo totale CT = 100 + 4q + q^2. Trovare il costo marginale e il costo medio quando q = 10.\nIl costo marginale è la derivata del costo totale." },
  ] };
  assert.equal(saidByTutor(exam, "Il prof ha detto che all'esame lo chiede sempre, il punto di chiusura.")?.id, "a");
  assert.equal(saidByTutor(exam, "Questo all'esame lo chiedo sempre: l'elasticità."), null, "detta a lezione: è del docente");
  assert.equal(methodByTutor(exam, { problem: "Un'impresa ha costo totale $CT = 100 + 4q + q^2$. Trovare il costo marginale e il costo medio quando $q = 10$.", solution: "" })?.id, "c");
  assert.equal(methodByTutor(exam, { problem: "Per il monopolista la curva inversa è P = 50 - Q e il costo marginale MC = 10: trovare quantità e prezzo.", solution: "" }), null);
  const plan = buildPlan({ examDate: "2026-11-05", examType: "problemi", level: 2, hoursPerDay: 3, topics: [{ id: "t4", title: "Costi", importance: 3, difficulty: 2, methods: [{ name: "Costo marginale", steps: ["a", "b"], tutor: true }] }], learned: {}, today: "2026-10-05", start: "2026-10-05" });
  assert.ok(plan.days.flatMap((d) => d.tasks).some((x) => x.title === "Esercizi guidati: Costo marginale (metodo del tutor)"));
});
