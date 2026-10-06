// Parte pura della funzione /api/claude (Vercel): controlli, costi e chiamate a Supabase.
// I file con «_» in api/ non diventano endpoint.

export const MAX_PROMPT_BYTES = 262_144; // come la capability `sample` delle pagine Claude
export const MAX_IMAGES = 3; // il corpo di una richiesta a Vercel non può superare 4,5 MB
export const MAX_IMAGE_BYTES = 3_500_000; // totale delle immagini in base64
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Dollari per milione di token: [ingresso, uscita].
const PRICES = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-opus-4-8": [5, 25], "claude-opus-5": [5, 25] };

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/** Costo di una risposta in dollari (cache: scrittura 1,25×, lettura 0,1× del prezzo d'ingresso). */
export function costUsd(model, usage = {}) {
  const [pin, pout] = PRICES[model] ?? PRICES[Object.keys(PRICES).find((m) => model?.startsWith(m))] ?? PRICES["claude-opus-5-5"];
  const input = (usage.input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0);
  return (input * pin + (usage.output_tokens ?? 0) * pout) / 1e6;
}

/** Corpo della richiesta → { prompt, images, json }, oppure HttpError. */
export function readBody(body) {
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new HttpError(400, "bad_request", "Richiesta non valida.");
    }
  }
  const prompt = body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) throw new HttpError(400, "bad_request", "Richiesta senza testo.");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) throw new HttpError(413, "prompt_too_large");
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new HttpError(413, "prompt_too_large", `Al massimo ${MAX_IMAGES} immagini per richiesta.`);
  let bytes = 0;
  for (const img of images) {
    if (!IMAGE_TYPES.has(img?.mediaType) || typeof img.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(img.data)) throw new HttpError(400, "bad_request", "Immagine non valida.");
    bytes += img.data.length;
  }
  if (bytes > MAX_IMAGE_BYTES) throw new HttpError(413, "prompt_too_large", "Immagini troppo pesanti.");
  return { prompt, images, json: body.json === true };
}

/** Parametri della richiesta a Claude (Messages API). */
export function messageParams({ prompt, images, json }, { model, maxTokens }) {
  return {
    model,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // se il modello rifiuta per una regola di sicurezza, l'API riprova su quello consigliato
    ...(json ? { system: "Rispondi solo con JSON valido: nessun testo prima o dopo, nessun blocco di codice." } : {}),
    messages: [{
      role: "user",
      content: [
        ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
        { type: "text", text: prompt },
      ],
    }],
  };
}

/** Errore dell'API di Claude → codice per l'app (gli stessi della capability `sample`). */
export function claudeErrorCode(e) {
  const s = e?.status;
  const msg = e?.message ?? "";
  if (e?.name === "APIUserAbortError" || e?.name === "AbortError") return "cancelled";
  if (s === 429 || s === 529) return "rate_limited";
  if (/credit balance|billing|purchase credits|spend limit|usage limit/i.test(msg)) return "billing"; // credito Anthropic del gestore esaurito
  if (s === 413 || (s === 400 && /prompt is too long|too many tokens|exceed/i.test(msg))) return "prompt_too_large";
  if (s === 401) return "invalid_key"; // chiave sbagliata o revocata
  if (s === 403) return "sampling_disabled";
  if (s === 404 || /model/i.test(msg) && s === 400) return "model_unavailable";
  return "server_error";
}

/* ----------------------------- Supabase ----------------------------- */

const sb = (env, token) => ({ apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

/** Utente del token (verificato da Supabase), oppure null. */
export async function getUser(env, token, fetchFn = fetch) {
  const r = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, { headers: sb(env, token) });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? u : null;
}

/** Spesa del mese: { mine, total } in dollari. */
export async function monthSpend(env, token, fetchFn = fetch) {
  const r = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/ai_spend_this_month`, { method: "POST", headers: sb(env, token), body: "{}" });
  if (!r.ok) throw new HttpError(503, "server_error", "Non riesco a leggere il consumo.");
  const row = (await r.json())?.[0] ?? {};
  return { mine: Number(row.mine ?? 0), total: Number(row.total ?? 0) };
}

export async function recordUsage(env, token, { input, output, cost }, fetchFn = fetch) {
  const r = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/record_ai_usage`, {
    method: "POST",
    headers: sb(env, token),
    body: JSON.stringify({ p_input: input, p_output: output, p_cost: Number(cost.toFixed(6)) }),
  });
  if (!r.ok) throw new Error(`record_ai_usage: ${r.status}`);
}

/** Limiti di spesa in dollari al mese (variabili d'ambiente su Vercel). */
export const limits = (env) => ({
  user: Number(env.USER_MONTHLY_LIMIT_USD ?? 3),
  total: Number(env.TOTAL_MONTHLY_LIMIT_USD ?? 30),
});

/** Controlli prima di chiamare Claude: utente, credito. Restituisce l'utente. */
export async function authorize(env, authHeader, fetchFn = fetch) {
  const token = /^Bearer (.+)$/.exec(authHeader ?? "")?.[1];
  if (!token) throw new HttpError(401, "session_expired");
  const user = await getUser(env, token, fetchFn);
  if (!user) throw new HttpError(401, "session_expired");
  const spend = await monthSpend(env, token, fetchFn);
  const lim = limits(env);
  if (spend.mine >= lim.user) throw new HttpError(429, "quota_exceeded", "Hai usato tutto il credito di Claude di questo mese: si rinnova il primo del mese.");
  if (spend.total >= lim.total) throw new HttpError(429, "quota_exceeded", "Il credito di Claude di Studify per questo mese è esaurito: riprova il mese prossimo.");
  return { user, token };
}

/**
 * Gestore della richiesta (dipendenze iniettate per le prove).
 * Risposta: righe JSON (NDJSON) — {"type":"text","delta"} …, poi {"type":"done","truncated"} oppure {"type":"error","code"}.
 */
export function createHandler({ env, anthropic, fetchFn = fetch, log = console.error }) {
  const model = env.ANTHROPIC_MODEL || "claude-opus-5-5";
  const maxTokens = Number(env.ANTHROPIC_MAX_TOKENS ?? 32000);
  return async function handler(req, res) {
    const fail = (status, code, message) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code, message }));
    };
    if (req.method === "GET") {
      // limite mensile per utente, mostrato nella finestra «Account» (nessun dato personale)
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      // solo SE la chiave è configurata (mai il valore): serve a capire «Claude non configurato» senza un account
      return res.end(JSON.stringify({ limits: { user: limits(env).user }, configured: Boolean(env.ANTHROPIC_API_KEY), model }));
    }
    if (req.method !== "POST") return fail(405, "bad_request", "Usa POST.");
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return fail(503, "sampling_disabled", "Server non configurato.");
    let auth, body;
    try {
      auth = await authorize(env, req.headers?.authorization, fetchFn);
      if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "sampling_disabled", "Claude non è ancora configurato su questo server.");
      body = readBody(req.body);
    } catch (e) {
      return e instanceof HttpError ? fail(e.status, e.code, e.message) : (log(e), fail(500, "server_error"));
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const line = (o) => res.write(`${JSON.stringify(o)}\n`);
    const abort = new AbortController();
    req.on?.("close", () => { if (!res.writableEnded) abort.abort(); });
    const usage = { model, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    try {
      const stream = anthropic.beta.messages.stream(messageParams(body, { model, maxTokens }), { signal: abort.signal });
      for await (const ev of stream) {
        if (ev.type === "message_start") {
          usage.model = ev.message?.model ?? model;
          Object.assign(usage, pickUsage(ev.message?.usage));
        } else if (ev.type === "message_delta" && ev.usage) {
          Object.assign(usage, pickUsage(ev.usage));
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          line({ type: "text", delta: ev.delta.text });
        }
      }
      const msg = await stream.finalMessage();
      Object.assign(usage, pickUsage(msg.usage));
      if (msg.stop_reason === "refusal") line({ type: "error", code: "refused" });
      else line({ type: "done", truncated: msg.stop_reason === "max_tokens" });
    } catch (e) {
      const code = claudeErrorCode(e);
      if (code !== "cancelled") log(`claude: ${code} (${e?.status ?? "-"}) ${String(e?.message ?? e).slice(0, 300)}`); // nei log di Vercel
      line({ type: "error", code });
    } finally {
      // il consumo si registra anche se la risposta si è interrotta: i token sono stati pagati
      const input = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
      if (input || usage.output_tokens) {
        await recordUsage(env, auth.token, { input, output: usage.output_tokens, cost: costUsd(usage.model, usage) }, fetchFn).catch(log);
      }
      res.end();
    }
  };
}

const pickUsage = (u) => Object.fromEntries(Object.entries(u ?? {}).filter(([k, v]) => typeof v === "number" && /tokens$/.test(k)));
