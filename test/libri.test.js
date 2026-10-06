import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterPages, demoBooks, demoChapterLinks, findOffset, parseProgram, parseToc, programChapters, programPdfRange, readingByTopic, readingLabel, readingMinutes, topicReading, uncoveredChapters } from "../public/js/books.js";
import { buildPlan } from "../public/js/planner.js";
import { normalizeBooks, normalizeChapterLinks } from "../shared/normalize.js";
import { chaptersPrompt } from "../shared/prompts.js";

const INDICE = `Indice
Prefazione   xiii
Parte I Introduzione
Capitolo 1 Dieci principi dell'economia ........ 3
1.1 Come le persone prendono decisioni 4
Capitolo 2 Pensare da economista ..... 21
4 Le forze di mercato della domanda e dell'offerta 65
4.1 Il mercato e la concorrenza 66
5. L’elasticità e le sue applicazioni   89
5.2 L'elasticità dell'offerta 101
Chapter 6 Domanda, offerta e politica economica 113
Capitolo 15 Il monopolio 301`;

test("indice: capitoli con pagina e paragrafi; prefazione in romani e parti ignorate", () => {
  const toc = parseToc(INDICE);
  assert.deepEqual(toc.map((c) => [c.n, c.page]), [["1", 3], ["2", 21], ["4", 65], ["5", 89], ["6", 113], ["15", 301]]);
  assert.equal(toc[3].title, "L’elasticità e le sue applicazioni");
  assert.deepEqual(toc[3].sections, ["L'elasticità dell'offerta"]);
  assert.deepEqual(parseToc("Capitolo 1 Uno 10\nCapitolo 2 Due 300\nCapitolo 3 Tre 30"), parseToc("Capitolo 1 Uno 10\nCapitolo 2 Due 300").concat([]), "pagina fuori ordine: riga letta male, scartata");
});

test("programma, pagine dei capitoli, spostamento delle pagine nel PDF", () => {
  assert.deepEqual([...parseProgram("capp. 1-5, 7 e 9-10")], [1, 2, 3, 4, 5, 7, 9, 10]);
  assert.equal(parseProgram("").size, 0);
  const book = { toc: parseToc(INDICE), program: "1-5" };
  assert.deepEqual(programChapters(book).map((c) => c.n), ["1", "2", "4", "5"]);
  assert.deepEqual(chapterPages(book, "5"), { from: 89, to: 112 });
  assert.deepEqual(chapterPages(book, "15"), { from: 301, to: null });
  const pages = Array(420).fill("testo");
  pages[89 + 12 - 1] = "Capitolo 5\nL’elasticità e le sue applicazioni";
  pages[65 + 12 - 1] = "4\nLe forze di mercato della domanda e dell'offerta";
  assert.equal(findOffset(pages, book.toc), 12);
  assert.equal(findOffset(pages.map((p, i) => (i === 65 + 12 - 1 ? "x" : p)), book.toc), null, "un capitolo solo non basta");
  assert.deepEqual(programPdfRange({ ...book, offset: 12 }, 420), { from: 15, to: 124 }, "dal cap. 1 alla fine del cap. 5, nelle pagine del PDF");
});

const exam = () => ({
  level: 2, moduleBuiltAt: "B1",
  module: { topics: [{ id: "t1", title: "Domanda e offerta" }, { id: "t2", title: "Elasticità" }, { id: "t5", title: "Monopolio" }] },
  books: [
    { id: "b1", title: "Principi di economia", authors: "N. G. Mankiw, M. P. Taylor", main: true, own: "carta", program: "4-6", toc: parseToc(INDICE), moduleBuiltAt: "B1", links: { t1: ["4", "6"], t2: ["5", "6"] } },
    { id: "b2", title: "Microeconomia", authors: "Varian", main: false, own: "no", program: "", toc: [{ n: "1", title: "Il mercato", page: 1, sections: [] }, { n: "2", title: "Monopolio", page: 20, sections: [] }], moduleBuiltAt: "B1", links: { t5: ["2"] } },
  ],
});

test("che cosa leggere per argomento, capitoli scoperti, pagine per il piano", () => {
  const e = exam();
  assert.deepEqual(topicReading(e, "t2").map((r) => [r.book.id, r.chapter.n, r.count]), [["b1", "5", 24], ["b1", "6", 188]]);
  assert.equal(readingLabel(topicReading(e, "t2")[0]), "Taylor cap. 5, pp. 89–112".replace("Taylor", "Mankiw"));
  assert.deepEqual(uncoveredChapters(e).map((x) => `${x.book.id}:${x.chapter.n}`), ["b2:1"], "b1: 4, 5, 6 coperti; b2 (programma vuoto = tutti): il cap. 1 no");
  const r = readingByTopic(e);
  assert.deepEqual(r.get("t2"), { pages: 24 + 94, label: "Mankiw cap. 5, pp. 89–112; Mankiw cap. 6, pp. 113–300" }, "il cap. 6 è diviso tra due argomenti");
  assert.ok(!r.has("t5"), "un libro che non hai non entra nel piano");
  assert.equal(readingMinutes(24, 2), 95);
  assert.equal(readingMinutes(24, 4), 70);
  e.moduleBuiltAt = "B2";
  assert.deepEqual([topicReading(e, "t2").length, uncoveredChapters(e).length], [0, 0], "modulo rigenerato: i collegamenti non valgono più");
});

test("piano: lo studio dell'argomento comprende la lettura del capitolo", () => {
  const topics = [{ id: "t1", title: "Domanda", importance: 3, difficulty: 2 }, { id: "t2", title: "Elasticità", importance: 3, difficulty: 2, readPages: 24, readLabel: "Mankiw cap. 5, pp. 89–112" }];
  const plan = buildPlan({ examDate: "2026-11-05", examType: "problemi", level: 2, hoursPerDay: 3, topics, learned: {}, today: "2026-10-05", start: "2026-10-05" });
  const learn = plan.days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn");
  const [a, b] = ["t1", "t2"].map((id) => learn.find((t) => t.topicId === id));
  assert.equal(b.title, "Studia: Elasticità (leggi Mankiw cap. 5, pp. 89–112)");
  assert.equal(b.minutes - a.minutes, 95, "24 pagine da studiare a livello 2: ~95 minuti in più");
});

test("normalizzazione: libri solo se il titolo è nella scheda, capitoli e argomenti esistenti", () => {
  const text = "Testi di riferimento: N. G. Mankiw, M. P. Taylor, Principi di economia, Zanichelli, 2023 (capp. 1-10).";
  const b = normalizeBooks({ books: [{ title: "Principi di economia", authors: "Mankiw, Taylor", edition: "2023", publisher: "Zanichelli", chapters: "1-10", main: false, quote: "" }, { title: "Libro inventato", authors: "", edition: "", publisher: "", chapters: "", main: true, quote: "" }] }, { sourceText: text });
  assert.deepEqual(b.books.map((x) => [x.title, x.program, x.main]), [["Principi di economia", "1-10", true]], "il primo diventa principale se nessuno lo è");
  const l = normalizeChapterLinks({ links: [{ topicId: "t2", chapterIds: ["L1-5", "L1-5", "L9-9"] }, { topicId: "t9", chapterIds: ["L1-4"] }] }, { chapterIds: ["L1-4", "L1-5"], topicIds: ["t1", "t2"] });
  assert.deepEqual([...l], [["t2", ["L1-5"]]]);
  assert.match(chaptersPrompt({ exam: { name: "M", type: "scritto", level: 2, daysLeft: 9 }, topics: [{ id: "t2", title: "Elasticità" }], chapters: [{ id: "L1-5", title: "L'elasticità", sections: ["Domanda", "Offerta"] }] }), /t2: Elasticità[\s\S]*L1-5: L'elasticità — paragrafi: Domanda; Offerta/);
  assert.deepEqual(demoBooks("- N. G. Mankiw, Principi di economia, Zanichelli, 2023, capp. 1-10 (testo principale)").map((x) => [x.title, x.chapters, x.main]), [["Principi di economia", "1-10", true]]);
  assert.deepEqual(demoChapterLinks([{ id: "L1-5", title: "L'elasticità e le sue applicazioni" }], [{ id: "t2", title: "Elasticità" }]), [{ topicId: "t2", chapterIds: ["L1-5"] }]);
});
