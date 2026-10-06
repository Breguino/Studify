import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModule, setClient } from "../server/ai.js";
import { guessRole, isPractice, ROLES } from "../public/js/material-roles.js";
import { DISPENSA_SYSTEM, MODULE_PRINCIPLES, materialText, pdfTitle } from "../shared/prompts.js";

const stream = (msg) => ({ on() {}, finalMessage: async () => msg });
const fake = (responses, calls) => ({ messages: { stream(params) { calls.push(params); return stream(responses.shift()); }, async create(params) { calls.push(params); return responses.shift(); } } });

test("tipo «Appunti di colleghi»: dal nome del file, senza rubare domande d'esame ed esercizi", () => {
  assert.equal(ROLES.colleghi, "Appunti di colleghi");
  for (const n of ["Appunti colleghi lezione 3.pdf", "Appunti di un compagno.docx", "appunti_compagna_2023.pdf", "Appunti amico micro.txt"]) assert.equal(guessRole(n, n.endsWith(".pdf")), "colleghi", n);
  assert.equal(guessRole("Domande d'esame dei colleghi.txt"), "domande");
  assert.equal(guessRole("Esercizi dei colleghi.pdf", true), "esercizi");
  assert.equal(guessRole("Appunti Microeconomia.txt"), "appunti", "senza indizi restano i tuoi appunti");
  assert.equal(guessRole("Teoria delle compagnie assicurative.pdf", true), "dispense", "«compagnie» non è un compagno");
  assert.ok(!isPractice({ role: "colleghi" }), "la modalità base ne ricava argomenti e carte come dagli appunti");
});

test("regole per l'AI: di seconda mano, controllati su dispense e libro, l'anno conta", () => {
  assert.match(MODULE_PRINCIPLES, /appunti di colleghi \(tag appunti_colleghi\)[\s\S]*di seconda mano[\s\S]*se contrastano\s+valgono quelli, e segnalalo in "gaps"[\s\S]*solo negli appunti di un collega[\s\S]*attributo anno/);
  assert.match(DISPENSA_SYSTEM, /APPUNTI DI COLLEGHI: sono di seconda mano[\s\S]*\[Appunti di un collega\]/);
  assert.equal(materialText({ role: "colleghi", title: "Appunti di Marco", unit: "lezioni", pages: "2-4", year: "2023-24", text: "x" }), '<appunti_colleghi titolo="Appunti di Marco" lezioni="2-4" anno="2023-24">\nx\n</appunti_colleghi>');
  assert.equal(pdfTitle({ role: "colleghi", title: "Appunti di Marco", pages: "1-10", year: "2023-24" }), "Appunti di colleghi — Appunti di Marco (pagine 1-10) (anno 2023-24)");
  assert.equal(pdfTitle({ role: "libro", title: "Manuale", pages: "" }), "Libro — Manuale");
});

test("server: gli appunti di colleghi arrivano a Claude con il loro tag; in PDF con l'anno nel titolo", async () => {
  const calls = [];
  const raw = { title: "T", overview: "O", topics: [{ id: "a", title: "A", importance: 2, difficulty: 2, summary: "s", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", sourceIds: [], methods: [] }], flashcards: [], questions: [], gaps: [], examHints: [] };
  setClient(fake([{ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(raw) }] }], calls));
  await buildModule({
    exam: { name: "Micro", type: "orale", level: 2, daysLeft: 20, language: "italiano" },
    materials: [{ kind: "pdf", role: "colleghi", title: "Appunti di Giulia", pages: "", year: "2023-24", data: "QUJD" }, { kind: "notes", role: "colleghi", title: "Appunti di Marco", year: "2024-25", text: "La domanda è decrescente." }],
    research: null,
  });
  const content = calls[0].messages[0].content;
  assert.equal(content[0].title, "Appunti di colleghi — Appunti di Giulia (anno 2023-24)");
  assert.match(content.at(-1).text, /<appunti_colleghi titolo="Appunti di Marco" anno="2024-25">\nLa domanda è decrescente\./);
  assert.match(calls[0].system, /appunti di colleghi \(tag appunti_colleghi\)/);
});
