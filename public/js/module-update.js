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
