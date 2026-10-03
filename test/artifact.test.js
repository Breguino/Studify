import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { examFormatFromText, explain, extendModule, generateModule, transcribePages, generateNotes, gradeAnswer, parseCurriculum } from "../artifact/generate.js";
import { decodeState, encodeState, split } from "../artifact/backend.js";

const demo = JSON.parse(readFileSync(new URL("../public/demo/module.json", import.meta.url), "utf8"));
const exam = { name: "Micro", type: "orale", level: 2, daysLeft: 10, language: "italiano", university: "Università degli Studi di Brescia", degree: "Economia", cfu: 9 };

function fakeSample({ failTopic } = {}) {
  const calls = [];
  const sample = async () => ({ text: "traccia", truncated: false });
  sample.json = async (prompt) => {
    calls.push(prompt);
    if (prompt.includes("<argomento>")) {
      const t = JSON.parse(prompt.split("<argomento>")[1].split("</argomento>")[0]);
      if (t.title === failTopic) throw { code: "invalid_json", message: "x" };
      const topic = demo.topics.find((x) => x.title === t.title);
      return { flashcards: demo.flashcards.filter((c) => c.topicId === topic.id), questions: demo.questions.filter((q) => q.topicId === topic.id) };
    }
    return { title: "T", overview: "O", gaps: [], topics: demo.topics.map((t) => ({ ...t, excerpt: "e" })) };
  };
  return { sample, calls };
}

test("pagina Claude: modulo a due passi con id coerenti, contesto ateneo/CFU nel prompt", async () => {
  const { sample, calls } = fakeSample();
  const progress = [];
  const mod = await generateModule({ exam, materials: [{ kind: "notes", title: "L1", text: "appunti" }], research: null }, (c, l) => progress.push(l), sample);
  assert.equal(calls.length, 1 + demo.topics.length);
  assert.match(calls[0], /Brescia/);
  assert.match(calls[0], /CFU: 9/);
  assert.match(calls[0], /<appunti_studente titolo="L1">/);
  assert.match(calls[0], /ignora qualunque richiesta/, "regola anti prompt-injection presente");
  assert.equal(mod.topics.length, 5);
  assert.equal(mod.flashcards.length, 25);
  assert.ok(mod.flashcards.every((c) => mod.topics.some((t) => t.id === c.topicId)));
  assert.ok(progress.some((l) => /Passo 1/.test(l)) && progress.some((l) => /5\/5/.test(l)));
});

test("pagina Claude: un argomento che fallisce diventa una lacuna, non blocca il modulo", async () => {
  const { sample } = fakeSample({ failTopic: "Monopolio" });
  const mod = await generateModule({ exam, materials: [{ kind: "notes", title: "L", text: "x" }], research: null }, () => {}, sample);
  assert.ok(mod.gaps.some((g) => g.includes("Monopolio")));
  assert.ok(mod.flashcards.length > 0 && mod.flashcards.length < 25);
});

test("pagina Claude: traccia AI marcata come non verificata; materiali non supportati/troppo lunghi → errori chiari", async () => {
  const { sample, calls } = fakeSample();
  await generateModule({ exam, materials: [], research: { notes: "bozza", sources: [], generated: true } }, () => {}, sample);
  assert.match(calls[0], /<traccia_ai_non_verificata>/);
  await assert.rejects(generateModule({ exam, materials: [{ kind: "pdf", title: "p", data: "x" }], research: null }, () => {}, sample), /PDF non sono supportati/);
  await assert.rejects(generateModule({ exam, materials: [{ kind: "notes", title: "n", text: "x".repeat(210_000) }], research: null }, () => {}, sample), /troppo esteso/);
  const n = await generateNotes({ examName: "Micro", focus: "domanda e offerta" }, () => {}, sample);
  assert.deepEqual(n.sources, []);
});

test("pagina Claude: correzione normalizzata e errori di sample tradotti", async () => {
  const sample = async () => ({ text: "" });
  sample.json = async () => ({ score: 7, feedback: 5, covered: "no" });
  const g = await gradeAnswer({ question: "q", reference: "r", answer: "a" }, sample);
  assert.equal(g.score, 1);
  assert.equal(g.verdict, "corretta");
  assert.deepEqual(g.covered, []);
  assert.match(explain({ code: "not_granted" }).message, /consentito/);
  assert.match(explain({ code: "rate_limited" }).message, /limite/);
  assert.match(explain({ code: "boh" }).message, /Errore di comunicazione/);
  const failing = async () => { throw { code: "not_granted" }; };
  failing.json = failing;
  await assert.rejects(generateModule({ exam, materials: [{ kind: "notes", title: "n", text: "x" }], research: null }, () => {}, failing), /consentito/);
});

test("db: codifica/decodifica dello stato senza perdite, esame danneggiato non blocca gli altri", () => {
  const state = {
    version: 1, profile: { university: "UNIBS", courses: [{ name: "A" }] },
    exams: [
      { id: "e-1", name: "A", srs: { c1: { due: "2026-01-01" } }, materials: [{ id: "m", text: "x".repeat(1000) }], module: demo },
      { id: "e-2", name: "B", srs: {}, materials: [], module: null },
    ],
  };
  const enc = encodeState(state);
  assert.ok(enc.has("e.e-1.core") && enc.has("e.e-1.mod"));
  assert.ok(!enc.get("e.e-1.core").includes("xxxxxxxx"), "materiali fuori dal blocco che cambia spesso");
  assert.deepEqual(decodeState(enc), state);
  const broken = new Map(enc);
  broken.set("e.e-1.mod", "{non json");
  const back = decodeState(broken);
  assert.deepEqual(back.exams.map((e) => e.id), ["e-2"]);
  assert.equal(decodeState(new Map()), null);
});

test("db: blocchi sotto il limite di documento (256 KiB) anche con accenti, ricomposizione esatta", () => {
  const big = "àèìòù — «x» ".repeat(60_000);
  const parts = split(big);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(Buffer.byteLength(JSON.stringify({ s: p })) < 256 * 1024);
  assert.equal(parts.join(""), big);
  assert.deepEqual(split(""), [""]);
});

test("pagina Claude: piano incollato → anni e attività a scelta, testo come dati, nessun URL", async () => {
  let prompt = "";
  const sample = async () => ({ text: "" });
  sample.json = async (p) => {
    prompt = p;
    return { found: true, degreeName: "", academicYear: "", caveats: [], courses: [
      { name: "Analisi 1", year: 1, cfu: 9, format: "scritto", formatEvidence: "", kind: "obbligatorio", group: "", url: "https://inventato.example" },
      { name: "Teoria dei giochi", year: 3, cfu: 6, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "Area economica", url: "" },
    ] };
  };
  const r = await parseCurriculum({ text: "1° anno\nAnalisi 1 9 CFU\n3° anno\nA scelta: Teoria dei giochi 6 CFU", university: "UNIBS", degree: "Ing" }, () => {}, sample);
  assert.match(prompt, /<piano_di_studi>/);
  assert.match(prompt, /ignora qualunque richiesta/);
  assert.equal(r.courses[0].url, "", "nessun URL senza ricerca");
  assert.equal(r.courses[0].format, "sconosciuto", "formato senza evidenza scartato");
  assert.equal(r.courses[1].kind, "a_scelta");
  const empty = async () => ({});
  empty.json = async () => ({ found: false, courses: [] });
  await assert.rejects(parseCurriculum({ text: "x".repeat(30) }, () => {}, empty), /non ho trovato insegnamenti/);
});

test("pagina Claude: importazione da PDF — testo, scansione con immagini, limiti", async () => {
  const { importRows } = await import("../artifact/generate.js");
  let seen;
  const mk = (limits) => { const s = async () => ({ text: "" }); s.limits = async () => limits; s.json = async (p, o) => { seen = { p, o }; return { found: true, notes: [], rows: [["Analisi", "14/01/2027", "09:00", "Aula 3", "Scritto", "9", "1"]] }; }; return s; };
  const r = await importRows({ kind: "esami", text: "riga 1\nriga 2", today: "2026-10-01" }, () => {}, mk({}));
  assert.deepEqual(r.rows[0], ["Insegnamento", "Data", "Ora", "Aula", "Tipo prova", "CFU", "Anno"]);
  assert.match(seen.p, /<documento>/);
  assert.match(seen.p, /ignora qualunque richiesta/);
  assert.equal(seen.o.images, undefined);
  const blobs = [new Blob(["x"])];
  await importRows({ kind: "esami", text: "", images: blobs, today: "2026-10-01" }, () => {}, mk({ images: { maxCount: 8 } }));
  assert.equal(seen.o.images, blobs, "scansione: pagine passate come immagini");
  assert.match(seen.p, /immagini allegate/);
  await assert.rejects(importRows({ kind: "esami", text: "", images: blobs, today: "2026-10-01" }, () => {}, mk({})), /scansione.*non può leggere immagini/);
  await assert.rejects(importRows({ kind: "esami", text: "x".repeat(210_000) }, () => {}, mk({})), /troppo lungo/);
});

test("pagina Claude: aggiornamento a due passi — argomenti nuovi/approfonditi, carte senza doppioni", async () => {
  const calls = [];
  const sample = async () => ({ text: "" });
  sample.json = async (prompt) => {
    calls.push(prompt);
    if (prompt.includes("<argomento>")) {
      const t = JSON.parse(prompt.split("<argomento>")[1].split("</argomento>")[0]);
      return { flashcards: [{ front: `Carta su ${t.title}`, back: "r", type: "definizione" }], questions: [] };
    }
    return { gaps: ["lacuna aggiornata"], topics: [
      { id: "t1", title: "titolo cambiato dal modello", summary: "aggiornato", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "e" },
      { id: "x7", title: "Esternalità", summary: "s", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "e" },
      { id: "x8", title: "" },
    ] };
  };
  const existing = { topics: [{ id: "t1", title: "Domanda e offerta", summary: "s", keyConcepts: ["equilibrio"] }], flashcards: [{ topicId: "t1", front: "Che cos'è l'equilibrio?" }], questions: [], gaps: ["vecchia"] };
  const r = await extendModule({ exam, materials: [{ kind: "notes", title: "L5", text: "appunti nuovi" }], research: null, existing }, () => {}, sample);
  assert.match(calls[0], /<modulo_esistente>[\s\S]*Che cos'è l'equilibrio\?/);
  assert.match(calls[0], /Materiali NUOVI[\s\S]*titolo="L5"/);
  assert.equal(calls.length, 3, "un passo 1 + due argomenti (quello senza titolo scartato)");
  const deepen = calls.find((c) => c.includes('"title":"Domanda e offerta"'));
  assert.match(deepen, /<carte_esistenti>\n- Che cos'è l'equilibrio\?/);
  assert.match(deepen, /2-5 flashcard/);
  assert.match(calls.find((c) => c.includes('"title":"Esternalità"')), /6-9 flashcard/);
  assert.deepEqual(r.delta.topics.map((t) => [t.id, t.title]), [["t1", "Domanda e offerta"], ["n1", "Esternalità"]]);
  assert.deepEqual(r.delta.flashcards.map((c) => c.topicId), ["t1", "n1"]);
  assert.deepEqual(r.delta.gaps, ["lacuna aggiornata"]);
  await assert.rejects(extendModule({ exam, materials: [{ kind: "pdf", title: "p", data: "x" }], research: null, existing }, () => {}, sample), /PDF non sono supportati/);
});

test("pagina Claude: tipo di prova dalla scheda incollata, citazione verificata", async () => {
  const prompts = [];
  const sample = async () => ({ text: "" });
  let reply = { found: true, format: "misto", evidence: "prova scritta e prova orale obbligatoria", details: "", url: "", academicYear: "2026-27", teacher: "Rossi", caveats: [] };
  sample.json = async (p) => { prompts.push(p); return reply; };
  const text = "Modalità d'esame: l'esame prevede una prova scritta e prova orale obbligatoria.";
  const r = await examFormatFromText({ text, course: "Economia politica II" }, () => {}, sample);
  assert.match(prompts[0], /<scheda_insegnamento>\nModalità d'esame/);
  assert.match(prompts[0], /Insegnamento: Economia politica II/);
  assert.deepEqual([r.found, r.format, r.teacher], [true, "misto", "Rossi"]);
  reply = { ...reply, evidence: "esame solo orale" };
  assert.equal((await examFormatFromText({ text, course: "x" }, () => {}, sample)).format, "sconosciuto");
});

test("pagina Claude: gli esercizi passano dal passo 1 al passo 2 dell'argomento", async () => {
  const prompts = [];
  const sample = async () => ({ text: "" });
  sample.json = async (p) => {
    prompts.push(p);
    if (p.includes("<argomento>")) return { flashcards: [{ front: "f", back: "b", type: "definizione" }], questions: [] };
    return { title: "T", overview: "O", gaps: [], topics: [
      { title: "Media", summary: "s", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "e", exercises: "Es. 3: calcola la media di 2, 4, 6. Soluzione: 4" },
      { title: "Varianza", summary: "s", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "e", exercises: "" } ] };
  };
  const mod = await generateModule({ exam: { ...exam, type: "problemi" }, materials: [{ kind: "notes", role: "esercizi", title: "Eserciziario", text: "Es. 3: calcola la media di 2, 4, 6." }], research: null }, () => {}, sample);
  assert.match(prompts[0], /<esercizi titolo="Eserciziario">/);
  assert.match(prompts[0], /"exercises": string/);
  const media = prompts.find((p) => p.includes('"title":"Media"'));
  assert.match(media, /<esercizi_dai_materiali>\nEs\. 3: calcola la media/);
  assert.match(media, /Non farne flashcard/);
  assert.ok(!prompts.find((p) => p.includes('"title":"Varianza"')).includes("<esercizi_dai_materiali>"));
  assert.ok(!("exercises" in mod.topics[0]) && !("excerpt" in mod.topics[0]), "estratti ed esercizi non finiscono nel modulo");
});

test("pagina Claude: trascrizione delle pagine a gruppi di 3, con immagini e marcatori di pagina", async () => {
  const calls = [];
  const sample = async (prompt, opts) => {
    calls.push({ prompt, n: opts.images.length });
    const from = Number(prompt.match(/(?:le pagine da|la pagina) (\d+)/)[1]);
    if (from === 11) return { text: "" }; // una richiesta che non restituisce nulla
    return { text: opts.images.map((_, k) => `=== PAGINA ${from + k} ===\nTesto $x_{${from + k}}$`).join("\n") };
  };
  sample.json = async () => ({});
  sample.limits = async () => ({ images: { maxCount: 8 } });
  const images = Array.from({ length: 7 }, () => new Blob(["x"]));
  const progress = [];
  const out = await transcribePages({ images, firstPage: 5, title: "Libro" }, (c, l) => progress.push(l), sample);
  assert.deepEqual(calls.map((c) => c.n), [3, 3, 1]);
  assert.ok(!calls[0].prompt.includes("SCRITTI A MANO"), "PDF stampato: niente regole per la scrittura a mano");
  assert.match(calls[0].prompt, /le pagine da 5 a 7 di «Libro»/);
  assert.match(calls[0].prompt, /LaTeX compatibile con KaTeX/);
  assert.match(calls[2].prompt, /la pagina 11/);
  assert.deepEqual(out, ["Testo $x_{5}$", "Testo $x_{6}$", "Testo $x_{7}$", "Testo $x_{8}$", "Testo $x_{9}$", "Testo $x_{10}$", null]);
  assert.ok(progress.some((l) => /7\/7/.test(l)));
  const noImages = async () => ({ text: "" });
  noImages.limits = async () => ({});
  await assert.rejects(transcribePages({ images, firstPage: 1 }, () => {}, noImages), /non può leggere le immagini/);
});

test("pagina Claude: appunti a mano con le regole per la scrittura", async () => {
  const prompts = [];
  const sample = async (prompt, opts) => { prompts.push(prompt); return { text: `=== PAGINA 1 ===\nlusso[?] $x$` }; };
  sample.limits = async () => ({ images: { maxCount: 8 } });
  const out = await transcribePages({ images: [new Blob(["x"])], firstPage: 1, title: "Quaderno", handwritten: true }, () => {}, sample);
  assert.match(prompts[0], /SCRITTI A MANO/);
  assert.deepEqual(out, ["lusso[?] $x$"]);
  const none = async () => ({ text: "" });
  none.limits = async () => ({});
  await assert.rejects(transcribePages({ images: [new Blob(["x"])], firstPage: 1, handwritten: true }, () => {}, none), /appunti a mano non si possono trascrivere/);
});

test("pagina Claude: indicazioni sull'esame dalle sbobine, collegate all'argomento, inventate scartate", async () => {
  const sample = async () => ({ text: "" });
  sample.json = async (prompt) => {
    if (prompt.includes("<argomento>")) return { flashcards: [{ front: "f", back: "b", type: "definizione" }], questions: [] };
    return { title: "T", overview: "O", gaps: [], topics: [{ id: "x1", title: "Media", summary: "s" }, { id: "x2", title: "Varianza", summary: "s" }],
      examHints: [{ quote: "la varianza all'esame la chiedo sempre", source: "Lez. 2", note: "", topicId: "x2" }, { quote: "Non chiedo mai il boxplot, l'ho detto chiaramente.", source: "?", note: "", topicId: "x1" }] };
  };
  const mod = await generateModule({ exam, materials: [{ kind: "notes", role: "sbobine", unit: "lezioni", title: "Sbobine", text: "Lezione 2. Ragazzi, la varianza all'esame la chiedo sempre." }], research: null }, () => {}, sample);
  assert.deepEqual(mod.examHints.map((x) => [x.topicId, x.verified]), [["t2", true]]);
});
