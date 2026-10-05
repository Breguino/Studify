// Generazione con Claude dentro la pagina pubblicata (capability `sample`): nessuna chiave API,
// usa l'account Claude di chi apre la pagina. Limiti: nessuna navigazione web, nessun PDF,
// prompt ≤ 256 KiB e risposte brevi → il modulo si costruisce a passi (schema → carte/domande per argomento).
import { ASSIGN_RULES, assignPrompt, CURRICULUM_RULES, EXAM_FORMAT_RULES, EXAM_GRADE_RULES, EXAM_TYPE_LABEL, EXTEND_RULES, GRADE_RULES, PAST_EXAMS_RULES, examGradePrompt, pastExamsPrompt, IMPORT_HEADERS, IMPORT_RULES, JSON_LATEX_RULE, MODULE_INTRO, MODULE_PRINCIPLES, QUESTION_MIX, SAFETY_RULES, examContext, materialText, moduleDigest, parseTranscription, transcribePrompt, DISPENSA_SYSTEM, chapterPrompt, splitChapter } from "../shared/prompts.js";
import { exampleChecker, examQuestionLines, identityRefs, normalizeAssignments, normalizeCurriculum, normalizeExamFormat, normalizeExamGrade, normalizeImportRows, normalizeModule, normalizePastExams, quoteChecker, repairLatex } from "../shared/normalize.js";

const MAX_MATERIAL_CHARS = 200_000;
const CONCURRENCY = 2; // `sample` ne esegue un paio alla volta, le altre aspettano: oltre si rischia rate_limited

export const getSample = async () => {
  try {
    return (await window.claude?.use?.("sample")) ?? null;
  } catch {
    return null;
  }
};

/** Errori di `sample` → messaggi per l'utente. */
export function explain(e) {
  if (e instanceof Error) return e;
  const msg = {
    not_granted: "Non hai consentito alla pagina di usare Claude: riapri la pagina e accetta quando richiesto.",
    sampling_disabled: "Claude non è disponibile per questo account o organizzazione.",
    rate_limited: "Hai raggiunto un limite d'uso o stai facendo troppe richieste: riprova tra un po'.",
    prompt_too_large: "Il materiale è troppo lungo per questa versione: dividilo in più esami o argomenti.",
    invalid_json: "Claude ha risposto in un formato non valido. Riprova.",
    refused: "Claude ha rifiutato la richiesta. Prova a cambiare il materiale.",
    empty_completion: "Claude non ha prodotto una risposta. Riprova con meno materiale.",
    session_expired: "Sessione scaduta: riapri la pagina ed effettua l'accesso.",
    cancelled: "Operazione annullata.",
  }[e?.code] ?? "Errore di comunicazione con Claude. Riprova.";
  return new Error(msg);
}

/** Esegue `fn` su ogni elemento con al più `n` richieste in volo. */
async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

function materialBlock({ materials, research }) {
  const parts = [];
  for (const m of materials) if (m.kind !== "pdf" && m.text) parts.push(materialText(m));
  if (research?.notes)
    parts.push(research.generated
      ? `<traccia_ai_non_verificata>\n${research.notes}\n</traccia_ai_non_verificata>`
      : `<ricerca_online>\n${research.notes}\n</ricerca_online>`);
  return parts.join("\n\n");
}

const RULES = `${MODULE_INTRO}\n${SAFETY_RULES}\n\n${MODULE_PRINCIPLES}\n${JSON_LATEX_RULE}`;

const OUTLINE_SHAPE = `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"title": string, "overview": string (3-5 frasi), "gaps": [string],
 "topics": [{"id": "t1", "title": string, "importance": 1|2|3, "difficulty": 1|2|3,
   "summary": string (3-5 frasi con parole tue), "keyConcepts": [{"term": string, "definition": string}] (2-5),
   "mustKnow": [string] (3-5), "commonMistakes": [string] (1-3),
   "origin": "notes"|"model",
   "excerpt": string (passaggio COPIATO alla lettera dai materiali su cui si basa l'argomento, max 1000 caratteri; "" se origin è "model"),
   "exercises": string (1-3 esercizi COPIATI dai materiali di tipo esercizi o dai temi d'esame che riguardano l'argomento, con la soluzione se c'è, max 2000 caratteri; "" se non ce ne sono),
   "examQuestionIds": [string] (id «D…» delle domande d'esame dell'elenco che riguardano l'argomento: ogni id in un solo argomento; [] se non ce ne sono),
   "methodNames": [string] (i tipi di esercizio SVOLTI DAL DOCENTE nei materiali su questo argomento, al massimo 3; [] se non ce ne sono)}],
 "examHints": [{"quote": string, "source": string, "note": string, "topicId": string (id dell'argomento, es. "t3", o "")}] (vedi il punto 9; [] se non ce ne sono)}
Regole di forma: da 5 a 12 argomenti, in ordine logico. origin="notes" se il contenuto viene dai materiali dello studente;
"model" solo per ciò che non è nei materiali (conoscenza generale, di cui sei certo). Il contenuto della <traccia_ai_non_verificata>
è una bozza senza fonti: ciò che proviene solo da lì ha origin="model".`;

const TOPIC_SHAPE = (type, n, methods = []) => `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"flashcards": [{"front": string, "back": string, "type": "definizione"|"perche"|"come"|"confronto"|"formula"|"esempio"}] (${n.cards}),
 "questions": [{"kind": "mcq"|"open"|"problem", "prompt": string, "options": [string] (4 se mcq, altrimenti []),
   "correctIndex": number (0-3 se mcq, altrimenti -1), "modelAnswer": string ("" se mcq), "explanation": string,
   "rubric": [string] (3-6 punti se open/problem, [] se mcq)${methods.length ? `, "method": string (per gli esercizi: il nome del metodo del docente che usano, tra ${methods.map((m) => `"${m.name}"`).join(", ")}; "" se nessuno)` : ""}}] (${n.questions}${methods.length ? `, di cui almeno ${2 * methods.length} kind="problem" sui metodi del docente, con dati diversi, svolte con lo stesso procedimento e la stessa notazione, un passaggio per paragrafo` : ""})
Mix delle domande per questa prova (${EXAM_TYPE_LABEL[type]}): ${QUESTION_MIX[type]}.`;

/** I metodi del docente di un argomento, per il passo 2: le domande «problem» li seguono. */
const methodsBlock = (methods) => (methods.length
  ? `<metodi_del_docente>\n${methods.map((m) => `### ${m.name}\nPassaggi:\n${m.steps.map((st, i) => `${i + 1}. ${st}`).join("\n")}${m.problem ? `\nEsercizio svolto:\n${String(m.problem).slice(0, 1200)}\n${String(m.solution).slice(0, 2500)}` : ""}`).join("\n\n")}\n</metodi_del_docente>\n`
  : "");

/**
 * Esercizi svolti dal docente: per un argomento con tipi di esercizio svolti (passo 1), Claude ricava i metodi dai materiali
 * di tipo esercizi svolti (che qui legge interi).
 */
async function methodsStep({ sample, exam, t, worked }) {
  if (!worked || !(Array.isArray(t.methodNames) && t.methodNames.length)) return [];
  const prompt = `${RULES}\n\n${examContext(exam)}\n\n${worked}\n\n<argomento>\n${JSON.stringify({ title: t.title, summary: t.summary })}\n</argomento>
Compito: METODI DEL DOCENTE DA RICAVARE per questo argomento, dai materiali di tipo esercizi svolti qui sopra, per questi tipi di esercizio: ${t.methodNames.slice(0, 3).map((n) => `«${n}»`).join(", ")}.
Segui le regole sugli esercizi svolti dal docente (passaggi generici; problem e solution COPIATI da un esercizio svolto vero).
Rispondi SOLO con un oggetto JSON: {"methods": [{"name": string, "steps": [string] (3-8), "problem": string, "solution": string, "source": string}]}`;
  try {
    const r = await sample.json(prompt, { modelTier: "default" });
    return Array.isArray(r?.methods) ? r.methods.slice(0, 3) : [];
  } catch (e) {
    if (["not_granted", "sampling_disabled", "rate_limited"].includes(e?.code)) throw explain(e);
    return [];
  }
}

/** Il testo dei soli materiali di tipo esercizi svolti (per il passo dei metodi). */
const workedBlock = (materials) => materials.filter((m) => m.role === "svolti" && m.kind !== "pdf" && m.text).map(materialText).join("\n\n").slice(0, 150_000);

/** Esercizi dei materiali su questo argomento: modello per le domande «problem» (il passo 2 non vede i materiali interi). */
const exerciseBlock = (t) =>
  typeof t.exercises === "string" && t.exercises.trim()
    ? `<esercizi_dai_materiali>\n${t.exercises.slice(0, 2500)}\n</esercizi_dai_materiali>\nUsa questi esercizi come modello: almeno metà delle domande siano kind="problem" dello stesso tipo, con svolgimento in modelAnswer (se la soluzione non c'è, risolvilo e scrivi in explanation "Svolgimento non presente nei materiali: verificalo"). Non farne flashcard. Se vengono da temi d'esame passati, cambia dati e contesto: le prove vere lo studente le tiene per le simulazioni.\n`
    : "";

const EXAM_Q_PER_CALL = 8; // domande d'esame per richiesta: ognuna ha risposta modello e rubrica, la risposta resta breve

/**
 * Passo 3 (se ci sono elenchi di domande d'esame): per ogni argomento, le sue domande d'esame diventano domande del quiz con
 * risposta modello, rubrica e domanda di approfondimento. `lines` = id «D12» → testo della voce.
 * @returns {Promise<{questions: object[], missed: string[]}>} domande con topicId; id rimasti senza argomento o non riusciti
 */
async function examQuestionsStep({ sample, exam, topics, lines, onProgress }) {
  const jobs = [];
  const assigned = new Set();
  for (const t of topics) {
    const ids = [...new Set((Array.isArray(t.examQuestionIds) ? t.examQuestionIds : []).filter((id) => lines.has(id) && !assigned.has(id)))];
    ids.forEach((id) => assigned.add(id));
    for (let k = 0; k < ids.length; k += EXAM_Q_PER_CALL) jobs.push({ t, ids: ids.slice(k, k + EXAM_Q_PER_CALL) });
  }
  const missed = [...lines.keys()].filter((id) => !assigned.has(id));
  let done = 0;
  const parts = await pool(jobs, CONCURRENCY, async ({ t, ids }) => {
    const prompt = `${RULES}

${examContext(exam)}

<argomento>
${JSON.stringify({ title: t.title, summary: t.summary, keyConcepts: t.keyConcepts, mustKnow: t.mustKnow, excerpt: t.excerpt ?? "" })}
</argomento>
<domande_esame_argomento>
${ids.map((id) => `${id}. ${lines.get(id)}`).join("\n")}
</domande_esame_argomento>
Compito: DOMANDE D'ESAME DA PREPARARE. Per ogni domanda distinta dell'elenco crea una question come dicono le regole sulle domande d'esame
(prompt = la domanda ripulita; examRefs = gli id che riproduce; risposta modello dall'estratto e dal riassunto, o tua se non c'è, segnalandolo).
Rispondi SOLO con un oggetto JSON: {"questions": [{"kind": "open"|"problem", "prompt": string, "options": [], "correctIndex": -1, "modelAnswer": string,
"explanation": string, "rubric": [string] (3-6), "followUp": string, "examRefs": [string]}]}`;
    try {
      const r = await sample.json(prompt, { modelTier: "default" });
      return { t, ids, questions: Array.isArray(r?.questions) ? r.questions : [] };
    } catch (e) {
      if (["not_granted", "sampling_disabled", "rate_limited"].includes(e?.code)) throw explain(e);
      return { t, ids, questions: [], failed: true };
    } finally {
      done++;
      onProgress(0, `Passo 3: domande d'esame — ${done}/${jobs.length}`);
    }
  });
  const questions = parts.flatMap((p) => p.questions.map((q) => ({ ...q, topicId: p.t.id, examRefs: (Array.isArray(q.examRefs) ? q.examRefs : []).filter((id) => p.ids.includes(id)) })));
  return { questions, missed: [...missed, ...parts.filter((p) => p.failed).flatMap((p) => p.ids)] };
}

const missedGap = (n) => `${n} ${n === 1 ? "domanda d'esame non è entrata" : "domande d'esame non sono entrate"} nel quiz: ripeti l'aggiornamento o rigenera il modulo.`;

/**
 * Modulo di studio a passi. `onProgress(chars, label)`: l'etichetta descrive il passo.
 * @returns {Promise<object>} modulo normalizzato (stesso formato del server)
 */
export async function generateModule({ exam, materials, research }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const type = exam.type in EXAM_TYPE_LABEL ? exam.type : "misto";
  const body = materialBlock({ materials, research });
  if (!body.trim()) throw new Error(materials.some((m) => m.kind === "pdf") ? "I PDF non sono supportati in questa versione: incolla il testo degli appunti." : "Aggiungi almeno un materiale testuale.");
  if (body.length > MAX_MATERIAL_CHARS) throw new Error(`Materiale troppo esteso per una volta (${Math.round(body.length / 1000)}k caratteri, max ${MAX_MATERIAL_CHARS / 1000}k, circa 60-80 pagine di libro): nei materiali scegli le pagine da usare e aggiungi il resto dopo con «Aggiungi al modulo».`);

  // Passo 1: argomenti
  onProgress(0, "Passo 1: leggo i materiali e individuo gli argomenti…");
  let outline;
  try {
    outline = await sample.json(`${RULES}\n\n${body}\n\n${examContext(exam)}\n\nCompito: struttura i materiali in argomenti di studio.\n${OUTLINE_SHAPE}`, {
      modelTier: "default",
      onText: ({ text }) => onProgress(text.length, "Passo 1: leggo i materiali e individuo gli argomenti…"),
    });
  } catch (e) {
    throw explain(e);
  }
  const topics = (Array.isArray(outline?.topics) ? outline.topics : []).filter((t) => t && typeof t.title === "string" && t.title.trim()).slice(0, 12);
  if (!topics.length) throw new Error("Claude non ha individuato argomenti: i materiali sono sufficienti?");
  const origIds = topics.map((t) => t.id);
  topics.forEach((t, i) => (t.id = `t${i + 1}`));
  const hintTopic = (id) => (origIds.indexOf(id) >= 0 ? `t${origIds.indexOf(id) + 1}` : "");

  // Passo 2: flashcard e domande per argomento
  let done = 0;
  const failed = [];
  const worked = workedBlock(materials);
  const perTopic = await pool(topics, CONCURRENCY, async (t) => {
    onProgress(0, `Passo 2: carte e domande — argomento ${Math.min(done + 1, topics.length)}/${topics.length}…`);
    t.methods = await methodsStep({ sample, exam, t, worked });
    const prompt = `${RULES}\n\n${examContext(exam)}\n\n<argomento>\n${JSON.stringify({ title: t.title, summary: t.summary, keyConcepts: t.keyConcepts, mustKnow: t.mustKnow, excerpt: t.excerpt ?? "" })}\n</argomento>\n${exerciseBlock(t)}${methodsBlock(t.methods)}\nCompito: crea flashcard e domande SOLO su questo argomento, fedeli all'estratto e al riassunto (non aggiungere fatti che non vi compaiono).\n${TOPIC_SHAPE(type, { cards: "6-9 flashcard", questions: t.methods.length ? "4-7 domande" : "3-5 domande" }, t.methods)}`;
    try {
      const r = await sample.json(prompt, { modelTier: "default" });
      return { flashcards: Array.isArray(r?.flashcards) ? r.flashcards : [], questions: Array.isArray(r?.questions) ? r.questions : [] };
    } catch (e) {
      if (e?.code === "not_granted" || e?.code === "sampling_disabled" || e?.code === "rate_limited") throw explain(e);
      failed.push(t.title);
      return { flashcards: [], questions: [] };
    } finally {
      done++;
      onProgress(0, `Passo 2: carte e domande — ${done}/${topics.length} argomenti`);
    }
  });

  const lines = examQuestionLines(materials);
  const exq = lines.size ? await examQuestionsStep({ sample, exam, topics, lines, onProgress }) : { questions: [], missed: [] };
  const raw = {
    title: outline.title,
    overview: outline.overview,
    gaps: [...(Array.isArray(outline.gaps) ? outline.gaps : []), ...failed.map((f) => `Per «${f}» non sono riuscito a generare carte e domande: rigenera il modulo.`), ...(exq.missed.length ? [missedGap(exq.missed.length)] : [])],
    topics: topics.map((t) => ({ ...t, sourceIds: [] })),
    examHints: (Array.isArray(outline.examHints) ? outline.examHints : []).map((x) => ({ ...x, topicId: hintTopic(x?.topicId) })),
    flashcards: perTopic.flatMap((r, i) => r.flashcards.map((c) => ({ ...c, topicId: topics[i].id }))),
    questions: [...perTopic.flatMap((r, i) => r.questions.map((q) => ({ ...q, topicId: topics[i].id }))), ...exq.questions],
  };
  const mod = normalizeModule(raw, [], { checkQuote: quoteChecker(body), examRefs: identityRefs(materials), checkExample: exampleChecker(body) });
  if (!mod.topics.length || (mod.flashcards.length === 0 && mod.questions.length === 0)) throw new Error("Non sono riuscito a generare carte e domande. Riprova con meno materiale.");
  return mod;
}

const EXTEND_OUTLINE_SHAPE = `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"gaps": [string] (elenco AGGIORNATO delle lacune dell'intero modulo),
 "topics": [{"id": string (l'id esistente, es. "t3", se lo approfondisci; "n1", "n2"… se è nuovo), "title": string,
   "importance": 1|2|3, "difficulty": 1|2|3, "summary": string, "keyConcepts": [{"term": string, "definition": string}] (solo voci nuove),
   "mustKnow": [string] (solo voci nuove), "commonMistakes": [string] (solo voci nuove), "origin": "notes"|"model",
   "excerpt": string (passaggio COPIATO alla lettera dai MATERIALI NUOVI su cui si basa, max 1000 caratteri),
   "exercises": string (1-3 esercizi COPIATI dai materiali nuovi di tipo esercizi o dai temi d'esame nuovi sull'argomento, con soluzione se c'è, max 2000 caratteri; "" se non ce ne sono),
   "examQuestionIds": [string] (id «D…» delle domande d'esame nuove che riguardano l'argomento: ogni id in un solo argomento; [] se non ce ne sono),
   "methodNames": [string] (i tipi di esercizio SVOLTI DAL DOCENTE nei materiali nuovi su questo argomento, al massimo 3; [] se non ce ne sono)}],
 "examHints": [{"quote": string, "source": string, "note": string, "topicId": string (id dell'argomento: esistente o nuovo, o "")}] (solo dai materiali nuovi; [] se non ce ne sono)}
Al massimo 8 argomenti in tutto (nuovi + approfonditi). Carte e domande verranno chieste dopo, argomento per argomento.`;

/**
 * Aggiorna un modulo con i materiali nuovi, a passi come `generateModule`: (1) argomenti nuovi o da approfondire,
 * (2) carte e domande per ciascuno, con l'elenco di quelle già presenti per non ripeterle.
 * @returns {Promise<{delta: object, sources: object[]}>} da fondere con `mergeModule`
 */
export async function extendModule({ exam, materials, research, existing }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const type = exam.type in EXAM_TYPE_LABEL ? exam.type : "misto";
  const body = materialBlock({ materials, research });
  if (!body.trim()) throw new Error(materials.some((m) => m.kind === "pdf") ? "I PDF non sono supportati in questa versione: incolla il testo degli appunti." : "Non ci sono appunti testuali nuovi da aggiungere.");
  const digest = moduleDigest(existing, 50_000);
  if (body.length + digest.length > MAX_MATERIAL_CHARS) throw new Error(`Appunti nuovi troppo estesi per un solo aggiornamento (${Math.round(body.length / 1000)}k caratteri): aggiungili un po' alla volta.`);

  const step1 = "Passo 1: confronto gli appunti nuovi con il modulo…";
  onProgress(0, step1);
  let outline;
  try {
    outline = await sample.json(`${RULES}\n\n${digest}\n\nMateriali NUOVI da integrare nel modulo:\n${body}\n\n${examContext(exam)}\n\n${EXTEND_RULES}\n\n${EXTEND_OUTLINE_SHAPE}`, {
      modelTier: "default",
      onText: ({ text }) => onProgress(text.length, step1),
    });
  } catch (e) {
    throw explain(e);
  }
  const known = new Map((existing.topics ?? []).map((t) => [t.id, t]));
  const topics = (Array.isArray(outline?.topics) ? outline.topics : [])
    .filter((t) => t && (known.has(t.id) || (typeof t.title === "string" && t.title.trim())))
    .slice(0, 8);
  let n = 0;
  const renamed = new Map();
  for (const t of topics) {
    if (known.has(t.id)) t.title = known.get(t.id).title;
    else { const old = t.id; t.id = `n${++n}`; if (old != null) renamed.set(old, t.id); }
  }

  let done = 0;
  const failed = [];
  const worked = workedBlock(materials);
  const perTopic = await pool(topics, CONCURRENCY, async (t) => {
    const old = known.has(t.id);
    t.methods = await methodsStep({ sample, exam, t, worked });
    const have = old ? (existing.flashcards ?? []).filter((c) => c.topicId === t.id).map((c) => `- ${c.front}`).join("\n") : "";
    const prompt = `${RULES}\n\n${examContext(exam)}\n\n<argomento>\n${JSON.stringify({ title: t.title, summary: t.summary, keyConcepts: t.keyConcepts, mustKnow: t.mustKnow, excerpt: t.excerpt ?? "" })}\n</argomento>\n${exerciseBlock(t)}${methodsBlock(t.methods)}${old ? `<carte_esistenti>\n${have}\n</carte_esistenti>\n` : ""}\nCompito: crea flashcard e domande SOLO ${old ? "sui contenuti NUOVI dell'estratto, senza ripetere le carte esistenti (nemmeno con parole diverse)" : "su questo argomento"}, fedeli all'estratto e al riassunto (non aggiungere fatti che non vi compaiono).\n${TOPIC_SHAPE(type, old ? { cards: "2-5 flashcard", questions: t.methods.length ? "3-6 domande" : "1-3 domande" } : { cards: "6-9 flashcard", questions: t.methods.length ? "4-7 domande" : "3-5 domande" }, t.methods)}`;
    try {
      const r = await sample.json(prompt, { modelTier: "default" });
      return { flashcards: Array.isArray(r?.flashcards) ? r.flashcards : [], questions: Array.isArray(r?.questions) ? r.questions : [] };
    } catch (e) {
      if (e?.code === "not_granted" || e?.code === "sampling_disabled" || e?.code === "rate_limited") throw explain(e);
      failed.push(t.title);
      return { flashcards: [], questions: [] };
    } finally {
      done++;
      onProgress(0, `Passo 2: carte e domande — ${done}/${topics.length} argomenti`);
    }
  });

  const lines = examQuestionLines(materials);
  const exq = lines.size ? await examQuestionsStep({ sample, exam, topics, lines, onProgress }) : { questions: [], missed: [] };
  const gaps = Array.isArray(outline?.gaps) ? outline.gaps : existing.gaps ?? [];
  return {
    delta: {
      gaps: [...gaps, ...failed.map((f) => `Per «${f}» non sono riuscito a generare carte e domande: ripeti l'aggiornamento.`), ...(exq.missed.length ? [missedGap(exq.missed.length)] : [])],
      topics: topics.map(({ excerpt, exercises, examQuestionIds, methodNames, ...t }) => ({ ...t, sourceIds: [] })),
      examHints: (Array.isArray(outline?.examHints) ? outline.examHints : []).map((x) => ({ ...x, topicId: known.has(x?.topicId) ? x.topicId : renamed.get(x?.topicId) ?? "" })),
      flashcards: perTopic.flatMap((r, i) => r.flashcards.map((c) => ({ ...c, topicId: topics[i].id }))),
      questions: [...perTopic.flatMap((r, i) => r.questions.map((q) => ({ ...q, topicId: topics[i].id }))), ...exq.questions],
    },
    sources: [],
  };
}

const PAGES_PER_CALL = 3; // poche pagine per richiesta: la trascrizione di una pagina fitta è lunga

/**
 * Trascrive pagine di PDF (immagini) in testo con formule LaTeX: è il modo per avere formule esatte nella pagina Claude,
 * dove il testo estratto dal PDF le rovina. `images[k]` è la pagina `firstPage + k`.
 * @returns {Promise<string[]>} testo di ciascuna pagina, nello stesso ordine
 */
export async function transcribePages({ images, firstPage, title = "", handwritten = false }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const limits = await sample.limits?.().catch(() => null);
  if (!limits?.images) throw new Error(handwritten ? "Qui Claude non può leggere immagini: gli appunti a mano non si possono trascrivere." : "Qui Claude non può leggere le immagini delle pagine: le formule restano quelle del testo del PDF.");
  const per = Math.max(1, Math.min(PAGES_PER_CALL, limits.images.maxCount ?? PAGES_PER_CALL));
  const groups = [];
  for (let k = 0; k < images.length; k += per) groups.push({ start: k, imgs: images.slice(k, k + per) });
  let done = 0;
  const parts = await pool(groups, CONCURRENCY, async ({ start, imgs }) => {
    const from = firstPage + start;
    try {
      const { text } = await sample(transcribePrompt({ from, count: imgs.length, title, handwritten }), { images: imgs, modelTier: "default" });
      return parseTranscription(text, from, imgs.length);
    } catch (e) {
      throw explain(e);
    } finally {
      done += imgs.length;
      onProgress(0, `Leggo le pagine con Claude… ${done}/${images.length}`);
    }
  });
  const out = parts.flat();
  if (out.every((p) => p == null)) throw new Error("Claude non ha restituito la trascrizione delle pagine. Riprova con meno pagine.");
  return out;
}

/**
 * Dispensa nella pagina Claude: un capitolo per richiesta, con tutti i materiali (testo) nel prompt.
 * `onProgress(chars, label, partial)`: partial = { chapters } già pronti, così si salvano anche se poi qualcosa va storto.
 */
export async function writeDispensa({ exam, materials, research, outline, topics, length, solutions }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const body = materialBlock({ materials, research });
  if (!body.trim()) throw new Error("Per la dispensa servono materiali testuali (qui i PDF si usano come testo: caricali di nuovo se mancano).");
  if (body.length > MAX_MATERIAL_CHARS) throw new Error(`Materiali troppo estesi per una volta (${Math.round(body.length / 1000)}k caratteri, max ${MAX_MATERIAL_CHARS / 1000}k): scegli meno pagine o lezioni.`);
  const chapters = [];
  for (const [k, topic] of topics.entries()) {
    onProgress(0, `Scrivo il capitolo ${k + 1}/${topics.length}: ${topic.title}…`, { chapters: [...chapters] });
    try {
      const { text, truncated } = await sample(`${DISPENSA_SYSTEM}\n\nMateriali dello studente:\n\n${body}\n\n${chapterPrompt({ exam, topic, outline, hints: topic.hints ?? [], examQuestions: topic.examQuestions ?? [], length, solutions })}`, {
        modelTier: "default",
        onText: ({ text: t }) => onProgress(t.length, `Scrivo il capitolo ${k + 1}/${topics.length}: ${topic.title}… ~${Math.round(t.length / 1000)}k caratteri`),
      });
      const ch = { topicId: topic.id, title: topic.title, ...splitChapter(text) };
      if (truncated) ch.body += "\n\n> Il capitolo è stato interrotto perché troppo lungo: riscrivilo in versione «sintetica».";
      chapters.push(ch);
    } catch (e) {
      if (["not_granted", "sampling_disabled", "rate_limited"].includes(e?.code) && !chapters.length) throw explain(e);
      chapters.push({ topicId: topic.id, title: topic.title, body: "", solutions: "", error: explain(e).message });
    }
    onProgress(0, `Capitoli pronti: ${k + 1}/${topics.length}`, { chapters: [...chapters] });
  }
  if (chapters.every((c) => c.error)) throw new Error(chapters[0]?.error || "Non sono riuscito a scrivere la dispensa.");
  return { chapters };
}

/** Senza ricerca web: una traccia di studio scritta da Claude dal programma indicato. Bozza non verificata. */
export async function generateNotes({ examName, university, degree, focus, language = "italiano" }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const where = [university, degree].filter(Boolean).join(" — ");
  const prompt = `Sei un docente universitario. Scrivi in ${language} una traccia di studio per l'esame "${examName}"${where ? ` (${where})` : ""}.
${SAFETY_RULES}
Programma/argomenti indicati dallo studente:
${focus || "(non indicati: usa i contenuti tipici di un corso con questo nome)"}

Per ogni argomento: definizioni, idee chiave, formule o procedure, un esempio. Sii preciso e sintetico (circa 1500-2500 parole in tutto).
Non citare fonti né link che non puoi verificare. Se non sei sicuro di un'informazione, scrivilo. Chiudi con "Lacune:" elencando ciò che lo studente dovrà verificare sul proprio corso.`;
  try {
    const { text } = await sample(prompt, { onText: ({ text }) => onProgress(text.length, `Scrivo la traccia… ~${Math.round(text.length / 1000)}k caratteri`) });
    return { notes: text.trim(), sources: [] };
  } catch (e) {
    throw explain(e);
  }
}

/** Modalità d'esame dalla scheda dell'insegnamento incollata (la pagina Claude non naviga): la citazione deve essere nel testo. */
export async function examFormatFromText({ text, course }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const prompt = `Estrai la modalità d'esame dalla scheda di un insegnamento incollata dallo studente. ${SAFETY_RULES}
${EXAM_FORMAT_RULES}
url = "" salvo che l'indirizzo della pagina compaia nel testo. found = false se il testo non indica la modalità d'esame.
Rispondi SOLO con un oggetto JSON: {"found": boolean, "format": "scritto"|"test"|"problemi"|"orale"|"misto"|"sconosciuto", "evidence": string,
"details": string, "url": string, "academicYear": string, "teacher": string, "caveats": [string]}

Insegnamento: ${course || "(non indicato)"}
<scheda_insegnamento>
${String(text).slice(0, 40_000)}
</scheda_insegnamento>`;
  try {
    return normalizeExamFormat(await sample.json(prompt, { modelTier: "default" }), { sourceText: text });
  } catch (e) {
    throw explain(e);
  }
}

/** Analisi delle prove d'esame passate (testo): esercizi collegati agli argomenti del modulo. */
export async function analyzePastExams({ exam, topics, papers }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const body = pastExamsPrompt({ exam, topics, papers });
  if (body.length > MAX_MATERIAL_CHARS) throw new Error(`Prove troppo lunghe per una volta (${Math.round(body.length / 1000)}k caratteri): nei materiali scegli meno prove e analizza il resto dopo.`);
  const prompt = `${PAST_EXAMS_RULES}
${JSON_LATEX_RULE}
Rispondi SOLO con un oggetto JSON: {"papers": [{"id": string, "label": string, "year": string, "durationMin": number, "hasSolutions": boolean,
"items": [{"n": string, "summary": string, "topicIds": [string], "kind": "esercizio"|"teoria"|"test"|"altro", "points": number}]}],
"structure": string, "recurring": [{"pattern": string, "topicId": string, "paperIds": [string]}], "uncovered": [string], "caveats": [string]}

${body}`;
  let raw;
  try {
    raw = await sample.json(prompt, { modelTier: "default", onText: ({ text }) => onProgress(text.length, `Claude legge le prove… ~${Math.round(text.length / 1000)}k caratteri`) });
  } catch (e) {
    throw explain(e);
  }
  const out = normalizePastExams(raw, { paperIds: papers.map((p) => p.id), topicIds: topics.map((t) => t.id) });
  if (!Object.keys(out.papers).length) throw new Error("Claude non ha riconosciuto le prove: controlla che i materiali «Esami passati» contengano i testi delle prove.");
  return out;
}

/** Correzione di una simulazione d'esame: la prova (testo) e lo svolgimento dello studente. */
export async function gradeExam({ exam, topics, paper, answer, minutes }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const body = examGradePrompt({ exam, topics, paper, answer, minutes });
  if (body.length > MAX_MATERIAL_CHARS) throw new Error("Prova e svolgimento sono troppo lunghi per una correzione sola.");
  const prompt = `${EXAM_GRADE_RULES}
${JSON_LATEX_RULE}
Rispondi SOLO con un oggetto JSON: {"items": [{"n": string, "task": string, "maxPoints": number, "points": number,
"verdict": "corretto"|"parziale"|"errato"|"non svolto", "feedback": string, "topicId": string}], "overall": string, "priorities": [string], "readingIssues": [string]}

${body}`;
  let raw;
  try {
    raw = await sample.json(prompt, { modelTier: "default", onText: ({ text }) => onProgress(text.length, `Correzione in corso… ~${Math.round(text.length / 1000)}k caratteri`) });
  } catch (e) {
    throw explain(e);
  }
  const out = normalizeExamGrade(raw, { topicIds: topics.map((t) => t.id) });
  if (!out.items.length) throw new Error("Claude non è riuscito a correggere la prova. Riprova.");
  return out;
}

/** Esercizi delle esercitazioni → argomento e rubrica (testo e soluzione ufficiali restano quelli). */
export async function assignExercises({ exam, topics, exercises }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const out = [];
  for (let k = 0; k < exercises.length; k += 15) { // gruppi piccoli: la risposta resta breve
    const group = exercises.slice(k, k + 15);
    onProgress(0, `Claude assegna gli esercizi agli argomenti… ${Math.min(k + 15, exercises.length)}/${exercises.length}`);
    const prompt = `${ASSIGN_RULES}
${JSON_LATEX_RULE}
Rispondi SOLO con un oggetto JSON: {"assign": [{"id": string, "topicId": string, "rubric": [string], "note": string}]}

${assignPrompt({ exam, topics, exercises: group })}`;
    try {
      const m = normalizeAssignments(await sample.json(prompt, { modelTier: "default" }), { ids: group.map((e) => e.id), topicIds: topics.map((t) => t.id) });
      out.push(...[...m].map(([id, a]) => ({ id, ...a })));
    } catch (e) {
      throw explain(e);
    }
  }
  return { assign: out };
}

/** Correzione di una risposta libera. */
export async function gradeAnswer({ question, reference, rubric = [], answer, language = "italiano" }, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const prompt = `${GRADE_RULES(language)}
Rispondi SOLO con un oggetto JSON: {"score": number 0-1, "verdict": "corretta"|"parziale"|"errata", "feedback": string, "covered": [string], "missing": [string]}
${JSON_LATEX_RULE}

<domanda>${question}</domanda>
<risposta_di_riferimento>${reference}</risposta_di_riferimento>
<rubrica>${rubric.map((r) => `- ${r}`).join("\n")}</rubrica>
<risposta_studente>${answer}</risposta_studente>`;
  try {
    const g = await sample.json(prompt, { modelTier: "default" });
    const score = Math.min(1, Math.max(0, Number(g?.score) || 0));
    return {
      score,
      verdict: ["corretta", "parziale", "errata"].includes(g?.verdict) ? g.verdict : score > 0.8 ? "corretta" : score > 0.4 ? "parziale" : "errata",
      feedback: repairLatex(String(g?.feedback ?? "")),
      covered: Array.isArray(g?.covered) ? g.covered.map((x) => repairLatex(String(x))) : [],
      missing: Array.isArray(g?.missing) ? g.missing.map((x) => repairLatex(String(x))) : [],
    };
  } catch (e) {
    throw explain(e);
  }
}

/** Piano di studi incollato dallo studente: Claude lo legge e lo struttura (anni, CFU, attività a scelta). Nessuna ricerca web. */
export async function parseCurriculum({ text, university, degree }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  if (text.length > MAX_MATERIAL_CHARS) throw new Error("Il testo è troppo lungo: incolla solo l'elenco degli insegnamenti.");
  onProgress(0, "Leggo il piano di studi…");
  const prompt = `Sei un assistente che legge piani di studio universitari. ${SAFETY_RULES}
${CURRICULUM_RULES}
url = "" sempre. found = false se il testo non contiene un piano di studi.
Rispondi SOLO con un oggetto JSON: {"found": boolean, "degreeName": string, "academicYear": string, "caveats": [string],
"courses": [{"name": string, "year": number, "cfu": number, "format": "scritto"|"orale"|"test"|"problemi"|"misto"|"sconosciuto", "formatEvidence": string, "kind": "obbligatorio"|"a_scelta"|"sconosciuto", "group": string, "url": ""}]}

${[university, degree].filter(Boolean).length ? `Corso: ${[university, degree].filter(Boolean).join(" — ")}\n` : ""}<piano_di_studi>
${text}
</piano_di_studi>`;
  let raw;
  try {
    raw = await sample.json(prompt, { modelTier: "default" });
  } catch (e) {
    throw explain(e);
  }
  const cur = normalizeCurriculum(raw ?? {}, new Set());
  if (!cur.found || !cur.courses.length) throw new Error("Nel testo non ho trovato insegnamenti: incolla l'elenco con gli anni e i CFU.");
  return { ...cur, sources: [] };
}

/**
 * Documento (testo estratto dal PDF con layout a colonne, oppure pagine scansionate come immagini) → righe di tabella
 * con le colonne canoniche del tipo richiesto. Poi passano dagli stessi importatori dei CSV.
 */
export async function importRows({ kind, text, images, today }, onProgress = () => {}, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  if (!IMPORT_HEADERS[kind]) throw new Error("Tipo di importazione non valido.");
  if (text && text.length > MAX_MATERIAL_CHARS) throw new Error("Il documento è troppo lungo per questa versione: importa poche pagine alla volta o usa un CSV.");
  const withImages = !text?.trim() && images?.length;
  if (withImages) {
    const limits = await sample.limits?.().catch(() => null);
    if (!limits?.images) throw new Error("Questo PDF è una scansione e qui Claude non può leggere immagini: usa un PDF con testo selezionabile o un CSV.");
  }
  onProgress(0, withImages ? "Claude legge le pagine scansionate…" : "Claude legge il documento…");
  const prompt = `Sei un assistente che legge documenti universitari e li trasforma in tabelle.
${IMPORT_RULES(kind, today)}
Rispondi SOLO con un oggetto JSON: {"found": boolean, "rows": [[${IMPORT_HEADERS[kind].map((h) => `"${h}"`).join(", ")}]], "notes": [string]}
Le righe contengono SOLO i valori (senza intestazione), ogni riga con ${IMPORT_HEADERS[kind].length} stringhe.

${withImages ? "Il documento è nelle immagini allegate (pagine in ordine)." : `<documento>\n${text}\n</documento>`}`;
  let raw;
  try {
    raw = await sample.json(prompt, { modelTier: "default", ...(withImages ? { images } : {}) });
  } catch (e) {
    throw explain(e);
  }
  const out = normalizeImportRows(raw, IMPORT_HEADERS[kind]);
  if (!out.found) throw new Error("Nel documento non ho trovato dati di questo tipo: controlla di aver scelto il tipo giusto.");
  return out;
}
