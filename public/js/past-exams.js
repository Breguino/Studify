// Esami degli anni passati: le prove (una per appello) dentro i materiali di tipo «esami», cosa dicono sull'esame
// (argomenti che ricorrono) e le simulazioni a tempo fatte dallo studente. Solo funzioni pure.
import { paperStartsOf, splitPapers } from "./lessons.js";
import { roleOf } from "./material-roles.js";
import { parseRange, sliceText } from "./module-update.js";
import { hotByQuestions } from "./exam-questions.js";

/** Dopo il caricamento o il cambio di tipo: un file con più prove viene diviso (testo) o se ne trovano gli inizi (pagine). */
export function preparePapers(m) {
  if (roleOf(m) !== "esami" || m.kind !== "notes" || m.handwritten) return m;
  if (!m.numPages || m.unit === "lezioni") {
    const plain = m.unit === "lezioni" ? m.text.replace(/\f/g, "\n\n") : m.text;
    const r = splitPapers(plain);
    if (r) {
      Object.assign(m, { text: r.text, numPages: r.sections.length, sections: r.sections, unit: "prove", pages: null });
      delete m.paperStarts;
      return m;
    }
    if (m.unit === "lezioni") Object.assign(m, { text: plain, numPages: undefined, sections: undefined, unit: undefined, pages: null });
    return m;
  }
  if (m.unit !== "prove" && !m.paperStarts) {
    const r = paperStartsOf(m.text.split("\f"));
    if (r) Object.assign(m, { paperStarts: r.starts, paperLabels: r.labels });
  }
  return m;
}

/** «1, 4, 7» → [1, 4, 7] (pagine dove inizia ogni prova); null se vuoto o non valido. */
export function parseStarts(s, max = Infinity) {
  const nums = [...new Set(String(s ?? "").split(/[^\d]+/).filter(Boolean).map(Number))].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums[0] !== 1) nums.unshift(1);
  return nums.length > 1 ? nums : null;
}

const stripPdf = (t) => String(t ?? "").replace(/ \(da PDF\)$/, "");

/**
 * Le prove di un materiale di tipo «esami». key = `${id}:${pagina iniziale}`: resta la stessa se cambia la scelta delle pagine.
 * @returns {{key: string, materialId: string, label: string, from: number, to: number}[]}
 */
export function papersOf(m) {
  if (roleOf(m) !== "esami" || m.kind === "web") return [];
  const n = m.numPages || 1;
  const range = parseRange(m.pages, n) ?? { from: 1, to: n };
  const make = (from, to, label) => ({ key: `${m.id}:${from}`, materialId: m.id, label, from, to });
  if (m.unit === "prove" && m.sections?.length) {
    const out = [];
    for (let k = range.from; k <= range.to; k++) out.push(make(k, k, m.sections[k - 1] || `${stripPdf(m.title)} · prova ${k}`));
    return out;
  }
  if (m.paperStarts?.length > 1) {
    const unit = m.kind === "pdf" || m.fromPdf ? "pagine" : "slide";
    return m.paperStarts
      .map((st, i) => make(st, (m.paperStarts[i + 1] ?? n + 1) - 1, m.paperLabels?.[i] || `${stripPdf(m.title)} · ${unit} ${st}–${(m.paperStarts[i + 1] ?? n + 1) - 1}`))
      .filter((p) => p.from <= p.to && p.to >= range.from && p.from <= range.to);
  }
  const whole = range.from === 1 && range.to === n;
  return [make(range.from, range.to, whole ? stripPdf(m.title) : `${stripPdf(m.title)} · pagine ${range.from}–${range.to}`)];
}

export const allPapers = (exam) => exam.materials.flatMap(papersOf);

/** Testo di una prova (materiali testuali); null per i PDF (si mandano le pagine). */
export function paperText(m, p) {
  if (m.kind !== "notes") return null;
  return sliceText(m.text, `${p.from}-${p.to}`);
}

/** Anno di una prova dal titolo («Appello del 12/01/2024» → 2024, «… 12/01/24» → 2024), null se non c'è. */
export function paperYear(label) {
  const s = String(label ?? "");
  const y4 = s.match(/\b((?:19|20)\d{2})\b/);
  if (y4) return Number(y4[1]);
  const y2 = s.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-](\d{2})\b/);
  return y2 ? 2000 + Number(y2[1]) : null;
}

/** Simulazioni già fatte con questa prova. */
export const attemptsOf = (exam, key) => (exam.simulations ?? []).filter((s) => s.paperKey === key);

/**
 * Prova consigliata per la prossima simulazione: una mai fatta; tra queste, la più vecchia (le più recenti somigliano di più
 * all'esame vero: meglio tenerle per gli ultimi giorni).
 */
export function nextPaper(exam) {
  const fresh = allPapers(exam).filter((p) => !attemptsOf(exam, p.key).length);
  if (!fresh.length) return null;
  return [...fresh].sort((a, b) => (paperYear(a.label) ?? 9999) - (paperYear(b.label) ?? 9999))[0];
}

const DEFAULT_MINUTES = { test: 60, scritto: 120, problemi: 120, misto: 90, orale: 30 };

/** Durata della prova: quella letta nella prova (analisi), altrimenti la tipica delle altre prove, altrimenti per tipo d'esame. */
export function paperMinutes(exam, key) {
  const an = exam.pastExams?.papers ?? {};
  if (an[key]?.durationMin > 0) return an[key].durationMin;
  const known = Object.values(an).map((p) => p.durationMin).filter((x) => x > 0).sort((a, b) => a - b);
  if (known.length) return known[Math.floor(known.length / 2)];
  return DEFAULT_MINUTES[exam.type] ?? 120;
}

/** L'analisi vale finché il modulo non viene rigenerato (gli id degli argomenti cambierebbero significato). */
export const analysisValid = (exam) => !!exam.pastExams && !!exam.module && exam.pastExams.moduleBuiltAt === exam.moduleBuiltAt;

/** Prove presenti ma non ancora analizzate (aggiunte dopo l'analisi). */
export function unanalyzed(exam) {
  const done = analysisValid(exam) ? exam.pastExams.papers : {};
  return allPapers(exam).filter((p) => !done[p.key]);
}

/**
 * In quante prove analizzate compare ciascun argomento (almeno un esercizio che lo richiede).
 * @returns {{n: number, freq: Map<string, number>}} n = prove analizzate che esistono ancora tra i materiali
 */
export function topicFrequency(exam) {
  const freq = new Map();
  if (!analysisValid(exam)) return { n: 0, freq };
  const keys = new Set(allPapers(exam).map((p) => p.key));
  const papers = Object.entries(exam.pastExams.papers).filter(([k]) => keys.has(k));
  for (const [, p] of papers) {
    const ids = new Set(p.items.flatMap((it) => it.topicIds));
    for (const id of ids) freq.set(id, (freq.get(id) ?? 0) + 1);
  }
  return { n: papers.length, freq };
}

export const MIN_PAPERS = 3; // con meno prove la frequenza non dice quasi nulla

/**
 * Gli argomenti che escono in almeno metà delle prove (con almeno MIN_PAPERS prove), o che negli elenchi di domande d'esame sono
 * chiesti molto più della media (vedi hotByQuestions), diventano «centrali» per il piano.
 * Se un'analisi successiva non li conferma, tornano all'importanza di prima. Gli argomenti mai usciti non si abbassano:
 * «non è uscito» non vuol dire «non uscirà».
 * @returns {string[]} id degli argomenti alzati ora
 */
export function applyExamBoost(exam) {
  const { n, freq } = topicFrequency(exam);
  const asked = hotByQuestions(exam); // dagli elenchi di domande d'esame
  const raised = [];
  for (const t of exam.module?.topics ?? []) {
    const hot = (n >= MIN_PAPERS && (freq.get(t.id) ?? 0) / n >= 0.5) || asked.has(t.id);
    if (hot && t.importance < 3) {
      t.importanceBefore = t.importance;
      t.importance = 3;
      t.boost = "esami";
      raised.push(t.id);
    } else if (!hot && t.boost === "esami") {
      t.importance = t.importanceBefore ?? t.importance;
      delete t.importanceBefore;
      delete t.boost;
    }
  }
  return raised;
}

/** Punti e voto in trentesimi di una correzione (dai punti per esercizio, che lo studente può modificare). */
export function simScore(items) {
  const max = items.reduce((s, it) => s + (Number(it.maxPoints) || 0), 0);
  const pts = items.reduce((s, it) => s + Math.min(Number(it.points) || 0, Number(it.maxPoints) || 0), 0);
  return { points: Math.round(pts * 10) / 10, max, grade: max > 0 ? Math.round((pts / max) * 300) / 10 : null };
}

/** «27,5/30» */
export const fmtGrade = (g) => (g == null ? "—" : `${String(Math.round(g * 10) / 10).replace(".", ",")}/30`);

/** Minuti trascorsi da una data ISO. */
export const minutesSince = (iso, now = Date.now()) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));

/* ------------------------- solo per la modalità demo e le prove ------------------------- */

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ITEM = /^\s*(?:#{1,4}\s*)?(?:esercizio|domanda|quesito|problema|es\.)?\s*(\d{1,2}[a-z]?)\s*[.):]\s*(.+)$/i;
const ITEM_WORD = /^\s*(?:#{1,4}\s*)?(?:esercizio|domanda|quesito|problema)\s+(\d{1,2}[a-z]?)\b\s*[.):—–-]?\s*(.*)$/i;

/** Esercizi di una prova riconosciuti dalla numerazione («1.», «Esercizio 2 (8 punti)»). */
export function itemsOfText(text) {
  const items = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(ITEM_WORD) ?? line.match(ITEM);
    if (!m) continue;
    const pts = line.match(/(\d{1,2})\s*punt/i);
    items.push({ n: m[1], text: m[2].trim() || line.trim(), points: pts ? Number(pts[1]) : 0 });
  }
  return items;
}

/** Analisi finta (modalità demo): esercizi dalla numerazione, argomenti dalle parole del titolo, durata dal testo. */
export function demoAnalysis(papers, topics) {
  const words = topics.map((t) => ({ id: t.id, w: norm(t.title).split(/[^a-z]+/).filter((x) => x.length > 5).map((x) => x.slice(0, 7)) }));
  const out = papers.map((p) => {
    const dur = norm(p.text).match(/(\d{1,3})\s*(ore|ora|minuti|min)\b/);
    return {
      id: p.id, label: p.label, year: String(paperYear(p.label) ?? ""), hasSolutions: /soluzion/i.test(p.text ?? ""),
      durationMin: dur ? (dur[2].startsWith("or") ? Number(dur[1]) * 60 : Number(dur[1])) : 0,
      items: itemsOfText(p.text).map((it) => ({ n: it.n, summary: it.text.slice(0, 150), kind: /spieg|defin|dimostr|illustr/i.test(it.text) ? "teoria" : "esercizio", points: it.points,
        topicIds: words.filter((t) => t.w.some((x) => norm(it.text).includes(x))).map((t) => t.id) })),
    };
  });
  return {
    papers: out,
    structure: "[DEMO] Analisi simulata dalla numerazione degli esercizi: con Claude ogni esercizio viene letto e collegato agli argomenti.",
    recurring: [], uncovered: [], caveats: ["Risposta della modalità demo."],
  };
}

/** Correzione finta (modalità demo): punti pieni agli esercizi a cui lo svolgimento fa riferimento («1.», «Es. 2»). */
export function demoGrade(paperText, answer) {
  const items = itemsOfText(paperText);
  const list = items.length ? items : [{ n: "1", text: "Prova", points: 0 }];
  const each = Math.round(30 / list.length);
  return {
    items: list.map((it) => {
      const done = new RegExp(`(^|\\n)\\s*(es(ercizio)?\\.?\\s*)?${it.n}\\b`, "i").test(answer);
      const max = it.points || each;
      return { n: it.n, task: it.text.slice(0, 120), maxPoints: max, points: done ? Math.round(max * 0.7) : 0, verdict: done ? "parziale" : "non svolto",
        feedback: done ? "[DEMO] Impostazione corretta, manca un passaggio (correzione simulata)." : "[DEMO] Non svolto.", topicId: "" };
    }),
    overall: "[DEMO] Correzione simulata: con Claude ogni esercizio viene corretto come farebbe il docente.",
    priorities: ["Rifai gli esercizi non svolti.", "Ripassa gli argomenti dove hai perso punti."],
    readingIssues: [],
  };
}
