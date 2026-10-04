// Tipi di materiale: cambiano il modo in cui l'AI li usa (vedi shared/prompts.js, principio 7).
export const ROLES = { appunti: "Appunti", sbobine: "Sbobine (lezioni trascritte)", libro: "Libro", dispense: "Dispense / slide", esercizi: "Esercizi", esami: "Esami passati (temi d'esame)", altro: "Altro" };

/** Tipo probabile dal nome del file (modificabile dallo studente). */
export function guessRole(fileName, isPdf = false) {
  const n = String(fileName ?? "").toLowerCase().replace(/[_\-.'’]+/g, " ");
  if (/sbobin|trascrizion|registrazion/.test(n)) return "sbobine";
  // prove d'esame vere: «Temi d'esame 2024», «Appello 12 01 2024», «Compito A», «Prove scritte»
  if (/\btemi\b|\btema d esame|prov[ae] d esame|prov[ae] scritt[ae]|prov[ae] intermedi[ae]|\bcompit[io]\b|appell[oi]|esoner[oi]|esami (passati|vecchi|anni)|past (exams?|papers?)/.test(n)) return "esami";
  // «Esercizi per l'esame» è un eserciziario, non una prova
  if (/eserciz|esercitaz|soluzion|exercis|problem set/.test(n)) return "esercizi";
  if (/\besam[ei]\b|\bexams?\b/.test(n)) return "esami";
  if (/dispens|slide|lucid|lezion|lecture|appunti del docente/.test(n)) return "dispense";
  if (/\blibro\b|manuale|textbook|\bbook\b|capitol|\bcap\b\s*\d|chapter/.test(n)) return "libro";
  if (/appunt|note|notes/.test(n)) return "appunti";
  return isPdf ? "dispense" : "appunti";
}

/** Tipo di un materiale salvato prima che esistessero i tipi. */
export const roleOf = (m) => m.role ?? (m.kind === "pdf" ? "dispense" : "appunti");

/** Materiali che non diventano carte e domande così come sono (eserciziari e prove d'esame). */
export const isPractice = (m) => ["esercizi", "esami"].includes(roleOf(m));
