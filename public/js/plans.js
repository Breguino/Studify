// Piani di Studify (versione web): nomi, prezzi mostrati e credito di Claude al mese. Funzioni pure, testate.
// I prezzi veri sono quelli dei «Price» su Stripe (variabili STRIPE_PRICE_* su Vercel): questi servono solo a mostrarli
// e vanno tenuti uguali. Il credito in dollari è il tetto di spesa per Claude (api/_billing.js lo applica): scelto perché
// ogni piano resti in attivo anche se il credito si usa tutto (prezzo senza IVA e commissioni di Stripe > credito).

export const PLANS = {
  free: { id: "free", name: "Gratis", month: 0, year: 0, credit: 0.5, pitch: "Per provare Studify con un esame." },
  base: { id: "base", name: "Base", month: 4.99, year: 49, credit: 3, pitch: "Per un semestre con qualche esame." },
  pro: { id: "pro", name: "Pro", month: 9.99, year: 99, credit: 5, pitch: "Per chi prepara molti esami o carica tanti materiali." },
};
export const PAID = ["base", "pro"];
export const INTERVALS = { month: "al mese", year: "all'anno" };

/** 4.99 → «4,99 €», 49 → «49 €». */
export const euro = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")} €`;

/** Quanto si risparmia con l'annuale rispetto a dodici mensilità, in mesi interi (es. 2). */
export function yearSaving(plan) {
  const p = PLANS[plan];
  if (!p?.month) return 0;
  return Math.round((p.month * 12 - p.year) / p.month);
}

/** Stato dell'abbonamento (riga della tabella `subscriptions`, o null) → piano in uso: "free" | "base" | "pro". */
export function activePlan(sub, now = Date.now()) {
  if (!sub || !PAID.includes(sub.plan)) return "free";
  if (!["active", "trialing", "past_due"].includes(sub.status)) return "free"; // past_due: Stripe sta ritentando il pagamento
  if (sub.current_period_end && Date.parse(sub.current_period_end) + 3 * 86_400_000 < now) return "free"; // 3 giorni di tolleranza
  return sub.plan;
}

/** Frase per l'account: «Piano Base · si rinnova il 12 novembre 2026» o «… · termina il …» se disdetto. */
export function planLine(sub, now = Date.now()) {
  const plan = activePlan(sub, now);
  if (plan === "free") return "Piano Gratis.";
  const name = `Piano ${PLANS[plan].name}${sub.billing_interval === "year" ? " annuale" : " mensile"}`;
  if (!sub.current_period_end) return `${name}.`;
  const d = new Date(sub.current_period_end).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  if (sub.status === "past_due") return `${name} · pagamento non riuscito: aggiorna la carta da «Gestisci abbonamento».`;
  return `${name} · ${sub.cancel_at_period_end ? "termina" : "si rinnova"} il ${d}.`;
}
