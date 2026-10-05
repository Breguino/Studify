import { test } from "node:test";
import assert from "node:assert/strict";
import { readingByTopic, readingLabel, sentChapters, topicReading, uncoveredChapters } from "../public/js/books.js";
import { dispenseToc, looksLikeSlides } from "../public/js/dispense.js";
import { guessRole, ROLES } from "../public/js/material-roles.js";
import { DISPENSA_SYSTEM, MODULE_PRINCIPLES, materialText } from "../shared/prompts.js";

const prose = (n) => Array.from({ length: n }, (_, i) => `parola${i % 7 === 0 ? "." : ""}`).join(" ").replace(/parola/g, "domanda");

test("slide o dispense: poche parole per pagina sono slide (anche se il file si chiama «Lezione 4»)", () => {
  const slides = ["Lezione 4 Il monopolio", "Un solo venditore\n• barriere all'entrata\n• prezzo maggiore del costo marginale", "MR = MC\n• il monopolista sceglie Q", "Perdita secca\n• confronto con la concorrenza",
    "Discriminazione di prezzo\n• primo grado", "Monopolio naturale\n• costi fissi alti", "Regolamentazione\n• prezzo uguale al costo medio", "Riepilogo\n• domande?"];
  assert.ok(looksLikeSlides(slides));
  assert.ok(!looksLikeSlides([prose(350), prose(420), prose(380), prose(300), prose(350), prose(420), prose(380), prose(300)]), "pagine di testo per esteso");
  assert.ok(!looksLikeSlides(Array(10).fill("")), "una scansione non è fatta di slide");
  assert.ok(!looksLikeSlides(slides.slice(0, 5)), "un formulario di poche pagine non è una lezione");
  assert.equal(ROLES.dispense, "Dispense del docente");
  assert.equal(guessRole("Lezione 4.pdf", true), "dispense", "dal nome: dispense (poi si guardano le pagine)");
  assert.equal(guessRole("Riassunto micro.pdf", true), "appunti", "un riassunto è di uno studente");
  assert.equal(guessRole("Schemi di microeconomia.pdf", true), "appunti");
  assert.equal(guessRole("Schema di Bernoulli.pdf", true), "dispense", "«schema» nel titolo di un argomento");
  assert.equal(guessRole("Dispense Microeconomia.pdf", true), "dispense");
});

const INDEX = ["Dispense di Microeconomia\nProf. Rossi", "Indice\n1 Domanda e offerta 3\n1.1 La curva di domanda 3\n2 L'elasticità 5\n3 Il monopolio 7\n4 Le esternalità 9",
  `Capitolo 1\nDomanda e offerta\n${prose(300)}`, prose(300), `Capitolo 2\nL'elasticità\n${prose(300)}`, prose(300), `Capitolo 3\nIl monopolio\n${prose(300)}`, prose(300), `Capitolo 4\nLe esternalità\n${prose(300)}`, prose(300)];

test("indice delle dispense dalla pagina «Indice»: capitoli, paragrafi, pagine stampate e spostamento nel PDF", () => {
  const r = dispenseToc(INDEX);
  assert.deepEqual(r.toc.map((c) => [c.n, c.title, c.page]), [["1", "Domanda e offerta", 3], ["2", "L'elasticità", 5], ["3", "Il monopolio", 7], ["4", "Le esternalità", 9]]);
  assert.deepEqual(r.toc[0].sections, ["La curva di domanda"]);
  assert.deepEqual([r.from, r.indexPage, r.offset], ["indice", 2, 0]);
  // copertina e indice senza numero: la pagina stampata 1 è la 3 del PDF
  const shifted = dispenseToc([INDEX[0], "Sommario\n1 Domanda e offerta 1\n2 L'elasticità 3\n3 Il monopolio 5", ...INDEX.slice(2, 8)]);
  assert.deepEqual([shifted.toc.length, shifted.offset], [3, 2]);
});

test("indice dai titoli nelle pagine: «Capitolo n», intestazioni ripetute, titolo alla riga dopo; un elenco numerato non è un indice", () => {
  const pages = [`Capitolo 1 – Domanda e offerta\n${prose(200)}\n1.1 La curva di domanda\n${prose(100)}`, `Capitolo 1 – Domanda e offerta\n${prose(300)}`,
    `Capitolo 2\nL'elasticità\n${prose(200)}\n2.1 Elasticità al prezzo\n2.2 Elasticità al reddito`, `Capitolo 2 – L'elasticità\n${prose(300)}`, `Lezione 3: Il monopolio\n${prose(300)}`];
  const r = dispenseToc(pages);
  assert.deepEqual(r.toc.map((c) => [c.n, c.title, c.page]), [["1", "Domanda e offerta", 1], ["2", "L'elasticità", 3], ["3", "Il monopolio", 5]]);
  assert.deepEqual(r.toc[1].sections, ["Elasticità al prezzo", "Elasticità al reddito"]);
  assert.deepEqual([r.from, r.offset], ["titoli", 0]);
  const weak = dispenseToc([`1. Introduzione\n${prose(300)}`, `2. La domanda\n${prose(300)}`, prose(300), `3. L'offerta\n${prose(300)}`]);
  assert.deepEqual(weak.toc.map((c) => [c.n, c.page]), [["1", 1], ["2", 2], ["3", 4]], "titoli numerati in cima alle pagine, di seguito");
  assert.equal(dispenseToc([`${prose(100)}\n1. Calcola la domanda\n2. Calcola l'offerta\n${prose(100)}`, prose(300), prose(300)]), null, "esercizi numerati in mezzo alla pagina");
  assert.equal(dispenseToc([`1. Introduzione\n${prose(300)}`, `2. La domanda\n${prose(300)}`]), null, "due soli titoli senza «Capitolo»: troppo poco");
  assert.equal(dispenseToc([prose(300), prose(300)]), null);
  assert.equal(dispenseToc([`Come visto nel\ncapitolo 2 vedremo la domanda\n${prose(300)}`, `capitolo 3 tratta il monopolio\n${prose(300)}`]), null, "«capitolo 3» a inizio riga nel testo non è un titolo");
});

test("da leggere: prima le dispense del docente, poi il libro; nel piano una fonte sola; pagine del PDF dichiarate", () => {
  const disp = { id: "d", kind: "dispense", title: "Dispense Microeconomia", own: "pdf", materialId: "m1", pdfPages: true, offset: 0, main: false, moduleBuiltAt: "B",
    toc: [{ n: "1", title: "Domanda e offerta", page: 3 }, { n: "2", title: "L'elasticità", page: 5 }, { n: "3", title: "Il monopolio", page: 7 }, { n: "4", title: "Le esternalità", page: 9 }, { n: "5", title: "Appendice", page: 11 }],
    links: { t1: ["1"], t2: ["2"] } };
  const book = { id: "b", title: "Principi di economia", authors: "N. G. Mankiw", own: "carta", main: true, moduleBuiltAt: "B", toc: [{ n: "5", title: "L'elasticità", page: 89 }, { n: "6", title: "Politica", page: 113 }], links: { t2: ["5"], t5: ["6"] } };
  const exam = { module: { topics: [], materialIds: ["m1"] }, moduleBuiltAt: "B", level: 2, books: [book, disp], materials: [{ id: "m1", sentPages: "1-8" }] };
  assert.deepEqual(topicReading(exam, "t2").map((r) => r.book.id), ["d", "b"], "prima le dispense");
  assert.equal(readingLabel(topicReading(exam, "t2")[0]), "Dispense Microeconomia cap. 2, pp. 5–6 del PDF");
  assert.equal(readingLabel({ book: { ...disp, title: "Microeconomia Rossi", pdfPages: false }, chapter: disp.toc[1], pages: { from: 5, to: 6 } }), "Dispense Microeconomia Rossi cap. 2, pp. 5–6");
  const plan = readingByTopic(exam);
  assert.deepEqual(plan.get("t2"), { pages: 2, label: "Dispense Microeconomia cap. 2, pp. 5–6 del PDF" }, "piano: le dispense al posto del libro");
  assert.equal(plan.get("t5").label, "Mankiw cap. 6, pp. 113", "il libro dove le dispense non arrivano");
  // capitoli senza argomento: solo quelli le cui pagine l'AI ha ricevuto (1-8), non il 4 (p. 9) né il 5
  assert.deepEqual(sentChapters(exam, disp).map((c) => c.n), ["1", "2", "3"]);
  assert.deepEqual(uncoveredChapters(exam).filter((x) => x.book.kind === "dispense").map((x) => x.chapter.n), ["3"]);
  exam.materials[0].sentPages = "all";
  assert.deepEqual(uncoveredChapters(exam).filter((x) => x.book.kind === "dispense").map((x) => x.chapter.n), ["3", "4", "5"]);
  exam.module.materialIds = [];
  assert.deepEqual(sentChapters(exam, disp), [], "dispense non ancora nel modulo: nessun capitolo «saltato»");
});

test("regole per l'AI: le dispense del docente sono la fonte principale; se non concordano col libro si dice", () => {
  assert.match(MODULE_PRINCIPLES, /dispense del docente \(tag dispense\): il corso scritto per esteso da chi fa l'esame[\s\S]*sue\s+definizioni, i suoi simboli[\s\S]*coprili tutti[\s\S]*non concordano con il libro, usa la versione delle dispense e scrivi la differenza in "gaps"/);
  assert.match(MODULE_PRINCIPLES, /se contrastano con dispense del docente o libro valgono quelli/);
  assert.match(DISPENSA_SYSTEM, /DISPENSE DEL DOCENTE: sono il testo di chi fa l'esame[\s\S]*senza scegliere tu/);
  assert.equal(materialText({ role: "dispense", title: "Dispense", text: "x" }), '<dispense titolo="Dispense">\nx\n</dispense>');
});
