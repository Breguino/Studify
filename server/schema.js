import { z } from "zod";

// Schema del "modulo di studio" generato dall'AI. Tutti i campi sono obbligatori
// (gli output strutturati non gestiscono bene i campi opzionali): dove un campo
// non si applica si usa una lista vuota / -1.
export const ModuleSchema = z.object({
  title: z.string(),
  overview: z.string(),
  topics: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      importance: z.number(), // 1 = marginale, 2 = importante, 3 = centrale per l'esame
      difficulty: z.number(), // 1 = facile, 2 = medio, 3 = difficile
      summary: z.string(),
      keyConcepts: z.array(z.object({ term: z.string(), definition: z.string() })),
      mustKnow: z.array(z.string()),
      commonMistakes: z.array(z.string()),
      origin: z.enum(["notes", "online", "model"]),
      sourceIds: z.array(z.string()),
    }),
  ),
  flashcards: z.array(
    z.object({
      id: z.string(),
      topicId: z.string(),
      front: z.string(),
      back: z.string(),
      type: z.enum(["definizione", "perche", "come", "confronto", "formula", "esempio"]),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string(),
      topicId: z.string(),
      kind: z.enum(["mcq", "open", "problem"]),
      prompt: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number(),
      modelAnswer: z.string(),
      explanation: z.string(),
      rubric: z.array(z.string()),
    }),
  ),
  gaps: z.array(z.string()),
});

export const GradeSchema = z.object({
  score: z.number(), // 0..1
  verdict: z.enum(["corretta", "parziale", "errata"]),
  feedback: z.string(),
  covered: z.array(z.string()),
  missing: z.array(z.string()),
});

const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);
const str = (s) => (typeof s === "string" ? s.trim() : "");

/**
 * Rende il modulo coerente: id stabili e univoci, riferimenti validi, valori nei range.
 * `sources` è la lista [{id,title,url}] fornita al modello: gli id sconosciuti vengono scartati.
 */
export function normalizeModule(raw, sources = []) {
  const validSource = new Set(sources.map((s) => s.id));
  const idMap = new Map();
  const topics = [];
  for (const t of raw.topics ?? []) {
    if (!str(t.title)) continue;
    const id = `t${topics.length + 1}`;
    idMap.set(t.id, id);
    topics.push({
      id,
      title: str(t.title),
      importance: clamp(t.importance, 1, 3, 2),
      difficulty: clamp(t.difficulty, 1, 3, 2),
      summary: str(t.summary),
      keyConcepts: (t.keyConcepts ?? []).filter((k) => str(k.term) && str(k.definition)),
      mustKnow: (t.mustKnow ?? []).map(str).filter(Boolean),
      commonMistakes: (t.commonMistakes ?? []).map(str).filter(Boolean),
      origin: t.origin ?? "notes",
      sourceIds: (t.sourceIds ?? []).filter((s) => validSource.has(s)),
    });
  }
  const flashcards = [];
  for (const c of raw.flashcards ?? []) {
    const topicId = idMap.get(c.topicId);
    if (!topicId || !str(c.front) || !str(c.back)) continue;
    flashcards.push({ id: `c${flashcards.length + 1}`, topicId, front: str(c.front), back: str(c.back), type: c.type });
  }
  const questions = [];
  for (const q of raw.questions ?? []) {
    const topicId = idMap.get(q.topicId);
    if (!topicId || !str(q.prompt)) continue;
    const options = (q.options ?? []).map(str).filter(Boolean);
    const correctIndex = Math.round(q.correctIndex);
    if (q.kind === "mcq" && (options.length < 2 || !(correctIndex >= 0 && correctIndex < options.length))) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      topicId,
      kind: q.kind,
      prompt: str(q.prompt),
      options: q.kind === "mcq" ? options : [],
      correctIndex: q.kind === "mcq" ? correctIndex : -1,
      modelAnswer: str(q.modelAnswer),
      explanation: str(q.explanation),
      rubric: (q.rubric ?? []).map(str).filter(Boolean),
    });
  }
  return {
    title: str(raw.title),
    overview: str(raw.overview),
    topics,
    flashcards,
    questions,
    gaps: (raw.gaps ?? []).map(str).filter(Boolean),
    sources,
  };
}
