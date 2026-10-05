// Tipi di materiale: cambiano il modo in cui l'AI li usa (vedi shared/prompts.js, principio 7).
export const ROLES = { appunti: "Appunti", colleghi: "Appunti di colleghi", sbobine: "Sbobine (lezioni trascritte)", libro: "Libro", slide: "Slide del docente", dispense: "Dispense del docente", esercizi: "Esercizi", svolti: "Esercizi svolti dal docente", esami: "Esami passati (temi d'esame)", domande: "Domande d'esame (elenchi)", quiz: "Quiz del docente (Moodle)", altro: "Altro" };

/** Tipo probabile dal nome del file (modificabile dallo studente). */
export function guessRole(fileName, isPdf = false) {
  const n = String(fileName ?? "").toLowerCase().replace(/[_\-.'’]+/g, " ");
  if (/sbobin|trascrizion|registrazion/.test(n)) return "sbobine";
  // elenchi di domande uscite (spesso raccolte dagli studenti, tipiche dell'orale)
  if (/domand[ae] (d )?esam[ei]|domand[ae] (dell )?oral[ei]|domand[ae] (uscit|frequent|chiest|raccolt)|domande (di )?teoria|faq|exam questions/.test(n)) return "domande";
  // quiz del docente (Moodle, autovalutazione): domande chiuse con la risposta corretta
  if (/\bquiz\b|moodle|autovalutazion|questionari[oi]|self assessment/.test(n)) return "quiz";
  // prove d'esame vere: «Temi d'esame 2024», «Appello 12 01 2024», «Compito A», «Prove scritte»
  if (/\btemi\b|\btema d esame|prov[ae] d esame|prov[ae] scritt[ae]|prov[ae] intermedi[ae]|\bcompit[io]\b|appell[oi]|esoner[oi]|esami (passati|vecchi|anni)|past (exams?|papers?)/.test(n)) return "esami";
  // esercizi risolti dal docente (a lezione, in esercitazione): il procedimento da imparare
  if (/\bsvolt[aeio]\b|\brisolt[aeio]\b|worked|svolgiment/.test(n)) return "svolti";
  // «Appunti esercitazione 6», «Appunti in aula»: gli appunti presi all'esercitazione (le soluzioni alla lavagna), non il foglio
  if (/appunt/.test(n) && /esercitaz|\baula\b|lavagna/.test(n)) return "appunti";
  // tutorato: di solito esercizi con le soluzioni (che sia del tutor e non del docente lo dice `tutor`, vedi isTutorFile)
  if (/tutor/.test(n)) return "esercizi";
  // «Esercizi per l'esame» è un eserciziario, non una prova
  if (/eserciz|esercitaz|soluzion|exercis|problem set/.test(n)) return "esercizi";
  // appunti presi da un altro studente (dopo domande ed esercizi: «Domande d'esame dei colleghi» resta un elenco di domande)
  if (/collegh|compagn[oaie]\b|\bamic[oaie]\b/.test(n)) return "colleghi";
  if (/\besam[ei]\b|\bexams?\b/.test(n)) return "esami";
  // riassunti e schemi fatti da studenti: non sono il testo del docente
  if (/riassunt|\bschemi\b|mapp[ae] concettual/.test(n)) return "appunti"; // «Schema di Bernoulli» resta un argomento
  // slide (anche in PDF): schematiche, la traccia del corso; le dispense sono testo scritto per esteso
  if (/\bpptx?\b|slide|lucid|presentazion/.test(n)) return "slide";
  if (/dispens|lezion|lecture|appunti del docente/.test(n)) return "dispense";
  if (/\blibro\b|manuale|textbook|\bbook\b|capitol|\bcap\b\s*\d|chapter/.test(n)) return "libro";
  if (/appunt|note|notes/.test(n)) return "appunti";
  return isPdf ? "dispense" : "appunti";
}

/** Preparato dal tutor, non dal docente («Tutorato 3», «Esercizi tutor»): si può cambiare nella scheda del materiale. */
export const isTutorFile = (name) => /tutor/i.test(String(name ?? ""));

/** Tipo di un materiale salvato prima che esistessero i tipi. */
export const roleOf = (m) => m.role ?? (m.kind === "pdf" ? "dispense" : "appunti");

/** Materiali da cui la modalità base non ricava argomenti e carte (eserciziari, esercizi svolti, prove d'esame, elenchi di domande, quiz). */
export const isPractice = (m) => ["esercizi", "svolti", "esami", "domande", "quiz"].includes(roleOf(m));
