// Accesso con Supabase Auth (API REST, senza librerie): registrazione con conferma dell'email, accesso,
// rinnovo della sessione, recupero della password, uscita. La sessione resta in localStorage.

const KEY = "studify-session";

const MESSAGES = {
  invalid_credentials: "Email o password non corretti.",
  email_not_confirmed: "Prima conferma l'indirizzo email: apri il link che ti abbiamo mandato.",
  user_already_exists: "Esiste già un account con questa email: accedi.",
  email_exists: "Esiste già un account con questa email: accedi.",
  weak_password: "Password troppo debole: usa almeno 8 caratteri, con lettere e numeri.",
  same_password: "La nuova password deve essere diversa da quella attuale.",
  over_email_send_rate_limit: "Sono state inviate troppe email: riprova tra un'ora.",
  over_request_rate_limit: "Troppi tentativi: aspetta qualche minuto e riprova.",
  signup_disabled: "Le registrazioni sono chiuse in questo momento.",
  email_address_invalid: "Indirizzo email non valido.",
  validation_failed: "Controlla i dati inseriti.",
  otp_expired: "Il link è scaduto o è già stato usato: richiedine uno nuovo.",
  session_not_found: "Sessione scaduta: accedi di nuovo.",
  refresh_token_not_found: "Sessione scaduta: accedi di nuovo.",
};

export class AuthError extends Error {
  constructor(code, message) {
    super(MESSAGES[code] ?? message ?? "Accesso non riuscito. Riprova.");
    this.code = code;
  }
}

/** Errore di GoTrue (forme diverse a seconda della versione) → AuthError in italiano. */
export function authError(data = {}, status = 0) {
  const code = data.error_code ?? data.code ?? (data.error === "invalid_grant" ? (/confirm/i.test(data.error_description ?? "") ? "email_not_confirmed" : "invalid_credentials") : null);
  if (typeof code === "string" && MESSAGES[code]) return new AuthError(code);
  if (status === 429) return new AuthError("over_request_rate_limit");
  return new AuthError(typeof code === "string" ? code : "unknown", status >= 500 ? "Il servizio di accesso non risponde. Riprova tra poco." : undefined);
}

/** Frammento dell'URL dopo il link di un'email (#access_token=…&type=signup|recovery|magiclink, oppure #error=…). */
export function parseAuthHash(hash) {
  const p = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  if (p.get("access_token")) {
    return {
      session: { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: Number(p.get("expires_in") ?? 3600), expires_at: Number(p.get("expires_at")) || undefined },
      type: p.get("type") ?? "",
    };
  }
  if (p.get("error") || p.get("error_code")) return { error: new AuthError(p.get("error_code") ?? "unknown", p.get("error_description") ?? undefined) };
  return null;
}

export function createAuth({ url, key, fetchFn = (...a) => fetch(...a), storage = globalThis.localStorage, now = () => Date.now() }) {
  let session = null;
  try {
    session = JSON.parse(storage?.getItem(KEY) ?? "null");
  } catch {
    session = null;
  }
  const listeners = new Set();
  let refreshing = null;

  async function call(path, { method = "POST", body, token } = {}) {
    let r;
    try {
      r = await fetchFn(`${url}/auth/v1/${path}`, {
        method,
        headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AuthError("network", "Connessione non riuscita: controlla la rete.");
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw authError(data, r.status);
    return data;
  }

  function save(s) {
    session = s?.access_token
      ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? Math.floor(now() / 1000) + (s.expires_in ?? 3600), user: s.user ?? session?.user ?? null }
      : null;
    try {
      if (session) storage?.setItem(KEY, JSON.stringify(session));
      else storage?.removeItem(KEY);
    } catch {
      /* archivio del browser non disponibile: la sessione dura finché la pagina resta aperta */
    }
    for (const fn of listeners) fn(session);
  }

  const auth = {
    get session() {
      return session;
    },
    get user() {
      return session?.user ?? null;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** @returns {{ confirm: boolean }} confirm = deve aprire il link nell'email prima di accedere */
    async signUp({ email, password, redirectTo, metadata }) {
      const data = await call(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, { body: { email, password, data: metadata } });
      if (data.access_token) save(data);
      return { confirm: !data.access_token };
    },
    async signIn({ email, password }) {
      save(await call("token?grant_type=password", { body: { email, password } }));
      return session;
    },
    async recover({ email, redirectTo }) {
      await call(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { body: { email } });
    },
    async updatePassword(password) {
      const user = await call("user", { method: "PUT", token: await auth.accessToken(), body: { password } });
      save({ ...session, user });
    },
    async signOut() {
      const token = session?.access_token;
      save(null);
      if (token) await call("logout", { token }).catch(() => {});
    },
    /** Sessione dal link di un'email: { type } se valida. */
    async fromHash(hash) {
      const parsed = parseAuthHash(hash);
      if (!parsed) return null;
      if (parsed.error) throw parsed.error;
      const user = await call("user", { method: "GET", token: parsed.session.access_token });
      save({ ...parsed.session, user });
      return { type: parsed.type };
    },
    /** Token valido per le richieste (rinnovato se sta per scadere); null senza sessione. */
    async accessToken() {
      if (!session) return null;
      if (session.expires_at - 60 > now() / 1000) return session.access_token;
      refreshing ??= call("token?grant_type=refresh_token", { body: { refresh_token: session.refresh_token } })
        .then((data) => save(data))
        .catch((e) => {
          if (e.code !== "network") save(null); // token revocato o scaduto: si torna al login
          throw e;
        })
        .finally(() => (refreshing = null));
      await refreshing;
      return session?.access_token ?? null;
    },
  };
  return auth;
}
