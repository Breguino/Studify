// Versione web (Vercel + Supabase): funzione /api/claude, accesso, capability sample e db.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { HttpError, claudeErrorCode, costUsd, createHandler, messageParams, readBody } from "../api/_lib.js";
import { authError, createAuth, parseAuthHash } from "../web/auth.js";
import { createDb, createSample, parseJsonText } from "../web/claude.js";
import { initialMode, looksLikeBot, MIN_FILL_MS, signupProblems } from "../web/gate.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ENV = { SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "pk", ANTHROPIC_API_KEY: "sk-test", USER_MONTHLY_LIMIT_USD: "3", TOTAL_MONTHLY_LIMIT_USD: "30" };

/* ------------------------------- /api/claude ------------------------------- */

test("costo: prezzi per modello, cache scritta 1,25× e letta 0,1×", () => {
  assert.equal(costUsd("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(costUsd("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 0 }), 2);
  assert.equal(costUsd("claude-opus-5-5", { cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 }), 4 * 1.25 + 0.4);
  assert.equal(costUsd("modello-sconosciuto", { output_tokens: 1e6 }), 20, "prezzo prudente di Opus 5.5 se il modello non è in tabella");
});

test("richiesta: testo obbligatorio, limiti di dimensione, immagini controllate", () => {
  assert.deepEqual(readBody({ prompt: "Ciao" }), { prompt: "Ciao", images: [], json: false });
  assert.equal(readBody(JSON.stringify({ prompt: "x", json: true })).json, true);
  assert.throws(() => readBody({ prompt: "  " }), (e) => e instanceof HttpError && e.status === 400);
  assert.throws(() => readBody({ prompt: "à".repeat(140_000) }), (e) => e.code === "prompt_too_large", "il limite è in byte, non in caratteri");
  assert.throws(() => readBody({ prompt: "x", images: [1, 2, 3, 4].map(() => ({ mediaType: "image/jpeg", data: "AAAA" })) }), (e) => e.code === "prompt_too_large");
  assert.throws(() => readBody({ prompt: "x", images: [{ mediaType: "text/html", data: "AAAA" }] }), (e) => e.code === "bad_request");
  assert.throws(() => readBody({ prompt: "x", images: [{ mediaType: "image/png", data: "<script>" }] }), (e) => e.code === "bad_request");
});

test("parametri: fallback lato server, immagini prima del testo, istruzione JSON solo se richiesta", () => {
  const p = messageParams({ prompt: "Domanda", images: [{ mediaType: "image/png", data: "AAAA" }], json: true }, { model: "claude-opus-5-5", maxTokens: 32000 });
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.messages[0].content[0].type, "image");
  assert.equal(p.messages[0].content[0].source.media_type, "image/png");
  assert.deepEqual(p.messages[0].content.at(-1), { type: "text", text: "Domanda" });
  assert.match(p.system, /JSON/);
  assert.equal(messageParams({ prompt: "x", images: [], json: false }, { model: "m", maxTokens: 1 }).system, undefined);
  assert.equal(p.thinking, undefined, "nessun parametro thinking: su Opus 5.5 il ragionamento adattivo è predefinito");
});

test("errori dell'API → codici dell'app", () => {
  assert.equal(claudeErrorCode({ status: 429 }), "rate_limited");
  assert.equal(claudeErrorCode({ status: 529 }), "rate_limited");
  assert.equal(claudeErrorCode({ status: 400, message: "prompt is too long: 250000 tokens" }), "prompt_too_large");
  assert.equal(claudeErrorCode({ status: 401, message: "invalid x-api-key" }), "invalid_key");
  assert.equal(claudeErrorCode({ status: 403 }), "sampling_disabled");
  assert.equal(claudeErrorCode({ status: 400, message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." }), "billing");
  assert.equal(claudeErrorCode({ status: 404, message: "model: claude-xyz" }), "model_unavailable");
  assert.equal(claudeErrorCode({ name: "APIUserAbortError" }), "cancelled");
  assert.equal(claudeErrorCode(new Error("boh")), "server_error");
});

function fakeRes() {
  const res = { statusCode: 0, headers: {}, chunks: [], writableEnded: false };
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.write = (c) => res.chunks.push(c);
  res.end = (c) => { if (c) res.chunks.push(c); res.writableEnded = true; };
  res.lines = () => res.chunks.join("").trim().split("\n").map((l) => JSON.parse(l));
  return res;
}
function fakeReq({ method = "POST", token = "user-jwt", body = { prompt: "Spiega l'elasticità" } } = {}) {
  return Object.assign(new EventEmitter(), { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body });
}
function fakeSupabase({ spent = 0, total = 0, user = { id: "u1", email: "a@b.it" } } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return init.headers.Authorization === "Bearer user-jwt" && user ? json(200, user) : json(401, { msg: "bad jwt" });
    if (url.endsWith("/rpc/ai_spend_this_month")) return json(200, [{ mine: spent, total }]);
    if (url.endsWith("/rpc/record_ai_usage")) return new Response(null, { status: 204 });
    return json(404, {});
  };
  return { fetchFn, calls };
}
function fakeAnthropic({ deltas = ["Ciao", " mondo"], stop = "end_turn", model = "claude-opus-5-5", fail = null } = {}) {
  const seen = [];
  return {
    seen,
    beta: { messages: { stream(params) {
      seen.push(params);
      const events = [
        { type: "message_start", message: { model, usage: { input_tokens: 1000, output_tokens: 1 } } },
        ...deltas.map((text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } })),
        { type: "message_delta", usage: { output_tokens: 500 } },
      ];
      return {
        async *[Symbol.asyncIterator]() {
          for (const ev of events) {
            if (fail && ev.type === "message_delta") throw fail;
            yield ev;
          }
        },
        finalMessage: async () => ({ stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 500 } }),
      };
    } } },
  };
}

test("handler: risposta in streaming NDJSON e consumo registrato con il costo", async () => {
  const sb = fakeSupabase();
  const anthropic = fakeAnthropic();
  const res = fakeRes();
  await createHandler({ env: ENV, anthropic, fetchFn: sb.fetchFn, log: () => {} })(fakeReq(), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /ndjson/);
  assert.deepEqual(res.lines(), [{ type: "text", delta: "Ciao" }, { type: "text", delta: " mondo" }, { type: "done", truncated: false }]);
  assert.equal(anthropic.seen[0].model, "claude-opus-5-5");
  const rec = sb.calls.find((c) => c.url.endsWith("record_ai_usage"));
  assert.ok(rec, "consumo registrato");
  assert.equal(rec.init.headers.Authorization, "Bearer user-jwt", "registrato con il token dell'utente (RLS), senza chiave di servizio");
  assert.deepEqual(JSON.parse(rec.init.body), { p_input: 1000, p_output: 500, p_cost: 0.014 });
});

test("handler: modello e max_tokens dalle variabili d'ambiente; risposta troncata segnalata", async () => {
  const anthropic = fakeAnthropic({ stop: "max_tokens" });
  const res = fakeRes();
  await createHandler({ env: { ...ENV, ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_MAX_TOKENS: "16000" }, anthropic, fetchFn: fakeSupabase().fetchFn })(fakeReq(), res);
  assert.equal(anthropic.seen[0].model, "claude-sonnet-5-5");
  assert.equal(anthropic.seen[0].max_tokens, 16000);
  assert.deepEqual(res.lines().at(-1), { type: "done", truncated: true });
});

test("handler: senza accesso 401, credito esaurito 429, senza chiave 503 — Claude non viene chiamato", async () => {
  for (const [req, sbOpts, env, status, code] of [
    [fakeReq({ token: null }), {}, ENV, 401, "session_expired"],
    [fakeReq({ token: "falso" }), {}, ENV, 401, "session_expired"],
    [fakeReq(), { spent: 3.01 }, ENV, 429, "quota_exceeded"],
    [fakeReq(), { total: 30 }, ENV, 429, "quota_exceeded"],
    [fakeReq(), {}, { ...ENV, ANTHROPIC_API_KEY: "" }, 503, "sampling_disabled"],
    [fakeReq({ body: { prompt: "" } }), {}, ENV, 400, "bad_request"],
  ]) {
    const anthropic = fakeAnthropic();
    const res = fakeRes();
    await createHandler({ env, anthropic, fetchFn: fakeSupabase(sbOpts).fetchFn })(req, res);
    assert.equal(res.statusCode, status, code);
    assert.equal(JSON.parse(res.chunks.join("")).code, code);
    assert.equal(anthropic.seen.length, 0);
  }
});

test("handler: rifiuto e interruzione → riga d'errore, consumo comunque registrato", async () => {
  let res = fakeRes();
  let sb = fakeSupabase();
  await createHandler({ env: ENV, anthropic: fakeAnthropic({ stop: "refusal" }), fetchFn: sb.fetchFn })(fakeReq(), res);
  assert.deepEqual(res.lines().at(-1), { type: "error", code: "refused" });
  res = fakeRes();
  sb = fakeSupabase();
  await createHandler({ env: ENV, anthropic: fakeAnthropic({ fail: Object.assign(new Error("overloaded"), { status: 529 }) }), fetchFn: sb.fetchFn, log: () => {} })(fakeReq(), res);
  assert.deepEqual(res.lines().at(-1), { type: "error", code: "rate_limited" });
  res = fakeRes();
  const logged = [];
  await createHandler({ env: ENV, anthropic: fakeAnthropic({ fail: Object.assign(new Error("Your credit balance is too low"), { status: 400 }) }), fetchFn: fakeSupabase().fetchFn, log: (m) => logged.push(String(m)) })(fakeReq(), res);
  assert.deepEqual(res.lines().at(-1), { type: "error", code: "billing" });
  assert.match(logged.join(" "), /billing \(400\)/, "l'errore finisce nei log di Vercel");
  const rec = JSON.parse(sb.calls.find((c) => c.url.endsWith("record_ai_usage")).init.body);
  assert.equal(rec.p_input, 1000, "i token d'ingresso già pagati sono registrati anche se lo stream si interrompe");
  assert.ok(res.writableEnded);
});

test("handler: GET restituisce il limite mensile e se la chiave è configurata (non il valore)", async () => {
  const res = fakeRes();
  await createHandler({ env: ENV, anthropic: fakeAnthropic(), fetchFn: fakeSupabase().fetchFn })(fakeReq({ method: "GET", token: null }), res);
  assert.deepEqual(JSON.parse(res.chunks.join("")), { limits: { user: 3 }, configured: true, model: "claude-opus-5-5" });
  const res2 = fakeRes();
  await createHandler({ env: { ...ENV, ANTHROPIC_API_KEY: "" }, anthropic: null, fetchFn: fakeSupabase().fetchFn })(fakeReq({ method: "GET", token: null }), res2);
  const body = JSON.parse(res2.chunks.join(""));
  assert.equal(body.configured, false, "dice se la chiave manca");
  assert.ok(!JSON.stringify(body).includes("sk-"), "mai il valore della chiave");
});

/* --------------------------------- accesso --------------------------------- */

function memStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("link delle email: sessione o errore dal frammento dell'URL", () => {
  const r = parseAuthHash("#access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer&type=signup");
  assert.equal(r.session.access_token, "AT");
  assert.equal(r.session.refresh_token, "RT");
  assert.equal(r.type, "signup");
  const e = parseAuthHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  assert.match(e.error.message, /scaduto/);
  assert.equal(parseAuthHash("#/exam/e1"), null, "le rotte dell'app non sono sessioni");
});

test("errori di accesso in italiano, nelle varie forme di Supabase", () => {
  assert.match(authError({ error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400).message, /non corretti/);
  assert.match(authError({ error: "invalid_grant", error_description: "Email not confirmed" }, 400).message, /conferma/i);
  assert.match(authError({ code: "user_already_exists" }, 422).message, /già un account/);
  assert.match(authError({ error_code: "over_email_send_rate_limit" }, 429).message, /troppe email/i);
  assert.match(authError({}, 429).message, /Troppi tentativi/);
  assert.match(authError({}, 503).message, /non risponde/);
});

test("accesso: sessione salvata, token rinnovato quando scade, sessione persa se il rinnovo è rifiutato", async () => {
  let t = 1_000_000_000_000;
  const calls = [];
  let refreshOk = true;
  const fetchFn = async (url, init) => {
    calls.push({ url, body: init.body && JSON.parse(init.body) });
    if (url.includes("grant_type=password")) return json(200, { access_token: "A1", refresh_token: "R1", expires_in: 3600, user: { id: "u1", email: "a@b.it" } });
    if (url.includes("grant_type=refresh_token")) return refreshOk ? json(200, { access_token: "A2", refresh_token: "R2", expires_in: 3600, user: { id: "u1" } }) : json(400, { error_code: "refresh_token_not_found" });
    return json(404, {});
  };
  const storage = memStorage();
  const auth = createAuth({ url: "https://sb.test", key: "pk", fetchFn, storage, now: () => t });
  const changes = [];
  auth.onChange((s) => changes.push(s?.access_token ?? null));
  await auth.signIn({ email: "a@b.it", password: "segreta123" });
  assert.equal(auth.user.id, "u1");
  assert.equal(await auth.accessToken(), "A1");
  assert.ok(storage.m.get("studify-session").includes("R1"), "sessione nel browser");
  assert.equal(createAuth({ url: "x", key: "k", fetchFn, storage, now: () => t }).user.id, "u1", "ricaricando la pagina la sessione resta");

  t += 3590 * 1000; // a meno di un minuto dalla scadenza
  const [a, b] = await Promise.all([auth.accessToken(), auth.accessToken()]);
  assert.equal(a, "A2");
  assert.equal(b, "A2");
  assert.equal(calls.filter((c) => c.url.includes("refresh_token")).length, 1, "un solo rinnovo anche con richieste in parallelo");
  assert.equal(calls.at(-1).body.refresh_token, "R1");

  t += 3600 * 1000;
  refreshOk = false;
  await assert.rejects(auth.accessToken());
  assert.equal(auth.session, null);
  assert.equal(changes.at(-1), null, "la schermata d'accesso viene avvisata");
  assert.equal(storage.m.has("studify-session"), false);
});

test("registrazione: metadati del consenso e indirizzo di ritorno; conferma email richiesta", async () => {
  let sent;
  const fetchFn = async (url, init) => ((sent = { url, body: JSON.parse(init.body), headers: init.headers }), json(200, { id: "u9", email: "n@b.it" }));
  const auth = createAuth({ url: "https://sb.test", key: "pk", fetchFn, storage: memStorage() });
  const r = await auth.signUp({ email: "n@b.it", password: "segreta123", redirectTo: "https://studify.app/", metadata: { terms_version: "2026-10-05", adult: true } });
  assert.deepEqual(r, { confirm: true });
  assert.equal(sent.url, "https://sb.test/auth/v1/signup?redirect_to=https%3A%2F%2Fstudify.app%2F");
  assert.deepEqual(sent.body.data, { terms_version: "2026-10-05", adult: true });
  assert.equal(sent.headers.apikey, "pk");
  assert.equal(auth.session, null, "nessuna sessione finché l'email non è confermata");
});

test("modulo di registrazione: email, password, termini, privacy e maggiore età obbligatori", () => {
  const ok = { email: "a@b.it", password: "segreta123", terms: true, privacy: true, adult: true };
  assert.deepEqual(signupProblems(ok), []);
  assert.equal(signupProblems({ ...ok, email: "a@b" }).length, 1);
  assert.match(signupProblems({ ...ok, password: "corta1" })[0], /8 caratteri/);
  assert.match(signupProblems({ ...ok, password: "solamentelettere" })[0], /lettere e numeri/);
  assert.match(signupProblems({ ...ok, terms: false })[0], /Termini/);
  assert.match(signupProblems({ ...ok, privacy: false })[0], /Informativa/);
  assert.match(signupProblems({ ...ok, adult: false })[0], /18 anni/);
  assert.equal(signupProblems({}).length, 5);
});

/* ------------------------------- sample e db ------------------------------- */

const fakeAuth = { accessToken: async () => "AT", user: { id: "u1" } };
const ndjson = (lines, status = 200) => new Response(new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    // spezzato a metà riga: il lettore deve ricomporre
    c.enqueue(enc.encode(text.slice(0, 7)));
    c.enqueue(enc.encode(text.slice(7)));
    c.close();
  },
}), { status, headers: { "Content-Type": "application/x-ndjson" } });

test("sample: testo in streaming con onText, immagini in base64, .json e .limits", async () => {
  let sent;
  const fetchFn = async (url, init) => ((sent = { url, init, body: JSON.parse(init.body) }), ndjson([{ type: "text", delta: '{"topics":' }, { type: "text", delta: "[1,2]}" }, { type: "done", truncated: false }]));
  const sample = createSample({ auth: fakeAuth, fetchFn });
  const seen = [];
  const r = await sample("Prompt", { onText: ({ text }) => seen.push(text), images: [new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })] });
  assert.deepEqual(r, { text: '{"topics":[1,2]}', truncated: false, modelTierApplied: "default" });
  assert.deepEqual(seen, ['{"topics":', '{"topics":[1,2]}']);
  assert.equal(sent.url, "/api/claude");
  assert.equal(sent.init.headers.Authorization, "Bearer AT");
  assert.deepEqual(sent.body.images, [{ data: "AQID", mediaType: "image/png" }]);
  assert.equal(sent.body.json, false);
  assert.deepEqual(await sample.json("P"), { topics: [1, 2] });
  assert.equal(sent.body.json, true);
  assert.ok((await sample.limits()).images.maxCount <= 3, "limite immagini compatibile con i 4,5 MB di Vercel");
});

test("sample: errori come oggetti { code } (come la capability della pagina Claude)", async () => {
  const run = async (res) => {
    const sample = createSample({ auth: fakeAuth, fetchFn: async () => res });
    try {
      await sample("x");
    } catch (e) {
      return e;
    }
    return null;
  };
  const quota = await run(json(429, { code: "quota_exceeded", message: "Hai usato tutto il credito" }));
  assert.equal(quota.code, "quota_exceeded");
  assert.equal(quota.message, "Hai usato tutto il credito");
  assert.equal(quota instanceof Error, false, "explain() traduce solo gli oggetti, non gli Error");
  assert.equal((await run(json(401, {}))).code, "session_expired");
  assert.equal((await run(ndjson([{ type: "text", delta: "ab" }, { type: "error", code: "refused" }]))).code, "refused");
  assert.equal((await run(ndjson([{ type: "text", delta: "ab" }]))).code, "server_error", "risposta interrotta senza «done»");
  assert.equal((await run(ndjson([{ type: "done", truncated: false }]))).code, "empty_completion");
  const noAuth = createSample({ auth: { accessToken: async () => null }, fetchFn: async () => assert.fail("nessuna richiesta senza accesso") });
  await assert.rejects(noAuth("x"), (e) => e.code === "session_expired");
});

test("JSON dalle risposte: con blocchi di codice o testo attorno", () => {
  assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonText('```json\n{"a":[1]}\n```'), { a: [1] });
  assert.deepEqual(parseJsonText('Ecco:\n{"a":2}\nFine.'), { a: 2 });
  assert.throws(() => parseJsonText("niente"), (e) => e.code === "invalid_json");
});

test("db: documenti sulla tabella docs (upsert, lettura, cancellazione) con il token dell'utente", async () => {
  const calls = [];
  const rows = new Map();
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const id = decodeURIComponent(/doc_id=eq\.([^&]+)/.exec(url)?.[1] ?? "");
    if (init.method === "POST") {
      const b = JSON.parse(init.body);
      rows.set(b.doc_id, b.data);
      return new Response(null, { status: 201 });
    }
    if (init.method === "DELETE") return rows.delete(id), new Response(null, { status: 204 });
    return json(200, rows.has(id) ? [{ data: rows.get(id) }] : []);
  };
  const col = createDb({ url: "https://sb.test", key: "pk", auth: fakeAuth, fetchFn }).collection("data/users/u1");
  const doc = col.doc("c_e.abc.core_0");
  assert.equal((await doc.get()).exists, false);
  await doc.set({ s: "àèì" });
  const post = calls.at(-1);
  assert.equal(post.url, "https://sb.test/rest/v1/docs?on_conflict=user_id,doc_id");
  assert.match(post.init.headers.Prefer, /merge-duplicates/);
  assert.equal(post.init.headers.Authorization, "Bearer AT");
  assert.equal(JSON.parse(post.init.body).user_id, "u1");
  const got = await doc.get();
  assert.equal(got.exists, true);
  assert.deepEqual(got.data(), { s: "àèì" });
  assert.match(calls.at(-1).url, /docs\?select=data&doc_id=eq\.c_e\.abc\.core_0$/);
  await doc.delete();
  assert.equal((await doc.get()).exists, false);
  const expired = createDb({ url: "u", key: "k", auth: fakeAuth, fetchFn: async () => json(401, {}) }).collection("x").doc("y");
  await assert.rejects(expired.get(), (e) => e.code === "session_expired");
});

test("schermata d'accesso: quella scelta dalla landing, altrimenti accesso per chi torna e registrazione per i nuovi", () => {
  assert.equal(initialMode({ search: "?entra=registrati", returning: true }), "signup");
  assert.equal(initialMode({ search: "?entra=accedi" }), "login");
  assert.equal(initialMode({ search: "" }), "signup");
  assert.equal(initialMode({ search: "", returning: true }), "login");
  assert.equal(initialMode({ search: "?entra=boh", returning: true }), "login", "valore sconosciuto: si ignora");
});

test("anti-spam: campo trappola compilato o invio troppo rapido", () => {
  assert.equal(looksLikeBot({ honeypot: "", elapsedMs: 8000 }), false, "persona: campo vuoto, qualche secondo per compilare");
  assert.equal(looksLikeBot({ honeypot: "http://spam.example", elapsedMs: 8000 }), true);
  assert.equal(looksLikeBot({ honeypot: "", elapsedMs: 300 }), true, "modulo inviato in 0,3 secondi");
  assert.equal(looksLikeBot({ honeypot: "  ", elapsedMs: MIN_FILL_MS }), false, "spazi: non conta, e il limite è incluso");
});
