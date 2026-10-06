// `window.claude` per la versione web: le stesse capability usate dalla pagina Claude (sample, db, user),
// ma servite da Supabase (dati) e dalla funzione /api/claude (Claude con il credito di Studify).

export const LIMITS = { maxPromptBytes: 262_144, images: { maxCount: 3, maxInputBytes: 3_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } };

/** Testo di una risposta → oggetto JSON (tollera blocchi ```json e testo attorno). */
export function parseJsonText(text) {
  const t = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[{[]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* sotto */
      }
    }
    throw { code: "invalid_json" };
  }
}

// Come la capability `sample`, gli errori sono oggetti { code } (non Error): explain() li traduce per l'utente.
const sampleError = (code, message) => (message ? { code, message } : { code });

async function imagePayload(img) {
  if (img && typeof img.data === "string") return { data: img.data, mediaType: img.mediaType ?? "image/jpeg" };
  const buf = new Uint8Array(await img.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { data: btoa(bin), mediaType: img.type || "image/jpeg" };
}

/** Capability `sample`: (prompt, opts) → { text, truncated }; .json(prompt, opts) → oggetto; .limits(). */
export function createSample({ auth, endpoint = "/api/claude", fetchFn = (...a) => fetch(...a) }) {
  async function run(prompt, opts = {}, json = false) {
    const images = await Promise.all((opts.images ?? []).map(imagePayload));
    const token = await auth.accessToken().catch(() => null);
    if (!token) throw sampleError("session_expired");
    let r;
    try {
      r = await fetchFn(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, images, json }),
        signal: opts.signal,
      });
    } catch (e) {
      throw sampleError(e?.name === "AbortError" ? "cancelled" : "server_error");
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw sampleError(err.code ?? (r.status === 401 ? "session_expired" : r.status === 429 ? "rate_limited" : r.status === 413 ? "prompt_too_large" : "server_error"), err.message);
    }
    let text = "";
    let done = null;
    let buf = "";
    const handle = (raw) => {
      if (!raw.trim()) return;
      const ev = JSON.parse(raw);
      if (ev.type === "text") {
        text += ev.delta;
        opts.onText?.({ text, delta: ev.delta });
      } else if (ev.type === "done") done = ev;
      else if (ev.type === "error") throw sampleError(ev.code);
    };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    handle(buf + dec.decode());
    if (!done) throw sampleError("server_error"); // risposta interrotta (tempo massimo della funzione?)
    if (!text.trim()) throw sampleError("empty_completion");
    return { text, truncated: !!done.truncated, modelTierApplied: "default" };
  }
  const sample = (prompt, opts) => run(prompt, opts);
  sample.json = async (prompt, opts) => parseJsonText((await run(prompt, opts, true)).text);
  sample.limits = async () => LIMITS;
  return sample;
}

/** Capability `db` sulla tabella `docs` di Supabase (RLS: ognuno legge e scrive solo le proprie righe). */
export function createDb({ url, key, auth, fetchFn = (...a) => fetch(...a), closed = () => false }) {
  async function rest(path, init = {}) {
    const token = await auth.accessToken();
    if (!token) throw sampleError("session_expired");
    const r = await fetchFn(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (r.status === 401) throw sampleError("session_expired");
    if (!r.ok) throw new Error(`Archivio: errore ${r.status}`);
    return r;
  }
  const doc = (id) => {
    const q = `doc_id=eq.${encodeURIComponent(id)}`;
    return {
      async get() {
        const rows = await (await rest(`docs?select=data&${q}`)).json();
        return rows.length ? { exists: true, data: () => rows[0].data } : { exists: false, data: () => undefined };
      },
      async set(data) {
        if (closed()) return; // uscita o eliminazione dell'account in corso: nessuna scrittura senza sessione
        const body = JSON.stringify({ user_id: auth.user.id, doc_id: id, data, updated_at: new Date().toISOString() });
        await rest("docs?on_conflict=user_id,doc_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body,
          keepalive: body.length < 60_000, // la scrittura finisce anche se la pagina si chiude (limite del browser: 64 KB)
        });
      },
      async delete() {
        if (closed()) return;
        await rest(`docs?${q}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      },
    };
  };
  // Il percorso della collezione (data/users/<id>) è implicito: le righe sono già dell'utente.
  return { collection: () => ({ doc }) };
}

/** Chiamata a una funzione SQL esposta (rpc) con il token dell'utente. */
export async function rpc({ url, key, auth, fetchFn = (...a) => fetch(...a) }, name, args = {}) {
  const token = await auth.accessToken();
  const r = await fetchFn(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw Object.assign(new Error(`rpc ${name}: ${r.status}`), { status: r.status });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** Installa window.claude: ogni capability attende che l'utente abbia fatto l'accesso. */
export function installClaude({ ready, auth, url, key }) {
  let closed = false;
  const caps = {
    sample: createSample({ auth }),
    db: createDb({ url, key, auth, closed: () => closed }),
    user: { id: async () => auth.user?.id ?? null, isOwner: async () => true },
  };
  window.claude = {
    web: true,
    async use(name) {
      await ready;
      return caps[name] ?? null;
    },
  };
  return { close: () => (closed = true), reopen: () => (closed = false) };
}
