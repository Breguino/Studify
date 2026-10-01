import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeModule, normalizeModule } from "../shared/normalize.js";
import { moduleDigest } from "../shared/prompts.js";
import { applyUpdate, compactModule, pendingMaterials, updateSummary } from "../public/js/module-update.js";
import { localDelta } from "../public/js/local-builder.js";

const demoRaw = JSON.parse(readFileSync(new URL("../public/demo/module.json", import.meta.url), "utf8"));
const base = () => normalizeModule(demoRaw, demoRaw.sources ?? []);
const NOW = "2026-10-08T10:00:00.000Z";

test("mergeModule: id esistenti intatti, i nuovi proseguono la numerazione", () => {
  const b = base();
  const raw = {
    topics: [
      { id: "n1", title: "Esternalità", importance: 3, difficulty: 2, summary: "Costi o benefici che ricadono su terzi.", keyConcepts: [{ term: "Pigou", definition: "imposta correttiva" }], mustKnow: ["Definire un'esternalità"], commonMistakes: [], origin: "notes", sourceIds: [] },
      { id: "t2", title: "", summary: "Riassunto aggiornato dell'elasticità.", keyConcepts: [{ term: "Elasticità incrociata", definition: "reazione al prezzo di un altro bene" }, { term: b.topics[1].keyConcepts[0].term, definition: "doppione" }], mustKnow: [], commonMistakes: [], origin: "notes", sourceIds: [] },
    ],
    flashcards: [
      { topicId: "n1", front: "Che cos'è un'esternalità negativa?", back: "Un costo imposto a terzi", type: "definizione" },
      { topicId: "t2", front: "Che cosa misura l'elasticità incrociata?", back: "…", type: "definizione" },
      { topicId: "t2", front: b.flashcards[0].front.toUpperCase(), back: "doppione di una carta esistente", type: "definizione" },
      { topicId: "t99", front: "argomento inesistente", back: "x", type: "definizione" },
    ],
    questions: [{ topicId: "n1", kind: "open", prompt: "Spiega l'imposta pigouviana", options: [], correctIndex: -1, modelAnswer: "…", explanation: "…", rubric: ["a"] }],
    gaps: ["manca il monopolio naturale"],
  };
  const { module: m, added } = mergeModule(b, raw, [], { now: NOW });
  // gli esistenti non cambiano id né contenuto delle carte
  assert.deepEqual(m.topics.slice(0, b.topics.length).map((t) => t.id), b.topics.map((t) => t.id));
  assert.deepEqual(m.flashcards.slice(0, b.flashcards.length), b.flashcards);
  assert.deepEqual(m.questions.slice(0, b.questions.length), b.questions);
  // nuovi
  const n = b.topics.length;
  assert.equal(m.topics[n].id, `t${n + 1}`);
  assert.equal(m.topics[n].addedAt, NOW);
  assert.equal(m.flashcards.at(-1).id, `c${b.flashcards.length + 2}`);
  assert.equal(m.flashcards.find((c) => c.front.startsWith("Che cos'è un'esternalità")).topicId, `t${n + 1}`);
  assert.equal(m.questions.at(-1).id, `q${b.questions.length + 1}`);
  // approfondimento di t2: riassunto sostituito, concetti aggiunti senza doppioni, segnato come aggiornato
  const t2 = m.topics.find((t) => t.id === "t2");
  assert.equal(t2.summary, "Riassunto aggiornato dell'elasticità.");
  assert.equal(t2.title, b.topics[1].title, "il titolo resta");
  assert.equal(t2.keyConcepts.length, b.topics[1].keyConcepts.length + 1);
  assert.equal(t2.updatedAt, NOW);
  assert.deepEqual(added, { topics: 1, updated: 1, flashcards: 2, questions: 1 }, "doppione e argomento inesistente scartati");
  assert.deepEqual(m.gaps, ["manca il monopolio naturale"], "lacune sostituite dall'elenco aggiornato");
  assert.equal(b.topics[1].summary !== t2.summary, true, "il modulo di partenza non viene modificato");
});

test("mergeModule: titolo uguale = approfondimento, fonti rinumerate, modalità «append»", () => {
  const b = { title: "M", overview: "", topics: [{ id: "t1", title: "Domanda e offerta", importance: 2, difficulty: 2, summary: "Vecchio.", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", sourceIds: ["S1"] }],
    flashcards: [{ id: "c1", topicId: "t1", front: "f", back: "b" }], questions: [], gaps: ["g"], sources: [{ id: "S1", title: "A", url: "https://a.it" }] };
  const { module: m, added } = mergeModule(b, {
    topics: [{ id: "n1", title: "domanda e OFFERTA", summary: "Nuovo.", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "online", sourceIds: ["S1", "S2"] }],
    flashcards: [{ topicId: "n1", front: "g", back: "h" }],
  }, [{ id: "S1", title: "B", url: "https://b.it" }, { id: "S2", title: "A di nuovo", url: "https://a.it" }], { now: NOW, summary: "append", replaceGaps: false });
  assert.equal(m.topics.length, 1, "nessun doppione per titolo");
  assert.equal(m.topics[0].summary, "Vecchio. Nuovo.");
  assert.deepEqual(m.sources.map((s) => s.id), ["S1", "S2"]);
  assert.equal(m.sources[1].url, "https://b.it", "S1 della ricerca nuova diventa S2");
  assert.deepEqual(m.topics[0].sourceIds, ["S1", "S2"], "S2 nuovo (stesso URL di S1) → S1; S1 nuovo → S2");
  assert.equal(m.flashcards[1].topicId, "t1");
  assert.deepEqual(m.gaps, ["g"]);
  assert.deepEqual(added, { topics: 0, updated: 1, flashcards: 1, questions: 0 });
});

test("pendingMaterials / applyUpdate: progressi conservati, materiali segnati, piano da ricalcolare", () => {
  const mod = base();
  mod.materialIds = ["a"];
  const exam = {
    module: mod, moduleBuiltAt: "2026-10-01T08:00:00.000Z",
    materials: [{ id: "a", kind: "notes", title: "Lezione 1", text: "x" }, { id: "b", kind: "notes", title: "Lezione 2", text: "## Esternalità\nEsternalità: un costo o beneficio che ricade su terzi estranei allo scambio." }],
    srs: { c1: { due: "2026-10-09", interval: 3 } }, qstats: { q1: { seen: 2 } }, learned: { t1: true }, done: { x: true }, plan: { days: [] },
  };
  assert.deepEqual(pendingMaterials(exam).map((m) => m.id), ["b"]);
  const added = applyUpdate(exam, { delta: localDelta(exam.materials[1].text, "Appunti"), mode: "local" }, ["b"], NOW);
  assert.equal(added.topics, 1);
  assert.ok(added.flashcards >= 1);
  assert.deepEqual(exam.srs, { c1: { due: "2026-10-09", interval: 3 } });
  assert.deepEqual(exam.learned, { t1: true });
  assert.equal(exam.plan, null);
  assert.equal(exam.moduleUpdatedAt, NOW);
  assert.deepEqual(pendingMaterials(exam), []);
  assert.deepEqual(exam.module.materialIds, ["a", "b"]);
  assert.match(updateSummary(added), /1 argomento nuovo.*I tuoi progressi restano/);
  assert.match(updateSummary({ topics: 0, updated: 0, flashcards: 0, questions: 0 }), /non aggiungono/);
});

test("pendingMaterials: moduli creati prima di questa funzione (senza materialIds)", () => {
  const exam = { module: base(), moduleBuiltAt: "2026-10-01T08:00:00.000Z", materials: [
    { id: "old", kind: "notes", title: "vecchio, senza data" },
    { id: "before", kind: "notes", title: "prima", addedAt: "2026-09-30T08:00:00.000Z" },
    { id: "after", kind: "pdf", title: "dopo", addedAt: "2026-10-02T08:00:00.000Z" },
  ] };
  assert.deepEqual(pendingMaterials(exam).map((m) => m.id), ["after"]);
  applyUpdate(exam, { delta: { topics: [], flashcards: [], questions: [] } }, ["after"], NOW);
  assert.deepEqual(exam.module.materialIds.sort(), ["after", "before", "old"]);
  assert.deepEqual(pendingMaterials({ ...exam, module: null }), []);
});

test("moduleDigest: id, riassunti, carte e lacune; accorcia se troppo lungo", () => {
  const mod = base();
  const d = moduleDigest(compactModule(mod));
  assert.match(d, /^<modulo_esistente>/);
  assert.match(d, /## t1 · /);
  assert.ok(d.includes(mod.flashcards[0].front));
  assert.ok(d.includes(mod.questions[0].prompt.slice(0, 50)));
  const small = moduleDigest(compactModule(mod), 3000);
  assert.ok(small.length <= 3000 && small.endsWith("</modulo_esistente>"));
  assert.ok(!small.includes("Domande già presenti"), "prima si tolgono le domande");
});
