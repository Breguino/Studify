import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CURRICULUM_RULES, EXAM_TYPE_LABEL, GRADE_RULES, MODULE_INTRO, MODULE_PRINCIPLES, QUESTION_MIX, SAFETY_RULES, examContext, where } from "../shared/prompts.js";
import { CurriculumSchema, DegreesSchema, GradeSchema, ModuleSchema, normalizeCurriculum, normalizeDegrees, normalizeModule } from "./schema.js";

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
/* Generazione del modulo di studio                                           */
/* -------------------------------------------------------------------------- */

const MODULE_SYSTEM = `${MODULE_INTRO}
${SAFETY_RULES}

${MODULE_PRINCIPLES}`;

function buildUserContent({ exam, materials, research: res }) {
  const content = [];
  for (const m of materials) {
    if (m.kind === "pdf" && m.data)
      content.push({
        type: "document",
        title: m.title,
        source: { type: "base64", media_type: "application/pdf", data: m.data },
      });
  }
  const parts = [];
  for (const m of materials) {
    if (m.kind !== "pdf" && m.text) parts.push(`<appunti_studente titolo="${m.title.replace(/"/g, "'")}">\n${m.text}\n</appunti_studente>`);
  }
  if (res?.notes) {
    parts.push(`<ricerca_online>\n${res.notes}\n</ricerca_online>`);
    parts.push(`<fonti_online>\n${res.sources.map((s) => `${s.id}: ${s.title} — ${s.url}`).join("\n")}\n</fonti_online>`);
  }
  const type = exam.type in EXAM_TYPE_LABEL ? exam.type : "misto";
  parts.push(`${examContext(exam)}

Produci il modulo di studio completo.
- Argomenti: tra 5 e 15, in base all'ampiezza dei materiali.
- Flashcard: circa 6-10 per argomento (mai meno di 4).
- Domande: circa 3-6 per argomento; mix per questo tipo di prova: ${QUESTION_MIX[type]}.
- Calibra difficoltà e spiegazioni sul livello ${exam.level}/5: più scaffolding e esempi se basso, più sfumature e casi limite se alto.`);
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
  const mod = normalizeModule(parsed, sources);
  if (mod.topics.length === 0) throw new Error("Il modulo generato non contiene argomenti: i materiali sono sufficienti?");
  return mod;
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
  return { ...g, score: Math.min(1, Math.max(0, g.score)) };
}
