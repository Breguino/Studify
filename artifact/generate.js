// Generazione con Claude dentro la pagina pubblicata (capability `sample`): nessuna chiave API,
// usa l'account Claude di chi apre la pagina. Limiti: nessuna navigazione web, nessun PDF,
// prompt ≤ 256 KiB e risposte brevi → il modulo si costruisce a passi (schema → carte/domande per argomento).
import { CURRICULUM_RULES, EXAM_FORMAT_RULES, EXAM_TYPE_LABEL, EXERCISES_TASK, EXTEND_RULES, GRADE_RULES, IMPORT_HEADERS, IMPORT_RULES, MODULE_INTRO, MODULE_PRINCIPLES, QUESTION_MIX, SAFETY_RULES, examContext, materialText, moduleDigest } from "../shared/prompts.js";
import { normalizeCurriculum, normalizeExamFormat, normalizeImportRows, normalizeModule } from "../shared/normalize.js";

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

const RULES = `${MODULE_INTRO}\n${SAFETY_RULES}\n\n${MODULE_PRINCIPLES}`;

const OUTLINE_SHAPE = `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"title": string, "overview": string (3-5 frasi), "gaps": [string],
 "topics": [{"id": "t1", "title": string, "importance": 1|2|3, "difficulty": 1|2|3,
   "summary": string (3-5 frasi con parole tue), "keyConcepts": [{"term": string, "definition": string}] (2-5),
   "mustKnow": [string] (3-5), "commonMistakes": [string] (1-3),
   "origin": "notes"|"model",
   "excerpt": string (passaggio COPIATO alla lettera dai materiali su cui si basa l'argomento, max 1000 caratteri; "" se origin è "model"),
   "exercises": string (1-3 esercizi COPIATI dai materiali di tipo esercizi che riguardano l'argomento, con la soluzione se c'è, max 2000 caratteri; "" se non ce ne sono)}]}
Regole di forma: da 5 a 12 argomenti, in ordine logico. origin="notes" se il contenuto viene dai materiali dello studente;
"model" solo per ciò che non è nei materiali (conoscenza generale, di cui sei certo). Il contenuto della <traccia_ai_non_verificata>
è una bozza senza fonti: ciò che proviene solo da lì ha origin="model".`;

const TOPIC_SHAPE = (type, n) => `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"flashcards": [{"front": string, "back": string, "type": "definizione"|"perche"|"come"|"confronto"|"formula"|"esempio"}] (${n.cards}),
 "questions": [{"kind": "mcq"|"open"|"problem", "prompt": string, "options": [string] (4 se mcq, altrimenti []),
   "correctIndex": number (0-3 se mcq, altrimenti -1), "modelAnswer": string ("" se mcq), "explanation": string,
   "rubric": [string] (3-6 punti se open/problem, [] se mcq)}] (${n.questions})
Mix delle domande per questa prova (${EXAM_TYPE_LABEL[type]}): ${QUESTION_MIX[type]}.`;

/** Esercizi dei materiali su questo argomento: modello per le domande «problem» (il passo 2 non vede i materiali interi). */
const exerciseBlock = (t) =>
  typeof t.exercises === "string" && t.exercises.trim()
    ? `<esercizi_dai_materiali>\n${t.exercises.slice(0, 2500)}\n</esercizi_dai_materiali>\nUsa questi esercizi come modello: almeno metà delle domande siano kind="problem" dello stesso tipo, con svolgimento in modelAnswer (se la soluzione non c'è, risolvilo e scrivi in explanation "Svolgimento non presente nei materiali: verificalo"). Non farne flashcard.\n`
    : "";

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
  topics.forEach((t, i) => (t.id = `t${i + 1}`));

  // Passo 2: flashcard e domande per argomento
  let done = 0;
  const failed = [];
  const perTopic = await pool(topics, CONCURRENCY, async (t) => {
    onProgress(0, `Passo 2: carte e domande — argomento ${Math.min(done + 1, topics.length)}/${topics.length}…`);
    const prompt = `${RULES}\n\n${examContext(exam)}\n\n<argomento>\n${JSON.stringify({ title: t.title, summary: t.summary, keyConcepts: t.keyConcepts, mustKnow: t.mustKnow, excerpt: t.excerpt ?? "" })}\n</argomento>\n${exerciseBlock(t)}\nCompito: crea flashcard e domande SOLO su questo argomento, fedeli all'estratto e al riassunto (non aggiungere fatti che non vi compaiono).\n${TOPIC_SHAPE(type, { cards: "6-9 flashcard", questions: "3-5 domande" })}`;
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

const EXTEND_OUTLINE_SHAPE = `Rispondi SOLO con un oggetto JSON (nessun testo prima o dopo) con questa forma:
{"gaps": [string] (elenco AGGIORNATO delle lacune dell'intero modulo),
 "topics": [{"id": string (l'id esistente, es. "t3", se lo approfondisci; "n1", "n2"… se è nuovo), "title": string,
   "importance": 1|2|3, "difficulty": 1|2|3, "summary": string, "keyConcepts": [{"term": string, "definition": string}] (solo voci nuove),
   "mustKnow": [string] (solo voci nuove), "commonMistakes": [string] (solo voci nuove), "origin": "notes"|"model",
   "excerpt": string (passaggio COPIATO alla lettera dai MATERIALI NUOVI su cui si basa, max 1000 caratteri),
   "exercises": string (1-3 esercizi COPIATI dai materiali nuovi di tipo esercizi sull'argomento, con soluzione se c'è, max 2000 caratteri; "" se non ce ne sono)}]}
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
  for (const t of topics) {
    if (known.has(t.id)) t.title = known.get(t.id).title;
    else t.id = `n${++n}`;
  }

  let done = 0;
  const failed = [];
  const perTopic = await pool(topics, CONCURRENCY, async (t) => {
    const old = known.has(t.id);
    const have = old ? (existing.flashcards ?? []).filter((c) => c.topicId === t.id).map((c) => `- ${c.front}`).join("\n") : "";
    const prompt = `${RULES}\n\n${examContext(exam)}\n\n<argomento>\n${JSON.stringify({ title: t.title, summary: t.summary, keyConcepts: t.keyConcepts, mustKnow: t.mustKnow, excerpt: t.excerpt ?? "" })}\n</argomento>\n${exerciseBlock(t)}${old ? `<carte_esistenti>\n${have}\n</carte_esistenti>\n` : ""}\nCompito: crea flashcard e domande SOLO ${old ? "sui contenuti NUOVI dell'estratto, senza ripetere le carte esistenti (nemmeno con parole diverse)" : "su questo argomento"}, fedeli all'estratto e al riassunto (non aggiungere fatti che non vi compaiono).\n${TOPIC_SHAPE(type, old ? { cards: "2-5 flashcard", questions: "1-3 domande" } : { cards: "6-9 flashcard", questions: "3-5 domande" })}`;
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

  const gaps = Array.isArray(outline?.gaps) ? outline.gaps : existing.gaps ?? [];
  return {
    delta: {
      gaps: [...gaps, ...failed.map((f) => `Per «${f}» non sono riuscito a generare carte e domande: ripeti l'aggiornamento.`)],
      topics: topics.map(({ excerpt, exercises, ...t }) => ({ ...t, sourceIds: [] })),
      flashcards: perTopic.flatMap((r, i) => r.flashcards.map((c) => ({ ...c, topicId: topics[i].id }))),
      questions: perTopic.flatMap((r, i) => r.questions.map((q) => ({ ...q, topicId: topics[i].id }))),
    },
    sources: [],
  };
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
