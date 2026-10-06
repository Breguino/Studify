import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFromSyllabus } from "../public/js/exam-type.js";
import { normalizeExamFormat } from "../shared/normalize.js";

test("formatFromSyllabus: regole senza AI sui casi tipici delle schede", () => {
  const cases = [
    ["Modalità di verifica dell’apprendimento: L’esame consiste in una prova scritta con esercizi numerici e domande di teoria. È prevista una prova orale facoltativa per migliorare il voto.", "problemi", "Orale facoltativo."],
    ["Modalità d’esame. L’esame si compone di una prova scritta e di una prova orale obbligatoria.", "misto", ""],
    ["Verifica dell’apprendimento: colloquio orale sugli argomenti del corso.", "orale", ""],
    ["Modalità di verifica: test a risposta multipla di 30 domande.", "test", ""],
    ["Assessment methods: Written exam with exercises; optional oral exam.", "problemi", "Orale facoltativo."],
    ["Obiettivi: discutere le problematiche del diritto. Modalità di verifica: prova scritta con domande aperte.", "scritto", ""],
  ];
  for (const [text, format, details] of cases) {
    const r = formatFromSyllabus(text);
    assert.equal(r.format, format, text);
    assert.equal(r.details, details, text);
    assert.ok(r.found && r.local && text.replace(/\s+/g, " ").includes(r.evidence), "la citazione è una frase del testo");
  }
  const none = formatFromSyllabus("Il corso tratta i mercati finanziari e la loro regolazione.");
  assert.deepEqual([none.found, none.format, none.evidence], [false, "sconosciuto", ""]);
  assert.equal(formatFromSyllabus("Modalità di verifica: orale facoltativo.").found, false, "solo un orale facoltativo non dice il tipo di prova");
});

test("normalizeExamFormat dal testo incollato: la citazione deve comparire nel testo", () => {
  const text = "Modalità di verifica dell'apprendimento\nL'esame consiste in una prova   scritta con esercizi (2 ore).\nhttps://unibs.it/syllabus/x";
  const ok = normalizeExamFormat({ found: true, format: "problemi", evidence: "L’esame consiste in una prova scritta con esercizi (2 ore).", url: "https://unibs.it/syllabus/x" }, { sourceText: text });
  assert.deepEqual([ok.found, ok.format, ok.url], [true, "problemi", "https://unibs.it/syllabus/x"], "apostrofi e spazi diversi non contano; URL presente nel testo");
  const made = normalizeExamFormat({ found: true, format: "orale", evidence: "L'esame è solo orale.", url: "https://inventato.it" }, { sourceText: text });
  assert.deepEqual([made.found, made.format, made.evidence, made.url], [false, "sconosciuto", "", ""], "citazione inventata → scartata");
  assert.equal(normalizeExamFormat({ found: true, format: "scritto", evidence: "" }, { sourceText: text }).found, false);
  // ricerca web: serve l'URL visto
  assert.equal(normalizeExamFormat({ found: true, format: "scritto", evidence: "x", url: "https://a.it" }, { seenUrls: new Set(["https://a.it"]) }).found, true);
  assert.equal(normalizeExamFormat({ found: true, format: "scritto", evidence: "x", url: "https://b.it" }, { seenUrls: new Set(["https://a.it"]) }).found, false);
});
