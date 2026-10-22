// Credito di Claude del mese (solo versione web, dove Claude usa il credito di Studify): quanto ne resta e che cosa dirlo.
// Funzioni pure, testate. Le richieste lunghe (modulo, dispensa, trascrizioni) controllano il credito prima di partire.

/** Le richieste che consumano molto: prima di partire si avvisa se il credito sta finendo. */
export const HEAVY_JOBS = new Set(["/api/module", "/api/module-extend", "/api/dispensa", "/api/past-exams", "/api/transcribe", "/api/transcribe-pdf", "/api/research", "/api/grade-exam"]);

export const LOW = 0.8; // da qui in su si avvisa prima di una richiesta lunga

/** { spent, limit } in dollari → stato del credito; null se il limite non è noto. Con `upsell` (abbonamenti attivi,
 *  piano Gratis) il testo ricorda che con un abbonamento il credito è più alto. */
export function creditState({ spent, limit, upsell = false } = {}) {
  if (!(limit > 0) || !Number.isFinite(spent)) return null;
  const used = Math.max(0, spent / limit);
  const pct = Math.min(100, Math.round(used * 100));
  const level = used >= 1 ? "out" : used >= LOW ? "low" : "ok";
  const text = level === "out"
    ? "Credito di Claude del mese finito: si rinnova il primo del mese. Flashcard, quiz e piano funzionano lo stesso."
    : level === "low"
      ? `Credito di Claude quasi finito: ${pct}% usato questo mese. Una richiesta con molti materiali potrebbe non arrivare in fondo.`
      : `Credito di Claude del mese: ${pct}% usato.`;
  const more = upsell && level !== "ok" ? " Con un abbonamento il credito è più alto: Account → Abbonamento." : "";
  return { used, pct, level, text: text + more };
}
