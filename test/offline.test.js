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
const rec = (r) => (r ? { state: r.state, dirty: r.dirty } : r); // il record ha anche `base`, controllato a parte

test("offline: online si tiene una copia in pari", async () => {
  const cloud = fakeCloud(st("A"));
  const local = fakeLocal();
  const b = withLocalCopy({ cloud, local, uid: async () => "u1" });
  assert.equal((await b.init()).state.exams[0].name, "A");
  assert.deepEqual(rec(local.rec.u1), { state: st("A"), dirty: false });
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
  assert.deepEqual(rec(local.rec.u1), { state: st("B"), dirty: true });
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
  assert.deepEqual(rec(local.rec.u1), { state: st("B"), dirty: true });
  assert.equal(cloud.stored.exams[0].name, "A");
  const again = withLocalCopy({ cloud, local, uid: async () => "u1" }); // riapertura
  assert.equal((await again.init()).state.exams[0].name, "B");
  assert.equal(cloud.stored.exams[0].name, "B", "inviata online all'apertura");
  assert.equal(local.rec.u1.dirty, false);
});

// due esami, per le prove tra dispositivi
const two = (a, b) => ({ version: 1, profile: null, exams: [{ id: "a", name: "Analisi", n: a }, { id: "b", name: "Fisica", n: b }] });

test("due dispositivi: il computer chiuso subito non cancella il lavoro fatto poi sul telefono", async () => {
  const cloud = fakeCloud(two(0, 0));
  const pcLocal = fakeLocal();
  const pc = withLocalCopy({ cloud, local: pcLocal, uid: async () => "u1" });
  await pc.init();
  await pc.stage(two(1, 0)); // sul computer: Analisi, poi la pagina si chiude prima dell'invio
  // sul telefono: Fisica, salvata online
  const phone = withLocalCopy({ cloud, local: fakeLocal(), uid: async () => "u1" });
  await phone.init();
  await phone.write(two(0, 5));
  // si riapre il computer
  const seen = [];
  const pc2 = withLocalCopy({ cloud, local: pcLocal, uid: async () => "u1", notify: (w, n) => seen.push([w, n]) });
  const r = await pc2.init();
  assert.deepEqual(r.state.exams.map((e) => e.n), [1, 5], "Analisi dal computer, Fisica dal telefono");
  assert.deepEqual(cloud.stored.exams.map((e) => e.n), [1, 5], "online l'unione");
  assert.ok(!seen.some(([w]) => w === "conflict"), "esami diversi: nessun conflitto");
});

test("due dispositivi: stesso esame cambiato su tutti e due, resta anche la copia di questo dispositivo", async () => {
  const cloud = fakeCloud(two(0, 0));
  const pcLocal = fakeLocal();
  const pc = withLocalCopy({ cloud, local: pcLocal, uid: async () => "u1" });
  await pc.init();
  await pc.stage(two(1, 0));
  const phone = withLocalCopy({ cloud, local: fakeLocal(), uid: async () => "u1" });
  await phone.init();
  await phone.write(two(7, 0));
  const seen = [];
  const r = await withLocalCopy({ cloud, local: pcLocal, uid: async () => "u1", notify: (w, n) => seen.push([w, n]) }).init();
  assert.deepEqual(r.state.exams.map((e) => [e.name, e.n]), [["Analisi", 7], ["Analisi (da questo dispositivo)", 1], ["Fisica", 0]]);
  assert.deepEqual(seen.find(([w]) => w === "conflict"), ["conflict", ["Analisi"]]);
});

test("due dispositivi: offline qui, online sul telefono; al ritorno della rete si unisce e l'app riceve lo stato unito", async () => {
  const cloud = fakeCloud(two(0, 0));
  const pcLocal = fakeLocal();
  const pc = withLocalCopy({ cloud, local: pcLocal, uid: async () => "u1" });
  await pc.init();
  cloud.up = false;
  const merged = [];
  const pc2 = withLocalCopy({ cloud, local: pcLocal, uid: async () => "u1", onMerge: (s) => merged.push(s) });
  await pc2.init(); // aperto senza rete: la copia
  await pc2.write(two(1, 0)); // studia Analisi offline
  cloud.up = true;
  const phone = withLocalCopy({ cloud, local: fakeLocal(), uid: async () => "u1" });
  await phone.init();
  await phone.write(two(0, 5)); // intanto il telefono, online
  await pc2.retry(); // torna la rete sul computer
  assert.deepEqual(cloud.stored.exams.map((e) => e.n), [1, 5]);
  assert.deepEqual(merged.at(-1)?.exams.map((e) => e.n), [1, 5], "l'app mostra anche il lavoro del telefono");
});
