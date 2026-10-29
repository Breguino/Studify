import test from "node:test";
import assert from "node:assert/strict";
import { activePlan, euro, planLine, PLANS, yearSaving } from "../public/js/plans.js";
import { isBillingOn } from "../public/js/plans.js";
import {
  billingSetup, createBillingHandler, usd, createWebhookHandler, planFromPrice, planLimit, signForTest, subscriptionRow, verifyStripeSignature,
} from "../api/_billing.js";
import { authorize, createHandler } from "../api/_lib.js";

const PRICES = { STRIPE_PRICE_BASE_MONTH: "price_bm", STRIPE_PRICE_BASE_YEAR: "price_by", STRIPE_PRICE_PRO_MONTH: "price_pm", STRIPE_PRICE_PRO_YEAR: "price_py" };
const ENV = { SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "pk", SUPABASE_SERVICE_ROLE_KEY: "service", BILLING: "on", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", SITE_URL: "https://studify.test", ...PRICES };
const DAY = 86_400_000;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeRes = () => ({ statusCode: 0, headers: {}, chunks: [], setHeader(k, v) { this.headers[k] = v; }, write(c) { this.chunks.push(c); }, end(c) { if (c) this.chunks.push(c); this.ended = true; }, get body() { return JSON.parse(this.chunks.join("")); } });

/** Supabase e Stripe finti: registrano le chiamate. */
function fakeNet({ sub = null, spent = 0, total = 0, customers = [], stripeSubs = [] } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return init.headers.Authorization === "Bearer jwt" ? json(200, { id: "u1", email: "a@b.it" }) : json(401, {});
    if (url.includes("/rest/v1/subscriptions")) return json(200, sub ? [sub] : []);
    if (url.endsWith("/rpc/ai_spend_this_month")) // come su Supabase: il totale solo alla chiave di servizio
      return json(200, [init.headers.Authorization === "Bearer service" ? { mine: 0, total } : { mine: spent, total: null }]);
    if (url.endsWith("/rpc/billing_upsert")) return new Response(null, { status: 204 });
    if (url.endsWith("/v1/checkout/sessions")) return json(200, { url: "https://checkout.stripe.com/c/1" });
    if (url.endsWith("/v1/billing_portal/sessions")) return json(200, { url: "https://billing.stripe.com/p/1" });
    if (url.includes("/v1/subscriptions/")) return json(200, stripeSub());
    if (url.includes("/v1/customers?")) return json(200, { data: customers });
    if (url.includes("/v1/subscriptions?")) return json(200, { data: stripeSubs.filter((x) => url.includes(`customer=${x.customer}`)) });
    return json(404, {});
  };
  return { fetchFn, calls };
}
const req = ({ method = "POST", body, token = "jwt", headers = {} } = {}) => ({ method, body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, host: "x" } });
const stripeSub = (o = {}) => ({ id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: { user_id: "u1" }, items: { data: [{ price: { id: "price_py" }, current_period_end: 1_800_000_000 }] }, ...o });
const paid = (o = {}) => ({ plan: "pro", billing_interval: "year", status: "active", current_period_end: new Date(Date.now() + 30 * DAY).toISOString(), cancel_at_period_end: false, stripe_customer_id: "cus_1", ...o });

/* ------------------------------- piani ------------------------------- */

test("piani: prezzi mostrati, risparmio dell'annuale, euro all'italiana", () => {
  assert.equal(euro(4.99), "4,99 €");
  assert.equal(euro(49), "49 €");
  assert.equal(yearSaving("base"), 2, "49 € invece di 59,88 €: due mesi gratis");
  assert.equal(yearSaving("pro"), 2);
  assert.equal(yearSaving("free"), 0);
  assert.ok(PLANS.pro.credit > PLANS.base.credit && PLANS.base.credit > PLANS.free.credit);
});

test("piani: piano in uso dalla riga dell'abbonamento", () => {
  assert.equal(activePlan(null), "free");
  assert.equal(activePlan(paid()), "pro");
  assert.equal(activePlan(paid({ status: "past_due" })), "pro", "Stripe sta ritentando il pagamento: si resta abbonati");
  assert.equal(activePlan(paid({ status: "canceled" })), "free");
  assert.equal(activePlan(paid({ current_period_end: new Date(Date.now() - 5 * DAY).toISOString() })), "free", "scaduto da più di 3 giorni");
  assert.equal(activePlan(paid({ plan: "gold" })), "free", "piano sconosciuto");
});

test("piani: frase per l'account (rinnovo, disdetta, pagamento non riuscito)", () => {
  assert.equal(planLine(null), "Piano Gratis.");
  assert.match(planLine(paid({ current_period_end: "2026-11-12T10:00:00Z" })), /^Piano Pro annuale · si rinnova il 12 novembre 2026\.$/);
  assert.match(planLine(paid({ cancel_at_period_end: true })), /termina il/);
  assert.match(planLine(paid({ status: "past_due" })), /pagamento non riuscito/);
});

test("credito per piano: senza abbonamenti attivi resta quello di sempre (3 $)", () => {
  assert.equal(planLimit({}, "free"), 3);
  assert.equal(planLimit({ BILLING: "on" }, "free"), 1); // un modulo intero costa circa 0,55-0,70 $: con meno si fermerebbe a metà
  assert.equal(planLimit({}, "pro"), 5);
  assert.equal(planLimit({ BILLING: "on", USER_MONTHLY_LIMIT_USD: "2" }, "free"), 2);
  assert.equal(planLimit({}, "base"), 3);
  assert.equal(planLimit({ PRO_MONTHLY_LIMIT_USD: "12" }, "pro"), 12);
});

test("prezzo di Stripe → piano e periodo; prezzi sconosciuti ignorati", () => {
  assert.deepEqual(planFromPrice(ENV, "price_by"), { plan: "base", interval: "year" });
  assert.deepEqual(planFromPrice(ENV, "price_pm"), { plan: "pro", interval: "month" });
  assert.equal(planFromPrice(ENV, "price_altro"), null);
  assert.equal(planFromPrice({}, undefined), null);
});

/* ------------------------------- firma ------------------------------- */

test("firma del webhook: valida, segreto sbagliato, corpo alterato, troppo vecchia", () => {
  const raw = JSON.stringify({ id: "evt_1" });
  const sig = signForTest(raw, "whsec_x");
  assert.equal(verifyStripeSignature(raw, sig, "whsec_x"), true);
  assert.equal(verifyStripeSignature(raw, sig, "whsec_y"), false);
  assert.equal(verifyStripeSignature(raw.replace("1", "2"), sig, "whsec_x"), false);
  assert.equal(verifyStripeSignature(raw, signForTest(raw, "whsec_x", Math.floor(Date.now() / 1000) - 600), "whsec_x"), false);
  assert.equal(verifyStripeSignature(raw, undefined, "whsec_x"), false);
  assert.equal(verifyStripeSignature(raw, sig, ""), false, "senza segreto configurato niente passa");
});

test("evento → riga: utente dai metadati, piano dal prezzo, fine periodo (anche sulla voce)", () => {
  const row = subscriptionRow(ENV, stripeSub(), 1_790_000_000);
  assert.equal(row.p_user_id, "u1");
  assert.equal(row.p_plan, "pro");
  assert.equal(row.p_interval, "year");
  assert.equal(row.p_period_end, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(row.p_customer, "cus_1");
  assert.equal(subscriptionRow(ENV, stripeSub({ current_period_end: 1_700_000_000 })).p_period_end, new Date(1_700_000_000 * 1000).toISOString());
  assert.equal(subscriptionRow(ENV, stripeSub({ metadata: {} })), null, "senza utente non si scrive");
  assert.equal(subscriptionRow(ENV, stripeSub({ items: { data: [{ price: { id: "price_altro" } }] } })), null);
});

/* ------------------------------- /api/claude ------------------------------- */

test("credito: l'abbonato Pro ha il suo limite e non è fermato dal tetto di chi non paga", async () => {
  const env = { ...ENV, TOTAL_MONTHLY_LIMIT_USD: "30" };
  await assert.rejects(authorize(env, "Bearer jwt", fakeNet({ spent: 1.2 }).fetchFn), { code: "quota_exceeded", message: /Con un abbonamento il credito è più alto/ });
  const ok = await authorize(env, "Bearer jwt", fakeNet({ spent: 4.5, total: 40, sub: paid() }).fetchFn);
  assert.equal(ok.plan, "pro");
  await assert.rejects(authorize(env, "Bearer jwt", fakeNet({ spent: 5.1, sub: paid() }).fetchFn), { code: "quota_exceeded" });
  await assert.rejects(authorize(env, "Bearer jwt", fakeNet({ spent: 0, total: 31 }).fetchFn), { code: "quota_exceeded" }, "Gratis: vale il tetto complessivo");
});

test("credito: con gli abbonamenti spenti tutto resta com'era (3 $, nessun invito)", async () => {
  const env = { SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "pk" };
  await authorize(env, "Bearer jwt", fakeNet({ spent: 2.5 }).fetchFn);
  await assert.rejects(authorize(env, "Bearer jwt", fakeNet({ spent: 3 }).fetchFn), (e) => e.code === "quota_exceeded" && !/abbonamento/.test(e.message));
});

test("GET /api/claude con il token: piano, credito del piano e abbonamento senza l'id cliente di Stripe", async () => {
  const res = fakeRes();
  await createHandler({ env: ENV, anthropic: null, fetchFn: fakeNet({ sub: paid() }).fetchFn })(req({ method: "GET" }), res);
  const b = res.body;
  assert.equal(b.billing, true);
  assert.equal(b.plan, "pro");
  assert.equal(b.limits.user, 5);
  assert.equal(b.subscription.manageable, true);
  assert.ok(!JSON.stringify(b).includes("cus_1"), "l'id cliente resta sul server");
});

/* ------------------------------- /api/billing ------------------------------- */

test("billing: spento senza BILLING=on, e solo con l'accesso", async () => {
  const res = fakeRes();
  await createBillingHandler({ env: { ...ENV, BILLING: "" }, fetchFn: fakeNet().fetchFn })(req({ body: { action: "checkout" } }), res);
  assert.equal(res.statusCode, 503);
  const res2 = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: fakeNet().fetchFn })(req({ body: { action: "checkout" }, token: "altro" }), res2);
  assert.equal(res2.statusCode, 401);
});

test("billing: il pagamento chiede la conferma di iniziare subito e crea la sessione giusta", async () => {
  const net = fakeNet();
  const res = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: net.fetchFn })(req({ body: { action: "checkout", plan: "base", interval: "year" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "consent_required");

  const res2 = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: net.fetchFn })(req({ body: JSON.stringify({ action: "checkout", plan: "base", interval: "year", startNow: true }) }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.url, "https://checkout.stripe.com/c/1");
  const call = net.calls.find((c) => c.url.endsWith("/v1/checkout/sessions"));
  const form = new URLSearchParams(call.init.body);
  assert.equal(call.init.headers.Authorization, "Bearer sk_test_x");
  assert.equal(form.get("mode"), "subscription");
  assert.equal(form.get("line_items[0][price]"), "price_by");
  assert.equal(form.get("client_reference_id"), "u1");
  assert.equal(form.get("customer_email"), "a@b.it");
  assert.equal(form.get("subscription_data[metadata][user_id]"), "u1", "il webhook ritrova l'utente");
  assert.ok(form.get("subscription_data[metadata][start_now_consent]"), "resta traccia della conferma");
  assert.equal(form.get("success_url"), "https://studify.test/app?abbonamento=ok");
});

test("billing: piano non valido, già abbonato, portale", async () => {
  const res = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: fakeNet().fetchFn })(req({ body: { action: "checkout", plan: "gold", interval: "month", startNow: true } }), res);
  assert.equal(res.statusCode, 400);
  const res2 = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: fakeNet({ sub: paid() }).fetchFn })(req({ body: { action: "checkout", plan: "base", interval: "month", startNow: true } }), res2);
  assert.equal(res2.statusCode, 409);
  const net = fakeNet({ sub: paid() });
  const res3 = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: net.fetchFn })(req({ body: { action: "portal" } }), res3);
  assert.equal(res3.body.url, "https://billing.stripe.com/p/1");
  assert.equal(new URLSearchParams(net.calls.at(-1).init.body).get("customer"), "cus_1");
  const res4 = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: fakeNet().fetchFn })(req({ body: { action: "portal" } }), res4);
  assert.equal(res4.body.code, "no_subscription");
});

test("billing: tornato dal pagamento prima della conferma, non si paga una seconda volta", async () => {
  // la riga in Supabase dice ancora «Gratis» (il webhook non è arrivato), ma Stripe ha già l'abbonamento
  const net = fakeNet({ customers: [{ id: "cus_9" }], stripeSubs: [stripeSub({ customer: "cus_9", status: "active" })] });
  const res = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: net.fetchFn })(req({ body: { action: "checkout", plan: "base", interval: "month", startNow: true } }), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /appena pagato/);
  assert.ok(!net.calls.some((c) => c.url.endsWith("/v1/checkout/sessions")), "nessuna seconda pagina di pagamento");
  assert.match(net.calls.find((c) => c.url.includes("/v1/customers?")).url, /email=a%40b\.it/);
});

test("billing: cliente già noto a Stripe (abbonamento finito) → si riusa, niente secondo cliente", async () => {
  const net = fakeNet({ customers: [{ id: "cus_9" }], stripeSubs: [stripeSub({ customer: "cus_9", status: "canceled" })] });
  const res = fakeRes();
  await createBillingHandler({ env: ENV, fetchFn: net.fetchFn })(req({ body: { action: "checkout", plan: "pro", interval: "year", startNow: true } }), res);
  assert.equal(res.statusCode, 200);
  const form = new URLSearchParams(net.calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).init.body);
  assert.equal(form.get("customer"), "cus_9");
  assert.equal(form.get("customer_email"), null);
});

/* ------------------------------- webhook ------------------------------- */

const hook = (event, secret = "whsec_x") => {
  const raw = JSON.stringify(event);
  return req({ body: raw, token: null, headers: { "stripe-signature": signForTest(raw, secret) } });
};

test("webhook: firma sbagliata → 400, niente scritture", async () => {
  const net = fakeNet();
  const res = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn: net.fetchFn, log: () => {} })(hook({ type: "customer.subscription.updated", data: { object: stripeSub() } }, "whsec_altro"), res);
  assert.equal(res.statusCode, 400);
  assert.ok(!net.calls.some((c) => c.url.includes("billing_upsert")));
});

test("webhook: abbonamento aggiornato → riga salvata con la chiave di servizio", async () => {
  const net = fakeNet();
  const res = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn: net.fetchFn })(hook({ type: "customer.subscription.updated", created: 1_790_000_000, data: { object: stripeSub({ cancel_at_period_end: true }) } }), res);
  assert.equal(res.statusCode, 200);
  const call = net.calls.find((c) => c.url.endsWith("/rpc/billing_upsert"));
  assert.equal(call.init.headers.Authorization, "Bearer service");
  const row = JSON.parse(call.init.body);
  assert.equal(row.p_plan, "pro");
  assert.equal(row.p_cancel_at_period_end, true);
  assert.equal(row.p_event_at, new Date(1_790_000_000 * 1000).toISOString());
});

test("webhook: un secondo abbonamento attivo per lo stesso utente finisce nei log, per il rimborso", async () => {
  const net = fakeNet({ sub: { stripe_subscription_id: "sub_vecchio", status: "active" } });
  const logged = [];
  const res = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn: net.fetchFn, log: (m) => logged.push(m) })(hook({ type: "customer.subscription.created", created: 1_790_000_000, data: { object: stripeSub({ id: "sub_nuovo" }) } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(logged.join(" "), /DUE ABBONAMENTI ATTIVI.*sub_vecchio e sub_nuovo/);
  const check = net.calls.find((c) => c.url.includes("/rest/v1/subscriptions?user_id=eq.u1"));
  assert.equal(check.init.headers.Authorization, "Bearer service", "letto con la chiave di servizio");
  const quiet = [];
  await createWebhookHandler({ env: ENV, fetchFn: fakeNet({ sub: { stripe_subscription_id: "sub_1", status: "active" } }).fetchFn, log: (m) => quiet.push(m) })(hook({ type: "customer.subscription.updated", created: 1_790_000_000, data: { object: stripeSub() } }), fakeRes());
  assert.deepEqual(quiet, [], "lo stesso abbonamento aggiornato: nessun avviso");
});

test("webhook: pagamento completato → legge l'abbonamento da Stripe; eventi d'altro tipo ignorati", async () => {
  const net = fakeNet();
  const res = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn: net.fetchFn })(hook({ type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1" } } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(net.calls.some((c) => c.url.endsWith("/v1/subscriptions/sub_1")));
  assert.ok(net.calls.some((c) => c.url.endsWith("/rpc/billing_upsert")));
  const res2 = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn: net.fetchFn })(hook({ type: "invoice.paid", data: { object: {} } }), res2);
  assert.equal(res2.body.ignored, "invoice.paid");
});

test("webhook: corpo già trasformato in oggetto → l'evento si rilegge da Stripe, mai fidandosi del corpo", async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push(url);
    if (url.endsWith("/v1/events/evt_ok")) return json(200, { id: "evt_ok", type: "customer.subscription.updated", created: 1_790_000_000, data: { object: stripeSub() } });
    if (url.includes("/v1/events/")) return json(404, { error: { message: "no" } });
    if (url.endsWith("/rpc/billing_upsert")) return new Response(null, { status: 204 });
    return json(404, {});
  };
  const forged = { id: "evt_falso", type: "customer.subscription.updated", data: { object: stripeSub({ items: { data: [{ price: { id: "price_py" } }] } }) } };
  const res = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn })({ method: "POST", body: forged, headers: { "stripe-signature": "t=1,v1=x" } }, res);
  assert.equal(res.statusCode, 400, "evento inventato: Stripe non lo conosce");
  assert.ok(!calls.some((u) => u.includes("billing_upsert")));
  const res2 = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn })({ method: "POST", body: { id: "evt_ok" }, headers: { "stripe-signature": "t=1,v1=x" } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.ok(calls.some((u) => u.endsWith("/rpc/billing_upsert")));
});

test("webhook: corpo grezzo letto dal flusso della richiesta", async () => {
  const raw = JSON.stringify({ type: "invoice.paid", data: { object: {} } });
  const stream = Object.assign((async function* () { yield Buffer.from(raw); })(), { method: "POST", readable: true, headers: { "stripe-signature": signForTest(raw, "whsec_x") } });
  const res = fakeRes();
  await createWebhookHandler({ env: ENV, fetchFn: fakeNet().fetchFn })(stream, res);
  assert.equal(res.body.ignored, "invoice.paid");
});

test("BILLING: accesi anche con On, true, 1, sì; spenti con tutto il resto", () => {
  for (const v of ["on", "On", "ON", " on ", "true", "TRUE", "1", "yes", "sì", "si"]) assert.equal(isBillingOn(v), true, v);
  for (const v of [undefined, null, "", "off", "0", "false", "no", "onn"]) assert.equal(isBillingOn(v), false, String(v));
});

test("diagnosi degli abbonamenti in GET /api/claude: solo presente/assente, mai un valore", async () => {
  assert.deepEqual(billingSetup({}), { billing: "assente", stripeKey: "assente", webhookSecret: false, prices: ["STRIPE_PRICE_BASE_MONTH", "STRIPE_PRICE_BASE_YEAR", "STRIPE_PRICE_PRO_MONTH", "STRIPE_PRICE_PRO_YEAR"], serviceKey: false });
  assert.equal(billingSetup({ BILLING: "acceso" }).billing, "valore non riconosciuto");
  assert.equal(billingSetup({ STRIPE_SECRET_KEY: "sk_live_x" }).stripeKey, "live");
  const res = fakeRes();
  await createHandler({ env: { ...ENV, STRIPE_SECRET_KEY: "sk_test_SEGRETO", STRIPE_WEBHOOK_SECRET: "whsec_SEGRETO" }, anthropic: null, fetchFn: fakeNet().fetchFn })(req({ method: "GET", token: null }), res);
  const b = res.body;
  assert.deepEqual(b.setup, { billing: "on", stripeKey: "test", webhookSecret: true, prices: [], serviceKey: true });
  assert.ok(!/SEGRETO|price_|whsec_|sk_test_|"service"/.test(JSON.stringify(b)), "nessun valore delle variabili esce dal server");
});

test("credito: variabili scritte male non tolgono il limite (mai NaN)", () => {
  assert.equal(usd("3", 1), 3);
  assert.equal(usd("1,5", 1), 1.5);
  assert.equal(usd("2 $", 1), 2);
  assert.equal(usd("$4", 1), 4);
  for (const bad of ["", " ", "tre", "1$5x", "-2", undefined, null]) assert.equal(usd(bad, 7), 7, String(bad));
  assert.equal(planLimit({ USER_MONTHLY_LIMIT_USD: "1$" }, "free"), 1);
  assert.equal(planLimit({ USER_MONTHLY_LIMIT_USD: "boh" }, "free"), 3, "non valida: il predefinito, non NaN");
  assert.equal(planLimit({ PRO_MONTHLY_LIMIT_USD: "5,5" }, "pro"), 5.5);
});

test("credito: TOTAL_MONTHLY_LIMIT_USD scritto male non disattiva il tetto complessivo", async () => {
  const env = { ...ENV, TOTAL_MONTHLY_LIMIT_USD: "trenta" };
  await assert.rejects(authorize(env, "Bearer jwt", fakeNet({ spent: 0, total: 31 }).fetchFn), { code: "quota_exceeded" });
});
