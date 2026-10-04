// Modalità base (senza AI): ricava un modulo minimale dagli appunti con euristiche.
// Non sostituisce la generazione con l'AI: niente quiz, solo argomenti e flashcard
// ottenute da definizioni esplicite ("Termine: definizione", "X è ...") e da termini in **grassetto**.

const isHeading = (line) => {
  const l = line.trim();
  if (!l || l.length > 90) return null;
  let m = l.match(/^#{1,4}\s+(.+)$/);
  if (m) return m[1].trim();
  m = l.match(/^\d+(\.\d+)*[.)]\s+(\S.*)$/);
  if (m && !/[.;,]$/.test(l)) return m[2].trim();
  if (/[A-ZÀ-Ý]{3}/.test(l) && l === l.toUpperCase() && !/[.;,]$/.test(l)) return l;
  return null;
};

const DEF_COLON = /^[-*•\s]*\**([^:–—*]{2,60}?)\**\s*(?::|—|–|\s-\s)\s+(.{15,})$/;
const DEF_IS = /^[-*•\s]*(.{3,60}?)\s+(?:è|sono|si definisce|si definiscono|indica|indicano|rappresenta)\s+(.{15,})$/i;

const sentences = (text) => text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) ?? [text.trim()];

export function buildLocalModule(notes, title = "Appunti") {
  const lines = notes.replace(/\r/g, "").replace(/\f/g, "\n\n").split("\n"); // «\f» separa pagine e lezioni
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h = isHeading(line);
    if (h) {
      cur = { title: h, lines: [] };
      sections.push(cur);
    } else if (cur) cur.lines.push(line);
    else if (line.trim()) {
      cur = { title, lines: [line] };
      sections.push(cur);
    }
  }
  const nonEmpty = sections.filter((s) => s.lines.join("").trim());
  // Senza intestazioni: spezza in blocchi per paragrafi.
  if (nonEmpty.length <= 1 && notes.length > 2500) {
    const paras = notes.split(/\n\s*\n/).filter((p) => p.trim());
    nonEmpty.length = 0;
    let buf = [];
    let len = 0;
    for (const p of paras) {
      buf.push(p);
      len += p.length;
      if (len > 1500) {
        nonEmpty.push({ title: `${title} — parte ${nonEmpty.length + 1}`, lines: buf.join("\n\n").split("\n") });
        buf = [];
        len = 0;
      }
    }
    if (buf.length) nonEmpty.push({ title: `${title} — parte ${nonEmpty.length + 1}`, lines: buf.join("\n\n").split("\n") });
  }

  const topics = [];
  const flashcards = [];
  for (const s of nonEmpty) {
    const id = `t${topics.length + 1}`;
    const body = s.lines.join("\n");
    const defs = [];
    for (const raw of s.lines) {
      const line = raw.trim();
      const m = line.match(DEF_COLON) ?? line.match(DEF_IS);
      if (m) defs.push({ term: m[1].replace(/\*/g, "").trim(), definition: m[2].trim() });
    }
    const seen = new Set();
    const uniq = defs.filter((d) => !seen.has(d.term.toLowerCase()) && seen.add(d.term.toLowerCase()));
    for (const d of uniq.slice(0, 12))
      flashcards.push({ id: `c${flashcards.length + 1}`, topicId: id, front: `Definisci o spiega: ${d.term}`, back: d.definition, type: "definizione" });
    for (const sent of sentences(body)) {
      const b = sent.match(/\*\*([^*]{2,40})\*\*/);
      if (b && flashcards.filter((c) => c.topicId === id).length < 14)
        flashcards.push({ id: `c${flashcards.length + 1}`, topicId: id, front: sent.replace(/\*\*[^*]+\*\*/, "_____").replace(/\*\*/g, ""), back: b[1], type: "definizione" });
    }
    topics.push({
      id,
      title: s.title,
      importance: 2,
      difficulty: 2,
      summary: sentences(body.replace(/\*\*/g, "")).slice(0, 3).join(" ").slice(0, 600),
      keyConcepts: uniq.slice(0, 8),
      mustKnow: uniq.slice(0, 6).map((d) => `Saper definire: ${d.term}`),
      commonMistakes: [],
      origin: "notes",
      sourceIds: [],
    });
  }
  return {
    title,
    overview: "Modulo generato in modalità base (senza AI): argomenti e flashcard ricavati dalle definizioni presenti negli appunti.",
    topics,
    flashcards,
    questions: [],
    gaps: ["Modalità base: non sono stati generati quiz né controllo delle lacune. Configura una chiave API per il modulo completo."],
    sources: [],
    local: true,
  };
}

/**
 * Modalità base per l'aggiornamento: argomenti e carte dei soli appunti nuovi, nel formato che `mergeModule` si aspetta
 * (id provvisori n1, n2…; un titolo uguale a un argomento esistente lo approfondisce invece di duplicarlo).
 */
export function localDelta(notes, title = "Appunti") {
  const m = buildLocalModule(notes, title);
  const id = (t) => t.replace(/^t/, "n");
  return { topics: m.topics.map((t) => ({ ...t, id: id(t.id) })), flashcards: m.flashcards.map((c) => ({ ...c, topicId: id(c.topicId) })), questions: [] };
}

// Frasi del docente sull'esame (soprattutto nelle sbobine): «questo lo chiedo», «all'esame», «non lo chiedo»…
const EXAM_CUE = /all['’]?\s*esame|agli esami|all['’]?\s*orale|allo scritto|(?:lo|la|li|le|ve lo|ve la)\s+chied|chieder[òo]|domand[ae] d['’]esame|esercizi[oi]? d['’]esame|tema d['’]esame|(?:esce|cade|chiedo) sempre|sempre chiest|non (?:lo|la|li|le) chied|non (?:è|e) (?:nel programma|da sapere)|importante per l['’]esame|da sapere bene/i;

/**
 * Indicazioni sull'esame trovate con le regole (modalità base, senza AI): sono frasi copiate dal testo, quindi verificate.
 * @returns {{quote: string, source: string, note: string, topicId: string}[]}
 */
export function findExamHints(text, source = "") {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? "").replace(/\r/g, "").split(/\n+|(?<=[.!?])\s+/)) {
    const sent = raw.replace(/^[\s\-–—•*>]+/, "").trim();
    if (sent.length < 12 || !EXAM_CUE.test(sent)) continue;
    const quote = sent.length > 300 ? `${sent.slice(0, 297)}…` : sent;
    if (seen.has(quote.toLowerCase())) continue;
    seen.add(quote.toLowerCase());
    out.push({ quote, source, note: "", topicId: "" });
  }
  return out.slice(0, 40);
}
