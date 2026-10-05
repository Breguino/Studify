// Tipi di materiale: cambiano il modo in cui l'AI li usa (vedi shared/prompts.js, principio 7).
export const ROLES = { appunti: "Appunti", sbobine: "Sbobine (lezioni trascritte)", libro: "Libro", slide: "Slide del docente", dispense: "Dispense", esercizi: "Esercizi", svolti: "Esercizi svolti dal docente", esami: "Esami passati (temi d'esame)", domande: "Domande d'esame (elenchi)", altro: "Altro" };

/** Tipo probabile dal nome del file (modificabile dallo studente). */
export function guessRole(fileName, isPdf = false) {
  const n = String(fileName ?? "").toLowerCase().replace(/[_\-.'’]+/g, " ");
  if (/sbobin|trascrizion|registrazion/.test(n)) return "sbobine";
  // elenchi di domande uscite (spesso raccolte dagli studenti, tipiche dell'orale)
  if (/domand[ae] (d )?esam[ei]|domand[ae] (dell )?oral[ei]|domand[ae] (uscit|frequent|chiest|raccolt)|domande (di )?teoria|faq|exam questions/.test(n)) return "domande";
  // prove d'esame vere: «Temi d'esame 2024», «Appello 12 01 2024», «Compito A», «Prove scritte»
  if (/\btemi\b|\btema d esame|prov[ae] d esame|prov[ae] scritt[ae]|prov[ae] intermedi[ae]|\bcompit[io]\b|appell[oi]|esoner[oi]|esami (passati|vecchi|anni)|past (exams?|papers?)/.test(n)) return "esami";
  // esercizi risolti dal docente (a lezione, in esercitazione): il procedimento da imparare
  if (/\bsvolt[aeio]\b|\brisolt[aeio]\b|worked|svolgiment/.test(n)) return "svolti";
  // «Esercizi per l'esame» è un eserciziario, non una prova
  if (/eserciz|esercitaz|soluzion|exercis|problem set/.test(n)) return "esercizi";
  if (/\besam[ei]\b|\bexams?\b/.test(n)) return "esami";
  // slide (anche in PDF): schematiche, la traccia del corso; le dispense sono testo scritto per esteso
  if (/\bpptx?\b|slide|lucid|presentazion/.test(n)) return "slide";
  if (/dispens|lezion|lecture|appunti del docente/.test(n)) return "dispense";
  if (/\blibro\b|manuale|textbook|\bbook\b|capitol|\bcap\b\s*\d|chapter/.test(n)) return "libro";
  if (/appunt|note|notes/.test(n)) return "appunti";
  return isPdf ? "dispense" : "appunti";
}

/** Tipo di un materiale salvato prima che esistessero i tipi. */
export const roleOf = (m) => m.role ?? (m.kind === "pdf" ? "dispense" : "appunti");

/** Materiali da cui la modalità base non ricava argomenti e carte (eserciziari, esercizi svolti, prove d'esame, elenchi di domande). */
export const isPractice = (m) => ["esercizi", "svolti", "esami", "domande"].includes(roleOf(m));
