// Documenti lunghi senza pagine (sbobine, appunti in Word): si dividono per lezione, così si sceglie quali usare
// come si scelgono le pagine di un libro. Le lezioni sono separate da «\f», come le pagine dei PDF.

const MONTHS = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
const DAYS = "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica";
const DATE = `\\d{1,2}\\s*(?:[/.\\-]\\s*\\d{1,2}(?:\\s*[/.\\-]\\s*\\d{2,4})?|\\s+(?:${MONTHS})(?:\\s+\\d{4})?)`;
const HEADING = new RegExp(
  `^\\s*(?:#{1,4}\\s*)?(?:` +
    `(?:lezione|lez\\.?|sbobina(?:tura)?|lecture)\\s*(?:n\\s*[°º.]?\\s*)?\\d{1,3}\\b` + // Lezione 5, LEZ. 3, Sbobina n° 4
    `|(?:lezione|sbobina(?:tura)?)\\s+(?:del(?:l')?\\s+)?(?:(?:${DAYS})\\s+)?${DATE}` + // Lezione del 12/10, Lezione del 3 ottobre
    `|(?:(?:${DAYS})\\s+)?${DATE}\\s*$` + // una data da sola sulla riga
  `)`,
  "i",
);

export const isLessonHeading = (line) => line.trim().length <= 90 && HEADING.test(line);

// Prove d'esame: «Appello del 12/01/2024», «Esame di Microeconomia – 15 giugno 2023», «Prova scritta 2022», «Compito A»,
// «Tema d'esame 3», «2° appello». Una riga che inizia così ma prosegue con altro (es. «Compito: calcolare…») non è un titolo.
const YEAR = "(?:19|20)\\d{2}";
const KEY = "(?:prova(?:\\s+(?:scritta|intermedia|finale|parziale|d'esame))?|esame|appello|compito|tema(?:\\s+d'esame)?|esonero|parziale|traccia)";
const ORD = "(?:primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|\\d{1,2}\\s*[°º^a]?)";
const PAPER = new RegExp(
  `^\\s*(?:#{1,4}\\s*)?(?:` +
    `${KEY}\\b.{0,60}?(?:${DATE}|(?:${MONTHS})\\s+${YEAR}|(?:${MONTHS})\\s*$|\\b${YEAR}\\b)` +
    `|${KEY}\\s*(?:n\\.?\\s*|nr\\.?\\s*|n°\\s*)?(?:[A-H]|\\d{1,2})\\s*[.:)]?\\s*$` +
    `|${ORD}\\s+appello\\b` +
  `)`,
  "i",
);

export const isPaperHeading = (line) => line.trim().length <= 90 && PAPER.test(line.replace(/[’‘]/g, "'"));

/** Divide un testo senza pagine dove una riga è un'intestazione (almeno 2), come fanno le pagine dei PDF. */
function splitBy(text, isHeading) {
  const s = String(text ?? "");
  if (s.includes("\f")) return null;
  const lines = s.split("\n");
  const starts = [];
  lines.forEach((l, i) => { if (isHeading(l) && (i === 0 || !lines[i - 1].trim() || starts.length === 0 || i - starts.at(-1) > 3)) starts.push(i); });
  if (starts.length < 2) return null;
  const sections = [];
  const parts = [];
  starts.forEach((st, k) => {
    const from = k === 0 ? 0 : st; // quello che precede la prima (titolo del corso, indice) va con la prima
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    parts.push(lines.slice(from, to).join("\n").trim());
    sections.push(lines[st].replace(/^\s*#{1,4}\s*/, "").trim().slice(0, 80));
  });
  return { text: parts.join("\f"), sections };
}

/**
 * @returns {null | {text: string, sections: string[]}} testo diviso per lezione e titoli delle lezioni;
 *   null se il documento non ha almeno 2 intestazioni di lezione (o se è già diviso in pagine).
 */
export const splitLessons = (text) => splitBy(text, isLessonHeading);

/** Un file con più prove d'esame (testo senza pagine) → una sezione per prova. */
export const splitPapers = (text) => splitBy(text, isPaperHeading);

/**
 * Un documento a pagine (PDF, slide) con più prove: le pagine dove ne inizia una (titolo nelle prime righe).
 * @returns {null | {starts: number[], labels: string[]}} la prima prova parte sempre da pagina 1; null se ce n'è una sola
 */
export function paperStartsOf(pages) {
  const starts = [];
  const labels = [];
  pages.forEach((p, i) => {
    const head = String(p ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
    const hit = head.find(isPaperHeading);
    if (hit) { starts.push(i + 1); labels.push(hit.replace(/^#{1,4}\s*/, "").slice(0, 80)); }
  });
  if (starts.length < 2) return null;
  if (starts[0] !== 1) starts[0] = 1; // copertina o istruzioni generali vanno con la prima prova
  return { starts, labels };
}
