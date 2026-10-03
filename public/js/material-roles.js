// Tipi di materiale: cambiano il modo in cui l'AI li usa (vedi shared/prompts.js, principio 7).
export const ROLES = { appunti: "Appunti", sbobine: "Sbobine (lezioni trascritte)", libro: "Libro", dispense: "Dispense / slide", esercizi: "Esercizi", altro: "Altro" };

/** Tipo probabile dal nome del file (modificabile dallo studente). */
export function guessRole(fileName, isPdf = false) {
  const n = String(fileName ?? "").toLowerCase().replace(/[_\-.]+/g, " ");
  if (/sbobin|trascrizion|registrazion/.test(n)) return "sbobine";
  if (/eserciz|esercitaz|\btemi\b|\btema d esame|prov[ae] d esame|prove scritte|compit[io]|\besame\b|soluzion|exercis|problem set/.test(n)) return "esercizi";
  if (/dispens|slide|lucid|lezion|lecture|appunti del docente/.test(n)) return "dispense";
  if (/\blibro\b|manuale|textbook|\bbook\b|capitol|\bcap\b\s*\d|chapter/.test(n)) return "libro";
  if (/appunt|note|notes/.test(n)) return "appunti";
  return isPdf ? "dispense" : "appunti";
}

/** Tipo di un materiale salvato prima che esistessero i tipi. */
export const roleOf = (m) => m.role ?? (m.kind === "pdf" ? "dispense" : "appunti");
