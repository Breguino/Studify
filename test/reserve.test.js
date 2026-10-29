import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MAX_OPEN_REQUESTS, createHandler, reserveUsd } from "../api/_lib.js";

const ENV = { SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "pk", ANTHROPIC_API_KEY: "sk-test", SUPABASE_SERVICE_ROLE_KEY: "service-key", USER_MONTHLY_LIMIT_USD: "1", TOTAL_MONTHLY_LIMIT_USD: "30" };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const req = () => Object.assign(new EventEmitter(), { method: "POST", headers: { authorization: "Bearer user-jwt" }, body: { prompt: "Spiega l'elasticità" } });
const res = () => {
  const r = { statusCode: 0, chunks: [], writableEnded: false, setHeader() {}, write: (c) => r.chunks.push(c), end: (c) => { if (c) r.chunks.push(c); r.writableEnded = true; } };
  r.code = () => JSON.parse(r.chunks.join("").trim().split("\n").at(-1)).code ?? "ok";
  return r;
};

/**
 * Supabase finto con le stesse regole di begin_ai_request e finish_ai_request (supabase/schema.sql). Ogni chiamata
 * gira senza interruzioni, come la funzione SQL dentro il suo lucchetto. `withReserve: false`: schema non aggiornato.
 */
function fakeDb({ spent = 0, total = 0, withReserve = true } = {}) {
  const db = { spent, total, open: new Map(), seq: 0, finished: [], recorded: [] };
  db.fetchFn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith("/auth/v1/user")) return json(200, { id: "u1" });
    if (url.endsWith("/rpc/ai_spend_this_month")) return json(200, [{ mine: db.spent, total: db.total }]);
    if (url.endsWith("/rpc/record_ai_usage_for")) { db.recorded.push(body); db.spent += body.p_cost; return new Response(null, { status: 204 }); }
    if (url.endsWith("/rpc/begin_ai_request") && withReserve) {
      assert.equal(init.headers.Authorization, "Bearer service-key", "solo con la chiave di servizio");
      const mine = [...db.open.values()].filter((o) => o.user === body.p_user);
      const reserved = mine.reduce((s, o) => s + o.amount, 0);
      const no = (reason) => json(200, [{ request_id: null, reason }]);
      if (mine.length >= body.p_max_open) return no("busy");
      if (db.spent >= body.p_limit) return no("quota");
      if (db.spent + reserved >= body.p_limit) return no("pending");
      const id = `r${++db.seq}`;
      db.open.set(id, { user: body.p_user, amount: body.p_reserve });
      return json(200, [{ request_id: id, reason: null }]);
    }
    if (url.endsWith("/rpc/finish_ai_request") && withReserve) {
      db.open.delete(body.p_request);
      db.finished.push(body);
      db.spent += body.p_cost;
      return new Response(null, { status: 204 });
    }
    if (url.includes("/rest/v1/subscriptions")) return json(200, []);
    return json(404, {});
  };
  return db;
}

// Claude finto: ogni risposta resta «in corso» finché la prova non la lascia finire
function slowClaude() {
  const c = { calls: 0, release: null };
  const gate = new Promise((r) => (c.release = r));
  c.beta = { messages: { stream() {
    c.calls++;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 2000, output_tokens: 1 } } };
        await gate;
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } };
      },
      finalMessage: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 3000 } }),
    };
  } } };
  return c;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test("credito: dieci richieste insieme a fine credito, parte solo quella che ci sta", async () => {
  const db = fakeDb({ spent: 0.95 }); // 1 $ di credito, 0,95 già usati
  const claude = slowClaude();
  const handler = createHandler({ env: ENV, anthropic: claude, fetchFn: db.fetchFn, log: () => {} });
  const all = Array.from({ length: 10 }, () => { const r = res(); return { r, done: handler(req(), r) }; });
  await settle();
  assert.equal(claude.calls, 1, "con il codice di prima partivano tutte e dieci");
  claude.release();
  await Promise.all(all.map((x) => x.done));
  const codes = all.map((x) => x.r.code());
  assert.equal(codes.filter((c) => c === "ok").length, 1);
  assert.equal(codes.filter((c) => c === "quota_exceeded").length, 9);
  assert.match(all.find((x) => x.r.code() === "quota_exceeded").r.chunks.join(""), /sta per finire/);
  assert.equal(db.open.size, 0, "prenotazione tolta a fine richiesta");
  assert.equal(db.finished.length, 1);
  assert.equal(db.finished[0].p_cost, 0.034, "saldata con il costo vero (2000 token d'ingresso, 3000 d'uscita)");
});

test("credito: al più quattro richieste in corso per utente, poi «troppe richieste»", async () => {
  const db = fakeDb();
  const claude = slowClaude();
  const handler = createHandler({ env: { ...ENV, USER_MONTHLY_LIMIT_USD: "50" }, anthropic: claude, fetchFn: db.fetchFn, log: () => {} });
  const all = Array.from({ length: 6 }, () => { const r = res(); return { r, done: handler(req(), r) }; });
  await settle();
  assert.equal(claude.calls, MAX_OPEN_REQUESTS);
  claude.release();
  await Promise.all(all.map((x) => x.done));
  assert.equal(all.filter((x) => x.r.code() === "rate_limited").length, 2);
  // finite quelle in corso, si riparte
  const again = res();
  const c2 = slowClaude();
  c2.release();
  await createHandler({ env: { ...ENV, USER_MONTHLY_LIMIT_USD: "50" }, anthropic: c2, fetchFn: db.fetchFn, log: () => {} })(req(), again);
  assert.equal(again.code(), "ok");
});

test("credito: un errore di Claude toglie la prenotazione senza registrare costi inventati", async () => {
  const db = fakeDb();
  const anthropic = { beta: { messages: { stream() { throw Object.assign(new Error("overloaded"), { status: 529 }); } } } };
  const r = res();
  await createHandler({ env: ENV, anthropic, fetchFn: db.fetchFn, log: () => {} })(req(), r);
  assert.equal(r.code(), "rate_limited");
  assert.equal(db.open.size, 0);
  assert.deepEqual(db.finished.map((f) => [f.p_input, f.p_output, f.p_cost]), [[0, 0, 0]]);
});

test("credito: database non ancora aggiornato, si lavora come prima (controllo e registrazione)", async () => {
  const db = fakeDb({ withReserve: false });
  const claude = slowClaude();
  claude.release();
  const logged = [];
  const r = res();
  await createHandler({ env: ENV, anthropic: claude, fetchFn: db.fetchFn, log: (m) => logged.push(m) })(req(), r);
  assert.equal(r.code(), "ok");
  assert.equal(db.recorded.length, 1);
  assert.match(logged.join(" "), /schema\.sql/, "nei log di Vercel: cosa manca");
});

test("credito: stima da prenotare, dall'ingresso vero e da una risposta lunga", () => {
  assert.equal(reserveUsd("claude-sonnet-5-5", { prompt: "x".repeat(30_000) }, 32000), 0.1, "10k token d'ingresso + 8000 d'uscita");
  assert.equal(reserveUsd("claude-sonnet-5-5", { prompt: "x", images: [{}, {}] }, 2000), 0.026402, "risposta breve: si prenota solo quella");
});
