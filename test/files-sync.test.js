// Versione web: PDF e foto online con i piani a pagamento (web/files.js, supabase/schema.sql parte 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base64Bytes, byteSize, bytesLabel, createFiles, fromDownload, MAX_FILE_BYTES, ORPHAN_AGE_MS, planSync, referencedFiles, sniffType, uploadBody, withOnlineFiles } from "../web/files.js";
import { missingFileMessage } from "../web/backend.js";
import { filesSpace, PLANS } from "../public/js/plans.js";

const b64 = (s) => Buffer.from(s).toString("base64");
const PDF = b64("%PDF-1.7 contenuto");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");

const PDF_BYTES = new Uint8Array(Buffer.from("%PDF-1.7 contenuto"));
const JPEG_BLOB = new Blob([Buffer.from(JPEG, "base64")], { type: "image/jpeg" });

test("file nelle tre forme del browser: byte, tipo, ritorno nella stessa forma", async () => {
  for (const s of ["", "a", "ab", "abc", "abcd", "%PDF-1.7 contenuto"]) assert.equal(base64Bytes(b64(s)), Buffer.byteLength(s));
  assert.equal(byteSize(PDF), 18);
  assert.equal(byteSize(PDF_BYTES), 18);
  assert.equal(byteSize(JPEG_BLOB), 7);
  assert.equal(byteSize({}), null);
  assert.equal(sniffType(PDF_BYTES), "application/pdf");
  assert.equal(sniffType(Buffer.from(JPEG, "base64")), "image/jpeg");
  assert.equal(sniffType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png");
  assert.equal(sniffType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffType(Buffer.from("<html>")), null);
  assert.equal((await uploadBody(PDF)).type, "application/pdf");
  assert.equal((await uploadBody(PDF_BYTES)).type, "application/pdf");
  assert.equal((await uploadBody(new Blob([Buffer.from(JPEG, "base64")]))).type, "image/jpeg", "Blob senza tipo: si guarda nei primi byte");
  await assert.rejects(uploadBody(b64("<html>")), (e) => e.code === "type", "il bucket accetta solo PDF e immagini");
  const back = new Blob([PDF_BYTES], { type: "application/pdf" });
  assert.equal(await fromDownload(back, "base64"), PDF);
  assert.deepEqual(await fromDownload(back, "bytes"), PDF_BYTES);
  assert.ok((await fromDownload(back, "blob")) instanceof Blob);
});

test("file usati, con la forma: PDF dei materiali, PDF da cui si è estratto il testo, foto", () => {
  const state = { exams: [
    { materials: [{ kind: "pdf", fileId: "p1" }, { kind: "notes", fromPdf: true, pdfFileId: "w1" }, { kind: "handwritten", imageIds: ["f1", "f2"] }] },
    { materials: [{ kind: "pdf", fileId: "p1" }] }, // due copie dello stesso esame condividono il file
  ] };
  assert.deepEqual(Object.fromEntries(referencedFiles(state)), { p1: "base64", w1: "bytes", f1: "blob", f2: "blob" });
  assert.equal(referencedFiles(null).size, 0);
});

test("piano dei caricamenti: dal più piccolo, finché c'è spazio; orfani tolti solo dopo un giorno", () => {
  const now = 10 * ORPHAN_AGE_MS;
  const sizes = { a: 300, b: 100, c: 200, grande: MAX_FILE_BYTES + 1 };
  const remote = new Map([["online", { size: 50, updatedAt: 0 }], ["vecchio", { size: 10, updatedAt: 0 }], ["appena", { size: 10, updatedAt: now - 1000 }]]);
  const r = planSync({ referenced: new Map(["a", "b", "c", "grande", "manca", "online"].map((id) => [id, "blob"])), remote, localSize: (id) => sizes[id] ?? null, used: 70, quota: 300, now });
  assert.deepEqual(r.upload, ["b", "c"], "b (100) e c (200) partono; a non serve, lo spazio è finito; grande supera il limite del bucket");
  assert.deepEqual(r.remove, ["vecchio"], "«appena» può essere di un esame che non è ancora arrivato da un altro dispositivo");
  assert.deepEqual(planSync({ referenced: new Map([["a", "blob"]]), remote: new Map(), localSize: () => 1, used: 0, quota: 0, now }).upload, [], "piano Gratis: niente online");
});

test("piani: spazio online uguale a quello del database", () => {
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const m = sql.match(/when 'pro' then (\d+) when 'base' then (\d+) else 0/);
  assert.ok(m, "files_quota nello schema");
  assert.equal(Number(m[1]), PLANS.pro.files);
  assert.equal(Number(m[2]), PLANS.base.files);
  assert.equal(PLANS.free.files, 0);
  assert.equal(filesSpace("base"), "1 GB");
  assert.equal(filesSpace("pro"), "5 GB");
  assert.equal(filesSpace("free"), null);
  assert.equal(bytesLabel(1024 ** 3), "1 GB");
  assert.equal(bytesLabel(1.5 * 1024 ** 2), "1,5 MB");
  assert.equal(bytesLabel(120 * 1024 ** 2), "120 MB");
  assert.equal(bytesLabel(0), "0 byte");
});

/* ----------------------- archivio online (HTTP finto) ----------------------- */

function fakeStorage({ quota = 1000, uploadStatus = null } = {}) {
  const objects = new Map(); // nome → { data, type, updatedAt }
  const calls = [];
  const res = (status, body) => new Response(body == null ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, headers: init.headers ?? {} });
    assert.equal(init.headers.Authorization, "Bearer tok");
    assert.equal(init.headers.apikey, "pk");
    const used = [...objects.values()].reduce((s, o) => s + o.data.length, 0);
    if (u.pathname === "/rest/v1/rpc/files_usage") return res(200, [{ used, quota, plan: quota ? "base" : "free" }]);
    if (u.pathname === "/storage/v1/object/list/files") {
      const { prefix } = JSON.parse(init.body);
      return res(200, [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ id: k, name: k.slice(prefix.length), updated_at: new Date(o.updatedAt).toISOString(), metadata: { size: o.data.length } })));
    }
    const obj = u.pathname.match(/^\/storage\/v1\/object\/(authenticated\/)?files\/(.+)$/);
    if (obj && init.method === "POST") {
      if (uploadStatus) return res(400, { statusCode: String(uploadStatus), error: "x", message: uploadStatus === 403 ? "new row violates row-level security policy" : "Payload too large" });
      if (used >= quota) return res(400, { statusCode: "403", message: "new row violates row-level security policy" });
      const name = decodeURIComponent(obj[2]);
      objects.set(name, { data: Buffer.from(await init.body.arrayBuffer()), type: init.headers["Content-Type"], updatedAt: Date.now() });
      return res(200, { Key: `files/${name}` });
    }
    if (obj) {
      const o = objects.get(decodeURIComponent(obj[2]));
      return o ? new Response(o.data, { status: 200 }) : res(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    }
    if (u.pathname === "/storage/v1/object/files" && init.method === "DELETE") {
      for (const p of JSON.parse(init.body).prefixes) objects.delete(p);
      return res(200, []);
    }
    return res(500, {});
  };
  return { fetchFn, objects, calls };
}
const AUTH = { user: { id: "u1" }, accessToken: async () => "tok" };

test("archivio online: carica nella cartella dell'utente, rilegge, elenca, cancella", async () => {
  const sb = fakeStorage();
  const files = createFiles({ url: "https://sb.test", key: "pk", auth: AUTH, fetchFn: sb.fetchFn });
  await files.upload("p1", PDF);
  const put = sb.calls.find((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/files/"));
  assert.equal(put.path, "/storage/v1/object/files/u1/p1");
  assert.equal(put.headers["Content-Type"], "application/pdf");
  assert.equal(put.headers["x-upsert"], "true", "«Carica di nuovo» sostituisce lo stesso file");
  assert.equal(sb.objects.get("u1/p1").data.toString(), "%PDF-1.7 contenuto");
  assert.equal(await files.download("p1", "base64"), PDF);
  assert.deepEqual(await files.download("p1", "bytes"), PDF_BYTES);
  assert.equal(await files.download("manca"), null);
  assert.deepEqual([...(await files.list()).keys()], ["p1"]);
  assert.deepEqual(await files.usage(), { used: 18, quota: 1000, plan: "base" });
  await files.remove(["p1"]);
  assert.equal(sb.objects.size, 0);
  await assert.rejects(files.upload("x", b64("<html>")), (e) => e.code === "type");
  await files.upload("w1", PDF_BYTES);
  await files.upload("f1", JPEG_BLOB);
  assert.equal(sb.objects.get("u1/w1").type, "application/pdf");
  assert.equal(sb.objects.get("u1/f1").type, "image/jpeg");
});

test("archivio online: spazio pieno e file troppo grandi diventano errori chiari", async () => {
  for (const [status, code] of [[403, "quota"], [413, "too_large"]]) {
    const files = createFiles({ url: "https://sb.test", key: "pk", auth: AUTH, fetchFn: fakeStorage({ uploadStatus: status }).fetchFn });
    await assert.rejects(files.upload("p1", PDF), (e) => e.code === code);
  }
  const offline = createFiles({ url: "https://sb.test", key: "pk", auth: AUTH, fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(offline.upload("p1", PDF), (e) => e.code === "offline");
  const noSession = createFiles({ url: "https://sb.test", key: "pk", auth: { user: null, accessToken: async () => null }, fetchFn: fakeStorage().fetchFn });
  await assert.rejects(noSession.usage(), (e) => e.code === "session_expired");
});

test("eliminazione dell'account: prima tutti i file online", async () => {
  const sb = fakeStorage({ quota: 10_000 });
  const files = createFiles({ url: "https://sb.test", key: "pk", auth: AUTH, fetchFn: sb.fetchFn });
  for (const id of ["a", "b", "c"]) await files.upload(id, JPEG);
  sb.objects.set("altro/x", { data: Buffer.from("x"), updatedAt: 0 }); // di un altro utente: non si tocca
  await files.removeAll();
  assert.deepEqual([...sb.objects.keys()], ["altro/x"]);
});

/* -------------------- browser più copia online (orchestrazione) -------------------- */

function setup({ quota = 1000, local = {} } = {}) {
  const sb = fakeStorage({ quota });
  const api = createFiles({ url: "https://sb.test", key: "pk", auth: AUTH, fetchFn: sb.fetchFn });
  const store = new Map(Object.entries(local));
  const notes = [];
  const files = withOnlineFiles({
    remote: async () => api,
    local: { get: async (id) => store.get(id), put: async (id, d) => void store.set(id, d), has: async (id) => store.has(id), del: async (id) => void store.delete(id) },
    notify: (what, u) => notes.push([what, u?.quota]),
  });
  return { sb, api, store, notes, files };
}

test("con un piano a pagamento un file nuovo va anche online; un altro dispositivo lo scarica e lo tiene", async () => {
  const a = setup();
  await a.files.put("p1", PDF_BYTES); // versione web: i PDF sono byte
  await a.files.idle();
  assert.ok(a.sb.objects.has("u1/p1"));
  // secondo dispositivo, stesso account e stesso archivio
  const store = new Map();
  const b = withOnlineFiles({ remote: async () => a.api, formOf: (id) => (id === "p1" ? "bytes" : "blob"), local: { get: async (id) => store.get(id), put: async (id, d) => void store.set(id, d), has: async (id) => store.has(id), del: async (id) => void store.delete(id) } });
  assert.equal(await b.has("p1"), true, "il materiale non dice più «è su un altro dispositivo»");
  assert.deepEqual(await b.get("p1"), PDF_BYTES, "nella stessa forma in cui l'ha caricato il primo dispositivo");
  assert.deepEqual(store.get("p1"), PDF_BYTES, "scaricato una volta, poi c'è anche senza rete");
  assert.equal(await b.get("manca"), undefined);
});

test("piano Gratis: i file restano nel browser, nessun caricamento e nessun avviso", async () => {
  const s = setup({ quota: 0 });
  await s.files.put("p1", PDF);
  await s.files.idle();
  assert.equal(s.sb.objects.size, 0);
  assert.equal(s.store.get("p1"), PDF);
  assert.deepEqual(s.notes, []);
  assert.ok(!s.sb.calls.some((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/files/")));
});

test("ciò che non è un file non va online", async () => {
  const s = setup();
  await s.files.put("x", { non: "un file" });
  await s.files.idle();
  assert.equal(s.sb.objects.size, 0);
});

test("spazio pieno: un avviso solo, il file resta qui", async () => {
  const s = setup({ quota: 20 });
  await s.files.put("p1", PDF); // 18 byte: entra
  await s.files.put("p2", PDF); // spazio usato 18 < 20: il database lo accetta ancora (si sfora di un file al massimo)
  await s.files.put("p3", PDF);
  await s.files.put("p4", PDF);
  await s.files.idle();
  assert.deepEqual([...s.sb.objects.keys()].sort(), ["u1/p1", "u1/p2"]);
  assert.deepEqual(s.notes, [["quota", 20]]);
  assert.equal(s.store.get("p4"), PDF);
});

test("sync: mette online i file di prima che mancano e toglie quelli che nessuno usa più", async () => {
  const s = setup({ local: { p1: PDF, w1: PDF_BYTES, f1: JPEG_BLOB } });
  s.sb.objects.set("u1/vecchio", { data: Buffer.from("x"), updatedAt: 0 });
  const state = { exams: [{ materials: [{ kind: "pdf", fileId: "p1" }, { kind: "handwritten", imageIds: ["f1"] }, { kind: "notes", pdfFileId: "w1" }] }] };
  await s.files.sync(state);
  assert.deepEqual([...s.sb.objects.keys()].sort(), ["u1/f1", "u1/p1", "u1/w1"]);
  const calls = s.sb.calls.length;
  await s.files.sync(state);
  assert.ok(!s.sb.calls.slice(calls).some((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/files/")), "già online: niente da caricare");
});

test("cancellare un materiale toglie il file anche online", async () => {
  const s = setup();
  await s.files.put("p1", PDF);
  await s.files.idle();
  await s.files.del("p1");
  await s.files.idle();
  assert.equal(s.sb.objects.size, 0);
  assert.equal(s.store.has("p1"), false);
});

test("senza rete i file del browser funzionano come prima", async () => {
  const store = new Map([["p1", PDF]]);
  const offline = createFiles({ url: "https://sb.test", key: "pk", auth: AUTH, fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
  const f = withOnlineFiles({ remote: async () => offline, local: { get: async (id) => store.get(id), put: async (id, d) => void store.set(id, d), has: async (id) => store.has(id), del: async (id) => void store.delete(id) } });
  await f.put("p2", JPEG);
  await f.idle();
  assert.equal(await f.get("p1"), PDF);
  assert.equal(await f.get("p2"), JPEG);
  assert.equal(await f.has("manca"), false);
  await f.sync({ exams: [{ materials: [{ kind: "pdf", fileId: "p1" }] }] }); // non lancia errori
});

test("messaggio del file mancante: con lo spazio online dice come farlo arrivare", () => {
  assert.match(missingFileMessage("Dispensa", true), /«Dispensa» non è né in questo browser né online.*dispositivo dove l'hai caricato/);
  assert.equal(missingFileMessage("Dispensa", false), null, "senza spazio online resta il messaggio di sempre");
});
