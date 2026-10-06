import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLessons } from "../public/js/lessons.js";
import { findExamHints } from "../public/js/local-builder.js";
import { guessRole } from "../public/js/material-roles.js";
import { mergeModule, normalizeModule, quoteChecker } from "../shared/normalize.js";
import { materialText } from "../shared/prompts.js";

const SBOBINE = [
  "Sbobine di Statistica — a.a. 2025-26", "Indice", "",
  "LEZIONE 1 - 2 ottobre", "Allora ragazzi, oggi iniziamo con la media aritmetica.", "La media è la somma diviso n.", "",
  "Lezione 2", "Oggi la varianza. Questa formula all'esame la chiedo sempre, quindi impararla bene.", "",
  "Lezione del 9/10/2025", "Il boxplot non lo chiedo, ma serve per capire.", "",
].join("\n");

test("sbobine: divise per lezione, l'intestazione del documento va con la prima", () => {
  const r = splitLessons(SBOBINE);
  assert.deepEqual(r.sections, ["LEZIONE 1 - 2 ottobre", "Lezione 2", "Lezione del 9/10/2025"]);
  const parts = r.text.split("\f");
  assert.equal(parts.length, 3);
  assert.match(parts[0], /^Sbobine di Statistica[\s\S]*media aritmetica/);
  assert.match(parts[1], /^Lezione 2\nOggi la varianza/);
  assert.equal(splitLessons("Solo una Lezione 1\nnient'altro"), null, "con una sola lezione non si divide");
  assert.equal(splitLessons("a\fb"), null, "già diviso in pagine");
  assert.equal(splitLessons("Lezione 1\ntesto\nIl 12 ottobre il prof ha detto che la lezione 2 salta\nancora"), null, "una data dentro una frase non è un'intestazione");
});

test("indicazioni sull'esame con le regole (modalità base): frasi copiate, con la fonte", () => {
  const h = findExamHints(SBOBINE, "Sbobine · Lezione 2");
  assert.deepEqual(h.map((x) => x.quote), ["Questa formula all'esame la chiedo sempre, quindi impararla bene.", "Il boxplot non lo chiedo, ma serve per capire."]);
  assert.equal(h[0].source, "Sbobine · Lezione 2");
  assert.deepEqual(findExamHints("La media è la somma diviso n."), []);
});

test("citazioni del docente: vere tenute, inventate scartate, da PDF non verificate, argomento collegato", () => {
  const raw = {
    topics: [{ id: "a", title: "Media" }, { id: "b", title: "Varianza" }],
    flashcards: [], questions: [],
    examHints: [
      { quote: "Questa formula all’esame la chiedo   sempre", source: "Lez. 2", note: "Studiare la varianza.", topicId: "b" },
      { quote: "Il docente non chiede mai le formule.", source: "?", note: "", topicId: "" },
      { quote: "Questa formula all'esame la chiedo sempre", source: "doppione", note: "", topicId: "b" },
      { quote: "corta", source: "", note: "", topicId: "" },
    ],
  };
  const m = normalizeModule(raw, [], { checkQuote: quoteChecker(SBOBINE) });
  assert.equal(m.examHints.length, 1, "inventata, doppione e troppo corta scartate");
  assert.deepEqual([m.examHints[0].topicId, m.examHints[0].verified, m.examHints[0].source], ["t2", true, "Lez. 2"]);
  const withPdf = normalizeModule(raw, [], { checkQuote: quoteChecker(SBOBINE, { hasPdf: true }) });
  assert.deepEqual(withPdf.examHints.map((x) => x.verified), [true, false], "con PDF: quella non trovata resta ma è segnata non verificata");
  const { module, added } = mergeModule(m, { topics: [], flashcards: [], questions: [], examHints: [
    { quote: "Questa formula all'esame la chiedo sempre", source: "Lez. 2", note: "", topicId: "t2" },
    { quote: "Il boxplot non lo chiedo, ma serve per capire.", source: "Lez. 3", note: "", topicId: "" },
  ] }, [], { checkQuote: quoteChecker(SBOBINE) });
  assert.equal(added.hints, 1, "già presente non ripetuta");
  assert.equal(module.examHints.length, 2);
});

test("tipo sbobine dal nome del file e nel prompt (lezioni, anno)", () => {
  assert.equal(guessRole("Sbobine Statistica 2024.docx"), "sbobine");
  assert.equal(guessRole("sbobina_esame_lez3.pdf", true), "sbobine", "«esame» nel nome non la rende un eserciziario");
  assert.equal(guessRole("Trascrizione lezione 5.docx"), "sbobine");
  assert.equal(materialText({ role: "sbobine", title: "Sbobine", unit: "lezioni", pages: "2-3", year: "2024-25", text: "x" }), `<sbobina titolo="Sbobine" lezioni="2-3" anno="2024-25">\nx\n</sbobina>`);
});
