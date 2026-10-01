import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { explain, generateModule, generateNotes, gradeAnswer, parseCurriculum } from "../artifact/generate.js";
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
