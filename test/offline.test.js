import { test } from "node:test";
import assert from "node:assert/strict";
import { withLocalCopy } from "../web/offline.js";

// archivio online finto: `up` dice se la rete c'è
function fakeCloud(initial = null) {
  const c = { up: true, stored: initial, inits: 0, writes: 0 };
  c.init = async () => {
    c.inits++;
    return c.up ? { state: c.stored, persistent: true } : { state: null, persistent: false };
  };
  c.write = async (s) => {
    if (!c.up) throw new TypeError("Failed to fetch");
    c.writes++;
    c.stored = structuredClone(s);
  };
  return c;
}
const fakeLocal = (rec = {}) => ({ rec, get: async (k) => rec[k] ?? null, set: async (k, v) => { rec[k] = structuredClone(v); } });
const st = (name) => ({ version: 1, exams: [{ id: "e1", name }], profile: null });

test("offline: online si tiene una copia in pari", async () => {
  const cloud = fakeCloud(st("A"));
  const local = fakeLocal();
  const b = withLocalCopy({ cloud, local, uid: async () => "u1" });
  assert.equal((await b.init()).state.exams[0].name, "A");
  assert.deepEqual(local.rec.u1, { state: st("A"), dirty: false });
  await b.write(st("B"));
  assert.equal(cloud.stored.exams[0].name, "B");
  assert.equal(local.rec.u1.dirty, false);
});

test("offline: senza rete si apre la copia, le modifiche restano in locale e partono al ritorno", async () => {
  const cloud = fakeCloud(st("A"));
  cloud.up = false;
  const local = fakeLocal({ u1: { state: st("A"), dirty: false } });
  const seen = [];
  const b = withLocalCopy({ cloud, local, uid: async () => "u1", notify: (w) => seen.push(w) });
  const r = await b.init();
  assert.equal(r.persistent, true, "si studia e si salva lo stesso");
  assert.equal(r.state.exams[0].name, "A");
  await b.write(st("B")); // non lancia: niente «salvataggio fallito»
  assert.deepEqual(local.rec.u1, { state: st("B"), dirty: true });
  assert.equal(cloud.stored.exams[0].name, "A");
  cloud.up = true;
  await b.retry();
  assert.equal(cloud.stored.exams[0].name, "B");
  assert.equal(local.rec.u1.dirty, false);
  assert.deepEqual(seen, ["offline", "synced"], "un avviso per l'uscita e uno per il ritorno");
  assert.ok(cloud.inits >= 2, "l'indice online è riletto prima di scrivere");
});

test("offline: le modifiche rimaste dalla volta prima vanno online all'apertura", async () => {
  const cloud = fakeCloud(st("A"));
  const local = fakeLocal({ u1: { state: st("C"), dirty: true } });
  const b = withLocalCopy({ cloud, local, uid: async () => "u1" });
  assert.equal((await b.init()).state.exams[0].name, "C");
  assert.equal(cloud.stored.exams[0].name, "C");
  assert.equal(local.rec.u1.dirty, false);
});

test("offline: senza copia in questo browser non si inventano dati (nessun salvataggio)", async () => {
  const cloud = fakeCloud(st("A"));
  cloud.up = false;
  const b = withLocalCopy({ cloud, local: fakeLocal(), uid: async () => "u1" });
  assert.deepEqual(await b.init(), { state: null, persistent: false });
});

test("offline: la copia è per utente", async () => {
  const cloud = fakeCloud();
  cloud.up = false;
  const b = withLocalCopy({ cloud, local: fakeLocal({ u1: { state: st("A"), dirty: false } }), uid: async () => "u2" });
  assert.equal((await b.init()).persistent, false);
});

test("offline: una modifica più recente non viene segnata in pari da una scrittura più vecchia", async () => {
  const cloud = fakeCloud(st("A"));
  let release;
  const slow = new Promise((r) => (release = r));
  const write = cloud.write;
  let first = true;
  cloud.write = async (s) => { if (first) { first = false; await slow; } return write(s); };
  const local = fakeLocal();
  const b = withLocalCopy({ cloud, local, uid: async () => "u1" });
  await b.init();
  const w1 = b.write(st("B"));
  await new Promise((r) => setTimeout(r, 0));
  const w2 = b.write(st("C"));
  release();
  await Promise.all([w1, w2]);
  assert.equal(local.rec.u1.state.exams[0].name, "C");
  assert.equal(local.rec.u1.dirty, false);
});

test("offline: una modifica salvata subito in locale va online al prossimo accesso, anche se la pagina si è chiusa prima", async () => {
  const cloud = fakeCloud(st("A"));
  const local = fakeLocal();
  const b = withLocalCopy({ cloud, local, uid: async () => "u1" });
  await b.init();
  await b.stage(st("B")); // modifica; la pagina si chiude prima del salvataggio online
  assert.deepEqual(local.rec.u1, { state: st("B"), dirty: true });
  assert.equal(cloud.stored.exams[0].name, "A");
  const again = withLocalCopy({ cloud, local, uid: async () => "u1" }); // riapertura
  assert.equal((await again.init()).state.exams[0].name, "B");
  assert.equal(cloud.stored.exams[0].name, "B", "inviata online all'apertura");
  assert.equal(local.rec.u1.dirty, false);
});
