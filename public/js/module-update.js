// Aggiornare un modulo con gli appunti delle lezioni successive, senza rigenerarlo e senza perdere i progressi.
// (Il percorso «../../shared» funziona sia su disco sia nel browser, dove il server serve /shared/normalize.js.)
import { mergeModule } from "../../shared/normalize.js";

/**
 * Materiali aggiunti dopo l'ultima generazione/aggiornamento. Con i moduli creati prima di questa funzione
 * (senza `materialIds`) contano solo i materiali con data di aggiunta successiva alla generazione.
 */
export function pendingMaterials(exam) {
  if (!exam.module) return [];
  const ids = exam.module.materialIds;
  return exam.materials.filter((m) =>
    (ids ? !ids.includes(m.id) : !!m.addedAt && m.addedAt > (exam.moduleBuiltAt ?? "")) ||
    (m.sentPages !== undefined && unsentPages(m) !== undefined)); // pagine aggiunte a un libro già nel modulo
}

/** Il sottoinsieme del modulo che serve all'AI per sapere cosa c'è già (niente risposte, spiegazioni, rubriche). */
export const compactModule = (mod) => ({
  topics: mod.topics.map(({ id, title, importance, summary, keyConcepts }) => ({ id, title, importance, summary, keyConcepts: keyConcepts.map((k) => k.term) })),
  flashcards: mod.flashcards.map(({ topicId, front }) => ({ topicId, front })),
  questions: mod.questions.map(({ topicId, prompt }) => ({ topicId, prompt })),
  gaps: mod.gaps ?? [],
});

/**
 * Fonde nell'esame il risultato dell'aggiornamento: flashcard, quiz e argomenti studiati restano (gli id esistenti
 * non cambiano), i materiali usati risultano inclusi, il piano si ricalcola.
 * @returns {{topics: number, updated: number, flashcards: number, questions: number}}
 */
export function applyUpdate(exam, { delta, sources = [], mode }, usedIds, now = new Date().toISOString()) {
  const { module, added } = mergeModule(exam.module, delta, sources, { now, summary: mode === "local" ? "append" : "replace", replaceGaps: mode !== "local" });
  module.materialIds = [...new Set([...(exam.module.materialIds ?? exam.materials.filter((m) => !usedIds.includes(m.id)).map((m) => m.id)), ...usedIds])];
  exam.module = module;
  exam.moduleUpdatedAt = now;
  exam.plan = null;
  return added;
}

/** Frase di riepilogo per l'utente. */
export function updateSummary(a) {
  if (!a.topics && !a.updated && !a.flashcards && !a.questions) return "Gli appunti nuovi non aggiungono contenuti che il modulo non abbia già.";
  const parts = [];
  if (a.topics) parts.push(`${a.topics} ${a.topics === 1 ? "argomento nuovo" : "argomenti nuovi"}`);
  if (a.updated) parts.push(`${a.updated} ${a.updated === 1 ? "argomento approfondito" : "argomenti approfonditi"}`);
  if (a.flashcards) parts.push(`${a.flashcards} flashcard`);
  if (a.questions) parts.push(`${a.questions} ${a.questions === 1 ? "domanda" : "domande"}`);
  return `Aggiunti: ${parts.join(", ")}. I tuoi progressi restano.`;
}

/* ------------------------------ pagine (libri, slide) ------------------------------ */

/** «45-120» → {from: 45, to: 120}; null se vuoto o non valido (= tutte le pagine). */
export function parseRange(s, max = Infinity) {
  const m = String(s ?? "").match(/^\s*(\d{1,4})\s*-\s*(\d{1,4})\s*$/);
  if (!m) return null;
  const from = Math.max(1, Math.min(+m[1], +m[2]));
  const to = Math.min(max, Math.max(+m[1], +m[2]));
  return from <= to ? { from, to } : null;
}

const fmt = (r) => `${r.from}-${r.to}`;

/**
 * Pagine di un materiale ancora da mandare all'AI. `sentPages` è ciò che il modulo contiene già («all» = tutto).
 * Allargando l'intervallo (es. da 1-40 a 1-80) si manda solo la parte nuova (41-80).
 * @returns {string|null|undefined} intervallo da mandare, null = tutte le pagine, undefined = niente di nuovo
 */
export function unsentPages(m) {
  const cur = parseRange(m.pages);
  if (m.sentPages === undefined) return cur ? fmt(cur) : null; // mai mandato
  if (m.sentPages === "all") return undefined;
  const sent = parseRange(m.sentPages);
  if (!cur) return null; // ora tutte le pagine: si rimanda tutto (meglio un doppione che un buco)
  if (cur.from >= sent.from && cur.to <= sent.to) return undefined;
  if (cur.from >= sent.from && cur.from <= sent.to + 1) return fmt({ from: sent.to + 1, to: cur.to });
  if (cur.to <= sent.to && cur.to >= sent.from - 1) return fmt({ from: cur.from, to: sent.from - 1 });
  return fmt(cur);
}

/** Dopo l'invio: il modulo contiene l'unione (approssimata) di quanto mandato. */
export function markSent(m) {
  const cur = parseRange(m.pages);
  const sent = m.sentPages && m.sentPages !== "all" ? parseRange(m.sentPages) : null;
  m.sentPages = !cur ? "all" : sent ? fmt({ from: Math.min(cur.from, sent.from), to: Math.max(cur.to, sent.to) }) : fmt(cur);
}

/** Testo delle pagine scelte di un materiale diviso in pagine/slide con «\f». */
export function sliceText(text, range) {
  const r = parseRange(range);
  if (!r || !String(text).includes("\f")) return String(text ?? "");
  return String(text).split("\f").slice(r.from - 1, r.to).join("\n\n");
}

/** Sostituisce le pagine `from…` del testo diviso in pagine («\f») con quelle nuove (null = lascia com'era). */
export function replacePages(text, from, pages, numPages) {
  const arr = String(text ?? "").split("\f");
  while (arr.length < (numPages ?? 0)) arr.push("");
  pages.forEach((p, k) => { if (p != null) arr[from - 1 + k] = p; });
  return arr.join("\f");
}

/** Unione di intervalli «1-4,7-9» + {from,to} → stringa ordinata e compattata. */
export function addRange(list, from, to) {
  const rs = String(list ?? "").split(",").map((x) => parseRange(x)).filter(Boolean);
  rs.push({ from, to });
  rs.sort((a, b) => a.from - b.from);
  const out = [];
  for (const r of rs) {
    const last = out.at(-1);
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out.map(fmt).join(",");
}

/** Pagine già trascritte con Claude dentro l'intervallo {from,to}. */
export function rangesCover(list, from, to) {
  const rs = String(list ?? "").split(",").map((x) => parseRange(x)).filter(Boolean);
  for (let p = from; p <= to; p++) if (!rs.some((r) => p >= r.from && p <= r.to)) return false;
  return true;
}

/**
 * Pagine con probabili formule rovinate dall'estrazione del testo (frazioni spezzate su più righe, simboli isolati).
 * Serve solo a suggerire la lettura con Claude.
 */
export function mathyPages(text) {
  // una formula spezzata lascia righe fatte quasi solo di simboli isolati: «2  1  2», «s  =  ∑  ( xi - x )», «i = 1»
  const brokenLine = (l) => {
    const tok = l.split(/\s+/).filter(Boolean);
    return l.length <= 2 || (tok.length >= 3 && tok.filter((t) => t.length === 1).length / tok.length >= 0.6);
  };
  return String(text ?? "").split("\f").filter((p) => {
    const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) return false;
    const sym = (p.match(/[=∑∫√±≤≥≠≈∞∂∆Δσμβαλπθεχ∈∀∃⇒→∏ˆ¯−×·÷′\u0302\u0304\u0305]/g) ?? []).length;
    return lines.filter(brokenLine).length >= 2 && sym >= 1;
  }).length;
}
