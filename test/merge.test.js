import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStates } from "../public/js/merge.js";

const ex = (id, name, extra = {}) => ({ id, name, materials: [], ...extra });
const st = (...exams) => ({ version: 1, profile: null, exams });

test("unione: online fermo, vale la copia locale", () => {
  const base = st(ex("a", "Analisi"));
  const local = st(ex("a", "Analisi", { learned: { t1: true } }));
  const r = mergeStates({ base, local, remote: base });
  assert.equal(r.state, local);
  assert.equal(r.changed, false);
});

test("unione: esami diversi cambiati sui due dispositivi, si tengono entrambe le modifiche", () => {
  const base = st(ex("a", "Analisi"), ex("b", "Fisica"));
  const local = st(ex("a", "Analisi", { learned: { t1: true } }), ex("b", "Fisica"));
  const remote = st(ex("a", "Analisi"), ex("b", "Fisica", { learned: { t9: true } }));
  const r = mergeStates({ base, local, remote });
  assert.deepEqual(r.state.exams.map((e) => [e.id, e.learned]), [["a", { t1: true }], ["b", { t9: true }]]);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.changed, true, "il telefono aveva studiato Fisica: la copia locale va aggiornata");
});

test("unione: stesso campo dello stesso esame cambiato su tutti e due, la locale diventa una copia (niente si perde)", () => {
  const base = st(ex("a", "Analisi", { date: "2026-12-01" }));
  const local = st(ex("a", "Analisi", { date: "2026-12-15", learned: { t1: true } }));
  const remote = st(ex("a", "Analisi", { date: "2027-01-10" }));
  const r = mergeStates({ base, local, remote });
  assert.equal(r.state.exams.length, 2);
  assert.deepEqual(r.state.exams[0], remote.exams[0], "online al suo posto");
  assert.equal(r.state.exams[1].name, "Analisi (da questo dispositivo)");
  assert.notEqual(r.state.exams[1].id, "a");
  assert.equal(r.state.exams[1].date, "2026-12-15");
  assert.deepEqual(r.state.exams[1].learned, { t1: true });
  assert.deepEqual(r.conflicts, ["Analisi"]);
});

test("unione: stesso esame, campi diversi o solo progressi: si tiene tutto, senza copie", () => {
  const card = (reps) => ({ reps, ease: 2.5, due: "2026-11-02" });
  const base = st(ex("a", "Analisi", { date: "2026-12-01", srs: { c0: card(1) }, learned: {}, done: {}, activity: { "2026-10-29": 4 }, plan: { builtOn: "2026-10-28" } }));
  // qui: ripassate due carte, cambiata la data; sul telefono: un'altra carta, un argomento studiato, un'attività spuntata
  const local = st(ex("a", "Analisi", { date: "2026-12-15", srs: { c0: card(2), c1: card(1) }, learned: {}, done: {}, activity: { "2026-10-29": 7 }, plan: { builtOn: "2026-10-29", x: 1 } }));
  const remote = st(ex("a", "Analisi", { date: "2026-12-01", srs: { c0: card(1), c2: card(1) }, learned: { t1: true }, done: { k1: true }, activity: { "2026-10-29": 6 }, plan: { builtOn: "2026-10-29", x: 2 } }));
  const r = mergeStates({ base, local, remote });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.state.exams.length, 1);
  const e = r.state.exams[0];
  assert.equal(e.date, "2026-12-15", "cambiata solo qui");
  assert.deepEqual(Object.keys(e.srs).sort(), ["c0", "c1", "c2"]);
  assert.equal(e.srs.c0.reps, 2);
  assert.deepEqual(e.learned, { t1: true });
  assert.deepEqual(e.done, { k1: true });
  assert.equal(e.activity["2026-10-29"], 9, "4 di partenza, +3 qui, +2 sul telefono");
  assert.equal(e.plan, null, "piano rifatto dai dati uniti");
});

test("unione: esami nuovi da tutte e due le parti, cancellazioni rispettate", () => {
  const base = st(ex("a", "Analisi"), ex("b", "Fisica"), ex("c", "Chimica"));
  const local = st(ex("a", "Analisi"), ex("c", "Chimica"), ex("n1", "Nuovo qui")); // cancellata Fisica
  const remote = st(ex("b", "Fisica"), ex("c", "Chimica"), ex("n2", "Nuovo online")); // cancellata Analisi
  const r = mergeStates({ base, local, remote });
  assert.deepEqual(r.state.exams.map((e) => e.id), ["c", "n2", "n1"]);
});

test("unione: cancellato da una parte ma modificato dall'altra, si tiene la versione modificata", () => {
  const base = st(ex("a", "Analisi"), ex("b", "Fisica"));
  const local = st(ex("b", "Fisica", { date: "2026-12-01" })); // cancellata Analisi, modificata Fisica
  const remote = st(ex("a", "Analisi", { date: "2026-11-01" })); // modificata Analisi, cancellata Fisica
  const r = mergeStates({ base, local, remote });
  assert.deepEqual(r.state.exams.map((e) => [e.id, e.date]), [["a", "2026-11-01"], ["b", "2026-12-01"]]);
});

test("unione: profilo cambiato solo qui, si tiene; senza base comune vale il locale (come prima)", () => {
  const base = st(ex("a", "Analisi"));
  const local = { ...st(ex("a", "Analisi")), profile: { university: "Bologna" } };
  const remote = st(ex("a", "Analisi"), ex("z", "Altro"));
  assert.deepEqual(mergeStates({ base, local, remote }).state.profile, { university: "Bologna" });
  assert.equal(mergeStates({ base: null, local, remote }).state, local);
});

test("unione: lo stesso esame con i campi in un altro ordine non è una modifica", () => {
  const base = st({ id: "a", name: "Analisi", materials: [], plan: { x: 1, y: 2 } });
  const remote = st({ materials: [], plan: { y: 2, x: 1 }, name: "Analisi", id: "a" }); // come lo ricompone l'archivio online
  const local = st({ id: "a", name: "Analisi", materials: [{ id: "m1" }], plan: { x: 1, y: 2 } });
  const r = mergeStates({ base, local, remote });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.state, local, "online fermo: vale la copia locale, con il materiale nuovo");
});
