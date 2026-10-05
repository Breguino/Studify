import { z } from "zod";
import { FORMATS, KINDS, LEVELS } from "../shared/normalize.js";

export { normalizeCurriculum, normalizeDegrees, normalizeExamFormat, normalizeExamGrade, normalizeImportRows, normalizeModule, normalizePastExams, quoteChecker, repairLatex, identityRefs, exampleChecker, normalizeAssignments } from "../shared/normalize.js";

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
      // dagli esercizi svolti dal docente: il procedimento in passi e un esercizio svolto copiato dal materiale
      methods: z.array(z.object({ name: z.string(), steps: z.array(z.string()), problem: z.string(), solution: z.string(), source: z.string() })),
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
      examRefs: z.array(z.string()), // id «D12» delle domande d'esame che la domanda riproduce ([] se non viene da un elenco)
      followUp: z.string(), // per le domande d'esame: come incalzerebbe il docente
      method: z.string(), // per gli esercizi: il metodo del docente che si usa (name), "" se nessuno
    }),
  ),
  gaps: z.array(z.string()),
  // frasi del docente sull'esame, copiate dai materiali (soprattutto sbobine)
  examHints: z.array(z.object({ quote: z.string(), source: z.string(), note: z.string(), topicId: z.string() })),
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

// Modalità d'esame di un singolo insegnamento (dalla scheda / syllabus sul sito dell'ateneo).
export const ExamFormatSchema = z.object({
  found: z.boolean(),
  format: z.enum(FORMATS),
  evidence: z.string(), // frase copiata dalla pagina
  details: z.string(), // durata, parti, prova intermedia… in breve
  url: z.string(),
  academicYear: z.string(),
  teacher: z.string(),
  caveats: z.array(z.string()),
});

// Analisi delle prove d'esame passate (una voce per prova, esercizi collegati agli argomenti del modulo).
export const PastExamsSchema = z.object({
  papers: z.array(z.object({
    id: z.string(),
    label: z.string(),
    year: z.string(),
    durationMin: z.number(),
    hasSolutions: z.boolean(),
    items: z.array(z.object({ n: z.string(), summary: z.string(), topicIds: z.array(z.string()), kind: z.enum(["esercizio", "teoria", "test", "altro"]), points: z.number() })),
  })),
  structure: z.string(),
  recurring: z.array(z.object({ pattern: z.string(), topicId: z.string(), paperIds: z.array(z.string()) })),
  uncovered: z.array(z.string()),
  caveats: z.array(z.string()),
});

// Correzione di una simulazione d'esame.
export const ExamGradeSchema = z.object({
  items: z.array(z.object({
    n: z.string(),
    task: z.string(),
    maxPoints: z.number(),
    points: z.number(),
    verdict: z.enum(["corretto", "parziale", "errato", "non svolto"]),
    feedback: z.string(),
    topicId: z.string(),
  })),
  overall: z.string(),
  priorities: z.array(z.string()),
  readingIssues: z.array(z.string()),
});

// Esercizi delle esercitazioni assegnati agli argomenti (testo e soluzione ufficiali li tiene l'app).
export const AssignSchema = z.object({
  assign: z.array(z.object({ id: z.string(), topicId: z.string(), rubric: z.array(z.string()), note: z.string() })),
});
