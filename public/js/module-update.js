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
  return exam.materials.filter((m) => (ids ? !ids.includes(m.id) : !!m.addedAt && m.addedAt > (exam.moduleBuiltAt ?? "")));
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
