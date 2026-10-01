import { z } from "zod";
import { FORMATS, KINDS, LEVELS } from "../shared/normalize.js";

export { normalizeCurriculum, normalizeDegrees, normalizeImportRows, normalizeModule } from "../shared/normalize.js";

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


export const CurriculumSchema = z.object({
  found: z.boolean(),
  degreeName: z.string(),
  academicYear: z.string(),
  courses: z.array(
    z.object({
      name: z.string(),
      year: z.number(),
      cfu: z.number(),
      format: z.enum(FORMATS),
      formatEvidence: z.string(),
      kind: z.enum(KINDS),
      group: z.string(),
      url: z.string(),
    }),
  ),
  caveats: z.array(z.string()),
});

export const DegreesSchema = z.object({
  found: z.boolean(),
  academicYear: z.string(),
  degrees: z.array(z.object({ name: z.string(), level: z.enum(LEVELS), classe: z.string(), url: z.string() })),
  caveats: z.array(z.string()),
});

export const ImportRowsSchema = z.object({
  found: z.boolean(),
  rows: z.array(z.array(z.string())),
  notes: z.array(z.string()),
});

export const GradeSchema = z.object({
  score: z.number(), // 0..1
  verdict: z.enum(["corretta", "parziale", "errata"]),
  feedback: z.string(),
  covered: z.array(z.string()),
  missing: z.array(z.string()),
});
