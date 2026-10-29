import { test } from "node:test";
import assert from "node:assert/strict";
import { createCloud, encodeState, mergeInto, split, writeMerging } from "../artifact/backend.js";
import { withLocalCopy } from "../web/offline.js";

// archivio `db` finto, condiviso da più dispositivi; `atomic`: con `swap` (come sul sito), altrimenti senza (pagina Claude)
function fakeDb({ atomic = true } = {}) {
  const docs = new Map();
  const db = { docs, failIndex: false, sets: 0 };
  db.doc = (id) => ({
    get: async () => (docs.has(id) ? { exists: true, data: () => structuredClone(docs.get(id)) } : { exists: false, data: () => undefined }),
    set: async (data) => {
      if (id === "studify-index" && db.failIndex) throw new TypeError("Failed to fetch");
      db.sets++;
      docs.set(id, structuredClone(data));
    },
    delete: async () => { docs.delete(id); },
    ...(atomic ? {
      swap: async (rev, data) => {
        if (db.failIndex) throw new TypeError("Failed to fetch");
        const cur = docs.has(id) ? docs.get(id).rev ?? 0 : null;
        if (cur !== rev) return false;
        docs.set(id, structuredClone(data));
        return true;
      },
    } : {}),
  });
  return db;
}
const device = (db) => createCloud(async () => db);
const ex = (id, name, extra = {}) => ({ id, name, materials: [], module: null, srs: {}, learned: {}, done: {}, activity: {}, plan: null, ...extra });
const st = (...exams) => ({ version: 1, exams, profile: null });
// come lo store: l'app sostituisce esami e profilo con quelli uniti
const hooks = (state, seen = []) => ({ onMerge: (m) => { state.exams = m.exams; state.profile = m.profile; }, notify: (n) => seen.push(...n) });

for (const atomic of [true, false]) {
  const where = atomic ? "sito" : "pagina Claude";

  test(`due dispositivi online (${where}): un esame aggiunto sul telefono non sparisce quando il computer salva`, async () => {
    const db = fakeDb({ atomic });
    const first = device(db);
    await first.init();
    await first.write(st(ex("a", "Analisi"), ex("b", "Fisica")));

    const pc = device(db);
    const phone = device(db);
    const pcState = (await pc.init()).state;
    const phoneState = (await phone.init()).state;

    phoneState.exams.push(ex("c", "Chimica"));
    await writeMerging(phone, phoneState, hooks(phoneState));

    pcState.exams[1].learned = { t1: true }; // il computer non sa di Chimica
    const seen = [];
    await writeMerging(pc, pcState, hooks(pcState, seen));

    const online = (await device(db).init()).state;
    assert.deepEqual(online.exams.map((e) => e.name), ["Analisi", "Fisica", "Chimica"]);
    assert.deepEqual(online.exams[1].learned, { t1: true });
    assert.deepEqual(pcState.exams.map((e) => e.name), ["Analisi", "Fisica", "Chimica"], "il computer ora vede Chimica");
    assert.deepEqual(seen, [], "nessuna copia doppia");
  });
}

test("due dispositivi online: lo stesso esame studiato su tutti e due, si tengono i ripassi di entrambi", async () => {
  const db = fakeDb();
  const first = device(db);
  await first.init();
  await first.write(st(ex("a", "Analisi")));
  const pc = device(db), phone = device(db);
  const pcS = (await pc.init()).state, phoneS = (await phone.init()).state;
  phoneS.exams[0].srs = { c1: { reps: 1 } };
  phoneS.exams[0].activity = { "2026-10-29": 2 };
  await writeMerging(phone, phoneS, hooks(phoneS));
  pcS.exams[0].srs = { c2: { reps: 1 } };
  pcS.exams[0].activity = { "2026-10-29": 3 };
  await writeMerging(pc, pcS, hooks(pcS));
  const e = (await device(db).init()).state.exams[0];
  assert.deepEqual(Object.keys(e.srs).sort(), ["c1", "c2"]);
  assert.equal(e.activity["2026-10-29"], 5);
});

test("salvataggio online: un'interruzione prima dell'indice lascia intero lo stato di prima", async () => {
  const db = fakeDb();
  const d = device(db);
  await d.init();
  await d.write(st(ex("a", "Analisi", { learned: { t1: true } })));
  db.failIndex = true;
  const big = ex("a", "Analisi modificato", { notes: "x".repeat(200_000) }); // più blocchi
  await assert.rejects(d.write(st(big)));
  const back = (await device(db).init()).state;
  assert.equal(back.exams[0].name, "Analisi");
  assert.deepEqual(back.exams[0].learned, { t1: true });
});

test("salvataggio online: i blocchi vecchi si cancellano dopo il nuovo indice; quelli del formato di prima restano", async () => {
  const db = fakeDb();
  // archivio scritto dalla versione di prima: indice senza revisione, blocchi c_<chiave>_<i>
  const old = encodeState(st(ex("a", "Analisi")));
  const keys = {};
  for (const [k, str] of old) { const parts = split(str); parts.forEach((s, i) => db.docs.set(`c_${k}_${i}`, { s })); keys[k] = parts.length; }
  db.docs.set("studify-index", { v: 1, keys });
  const d = device(db);
  const s = (await d.init()).state;
  assert.equal(s.exams[0].name, "Analisi", "si legge il formato di prima");
  s.exams[0].name = "Analisi 1";
  await d.write(s);
  assert.equal(db.docs.get("studify-index").rev, 1);
  assert.ok(db.docs.has("c_e.a.core_0"), "una scheda con l'app di prima li usa ancora");
  s.exams[0].name = "Analisi 2";
  await d.write(s);
  const coreDocs = [...db.docs.keys()].filter((k) => k.startsWith("c_e.a.core_") && k !== "c_e.a.core_0");
  assert.equal(coreDocs.length, 1, "della revisione 1 non resta niente");
  assert.equal((await device(db).init()).state.exams[0].name, "Analisi 2");
  const sets = db.sets;
  await d.write(s);
  assert.equal(db.sets, sets, "niente di cambiato: nessuna scrittura");
});

test("salvataggio online: una scrittura già in coda, fotografata prima dell'unione, non cancella il lavoro dell'altro dispositivo", async () => {
  const db = fakeDb();
  const first = device(db);
  await first.init();
  await first.write(st(ex("a", "Analisi")));
  const pc = device(db), phone = device(db);
  const pcS = (await pc.init()).state, phoneS = (await phone.init()).state;
  phoneS.exams.push(ex("c", "Chimica"));
  await writeMerging(phone, phoneS, hooks(phoneS));
  pcS.exams[0].learned = { t1: true };
  const w1 = writeMerging(pc, pcS, hooks(pcS));
  const snapshot = structuredClone(pcS); // una seconda foto, presa prima che l'unione arrivi
  snapshot.exams[0].done = { k: true };
  const w2 = writeMerging(pc, snapshot, hooks(snapshot));
  await Promise.all([w1, w2]);
  assert.ok((await device(db).init()).state.exams.some((e) => e.name === "Chimica"));
});

test("tornando su una scheda rimasta aperta: si riprende il lavoro fatto su un altro dispositivo", async () => {
  const db = fakeDb();
  const first = device(db);
  await first.init();
  await first.write(st(ex("a", "Analisi")));
  const pc = device(db), phone = device(db);
  const pcS = (await pc.init()).state, phoneS = (await phone.init()).state;
  assert.equal(await pc.refresh(), null, "niente di nuovo: nessuna rilettura");
  phoneS.exams[0].learned = { t1: true };
  await writeMerging(phone, phoneS, hooks(phoneS));
  const c = await pc.refresh();
  assert.ok(mergeInto(pcS, c, hooks(pcS)));
  assert.deepEqual(pcS.exams[0].learned, { t1: true });
});

test("sito con copia locale: due dispositivi online, l'app del computer riceve anche il lavoro del telefono", async () => {
  const db = fakeDb();
  const first = device(db);
  await first.init();
  await first.write(st(ex("a", "Analisi"), ex("b", "Fisica")));
  const memLocal = () => { const rec = {}; return { get: async (k) => rec[k] ?? null, set: async (k, v) => { rec[k] = structuredClone(v); } }; };
  const merged = [];
  const pc = withLocalCopy({ cloud: device(db), local: memLocal(), uid: async () => "u1", onMerge: (s) => merged.push(s) });
  const phone = withLocalCopy({ cloud: device(db), local: memLocal(), uid: async () => "u1" });
  const pcS = (await pc.init()).state;
  const phoneS = (await phone.init()).state;
  phoneS.exams.push(ex("c", "Chimica"));
  await phone.write(phoneS);
  pcS.exams[1].learned = { t1: true };
  await pc.write(pcS);
  const online = (await device(db).init()).state;
  assert.deepEqual(online.exams.map((e) => e.name), ["Analisi", "Fisica", "Chimica"]);
  assert.deepEqual(online.exams[1].learned, { t1: true });
  assert.deepEqual(merged.at(-1)?.exams.map((e) => e.name), ["Analisi", "Fisica", "Chimica"]);
  assert.equal(pc.offline, false, "un conflitto non è «senza connessione»");

  // il computer resta aperto; il telefono studia ancora; tornando sul computer si riprende quel lavoro
  phoneS.exams[0].learned = { t9: true };
  await phone.write(phoneS);
  await pc.refresh();
  assert.deepEqual(merged.at(-1)?.exams[0].learned, { t9: true });
});
