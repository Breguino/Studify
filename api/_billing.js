// Abbonamenti con Stripe (versione web): limiti per piano, pagamento (Checkout), portale per gestirlo e webhook.
// Parte pura e testata; le chiamate di rete hanno `fetchFn` iniettabile. Nessuna dipendenza: API REST di Stripe con fetch.
// Tutto è spento finché su Vercel non c'è BILLING=on: fino ad allora il credito resta quello di sempre per tutti.
import { createHmac, timingSafeEqual } from "node:crypto";
import { activePlan, isBillingOn, PAID, PLANS } from "../public/js/plans.js";
import { getUser, HttpError } from "./_lib.js";

export const billingOn = (env) => isBillingOn(env.BILLING);

const PRICE_VARS = ["STRIPE_PRICE_BASE_MONTH", "STRIPE_PRICE_BASE_YEAR", "STRIPE_PRICE_PRO_MONTH", "STRIPE_PRICE_PRO_YEAR"];
/**
 * Che cosa manca per gli abbonamenti, senza mai un valore: solo presente/assente (e test/live dal prefisso della chiave).
 * La dice GET /api/claude, così si capisce da fuori perché il pagamento non parte.
 */
export function billingSetup(env) {
  const key = String(env.STRIPE_SECRET_KEY ?? "");
  return {
    billing: env.BILLING == null || env.BILLING === "" ? "assente" : billingOn(env) ? "on" : "valore non riconosciuto",
    stripeKey: !key ? "assente" : key.startsWith("sk_test_") ? "test" : key.startsWith("sk_live_") ? "live" : key.startsWith("rk_") ? "chiave limitata" : "non riconosciuta",
    webhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    prices: PRICE_VARS.filter((k) => !env[k]),
    serviceKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

/** Credito di Claude al mese (dollari) per un piano. Senza abbonamenti attivi resta USER_MONTHLY_LIMIT_USD (3 $). */
export function planLimit(env, plan) {
  if (plan === "base") return Number(env.BASE_MONTHLY_LIMIT_USD ?? PLANS.base.credit);
  if (plan === "pro") return Number(env.PRO_MONTHLY_LIMIT_USD ?? PLANS.pro.credit);
  return Number(env.USER_MONTHLY_LIMIT_USD ?? (billingOn(env) ? PLANS.free.credit : 3));
}

/** Variabile d'ambiente con l'id del Price di Stripe per piano e periodo (es. STRIPE_PRICE_BASE_YEAR). */
const priceVar = (plan, interval) => `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEAR" : "MONTH"}`;

/** id del Price → { plan, interval }, o null se non è uno dei nostri. */
export function planFromPrice(env, priceId) {
  for (const plan of PAID) for (const interval of ["month", "year"]) if (priceId && env[priceVar(plan, interval)] === priceId) return { plan, interval };
  return null;
}

/* ------------------------------ firma del webhook ------------------------------ */

/** Verifica l'intestazione Stripe-Signature (t=…,v1=…) sul corpo grezzo; tolleranza 5 minuti. */
export function verifyStripeSignature(raw, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((kv) => kv.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const sigs = String(header).split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Firma come la calcola Stripe (per le prove). */
export const signForTest = (raw, secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;

/* ------------------------------ eventi → riga ------------------------------ */

/** Oggetto Subscription di Stripe → riga della tabella `subscriptions` (o null se manca l'utente o il prezzo). */
export function subscriptionRow(env, sub, eventAt) {
  const userId = sub?.metadata?.user_id;
  const item = sub?.items?.data?.[0];
  const p = planFromPrice(env, item?.price?.id);
  if (!userId || !p) return null;
  const end = sub.current_period_end ?? item?.current_period_end; // nelle versioni recenti dell'API sta sulla voce
  return {
    p_user_id: userId,
    p_plan: p.plan,
    p_interval: p.interval,
    p_status: sub.status,
    p_period_end: end ? new Date(end * 1000).toISOString() : null,
    p_cancel_at_period_end: !!sub.cancel_at_period_end,
    p_customer: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    p_subscription: sub.id,
    p_event_at: new Date((eventAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

export const HANDLED_EVENTS = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "checkout.session.completed"]);

/* ------------------------------ rete ------------------------------ */

const form = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? `${prefix}[${k}]` : k;
  if (v == null) return [];
  if (typeof v === "object") return form(v, key);
  return [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
}).join("&");

export async function stripe(env, method, path, body, fetchFn = fetch) {
  const r = await fetchFn(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? (typeof body === "string" ? body : form(body)) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`stripe ${path}: ${r.status} ${data?.error?.message ?? ""}`), { status: r.status });
  return data;
}

const sbUser = (env, token) => ({ apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

/** Abbonamento dell'utente (con il suo token: RLS fa vedere solo la propria riga), o null. Tabella assente → null. */
export async function readSubscription(env, token, fetchFn = fetch) {
  const r = await fetchFn(`${env.SUPABASE_URL}/rest/v1/subscriptions?select=plan,billing_interval,status,current_period_end,cancel_at_period_end,stripe_customer_id`, { headers: sbUser(env, token) });
  if (!r.ok) return null;
  return (await r.json())?.[0] ?? null;
}

/** Scrive la riga con la chiave di servizio (solo il webhook): ignora eventi più vecchi di quello già salvato. */
export async function saveSubscription(env, row, fetchFn = fetch) {
  const k = env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/billing_upsert`, {
    method: "POST",
    headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`billing_upsert: ${r.status}`);
}

const siteUrl = (env, req) => (env.SITE_URL || `https://${req.headers?.host ?? "localhost"}`).replace(/\/$/, "");

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

async function jsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req.body === "string" ? req.body : await rawBody(req);
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "bad_request", "Richiesta non valida.");
  }
}

/** Corpo grezzo: prima dal flusso della richiesta (senza toccare req.body, che Vercel trasforma), poi da req.body se è testo. */
export async function rawBody(req) {
  if (typeof req[Symbol.asyncIterator] === "function" && req.readable !== false) {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  }
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return "";
}

/**
 * /api/billing (POST, con il token dell'utente):
 *   { action: "checkout", plan: "base"|"pro", interval: "month"|"year", startNow: true } → { url } della pagina di pagamento Stripe
 *   { action: "portal" } → { url } del portale Stripe (cambia piano, carta, disdetta, ricevute)
 */
export function createBillingHandler({ env, fetchFn = fetch, log = console.error }) {
  return async function handler(req, res) {
    try {
      if (req.method !== "POST") throw new HttpError(405, "bad_request", "Usa POST.");
      if (!billingOn(env) || !env.STRIPE_SECRET_KEY) throw new HttpError(503, "billing_off", "Gli abbonamenti non sono ancora attivi.");
      const token = /^Bearer (.+)$/.exec(req.headers?.authorization ?? "")?.[1];
      const user = token ? await getUser(env, token, fetchFn) : null;
      if (!user) throw new HttpError(401, "session_expired");
      const body = await jsonBody(req);
      const sub = await readSubscription(env, token, fetchFn);
      const base = siteUrl(env, req);

      if (body.action === "portal") {
        if (!sub?.stripe_customer_id) throw new HttpError(400, "no_subscription", "Non hai un abbonamento da gestire.");
        const s = await stripe(env, "POST", "billing_portal/sessions", { customer: sub.stripe_customer_id, return_url: `${base}/app`, locale: "it" }, fetchFn);
        return send(res, 200, { url: s.url });
      }
      if (body.action === "checkout") {
        const { plan, interval } = body;
        const price = PAID.includes(plan) && ["month", "year"].includes(interval) ? env[priceVar(plan, interval)] : null;
        if (!price) throw new HttpError(400, "bad_request", "Piano non valido.");
        if (body.startNow !== true) throw new HttpError(400, "consent_required", "Conferma di voler iniziare subito l'abbonamento.");
        if (activePlan(sub) !== "free") throw new HttpError(409, "already_subscribed", "Hai già un abbonamento: cambialo da «Gestisci abbonamento».");
        const s = await stripe(env, "POST", "checkout/sessions", {
          mode: "subscription",
          "line_items[0][price]": price,
          "line_items[0][quantity]": 1,
          client_reference_id: user.id,
          ...(sub?.stripe_customer_id ? { customer: sub.stripe_customer_id } : { customer_email: user.email }),
          subscription_data: { metadata: { user_id: user.id, start_now_consent: new Date().toISOString() } },
          metadata: { user_id: user.id },
          allow_promotion_codes: "true",
          locale: "it",
          success_url: `${base}/app?abbonamento=ok`,
          cancel_url: `${base}/app?abbonamento=annullato`,
        }, fetchFn);
        return send(res, 200, { url: s.url });
      }
      throw new HttpError(400, "bad_request", "Azione non valida.");
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { code: e.code, message: e.message });
      log(`billing: ${String(e?.message ?? e).slice(0, 300)}`);
      return send(res, 502, { code: "server_error", message: "Il servizio di pagamento non risponde. Riprova tra poco." });
    }
  };
}

/** /api/stripe-webhook: Stripe avvisa dei cambi di abbonamento; la riga in Supabase segue. */
export function createWebhookHandler({ env, fetchFn = fetch, log = console.error }) {
  return async function handler(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "POST" });
    const raw = await rawBody(req);
    let ev;
    if (raw) {
      if (!verifyStripeSignature(raw, req.headers?.["stripe-signature"], env.STRIPE_WEBHOOK_SECRET)) return send(res, 400, { error: "firma non valida" });
      try {
        ev = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "json" });
      }
    } else {
      // corpo già trasformato dalla piattaforma: la firma non si può verificare, quindi l'evento si rilegge da Stripe
      const id = req.body?.id;
      if (!/^evt_[A-Za-z0-9]+$/.test(id ?? "") || !req.headers?.["stripe-signature"]) return send(res, 400, { error: "evento non valido" });
      try {
        ev = await stripe(env, "GET", `events/${id}`, null, fetchFn);
      } catch {
        return send(res, 400, { error: "evento sconosciuto a Stripe" });
      }
    }
    if (!HANDLED_EVENTS.has(ev.type)) return send(res, 200, { ignored: ev.type });
    try {
      let sub = ev.data?.object;
      if (ev.type === "checkout.session.completed") {
        if (sub?.mode !== "subscription" || !sub.subscription) return send(res, 200, { ignored: "checkout senza abbonamento" });
        sub = await stripe(env, "GET", `subscriptions/${encodeURIComponent(sub.subscription)}`, null, fetchFn);
      }
      const row = subscriptionRow(env, sub, ev.created);
      if (!row) {
        log(`stripe-webhook: ${ev.type} senza utente o con un prezzo sconosciuto`);
        return send(res, 200, { ignored: "non nostro" });
      }
      await saveSubscription(env, row, fetchFn);
      return send(res, 200, { ok: true });
    } catch (e) {
      log(`stripe-webhook: ${String(e?.message ?? e).slice(0, 300)}`);
      return send(res, 500, { error: "riprova" }); // Stripe ritenta da solo
    }
  };
}
