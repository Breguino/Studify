import { test } from "node:test";
import assert from "node:assert/strict";
import { guessRole } from "../public/js/material-roles.js";
import { isPaperHeading, paperStartsOf, splitPapers } from "../public/js/lessons.js";
import { MIN_PAPERS, allPapers, applyExamBoost, demoAnalysis, demoGrade, fmtGrade, itemsOfText, nextPaper, paperMinutes, paperText, paperYear, papersOf, parseStarts, preparePapers, simScore, topicFrequency, unanalyzed } from "../public/js/past-exams.js";
import { materialText } from "../shared/prompts.js";
import { normalizeExamGrade, normalizePastExams } from "../shared/normalize.js";

const TEMI = `Microeconomia — temi d'esame

Appello del 12/01/2024
Durata: 2 ore
1. Data la domanda Q = 100 - 2P, calcola l'elasticità in P = 20 (10 punti)
2. Spiega il surplus del consumatore (10 punti)

Appello del 9/02/2024
1. Calcola l'elasticità incrociata (12 punti)

Esame del 14 giugno 2023
1. Monopolio: prezzo e quantità di equilibrio
2. Elasticità e ricavo totale`;

test("tipo dal nome del file: le prove d'esame vere sono «esami», gli eserciziari restano «esercizi»", () => {
  for (const n of ["Temi d'esame 2024.pdf", "tema_d'esame_gennaio.docx", "Appello 12-01-2024.pdf", "Compito A.pdf", "Prove scritte Micro.pdf", "Esame 2023.pdf", "past exams.pdf", "esoneri 2022.pdf"])
    assert.equal(guessRole(n, true), "esami", n);
  assert.equal(guessRole("Esercizi per l'esame.pdf", true), "esercizi");
  assert.equal(guessRole("Esercitazione 3 soluzioni.pdf", true), "esercizi");
  assert.equal(guessRole("sbobina_esame_lez3.pdf", true), "sbobine");
});

test("titoli delle prove: appelli e date sì, righe dentro la prova no", () => {
  for (const l of ["Appello del 12/01/2024", "ESAME 12/01/2024", "Prova scritta del 3 febbraio 2023", "Compito B", "Tema d’esame 3", "2° appello", "Primo appello – gennaio 2024", "# Esame di Statistica - 20.06.2022"])
    assert.ok(isPaperHeading(l), l);
  for (const l of ["Esercizio 1 (appello 2022)", "Compito: calcolare l'elasticità nel punto A", "Esame: durata 2 ore", "Prova scritta: tempo a disposizione 2 ore", "Soluzioni dell'appello del 12/01/2024"])
    assert.ok(!isPaperHeading(l), l);
});

test("un file con più appelli si divide in prove (testo) o se ne trovano gli inizi (pagine)", () => {
  const r = splitPapers(TEMI);
  assert.deepEqual(r.sections, ["Appello del 12/01/2024", "Appello del 9/02/2024", "Esame del 14 giugno 2023"]);
  assert.match(r.text.split("\f")[0], /^Microeconomia — temi d'esame[\s\S]*surplus del consumatore \(10 punti\)$/, "il titolo del file va con la prima prova");
  assert.equal(splitPapers("Appello del 12/01/2024\n1. Calcola"), null, "una prova sola: niente divisione");

  const s = paperStartsOf(["Raccolta di temi d'esame", "Esame del 12/01/2024\nEsercizio 1", "segue esercizio 2", "Appello del 2/2/2024\nEs 1"]);
  assert.deepEqual(s, { starts: [1, 4], labels: ["Esame del 12/01/2024", "Appello del 2/2/2024"] }, "la copertina va con la prima prova");
  assert.equal(paperStartsOf(["Esame del 12/01/2024", "testo"]), null);
});

test("prove di un materiale: divise, per pagine indicate, intero; chiavi stabili", () => {
  const m = preparePapers({ id: "m1", kind: "notes", role: "esami", title: "Temi", text: TEMI });
  assert.equal(m.unit, "prove");
  assert.equal(m.numPages, 3);
  const ps = papersOf(m);
  assert.deepEqual(ps.map((p) => [p.key, p.label]), [["m1:1", "Appello del 12/01/2024"], ["m1:2", "Appello del 9/02/2024"], ["m1:3", "Esame del 14 giugno 2023"]]);
  assert.match(paperText(m, ps[1]), /^Appello del 9\/02\/2024\n1\. Calcola l'elasticità incrociata/);
  m.pages = "2-3";
  assert.deepEqual(papersOf(m).map((p) => p.key), ["m1:2", "m1:3"], "scelta delle prove: le chiavi non cambiano");

  // PDF di 10 pagine con 3 prove
  const pdf = { id: "m2", kind: "pdf", role: "esami", title: "Temi 2019-2022", numPages: 10, paperStarts: parseStarts("1, 4, 8", 10) };
  assert.deepEqual(papersOf(pdf).map((p) => [p.from, p.to, p.label]), [[1, 3, "Temi 2019-2022 · pagine 1–3"], [4, 7, "Temi 2019-2022 · pagine 4–7"], [8, 10, "Temi 2019-2022 · pagine 8–10"]]);
  assert.deepEqual(parseStarts("4; 8", 10), [1, 4, 8], "la prima prova parte sempre da 1");
  assert.equal(parseStarts("1", 10), null);
  assert.deepEqual(parseStarts("1, 4, 40", 10), [1, 4], "pagine oltre la fine ignorate");

  // senza divisione: il materiale intero è una prova
  assert.deepEqual(papersOf({ id: "m3", kind: "notes", role: "esami", title: "Compito A", text: "1. Calcola" }).map((p) => [p.key, p.label]), [["m3:1", "Compito A"]]);
  assert.deepEqual(papersOf({ id: "m4", kind: "notes", role: "esercizi", title: "x", text: "y" }), [], "solo i materiali «esami»");

  // testo prima diviso per lezioni (sbobine) e poi segnato come esami: torna testo e si divide per prove
  const l = preparePapers({ id: "m5", kind: "notes", role: "esami", title: "T", text: TEMI.split("\n\n").join("\f"), numPages: 4, unit: "lezioni", sections: ["a", "b", "c", "d"] });
  assert.equal(l.unit, "prove");
  assert.equal(l.numPages, 3);
});

test("materialText: tag dei temi d'esame con le prove scelte", () => {
  assert.equal(materialText({ role: "esami", title: "Temi", unit: "prove", pages: "1-2", text: "x" }), '<temi_esame titolo="Temi" prove="1-2">\nx\n</temi_esame>');
});

test("anno, prova consigliata (la più vecchia non fatta), durata", () => {
  assert.equal(paperYear("Appello del 12/01/2024"), 2024);
  assert.equal(paperYear("Esame 3.2.23"), 2023);
  assert.equal(paperYear("Compito A"), null);
  const m = preparePapers({ id: "m1", kind: "notes", role: "esami", title: "Temi", text: TEMI });
  const exam = { type: "problemi", materials: [m], simulations: [] };
  assert.equal(nextPaper(exam).label, "Esame del 14 giugno 2023", "le più recenti si tengono per gli ultimi giorni");
  exam.simulations.push({ paperKey: "m1:3" });
  assert.equal(nextPaper(exam).label, "Appello del 12/01/2024");
  assert.equal(paperMinutes(exam, "m1:1"), 120, "senza analisi: durata tipica del tipo d'esame");
  exam.pastExams = { papers: { "m1:1": { durationMin: 150 }, "m1:2": { durationMin: 0 } } };
  assert.equal(paperMinutes(exam, "m1:1"), 150);
  assert.equal(paperMinutes(exam, "m1:2"), 150, "la durata delle altre prove");
});

test("frequenza degli argomenti nelle prove e argomenti che diventano centrali (e tornano come prima)", () => {
  const m = preparePapers({ id: "m1", kind: "notes", role: "esami", title: "Temi", text: TEMI });
  const topics = [{ id: "t1", title: "Domanda", importance: 2 }, { id: "t2", title: "Elasticità", importance: 2 }, { id: "t3", title: "Surplus", importance: 1 }, { id: "t4", title: "Monopolio", importance: 2 }];
  const it = (...ids) => ({ n: "1", summary: "x", topicIds: ids, kind: "esercizio", points: 0 });
  const exam = { moduleBuiltAt: "B1", module: { topics }, materials: [m], pastExams: { moduleBuiltAt: "B1", papers: {
    "m1:1": { items: [it("t2"), it("t3")] }, "m1:2": { items: [it("t2"), it("t2")] }, "m1:3": { items: [it("t4", "t2")] } } } };
  const { n, freq } = topicFrequency(exam);
  assert.equal(n, 3);
  assert.deepEqual(Object.fromEntries(freq), { t2: 3, t3: 1, t4: 1 }, "un argomento conta una volta per prova");
  assert.equal(MIN_PAPERS, 3);
  assert.deepEqual(applyExamBoost(exam), ["t2"]);
  assert.deepEqual(topics.map((t) => t.importance), [2, 3, 1, 2], "mai uscito (t1) non si abbassa");
  assert.deepEqual(unanalyzed(exam), []);

  // una prova tolta dai materiali: n=2 < MIN_PAPERS → t2 torna come prima
  m.pages = "1-2";
  applyExamBoost(exam);
  assert.equal(topics[1].importance, 2);
  assert.equal(topics[1].boost, undefined);
  // modulo rigenerato: l'analisi non vale più
  m.pages = null;
  exam.moduleBuiltAt = "B2";
  assert.equal(topicFrequency(exam).n, 0);
  assert.equal(unanalyzed(exam).length, 3);
  assert.equal(allPapers(exam).length, 3);
});

test("punti e voto della simulazione", () => {
  const s = simScore([{ maxPoints: 10, points: 8 }, { maxPoints: 20, points: 25 }, { maxPoints: 0, points: 3 }]);
  assert.deepEqual(s, { points: 28, max: 30, grade: 28 }, "punti oltre il massimo non contano");
  assert.equal(simScore([{ maxPoints: 32, points: 17.5 }]).grade, 16.4);
  assert.equal(fmtGrade(16.4), "16,4/30");
  assert.equal(fmtGrade(null), "—");
});

test("normalizzazione: analisi e correzione con valori fuori range", () => {
  const a = normalizePastExams({ papers: [{ id: "P1", label: "A", year: "2024", durationMin: 9999, hasSolutions: 1, items: [{ n: "", summary: "s", topicIds: ["t1", "t1", "x"], kind: "boh", points: -3 }, { summary: "" }] }] }, { paperIds: ["P1"], topicIds: ["t1"] });
  assert.deepEqual(a.papers.P1, { label: "A", year: "2024", durationMin: 600, hasSolutions: true, items: [{ n: "1", summary: "s", topicIds: ["t1"], kind: "altro", points: 0 }] });
  assert.deepEqual([a.structure, a.recurring, a.uncovered, a.caveats], ["", [], [], []]);
  const g = normalizeExamGrade({ items: [{ n: "1", task: "t", maxPoints: 10, points: 10, verdict: "?", feedback: "", topicId: "t1" }, { n: "2", maxPoints: 5, points: 2 }] }, { topicIds: ["t1"] });
  assert.deepEqual(g.items.map((i) => [i.verdict, i.points, i.topicId]), [["corretto", 10, "t1"], ["parziale", 2, ""]]);
});

test("modalità demo: esercizi dalla numerazione, correzione per riferimenti", () => {
  assert.deepEqual(itemsOfText("Appello\n1. Calcola (10 punti)\nEsercizio 2 — Spiega il surplus\n2024"), [{ n: "1", text: "Calcola (10 punti)", points: 10 }, { n: "2", text: "Spiega il surplus", points: 0 }]);
  const an = demoAnalysis([{ id: "P1", label: "Appello del 12/01/2024", text: "Durata: 2 ore\n1. Calcola l'elasticità\n2. Spiega il surplus" }], [{ id: "t2", title: "Elasticità della domanda" }, { id: "t3", title: "Surplus del consumatore" }]);
  assert.equal(an.papers[0].durationMin, 120);
  assert.deepEqual(an.papers[0].items.map((i) => [i.topicIds, i.kind]), [[["t2"]], [["t3"], "teoria"]].map(([t, k]) => [t, k ?? "esercizio"]));
  const g = demoGrade("1. Calcola (10 punti)\n2. Spiega (20 punti)", "1. ε = 0,5");
  assert.deepEqual(g.items.map((i) => [i.maxPoints, i.points, i.verdict]), [[10, 7, "parziale"], [20, 0, "non svolto"]]);
});
