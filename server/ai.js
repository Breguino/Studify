import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ASSIGN_RULES, assignPrompt, CURRICULUM_RULES, EXAM_FORMAT_RULES, EXAM_GRADE_RULES, EXAM_TYPE_LABEL, EXTEND_RULES, PAST_EXAMS_RULES, examGradePrompt, pastExamsPrompt, practiceTasks, MATERIAL_LABEL, GRADE_RULES, IMPORT_HEADERS, IMPORT_RULES, MODULE_INTRO, MODULE_PRINCIPLES, QUESTION_MIX, SAFETY_RULES, examContext, materialText, moduleDigest, parseTranscription, transcribePrompt, where, DISPENSA_SYSTEM, chapterPrompt, splitChapter } from "../shared/prompts.js";
import { AssignSchema, CurriculumSchema, DegreesSchema, ExamFormatSchema, ExamGradeSchema, GradeSchema, ImportRowsSchema, ModuleSchema, PastExamsSchema, normalizeCurriculum, normalizeDegrees, normalizeExamFormat, normalizeExamGrade, normalizeImportRows, normalizeModule, normalizePastExams, quoteChecker, repairLatex, identityRefs, exampleChecker, normalizeAssignments } from "./schema.js";

export const MODEL = process.env.STUDIFY_MODEL || "claude-opus-5-5";

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let _client;
const client = () => (_client ??= new Anthropic());
/** Solo per i test: sostituisce il client con uno finto. */
export const setClient = (c) => { _client = c; };

/** Converte errori dell'SDK in messaggi comprensibili (senza esporre dettagli sensibili). */
export function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError)
    return "Chiave API non valida o mancante. Imposta ANTHROPIC_API_KEY e riavvia il server.";
  if (e instanceof Anthropic.RateLimitError) return "Troppe richieste all'AI: riprova tra qualche minuto.";
  if (e instanceof Anthropic.BadRequestError) return `Richiesta rifiutata dall'AI: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Impossibile raggiungere l'API di Anthropic (rete/proxy).";
  if (e instanceof Anthropic.APIError) return `Errore dell'AI (${e.status}): ${e.message}`;
  return e?.message || "Errore sconosciuto";
}

function textOf(content) {
  return content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function assertUsable(msg) {
  if (msg.stop_reason === "refusal")
    throw new Error("Il modello ha rifiutato la richiesta (filtri di sicurezza). Prova a riformulare o cambiare materiale.");
  if (msg.stop_reason === "max_tokens")
    throw new Error("Risposta troncata: il materiale è troppo esteso per un unico modulo. Suddividilo in più esami/moduli.");
}

/* -------------------------------------------------------------------------- */
/* Ricerca web (base comune a materiale didattico e piano di studi)           */
/* -------------------------------------------------------------------------- */

/**
 * Esegue una ricerca web con ripresa su pause_turn.
 * Restituisce il testo prodotto, le fonti citate (o, in mancanza, i primi risultati) e l'insieme di
 * TUTTI gli URL effettivamente visti, per poter verificare che il modello non ne inventi.
 */
async function webResearch({ system, prompt, maxUses = 8 }, onProgress = () => {}) {
  const messages = [{ role: "user", content: prompt }];
  let notes = "";
  const results = new Map(); // url -> title
  const cited = new Map();

  for (let i = 0; i < 5; i++) {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
      messages,
    });
    stream.on("text", (d) => onProgress(d.length));
    const msg = await stream.finalMessage();
    assertUsable(msg);
    for (const b of msg.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content))
        for (const r of b.content) if (r.url) results.set(r.url, r.title || r.url);
      if (b.type === "text") {
        notes += b.text;
        for (const c of b.citations ?? []) if (c.url) cited.set(c.url, c.title || c.url);
      }
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content }); // il server riprende da solo
  }

  if (!notes.trim()) throw new Error("La ricerca non ha prodotto risultati utilizzabili.");
  const pool = cited.size ? cited : results;
  const sources = [...pool.entries()].slice(0, 15).map(([url, title], i) => ({ id: `S${i + 1}`, title, url }));
  return { notes: notes.trim(), sources, seenUrls: new Set([...results.keys(), ...cited.keys()]) };
}

/* -------------------------------------------------------------------------- */
/* Ricerca online di materiale didattico                                      */
/* -------------------------------------------------------------------------- */

export async function research({ examName, university, degree, focus, language = "italiano" }, onProgress = () => {}) {
  const system = `Sei un assistente che cerca materiale didattico affidabile per uno studente universitario.
${SAFETY_RULES}
Regole:
- Preferisci fonti autorevoli: siti universitari, OpenCourseWare, manuali/dispense pubbliche, documentazione ufficiale, enciclopedie solo come appoggio.
- Non inventare nulla: riporta solo ciò che trovi, e dì chiaramente cosa non hai trovato.
- Scrivi in ${language}.`;
  const prompt = `Cerca online materiale per preparare l'esame "${examName}"${where(university, degree) ? ` (${where(university, degree)})` : ""}.
${university ? "Cerca prima la scheda ufficiale dell'insegnamento (programma, testi consigliati, modalità d'esame) sul sito dell'ateneo, poi altro materiale.\n" : ""}${focus ? `Argomenti/programma indicati dallo studente:\n${focus}\n` : "Se non c'è un programma, ricostruisci i contenuti tipici di un corso con questo nome."}

Restituisci appunti di studio strutturati per argomento: definizioni, idee chiave, formule/procedure, esempi.
Per ogni argomento indica a fine sezione "Fonti:" con gli URL da cui proviene l'informazione.
Se la scheda del corso o il sito dell'ateneo indicano come si svolge l'esame, riportalo in una riga che inizia
esattamente con "Modalità d'esame:" (scritto, orale, test, esercizi, o combinazioni) citando la fonte; se non lo trovi
scrivi "Modalità d'esame: non trovata". Non dedurlo dalla materia.
Chiudi con "Lacune:" elencando ciò che non sei riuscito a verificare.`;
  const { notes, sources } = await webResearch({ system, prompt }, onProgress);
  return { notes, sources };
}

/* -------------------------------------------------------------------------- */
/* Piano di studi di un corso di laurea                                       */
/* -------------------------------------------------------------------------- */

export async function curriculum({ university, degree }, onProgress = () => {}) {
  const system = `Sei un assistente che consulta i siti ufficiali delle università italiane.
${SAFETY_RULES}
Non inventare insegnamenti, CFU o modalità d'esame: riporta solo ciò che leggi nelle pagine trovate.`;
  const prompt = `Trova il piano di studi (manifesto degli studi / offerta formativa) del corso di studio "${degree}" presso "${university}",
per l'anno accademico più recente disponibile. Preferisci le pagine ufficiali dell'ateneo e del dipartimento.
Elenca gli insegnamenti per anno di corso con CFU e se sono obbligatori o a scelta; per il terzo anno (o l'ultimo) riporta anche
le attività a scelta dello studente e, se esiste, l'elenco degli insegnamenti a scelta consigliati dal corso.
Se la scheda dell'insegnamento dichiara esplicitamente la modalità d'esame (scritto, orale, test, esercizi), indicala con l'URL
della pagina dove l'hai letta. Indica anche l'anno accademico dei dati.
Se esistono più curricula, indica quale hai usato. Se non trovi il corso, dillo chiaramente.`;
  const found = await webResearch({ system, prompt, maxUses: 10 }, onProgress);

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(CurriculumSchema) },
    system: `Estrai dati strutturati dal testo di una ricerca. ${SAFETY_RULES}
${CURRICULUM_RULES}
url = pagina da cui proviene, scelta SOLO tra gli URL elencati, altrimenti "". found = false se il corso non è stato trovato.`,
    messages: [{ role: "user", content: `<ricerca>\n${found.notes}\n</ricerca>\n<url_validi>\n${[...found.seenUrls].join("\n")}\n</url_validi>` }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = CurriculumSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("Non sono riuscito a interpretare il piano di studi trovato. Riprova o inseriscilo a mano.");
  }
  const cur = normalizeCurriculum(raw, found.seenUrls);
  if (!cur.found || !cur.courses.length) throw new Error("Non ho trovato il piano di studi online: inserisci gli insegnamenti a mano.");
  return { ...cur, sources: found.sources };
}

/* -------------------------------------------------------------------------- */
/* Modalità d'esame di un insegnamento                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cerca la scheda dell'insegnamento (syllabus) sul sito dell'ateneo e ne estrae la modalità d'esame,
 * con la frase letta e l'URL. Non la deduce dalla materia: se non la trova lo dice.
 */
export async function examFormat({ university, degree, course, academicYear }, onProgress = () => {}) {
  const system = `Sei un assistente che consulta i siti ufficiali delle università italiane.
${SAFETY_RULES}
Riporta solo ciò che leggi nelle pagine trovate; non dedurre la modalità d'esame dal nome della materia.`;
  const prompt = `Trova la scheda ufficiale dell'insegnamento "${course}"${degree ? ` del corso di studio "${degree}"` : ""} presso "${university}"
(syllabus / programma dell'insegnamento${academicYear ? `, anno accademico ${academicYear} o il più recente disponibile` : ", anno accademico più recente"}).
Riporta TESTUALMENTE la parte sulla modalità d'esame (di solito «Modalità di verifica dell'apprendimento», «Modalità d'esame»,
«Assessment methods»): scritto, orale, test, esercizi, prove intermedie, durata, se l'orale è obbligatorio o facoltativo.
Indica l'URL della pagina, l'anno accademico e il docente. Se ci sono più docenti o canali con modalità diverse, elencali.
Se non trovi la scheda o la modalità non è indicata, dillo chiaramente.`;
  const found = await webResearch({ system, prompt, maxUses: 6 }, onProgress);

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(ExamFormatSchema) },
    system: `Estrai dati strutturati dal testo di una ricerca. ${SAFETY_RULES}
${EXAM_FORMAT_RULES}
url = pagina da cui proviene, scelta SOLO tra gli URL elencati, altrimenti "". found = false se non hai trovato la modalità.`,
    messages: [{ role: "user", content: `<ricerca>\n${found.notes}\n</ricerca>\n<url_validi>\n${[...found.seenUrls].join("\n")}\n</url_validi>` }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = ExamFormatSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("Non sono riuscito a interpretare la scheda trovata.");
  }
  return normalizeExamFormat(raw, { seenUrls: found.seenUrls });
}

/** La stessa estrazione dal testo della scheda incollato dallo studente (niente web): la citazione deve essere nel testo. */
export async function examFormatFromText({ text, course }) {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(ExamFormatSchema) },
    system: `Estrai la modalità d'esame dalla scheda di un insegnamento incollata dallo studente. ${SAFETY_RULES}
${EXAM_FORMAT_RULES}
url = "" salvo che l'indirizzo della pagina compaia nel testo. found = false se il testo non indica la modalità d'esame.`,
    messages: [{ role: "user", content: `Insegnamento: ${course || "(non indicato)"}\n<scheda_insegnamento>\n${text}\n</scheda_insegnamento>` }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = ExamFormatSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("Non sono riuscito a interpretare la scheda.");
  }
  return normalizeExamFormat(raw, { sourceText: text });
}

/* -------------------------------------------------------------------------- */
/* Corsi di studio di un ateneo                                               */
/* -------------------------------------------------------------------------- */

export async function degrees({ university }, onProgress = () => {}) {
  const system = `Sei un assistente che consulta i siti ufficiali delle università italiane.
${SAFETY_RULES}
Non inventare corsi: riporta solo ciò che leggi nelle pagine trovate.`;
  const prompt = `Trova l'elenco dei corsi di studio (laurea triennale L, magistrale LM, ciclo unico LMCU) attivi presso "${university}"
per l'anno accademico più recente. Preferisci la pagina "offerta formativa" del sito ufficiale dell'ateneo.
Per ciascun corso indica nome, tipo, classe di laurea (es. L-8) se riportata, e l'URL della pagina. Indica l'anno accademico dei dati.
Se non trovi l'offerta formativa, dillo chiaramente.`;
  const found = await webResearch({ system, prompt, maxUses: 10 }, onProgress);
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(DegreesSchema) },
    system: `Estrai dati strutturati dal testo di una ricerca. ${SAFETY_RULES}
Includi solo corsi elencati nel testo. level = "L", "LM" o "LMCU" ("" se non chiaro). classe = codice della classe (es. "L-8") o "".
url = pagina da cui proviene, scelta SOLO tra gli URL elencati, altrimenti "". found = false se l'offerta formativa non è stata trovata.`,
    messages: [{ role: "user", content: `<ricerca>\n${found.notes}\n</ricerca>\n<url_validi>\n${[...found.seenUrls].join("\n")}\n</url_validi>` }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = DegreesSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("Non sono riuscito a interpretare l'elenco dei corsi trovato. Scrivi il nome del corso a mano.");
  }
  const out = normalizeDegrees(raw, found.seenUrls);
  if (!out.found || !out.degrees.length) throw new Error("Non ho trovato l'elenco dei corsi online: scrivi il nome del tuo corso a mano.");
  return { ...out, sources: found.sources };
}

/** Piano di studi incollato dallo studente (dal sito dell'ateneo, da Esse3, da un PDF): nessuna ricerca web. */
export async function parseCurriculum({ text, university, degree }) {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(CurriculumSchema) },
    system: `Sei un assistente che legge piani di studio universitari. ${SAFETY_RULES}
${CURRICULUM_RULES}
url = "" sempre. found = false se il testo non contiene un piano di studi.`,
    messages: [{ role: "user", content: `${where(university, degree) ? `Corso: ${where(university, degree)}\n` : ""}<piano_di_studi>\n${text}\n</piano_di_studi>` }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = CurriculumSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("Non sono riuscito a leggere il piano di studi incollato. Prova a incollare solo l'elenco degli insegnamenti.");
  }
  const cur = normalizeCurriculum(raw, new Set());
  if (!cur.found || !cur.courses.length) throw new Error("Nel testo non ho trovato insegnamenti: incolla l'elenco con gli anni e i CFU.");
  return { ...cur, sources: [] };
}

/* -------------------------------------------------------------------------- */
/* Importazione da PDF / testo (appelli, piano di studi, orari)               */
/* -------------------------------------------------------------------------- */

/**
 * Legge un documento (testo estratto dal PDF con il layout a colonne, oppure il PDF stesso se è una scansione)
 * e lo trasforma in righe di tabella con le colonne canoniche del tipo richiesto.
 */
export async function importRows({ kind, text, pdf, today }) {
  if (!IMPORT_HEADERS[kind]) throw new Error("Tipo di importazione non valido.");
  const content = [];
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } });
  content.push({ type: "text", text: `${IMPORT_RULES(kind, today)}\n\n${text ? `<documento>\n${text}\n</documento>` : "Il documento è il PDF allegato."}` });
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(ImportRowsSchema) },
    system: `Sei un assistente che legge documenti universitari e li trasforma in tabelle. ${SAFETY_RULES}`,
    messages: [{ role: "user", content }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = ImportRowsSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("Non sono riuscito a interpretare il documento. Prova con un CSV o con meno pagine.");
  }
  const out = normalizeImportRows(raw, IMPORT_HEADERS[kind]);
  if (!out.found) throw new Error("Nel documento non ho trovato dati di questo tipo: controlla di aver scelto il tipo giusto.");
  return out;
}

/* -------------------------------------------------------------------------- */
/* Generazione del modulo di studio                                           */
/* -------------------------------------------------------------------------- */

const MODULE_SYSTEM = `${MODULE_INTRO}
${SAFETY_RULES}

${MODULE_PRINCIPLES}`;

const fullTask = (exam, type) => `Produci il modulo di studio completo.
- Argomenti: tra 5 e 15, in base all'ampiezza dei materiali.
- Flashcard: circa 6-10 per argomento (mai meno di 4).
- Domande: circa 3-6 per argomento; mix per questo tipo di prova: ${QUESTION_MIX[type]}.
- Calibra difficoltà e spiegazioni sul livello ${exam.level}/5: più scaffolding e esempi se basso, più sfumature e casi limite se alto.`;

const extendTask = (exam, type) => `${EXTEND_RULES}
- Argomento nuovo: circa 6-10 flashcard e 3-6 domande. Argomento approfondito: 2-6 flashcard e 1-3 domande, solo sui contenuti nuovi.
- Mix delle domande per questo tipo di prova: ${QUESTION_MIX[type]}.
- Calibra difficoltà e spiegazioni sul livello ${exam.level}/5.`;

function buildUserContent({ exam, materials, research: res, existing }, task = fullTask) {
  const content = [];
  const docs = [];
  for (const m of materials) {
    if (m.kind === "pdf" && m.data) {
      const title = `${MATERIAL_LABEL[m.role] ?? "Materiale"} — ${m.title}${m.pages ? ` (pagine ${m.pages})` : ""}`;
      docs.push(title);
      content.push({ type: "document", title, source: { type: "base64", media_type: "application/pdf", data: m.data } });
    }
  }
  const parts = existing ? [moduleDigest(existing), "Materiali NUOVI da integrare nel modulo (anche i PDF allegati sono nuovi):"] : [];
  if (docs.length) parts.push(`Documenti PDF allegati (tipo — titolo):\n${docs.map((d) => `- ${d}`).join("\n")}`);
  for (const m of materials) {
    if (m.kind !== "pdf" && m.text) parts.push(materialText(m));
  }
  if (res?.notes) {
    parts.push(`<ricerca_online>\n${res.notes}\n</ricerca_online>`);
    parts.push(`<fonti_online>\n${res.sources.map((s) => `${s.id}: ${s.title} — ${s.url}`).join("\n")}\n</fonti_online>`);
  }
  const type = exam.type in EXAM_TYPE_LABEL ? exam.type : "misto";
  const extra = practiceTasks(materials.map((m) => m.role));
  parts.push(`${examContext(exam)}\n\n${task(exam, type)}${extra ? `\n${extra}` : ""}`);
  content.push({ type: "text", text: parts.join("\n\n") });
  return content;
}

export async function buildModule(input, onProgress = () => {}) {
  const sources = input.research?.sources ?? [];
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ModuleSchema) },
    system: MODULE_SYSTEM,
    messages: [{ role: "user", content: buildUserContent(input) }],
  });
  stream.on("text", (d) => onProgress(d.length));
  const msg = await stream.finalMessage();
  assertUsable(msg);

  let parsed;
  try {
    parsed = ModuleSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("L'AI ha restituito un modulo in formato non valido. Riprova.");
  }
  const text = [...input.materials.map((m) => m.text ?? ""), input.research?.notes ?? ""].join("\n");
  const hasPdf = input.materials.some((m) => m.kind === "pdf" && m.data);
  const mod = normalizeModule(parsed, sources, { checkQuote: quoteChecker(text, { hasPdf }), examRefs: identityRefs(input.materials), checkExample: exampleChecker(text, { hasPdf }) });
  if (mod.topics.length === 0) throw new Error("Il modulo generato non contiene argomenti: i materiali sono sufficienti?");
  return mod;
}

/**
 * Aggiorna un modulo con materiali nuovi: il modello vede il modulo esistente (compatto) e restituisce, nello stesso
 * formato, solo argomenti nuovi / approfonditi e le carte e domande nuove. La fusione (id stabili) la fa il browser.
 * @returns {Promise<{delta: object, sources: object[]}>}
 */
export async function extendModule(input, onProgress = () => {}) {
  const sources = input.research?.sources ?? [];
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ModuleSchema) },
    system: MODULE_SYSTEM,
    messages: [{ role: "user", content: buildUserContent(input, extendTask) }],
  });
  stream.on("text", (d) => onProgress(d.length));
  const msg = await stream.finalMessage();
  assertUsable(msg);
  try {
    return { delta: ModuleSchema.parse(JSON.parse(textOf(msg.content))), sources };
  } catch {
    throw new Error("L'AI ha restituito un aggiornamento in formato non valido. Riprova.");
  }
}

/* -------------------------------------------------------------------------- */
/* Trascrizione di pagine fotografate (appunti a mano, scansioni)             */
/* -------------------------------------------------------------------------- */

const TRANSCRIBE_PER_CALL = 3; // una pagina fitta trascritta è lunga: poche immagini per richiesta

/**
 * Immagini di pagine → testo di ciascuna pagina (formule in LaTeX). `images` = [{data: base64, mediaType}].
 * @returns {Promise<{pages: (string|null)[]}>}
 */
export async function transcribe({ images, firstPage = 1, title = "", handwritten = false }, onProgress = () => {}) {
  const pages = [];
  for (let k = 0; k < images.length; k += TRANSCRIBE_PER_CALL) {
    const group = images.slice(k, k + TRANSCRIBE_PER_CALL);
    const from = firstPage + k;
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [{
        role: "user",
        content: [
          ...group.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
          { type: "text", text: transcribePrompt({ from, count: group.length, title, handwritten }) },
        ],
      }],
    });
    stream.on("text", (d) => onProgress(d.length));
    const msg = await stream.finalMessage();
    assertUsable(msg);
    pages.push(...parseTranscription(textOf(msg.content), from, group.length));
  }
  if (pages.every((p) => p == null)) throw new Error("Claude non ha restituito la trascrizione delle pagine. Riprova con meno foto.");
  return { pages };
}

/**
 * Pagine di un PDF (le sole pagine scelte, estratte nel browser) → testo di ciascuna pagina, formule in LaTeX: Claude legge il PDF
 * direttamente. Serve per le esercitazioni in PDF, i cui esercizi e soluzioni l'app usa così come sono.
 */
export async function transcribePdf({ data, firstPage = 1, count, title = "" }, onProgress = () => {}) {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: [
      { type: "document", title, source: { type: "base64", media_type: "application/pdf", data } },
      { type: "text", text: transcribePrompt({ from: firstPage, count, title, pdf: true }) },
    ] }],
  });
  stream.on("text", (d) => onProgress(d.length));
  const msg = await stream.finalMessage();
  assertUsable(msg);
  const pages = parseTranscription(textOf(msg.content), firstPage, count);
  if (pages.every((p) => p == null)) throw new Error("Claude non ha restituito la trascrizione del PDF. Riprova con meno pagine.");
  return { pages };
}

/* -------------------------------------------------------------------------- */
/* Esercitazioni: esercizi con soluzione ufficiale assegnati agli argomenti   */
/* -------------------------------------------------------------------------- */

/** @returns {Promise<{assign: {id, topicId, rubric, note}[]}>} */
export async function assignExercises({ exam, topics, exercises }) {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(AssignSchema) },
    system: ASSIGN_RULES,
    messages: [{ role: "user", content: assignPrompt({ exam, topics, exercises }) }],
  });
  assertUsable(msg);
  let raw;
  try {
    raw = AssignSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("L'assegnazione degli esercizi è arrivata in un formato non valido. Riprova.");
  }
  const m = normalizeAssignments(raw, { ids: exercises.map((e) => e.id), topicIds: topics.map((t) => t.id) });
  return { assign: [...m].map(([id, a]) => ({ id, ...a })) };
}

/* -------------------------------------------------------------------------- */
/* Dispensa: un documento da studiare, un capitolo per argomento              */
/* -------------------------------------------------------------------------- */

/**
 * I materiali come prefisso fisso della richiesta (PDF + testo), con il punto di cache alla fine: ogni capitolo
 * rimanda gli stessi materiali, che dal secondo in poi vengono letti dalla cache.
 */
function materialsPrefix({ materials, research }) {
  const blocks = [];
  for (const m of materials) {
    if (m.kind === "pdf" && m.data)
      blocks.push({ type: "document", title: `${MATERIAL_LABEL[m.role] ?? "Materiale"} — ${m.title}${m.pages ? ` (pagine ${m.pages})` : ""}`, source: { type: "base64", media_type: "application/pdf", data: m.data } });
  }
  const parts = materials.filter((m) => m.kind !== "pdf" && m.text).map(materialText);
  if (research?.notes) parts.push(`<ricerca_online>\n${research.notes}\n</ricerca_online>`);
  if (parts.length) blocks.push({ type: "text", text: `Materiali dello studente:\n\n${parts.join("\n\n")}` });
  if (blocks.length) blocks.at(-1).cache_control = { type: "ephemeral" };
  return blocks;
}

/**
 * Scrive i capitoli della dispensa (uno per argomento), in ordine; `onPartial` riceve i capitoli già pronti.
 * Un capitolo che non riesce non ferma gli altri: resta con `error`.
 * @returns {Promise<{chapters: {topicId:string, title:string, body:string, solutions:string, error?:string}[]}>}
 */
export async function writeDispensa({ exam, materials, research, outline, topics, length, solutions }, onProgress = () => {}, onPartial = () => {}) {
  const prefix = materialsPrefix({ materials, research });
  const chapters = [];
  for (const [k, topic] of topics.entries()) {
    try {
      const stream = client().messages.stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: DISPENSA_SYSTEM,
        messages: [{ role: "user", content: [...prefix, { type: "text", text: chapterPrompt({ exam, topic, outline, hints: topic.hints ?? [], examQuestions: topic.examQuestions ?? [], length, solutions }) }] }],
      });
      stream.on("text", (d) => onProgress(d.length));
      const msg = await stream.finalMessage();
      assertUsable(msg);
      chapters.push({ topicId: topic.id, title: topic.title, ...splitChapter(textOf(msg.content)) });
    } catch (e) {
      chapters.push({ topicId: topic.id, title: topic.title, body: "", solutions: "", error: friendlyError(e) });
    }
    onPartial({ chapters: [...chapters], done: k + 1, total: topics.length });
  }
  if (chapters.every((c) => c.error)) throw new Error(chapters[0]?.error || "Non sono riuscito a scrivere la dispensa.");
  return { chapters };
}

/* -------------------------------------------------------------------------- */
/* Esami degli anni passati: analisi e correzione delle simulazioni           */
/* -------------------------------------------------------------------------- */

const pdfBlock = (title, data) => ({ type: "document", title, source: { type: "base64", media_type: "application/pdf", data } });

/**
 * Le prove passate collegate agli argomenti del modulo. `papers` = [{id: "P1", label, text}] o, per i PDF, [{id, label, data}].
 * @returns {Promise<object>} vedi normalizePastExams (prove per id)
 */
export async function analyzePastExams({ exam, topics, papers }, onProgress = () => {}) {
  const content = papers.filter((p) => p.data).map((p) => pdfBlock(`${p.id} — ${p.label}`, p.data));
  content.push({ type: "text", text: pastExamsPrompt({ exam, topics, papers: papers.map((p) => ({ ...p, text: p.data ? null : p.text })) }) });
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(PastExamsSchema) },
    system: PAST_EXAMS_RULES,
    messages: [{ role: "user", content }],
  });
  stream.on("text", (d) => onProgress(d.length));
  const msg = await stream.finalMessage();
  assertUsable(msg);
  let raw;
  try {
    raw = PastExamsSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("L'analisi delle prove è arrivata in un formato non valido. Riprova.");
  }
  const out = normalizePastExams(raw, { paperIds: papers.map((p) => p.id), topicIds: topics.map((t) => t.id) });
  if (!Object.keys(out.papers).length) throw new Error("Claude non ha riconosciuto le prove: controlla che i materiali «Esami passati» contengano i testi delle prove.");
  return out;
}

/** Correzione di una prova svolta a tempo (testo della prova o PDF, svolgimento come testo). */
export async function gradeExam({ exam, topics, paper, answer, minutes }, onProgress = () => {}) {
  const content = paper.data ? [pdfBlock(paper.label, paper.data)] : [];
  content.push({ type: "text", text: examGradePrompt({ exam, topics, paper: { ...paper, text: paper.data ? null : paper.text }, answer, minutes }) });
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ExamGradeSchema) },
    system: EXAM_GRADE_RULES,
    messages: [{ role: "user", content }],
  });
  stream.on("text", (d) => onProgress(d.length));
  const msg = await stream.finalMessage();
  assertUsable(msg);
  let raw;
  try {
    raw = ExamGradeSchema.parse(JSON.parse(textOf(msg.content)));
  } catch {
    throw new Error("La correzione è arrivata in un formato non valido. Riprova.");
  }
  const out = normalizeExamGrade(raw, { topicIds: topics.map((t) => t.id) });
  if (!out.items.length) throw new Error("Claude non è riuscito a correggere la prova. Riprova.");
  return out;
}

/* -------------------------------------------------------------------------- */
/* Correzione di risposte aperte / spiegazioni                                */
/* -------------------------------------------------------------------------- */

export async function gradeAnswer({ question, reference, rubric = [], answer, language = "italiano" }) {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(GradeSchema) },
    system: GRADE_RULES(language),
    messages: [
      {
        role: "user",
        content: `<domanda>${question}</domanda>
<risposta_di_riferimento>${reference}</risposta_di_riferimento>
<rubrica>${rubric.map((r) => `- ${r}`).join("\n")}</rubrica>
<risposta_studente>${answer}</risposta_studente>`,
      },
    ],
  });
  assertUsable(msg);
  const g = GradeSchema.parse(JSON.parse(textOf(msg.content)));
  return { ...g, score: Math.min(1, Math.max(0, g.score)), feedback: repairLatex(g.feedback), covered: g.covered.map(repairLatex), missing: g.missing.map(repairLatex) };
}
