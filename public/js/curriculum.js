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
    if (m.length < 6) return false;
    const [short, long] = m.length <= n.length ? [m, n] : [n, m];
    // «Matematica II» non è «Matematica I»: se la differenza è solo un numero d'ordine sono insegnamenti diversi
    return long.includes(short) && !NUMERAL_RE.test(long.replace(short, "").trim());
  });
  return partial.length === 1 ? partial[0] : null; // se è ambiguo meglio non scegliere
}

const NUMERAL_RE = /^(?:i{1,3}|iv|v|[1-6])$/;

/** Abbina i nomi di un orario agli insegnamenti del piano: { nome → insegnamento | null }. */
export function matchCourses(names, courses) {
  return new Map(names.map((n) => [n, findCourse(courses, n)]));
}

/**
 * Quali insegnamenti di un orario spuntare in automatico per chi frequenta l'anno `year`.
 * Si tolgono solo quelli che il piano colloca in un altro anno: se non trovo il nome nel piano lo tengo
 * (sbagliare per eccesso riduce un po' troppo il tempo di studio, sbagliare per difetto lo gonfia).
 */
export function defaultTimetableSelection(names, courses, year) {
  const match = matchCourses(names, courses);
  const keep = (n) => {
    const c = match.get(n);
    return !year || !c || !c.year || c.year === year;
  };
  return { include: new Set(names.filter(keep)), match };
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

/* ------------------------ piani di studio in tabella (da PDF) ------------------------ */

// Codici SSD: nuovi (STAT-04/A, ECON-06/A) e vecchi (MAT/05, SECS-P/01, ING-INF/05, L-LIN/12)
const SSD_CODE = /^(?:[A-Z]{2,5}-\d{2}\/[A-Z]|(?:[A-Z]{1,4}-)?[A-Z]{2,4}(?:-[A-Z]{1,3})?\/\d{2}[A-Z]?)$/;
const SEMESTER = /^(?:[1-4]\s*°?\s*(?:q|sem)\w*|q[1-4]|i{1,3}\s*sem\w*)\*?$/i;
const YEAR_ANYWHERE = /(\d)\s*[°º]\s*anno|\banno\s*(\d)\b|\b(primo|secondo|terzo|quarto|quinto|sesto)\s+anno/i;
const ELECTIVE_NAME = /scelta libera|libera scelta|a scelta|opzional|affin/i;
const sentence = (s) => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * Piano di studi come tabella di celle (righe di un PDF o di un foglio): una riga per insegnamento con il CFU in una cella
 * numerica; l'anno compare nelle intestazioni di sezione («INSEGNAMENTI 2° ANNO»); le attività a scelta stanno in un blocco
 * «Altre attività…». Una riga vuota ([]) chiude un gruppo. Verifica la somma dei CFU con il «Totale» dichiarato.
 * @param {string[][]} rows
 */
export function parseCurriculumTable(rows) {
  const courses = [];
  const seen = new Set();
  const meta = { degreeName: "", academicYear: "", declaredTotal: 0, sum: 0 };
  let year = 0;
  let group = "";
  const push = (name, cfu, kind, g) => {
    const n = name
      .replace(/^[\s\-–•·*]+/, "")
      .replace(/^(?:e|ed|oppure)\s+/i, "") // congiunzione iniziale («… e Tirocinio»)
      .replace(/\s+(?:e|ed|oppure)\s*$/i, "") // e finale («… (12 CFU) e»)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[:;,]$/, "");
    if (n.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 3 || n.length > 120) return;
    const key = `${year}|${n.toLowerCase()}`;
    if (seen.has(key)) return; // alternative («12 CFU … oppure 15 CFU»): vale la prima
    seen.add(key);
    courses.push({ name: n, year, cfu, format: "sconosciuto", formatEvidence: "", kind, group: g, url: "" });
  };

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.length) { group = ""; continue; }
    const line = cells.join(" ").replace(/\s+/g, " ").trim();
    if (!line) continue;

    const mDeg = line.match(/^corso di laurea(?:\s+magistrale(?:\s+a\s+ciclo\s+unico)?)?(?:\s+in)?\s*(.*)$/i);
    if (mDeg && !meta.degreeName) { meta.degreeName = sentence((mDeg[1] || (rows[i + 1] ?? []).join(" ")).trim()); continue; }
    const mAa = line.match(/\ba\.?\s?a\.?\s*(\d{4}\s*[-/]\s*\d{2,4})/i);
    if (mAa && !meta.academicYear && !YEAR_ANYWHERE.test(line)) meta.academicYear = mAa[1].replace(/\s+/g, "");

    if (/^totale\b/i.test(line)) {
      const n = line.match(/^totale\s*(?:cfu)?\s*(\d{2,3})$/i);
      if (n) meta.declaredTotal = +n[1];
      continue;
    }
    if (/^\*|^note\b|^legenda\b/i.test(line)) continue;

    const hasCfuCell = cells.some((c, k) => k > 0 && /^\d{1,2}$/.test(c) && +c > 0 && +c <= 30);
    const ym = line.match(YEAR_ANYWHERE);
    if (ym && !hasCfuCell) {
      year = ym[1] ? +ym[1] : ym[2] ? +ym[2] : ORD[ym[3].toLowerCase()];
      group = "";
      continue;
    }
    if (/^altre attivit/i.test(line)) { group = "Altre attività"; continue; }

    // più voci su una riga: «Scelta libera dello studente (12 CFU) e Tirocinio (3 CFU) oppure»
    const multi = [...line.matchAll(/([^()]*?)\s*\((\d{1,2})\s*CFU\)/gi)];
    if (multi.length) {
      for (const m of multi) push(m[1], +m[2], group || ELECTIVE_NAME.test(m[1]) ? "a_scelta" : "obbligatorio", group || (ELECTIVE_NAME.test(m[1]) ? "A scelta dello studente" : ""));
      continue;
    }

    // riga di tabella: [SSD] nome … CFU [quadrimestre]
    const idx = cells.findIndex((c, k) => k > 0 && /^\d{1,2}$/.test(c) && +c > 0 && +c <= 30);
    if (idx > 0) {
      const name = cells.slice(0, idx).filter((c) => !SSD_CODE.test(c) && !SEMESTER.test(c) && /[A-Za-zÀ-ÿ]{3}/.test(c)).join(" ");
      if (!name) continue;
      const final = /prova finale|tesi|elaborato finale/i.test(name);
      if (final) group = "";
      const kind = !final && (group || ELECTIVE_NAME.test(name)) ? "a_scelta" : "obbligatorio";
      push(name, +cells[idx], kind, kind === "a_scelta" ? group || "A scelta dello studente" : "");
      continue;
    }
    // riga con «N CFU» nel testo (formato non tabellare)
    const m = line.match(CFU_RE);
    if (m) {
      const words = line.replace(CFU_RE, "").replace(/[()]/g, " ").trim().split(/\s+/);
      if (SSD_CODE.test(words[0])) words.shift(); // codice SSD in testa alla riga
      push(words.join(" "), Math.round(parseFloat(m[1].replace(",", "."))), group ? "a_scelta" : "obbligatorio", group);
    }
  }
  meta.sum = courses.reduce((n, c) => n + c.cfu, 0);
  return { courses, years: [...new Set(courses.map((c) => c.year))].sort((a, b) => a - b), meta };
}
