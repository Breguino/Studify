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

/**
 * @returns {null | {text: string, sections: string[]}} testo diviso per lezione e titoli delle lezioni;
 *   null se il documento non ha almeno 2 intestazioni di lezione (o se è già diviso in pagine).
 */
export function splitLessons(text) {
  const s = String(text ?? "");
  if (s.includes("\f")) return null;
  const lines = s.split("\n");
  const starts = [];
  lines.forEach((l, i) => { if (isLessonHeading(l) && (i === 0 || !lines[i - 1].trim() || starts.length === 0 || i - starts.at(-1) > 3)) starts.push(i); });
  if (starts.length < 2) return null;
  const sections = [];
  const parts = [];
  starts.forEach((st, k) => {
    const from = k === 0 ? 0 : st; // quello che precede la prima lezione (titolo del corso, indice) va con la prima
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    parts.push(lines.slice(from, to).join("\n").trim());
    sections.push(lines[st].replace(/^\s*#{1,4}\s*/, "").trim().slice(0, 80));
  });
  return { text: parts.join("\f"), sections };
}
