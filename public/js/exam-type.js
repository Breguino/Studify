// Suggerisce il tipo di prova dal nome della materia. È un'euristica: nella realtà il formato
// dipende dal docente e dall'ateneo, quindi il risultato è solo un valore iniziale da confermare.

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const RULES = [
  { type: "problemi", label: "esercizi e problemi", words: ["matematica", "analisi", "algebra", "geometria", "fisica", "chimica", "statistica", "probabilita", "calcolo", "meccanica", "termodinamica", "elettromagnetismo", "elettrotecnica", "econometria", "microeconomia", "macroeconomia", "ricerca operativa", "scienza delle costruzioni", "circuiti", "controlli automatici", "segnali", "matematica finanziaria", "ragioneria", "contabilita", "fluidodinamica", "fisica tecnica"] },
  { type: "orale", label: "orale", words: ["diritto", "storia", "filosofia", "letteratura", "sociologia", "pedagogia", "psicologia", "antropologia", "geografia", "archeologia", "teologia", "scienze politiche", "anatomia", "fisiologia", "istologia", "patologia", "farmacologia", "linguistica", "criminologia", "economia politica", "storia economica", "estetica", "semiotica"] },
  { type: "test", label: "test a risposta multipla", words: ["inglese", "lingua inglese", "idoneita", "biologia", "citologia", "abilita informatiche", "test"] },
  { type: "misto", label: "scritto + orale", words: ["informatica", "programmazione", "algoritmi", "basi di dati", "reti", "ingegneria del software", "sistemi operativi", "economia aziendale", "marketing", "organizzazione aziendale", "bilancio"] },
];

/** @returns {{type:string, label:string, confidence:"media"|"bassa", match:string|null}} */
export function suggestExamType(subject) {
  const s = ` ${norm(subject)} `;
  let best = null;
  for (const r of RULES)
    for (const w of r.words) {
      const hit = s.includes(` ${w}`) || s.includes(w) && w.length > 6; // parola intera, o radice lunga (es. «elettromagnetismo»)
      if (hit && (!best || w.length > best.match.length)) best = { ...r, match: w };
    }
  if (!best) return { type: "misto", label: "scritto + orale", confidence: "bassa", match: null };
  return { type: best.type, label: best.label, confidence: "media", match: best.match };
}

/** Cerca nel testo di una ricerca la modalità d'esame dichiarata (riga «Modalità d'esame: …»). */
export function findExamFormat(text) {
  const m = String(text ?? "").match(/modalit[àa']?\s+d['’]?\s*esame\s*[:\-–]\s*([^\n]{3,200})/i);
  if (!m) return null;
  const line = norm(m[1]);
  if (/non (ho )?trovat|non specificat|non indicat|sconosciut/.test(line)) return null;
  const scritto = /scritt/.test(line), orale = /oral/.test(line), test = /test|quiz|risposta multipla|crocett/.test(line);
  const problemi = /eserciz|problem/.test(line);
  let type = null;
  if (scritto && orale) type = "misto";
  else if (orale) type = "orale";
  else if (test) type = "test";
  else if (problemi) type = "problemi";
  else if (scritto) type = "scritto";
  return type ? { type, text: m[1].trim() } : null;
}

const SECTION_RE = /modalit[àa']?\s+(?:di\s+)?(?:verifica|valutazione|d['’]\s*esame|esame)|verifica\s+dell['’]\s*apprendimento|assessment(?:\s+methods)?|examination|prova\s+d['’]\s*esame/i;
const ORAL = /\boral[ei]?\b|colloquio|\boral\b/;
const OPTIONAL = /facoltativ|a scelta|su richiesta|integrativ|opzional|optional|on request|migliorare il voto/;
const WRITTEN = /scritt|written/;
const TEST = /risposta multipla|scelta multipla|\btest\b|quiz|crocett|multiple[- ]choice/;
const EXERCISES = /eserciz|esercitazion[ei] numerich|risoluzione di problemi|problemi (?:numerici|da risolvere)|exercise|problem[- ]solving/;

/**
 * Modalità d'esame dal testo della scheda di un insegnamento, SENZA AI (regole). Guarda la sezione sulla verifica se c'è.
 * Un orale «facoltativo / a scelta / per migliorare il voto» non rende l'esame «scritto + orale».
 * Meno affidabile della lettura con l'AI: il risultato è marcato `local`.
 */
export function formatFromSyllabus(text) {
  const t = String(text ?? "").replace(/\s+/g, " ");
  const i = t.search(SECTION_RE);
  const section = i >= 0 ? t.slice(i, i + 1500) : t.slice(0, 3000);
  const sentences = section.split(/(?<=[.;!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const n = norm(section);
  const oralSentences = sentences.filter((x) => ORAL.test(norm(x)));
  const oral = oralSentences.length > 0;
  const oralOptional = oral && oralSentences.every((x) => OPTIONAL.test(norm(x)));
  const written = WRITTEN.test(n);
  const test = TEST.test(n);
  const exercises = EXERCISES.test(n);
  let format = null;
  if ((written || test || exercises) && oral && !oralOptional) format = "misto";
  else if (oral && !written && !test && !exercises) format = oralOptional ? null : "orale";
  else if (exercises) format = "problemi";
  else if (test) format = "test";
  else if (written) format = "scritto";
  const evidence = format ? (sentences.find((x) => [ORAL, WRITTEN, TEST, EXERCISES].some((re) => re.test(norm(x)))) ?? "").slice(0, 300) : "";
  return {
    found: !!format && !!evidence,
    format: format && evidence ? format : "sconosciuto",
    evidence,
    details: format && format !== "misto" && oralOptional ? "Orale facoltativo." : "",
    url: "", academicYear: "", teacher: "",
    caveats: ["Lettura automatica senza AI: controlla il testo."],
    local: true,
  };
}
