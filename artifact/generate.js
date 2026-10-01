// Generazione con Claude dentro la pagina pubblicata (capability `sample`): nessuna chiave API,
// usa l'account Claude di chi apre la pagina. Limiti: nessuna navigazione web, nessun PDF,
// prompt ≤ 256 KiB e risposte brevi → il modulo si costruisce a passi (schema → carte/domande per argomento).
import { EXAM_TYPE_LABEL, GRADE_RULES, MODULE_INTRO, MODULE_PRINCIPLES, QUESTION_MIX, SAFETY_RULES, examContext } from "../shared/prompts.js";
import { normalizeModule } from "../shared/normalize.js";

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
  for (const m of materials) if (m.kind !== "pdf" && m.text) parts.push(`<appunti_studente titolo="${String(m.title).replace(/"/g, "'")}">\n${m.text}\n</appunti_studente>`);
  if (research?.notes)
    parts.push(research.generated
      ? `<traccia_ai_non_verificata>\n${research.notes}\n</traccia_ai_non_verificata>`
      : `<ricerca_online>\n${research.notes}\n</ricerca_online>`);
  return parts.join("\n\n");
}

const RULES = `${MODULE_INTRO}\n${SAFETY_RULES}\n\n${MODULE_PRINCIPLES}`;

const OUTLINE_SHAPE = `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"title": string, "overview": string (3-5 frasi), "gaps": [string],
 "topics": [{"id": "t1", "title": string, "importance": 1|2|3, "difficulty": 1|2|3,
   "summary": string (3-5 frasi con parole tue), "keyConcepts": [{"term": string, "definition": string}] (2-5),
   "mustKnow": [string] (3-5), "commonMistakes": [string] (1-3),
   "origin": "notes"|"model",
   "excerpt": string (passaggio COPIATO alla lettera dai materiali su cui si basa l'argomento, max 1000 caratteri; "" se origin è "model")}]}
Regole di forma: da 5 a 12 argomenti, in ordine logico. origin="notes" se il contenuto viene dai materiali dello studente;
"model" solo per ciò che non è nei materiali (conoscenza generale, di cui sei certo). Il contenuto della <traccia_ai_non_verificata>
è una bozza senza fonti: ciò che proviene solo da lì ha origin="model".`;

const TOPIC_SHAPE = (type, n) => `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"flashcards": [{"front": string, "back": string, "type": "definizione"|"perche"|"come"|"confronto"|"formula"|"esempio"}] (${n.cards}),
 "questions": [{"kind": "mcq"|"open"|"problem", "prompt": string, "options": [string] (4 se mcq, altrimenti []),
   "correctIndex": number (0-3 se mcq, altrimenti -1), "modelAnswer": string ("" se mcq), "explanation": string,
   "rubric": [string] (3-6 punti se open/problem, [] se mcq)}] (${n.questions})
Mix delle domande per questa prova (${EXAM_TYPE_LABEL[type]}): ${QUESTION_MIX[type]}.`;

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
  if (body.length > MAX_MATERIAL_CHARS) throw new Error(`Materiale troppo esteso per questa versione (${Math.round(body.length / 1000)}k caratteri, max ${MAX_MATERIAL_CHARS / 1000}k): dividilo in più esami.`);

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
  topics.forEach((t, i) => (t.id = `t${i + 1}`));

  // Passo 2: flashcard e domande per argomento
  let done = 0;
  const failed = [];
  const perTopic = await pool(topics, CONCURRENCY, async (t) => {
    onProgress(0, `Passo 2: carte e domande — argomento ${Math.min(done + 1, topics.length)}/${topics.length}…`);
    const prompt = `${RULES}\n\n${examContext(exam)}\n\n<argomento>\n${JSON.stringify({ title: t.title, summary: t.summary, keyConcepts: t.keyConcepts, mustKnow: t.mustKnow, excerpt: t.excerpt ?? "" })}\n</argomento>\n\nCompito: crea flashcard e domande SOLO su questo argomento, fedeli all'estratto e al riassunto (non aggiungere fatti che non vi compaiono).\n${TOPIC_SHAPE(type, { cards: "6-9 flashcard", questions: "3-5 domande" })}`;
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

  const raw = {
    title: outline.title,
    overview: outline.overview,
    gaps: [...(Array.isArray(outline.gaps) ? outline.gaps : []), ...failed.map((f) => `Per «${f}» non sono riuscito a generare carte e domande: rigenera il modulo.`)],
    topics: topics.map((t) => ({ ...t, sourceIds: [] })),
    flashcards: perTopic.flatMap((r, i) => r.flashcards.map((c) => ({ ...c, topicId: topics[i].id }))),
    questions: perTopic.flatMap((r, i) => r.questions.map((q) => ({ ...q, topicId: topics[i].id }))),
  };
  const mod = normalizeModule(raw, []);
  if (!mod.topics.length || (mod.flashcards.length === 0 && mod.questions.length === 0)) throw new Error("Non sono riuscito a generare carte e domande. Riprova con meno materiale.");
  return mod;
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

/** Correzione di una risposta libera. */
export async function gradeAnswer({ question, reference, rubric = [], answer, language = "italiano" }, sampleFn) {
  const sample = sampleFn ?? (await getSample());
  if (!sample) throw new Error("Claude non è disponibile in questa pagina.");
  const prompt = `${GRADE_RULES(language)}
Rispondi SOLO con un oggetto JSON: {"score": number 0-1, "verdict": "corretta"|"parziale"|"errata", "feedback": string, "covered": [string], "missing": [string]}

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
      feedback: String(g?.feedback ?? ""),
      covered: Array.isArray(g?.covered) ? g.covered.map(String) : [],
      missing: Array.isArray(g?.missing) ? g.missing.map(String) : [],
    };
  } catch (e) {
    throw explain(e);
  }
}
