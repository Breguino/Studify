// Piano di studi dell'utente (inserito a mano o trovato dall'AI) e abbinamento con gli esami.
import { EXAM_TYPES } from "./methods.js";

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(demo\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Trova l'insegnamento che corrisponde al nome digitato (esatto, oppure uno contenuto nell'altro con ≥ 6 caratteri). */
export function findCourse(courses, name) {
  const n = norm(name ?? "");
  if (!n) return null;
  const exact = courses.find((c) => norm(c.name) === n);
  if (exact) return exact;
  if (n.length < 6) return null;
  const partial = courses.filter((c) => {
    const m = norm(c.name);
    return m.length >= 6 && (m.includes(n) || n.includes(m));
  });
  return partial.length === 1 ? partial[0] : null; // se è ambiguo meglio non scegliere
}

export const FORMAT_LABEL = { ...EXAM_TYPES, sconosciuto: "Non indicato" };

/** Dal piano di studi allo spunto per il form dell'esame. */
export function examDefaultsFromCourse(course) {
  if (!course) return null;
  return {
    cfu: course.cfu || 0,
    type: course.format && course.format !== "sconosciuto" ? course.format : null,
    evidence: course.formatEvidence || "",
    url: course.url || "",
  };
}

/* ---------------------------- lettura di un piano incollato ---------------------------- */

const ORD = { primo: 1, secondo: 2, terzo: 3, quarto: 4, quinto: 5, sesto: 6 };
const YEAR_RE = /^\s*(?:(?:(\d)\s*[°ºo]?\s*anno)|(?:anno\s*(\d))|(?:(primo|secondo|terzo|quarto|quinto|sesto)\s+anno))\b/i;
const CFU_RE = /(\d{1,2}(?:[.,]\d)?)\s*(?:cfu|crediti|ects|cr\.)/i;
const SSD_RE = /^[A-Z]{2,5}[-/ ]?[A-Z]*\/?\d{2}[A-Z]?$/; // MAT/05, ING-INF/05, SECS-P/01
const NOISE_RE = /^(?:totale|crediti totali|totale crediti|cfu totali|legenda|note)\b/i;

const clean = (s) =>
  s
    .replace(/^[\s\-–—•·▪*]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[?(?:cod\.?\s*)?[A-Z]{0,4}\d{4,}\]?\s*[-–:]?\s*/i, "")
    .replace(/\(\s*(?:i|ii|1|2)\s*(?:sem(?:estre|\.)?)\s*\)/gi, "")
    .replace(/\b(?:i|ii)\s*semestre\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—:,;(]+$/, "")
    .trim();

/** Estrae gli insegnamenti da un testo copiato dal sito dell'ateneo (anni, CFU, attività a scelta). Euristico. */
export function parseCurriculumText(text) {
  const courses = [];
  const seen = new Set();
  let year = 0;
  let kind = "obbligatorio";
  let group = "";
  const push = (name, cfu, k, g) => {
    const n = clean(name);
    if (n.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 3 || n.length > 120 || NOISE_RE.test(n)) return;
    const key = `${year}|${n.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    courses.push({ name: n, year, cfu: Math.min(60, Math.round(cfu) || 0), format: "sconosciuto", formatEvidence: "", kind: k, group: g, url: "" });
  };

  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      // una riga vuota chiude un gruppo di insegnamenti a scelta
      if (group) { kind = "obbligatorio"; group = ""; }
      continue;
    }
    const ym = line.match(YEAR_RE);
    if (ym && !CFU_RE.test(line)) {
      year = ym[1] ? +ym[1] : ym[2] ? +ym[2] : ORD[ym[3].toLowerCase()];
      kind = "obbligatorio";
      group = "";
      continue;
    }
    const cells = line.split(/\t|\s{3,}|\|/).map((c) => c.trim()).filter(Boolean);
    let cfu = 0;
    let name = line;
    const cm = line.match(CFU_RE);
    if (cm) {
      cfu = parseFloat(cm[1].replace(",", "."));
      name = line.replace(CFU_RE, "").replace(/[()]/g, " ");
    } else if (cells.length >= 2) {
      const numIdx = cells.findIndex((c) => /^\d{1,2}$/.test(c) && +c > 0 && +c <= 30);
      const nameCell = cells.filter((c) => /[A-Za-zÀ-ÿ]{3}/.test(c) && !SSD_RE.test(c)).sort((a, b) => b.length - a.length)[0];
      if (numIdx >= 0 && nameCell) {
        cfu = +cells[numIdx];
        name = nameCell;
      } else if (cells.length >= 2) continue;
    } else if (!/[-–—:]\s*\d{1,2}$/.test(line)) {
      // riga senza crediti: può essere l'intestazione di un gruppo a scelta
      if (/a scelta|opzional|libera scelta/i.test(line) && line.length < 140) {
        kind = "a_scelta";
        group = clean(line).replace(/[:]$/, "");
      }
      continue;
    } else {
      cfu = +line.match(/(\d{1,2})$/)[1];
      name = line.replace(/[-–—:]\s*\d{1,2}$/, "");
    }
    // "Insegnamenti a scelta dello studente 12 CFU" → segnaposto a scelta (non cambia il gruppo corrente)
    if (/a scelta|libera scelta|opzional/i.test(name) && /(studente|libera|attivit)/i.test(name)) push(name, cfu, "a_scelta", "");
    else push(name, cfu, kind, kind === "a_scelta" ? group : "");
  }
  const years = [...new Set(courses.map((c) => c.year))].sort((a, b) => a - b);
  return { courses, years };
}

/* ------------------------------- raggruppamento -------------------------------- */

export const yearLabel = (y) => (y ? `${y}° anno` : "Anno non indicato");

/** [{ year, label, required: Course[], electives: [{ group, courses }] }], anni crescenti, «non indicato» in fondo. */
export function groupByYear(courses) {
  const years = [...new Set(courses.map((c) => c.year || 0))].sort((a, b) => (a || 99) - (b || 99));
  return years.map((y) => {
    const list = courses.filter((c) => (c.year || 0) === y);
    const electives = new Map();
    for (const c of list.filter((c) => c.kind === "a_scelta")) {
      const g = c.group || "A scelta dello studente";
      electives.set(g, [...(electives.get(g) ?? []), c]);
    }
    return {
      year: y,
      label: yearLabel(y),
      required: list.filter((c) => c.kind !== "a_scelta"),
      electives: [...electives].map(([group, cs]) => ({ group, courses: cs })),
    };
  });
}

/** Insegnamenti proponibili per un anno: quelli dell'anno (obbligatori e a scelta) più quelli senza anno. year 0 = tutti. */
export const coursesForYear = (courses, year) => (year ? courses.filter((c) => c.year === year || !c.year) : courses);
