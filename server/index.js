import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL, aiConfigured, analyzePastExams, assignExercises, transcribePdf, extractBooks, linkChapters, buildModule, curriculum, degrees, examFormat, examFormatFromText, extendModule, gradeExam, transcribe, writeDispensa, friendlyError, gradeAnswer, importRows, parseCurriculum, research } from "./ai.js";
import { demoAnalysis, demoGrade } from "../public/js/past-exams.js";
import { demoExamQuestions } from "../public/js/exam-questions.js";
import { demoMethods } from "../public/js/worked.js";
import { demoAssign } from "../public/js/exercises.js";
import { demoBooks, demoChapterLinks } from "../public/js/books.js";
import { extractPages } from "../public/js/pdf-extract.js";
import { findExamHints, localDelta } from "../public/js/local-builder.js";
import { formatFromSyllabus } from "../public/js/exam-type.js";
import { IMPORT_HEADERS } from "../shared/prompts.js";
import { normalizeAssignments, normalizeBooks, normalizeChapterLinks, normalizeExamGrade, normalizeModule, normalizePastExams } from "./schema.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MOCK = process.env.STUDIFY_MOCK === "1";
const MAX_BODY = 40 * 1024 * 1024; // PDF in base64
const LOOPBACK = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* ------------------------------ job in memoria ----------------------------- */
// Le generazioni durano minuti: l'API restituisce subito un jobId e il client fa polling.
const jobs = new Map();

function startJob(kind, fn) {
  const id = randomUUID();
  const job = { id, kind, status: "running", chars: 0, startedAt: Date.now(), result: null, error: null, partial: null };
  jobs.set(id, job);
  fn((n) => (job.chars += n), (p) => (job.partial = p)) // partial: risultati parziali (es. capitoli già pronti)
    .then((result) => Object.assign(job, { status: "done", result }))
    .catch((e) => {
      console.error(`[job ${kind}]`, e?.message);
      Object.assign(job, { status: "error", error: friendlyError(e) });
    });
  return id;
}

setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.startedAt > 60 * 60 * 1000) jobs.delete(id);
}, 10 * 60 * 1000).unref();

/* ------------------------------ modalità demo ------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mockRun(onProgress, result) {
  for (let i = 0; i < 6; i++) {
    await sleep(400);
    onProgress(900);
  }
  return result;
}

/** Demo: capitoli costruiti dal riassunto dell'argomento (nessuna AI), con una formula, una citazione e le soluzioni. */
async function mockDispensa({ topics, solutions }, onProgress, onPartial) {
  const chapters = [];
  for (const [k, t] of topics.entries()) {
    await sleep(250);
    onProgress(800);
    const quote = t.hints[0] ? `### Il docente ha detto\n> «${t.hints[0].quote}» (${t.hints[0].source})\n\n` : "";
    chapters.push({ topicId: t.id, title: t.title, body: `### Spiegazione\n${t.summary || "Testo del capitolo (demo)."} [Appunti]\n\n### Formule e definizioni chiave\n- Elasticità al prezzo: $$\\varepsilon_P=\\left|\\frac{\\Delta\\%Q}{\\Delta\\%P}\\right|$$\n\n${quote}### Errori da evitare\n- Confondere **movimento lungo** la curva e **spostamento** della curva.\n\n### Mettiti alla prova\n1. Spiega ${t.title.toLowerCase()} con un esempio.\n2. Se il prezzo sale del 10% e la quantità scende del 5%, quanto vale $\\varepsilon_P$?`,
      solutions: solutions ? `1. Vedi la spiegazione.\n2. $\\varepsilon_P=\\frac{5}{10}=0{,}5$: domanda anelastica.` : "" });
    onPartial({ chapters: [...chapters], done: k + 1, total: topics.length });
  }
  return { chapters };
}

/** Demo: una trascrizione finta per pagina (con una parola incerta negli appunti a mano). */
function mockTranscription({ images, firstPage, handwritten }) {
  return {
    pages: images.map((_, k) => {
      const n = firstPage + k;
      return handwritten
        ? `# Lezione ${n} — Elasticità\nL'elasticità della domanda al prezzo misura quanto varia $Q$ quando varia $P$ (in %).\n\n$$\\varepsilon_P=\\left|\\frac{\\Delta\\%Q}{\\Delta\\%P}\\right|$$\n\n- se $\\varepsilon_P>1$ → domanda **elastica**\n- beni di lusso[?] più elastici\n(nota: chiesto all'esame l'anno scorso)`
        : `# Pagina ${n}\nTesto della pagina ${n} (trascrizione simulata).`;
    }),
  };
}

/** Demo: il testo del PDF letto con pdf.js (riga per riga), come se l'avesse trascritto Claude. */
async function mockPdfTranscription({ data, firstPage, count }) {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { pages } = await extractPages(lib, Buffer.from(data, "base64"), { maxPages: count });
  return {
    pages: pages.map((p) => {
      const lines = new Map();
      for (const it of p.items) { const y = Math.round(it.y / 3); lines.set(y, [...(lines.get(y) ?? []), it]); }
      return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")).join("\n");
    }).concat(Array(Math.max(0, count - pages.length)).fill(null)).slice(0, count),
    firstPage,
  };
}

async function demoModule() {
  const raw = JSON.parse(await readFile(join(ROOT, "demo", "module.json"), "utf8"));
  return normalizeModule(raw, raw.sources ?? []);
}

/* --------------------------------- helpers --------------------------------- */

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Materiale troppo grande (max 40 MB)."), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON non valido."), { status: 400 });
  }
}

// Protegge i crediti API da pagine web esterne (CSRF / DNS rebinding) quando il server è locale.
function sameOriginOk(req) {
  if (!LOOPBACK) return true;
  const host = (req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return false;
  return true;
}

const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

/** Materiali e ricerca online come li manda il browser (moduli e dispensa). */
function parseMaterials(body) {
  const materials = (Array.isArray(body.materials) ? body.materials : []).slice(0, 40).map((m) => ({
    kind: ["pdf", "notes", "web"].includes(m.kind) ? m.kind : "notes",
    role: ["appunti", "colleghi", "libro", "slide", "dispense", "esercizi", "svolti", "esami", "domande", "sbobine", "altro"].includes(m.role) ? m.role : "appunti",
    unit: ["lezioni", "prove"].includes(m.unit) ? m.unit : "pagine",
    year: str(m.year, 20),
    pages: /^\d{1,4}-\d{1,4}$/.test(m.pages ?? "") ? m.pages : "",
    handwritten: !!m.handwritten,
    title: str(m.title, 200) || "Appunti",
    text: str(m.text, 2_000_000),
    data: m.kind === "pdf" && typeof m.data === "string" ? m.data : "",
  }));
  const research = body.research && typeof body.research.notes === "string"
    ? {
        notes: str(body.research.notes, 400_000),
        sources: (Array.isArray(body.research.sources) ? body.research.sources : []).slice(0, 30).map((s) => ({
          id: str(s.id, 10), title: str(s.title, 300), url: str(s.url, 1000),
        })),
      }
    : null;
  return { materials, research };
}

/** Il modulo esistente come lo manda il browser (solo ciò che serve a dire al modello cosa c'è già). */
function parseExisting(e = {}) {
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
  return {
    topics: arr(e.topics, 80).map((t) => ({
      id: str(t.id, 12), title: str(t.title, 300), importance: Number(t.importance) || 2, summary: str(t.summary, 3000),
      keyConcepts: arr(t.keyConcepts, 30).map((k) => str(typeof k === "string" ? k : k?.term, 200)).filter(Boolean),
      methods: arr(t.methods, 10).map((m) => str(typeof m === "string" ? m : m?.name, 200)).filter(Boolean),
    })).filter((t) => t.id && t.title),
    flashcards: arr(e.flashcards, 3000).map((c) => ({ topicId: str(c.topicId, 12), front: str(c.front, 500) })),
    questions: arr(e.questions, 1500).map((q) => ({ topicId: str(q.topicId, 12), prompt: str(q.prompt, 800) })),
    gaps: arr(e.gaps, 60).map((g) => str(g, 600)).filter(Boolean),
  };
}

/** Argomenti del modulo (id e titolo) a cui collegare prove ed esercizi. */
const parseTopics = (list) => (Array.isArray(list) ? list : []).slice(0, 80).map((t) => ({ id: str(t?.id, 12), title: str(t?.title, 300) })).filter((t) => t.id && t.title);

function parseExam(e = {}) {
  const level = Math.min(5, Math.max(1, Number(e.level) || 2));
  return {
    name: str(e.name, 200) || "Esame",
    type: str(e.type, 20),
    level,
    daysLeft: Math.max(0, Number(e.daysLeft) || 0),
    language: str(e.language, 40) || "italiano",
    university: str(e.university, 200),
    degree: str(e.degree, 200),
    cfu: Math.min(60, Math.max(0, Number(e.cfu) || 0)),
  };
}

/* ---------------------------------- routes --------------------------------- */

async function api(req, res, url) {
  if (!sameOriginOk(req)) return send(res, 403, { error: "Origine non consentita." });

  if (req.method === "GET" && url.pathname === "/api/status")
    return send(res, 200, { ai: MOCK || aiConfigured(), mock: MOCK, model: MOCK ? "demo" : MODEL, web: true, pdf: true, pdfRead: true });

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const job = jobs.get(url.pathname.split("/").pop());
    if (!job) return send(res, 404, { error: "Job non trovato (server riavviato?)." });
    return send(res, 200, { status: job.status, chars: job.chars, result: job.result, error: job.error, partial: job.status === "running" ? job.partial : null });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Metodo non consentito." });
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    return send(res, 415, { error: "Content-Type deve essere application/json." });
  if (!MOCK && !aiConfigured())
    return send(res, 503, { error: "AI non configurata: imposta ANTHROPIC_API_KEY e riavvia il server." });

  const body = await readJson(req);

  if (url.pathname === "/api/research") {
    const name = str(body.examName, 200);
    if (!name) return send(res, 400, { error: "Indica il nome dell'esame." });
    const input = { examName: name, university: str(body.university, 200), degree: str(body.degree, 200), focus: str(body.focus, 5000), language: str(body.language, 40) || "italiano" };
    const id = startJob("research", (p) =>
      MOCK
        ? mockRun(p, {
            notes: "[DEMO] Appunti di esempio trovati online.\n\nModalità d'esame: prova scritta con esercizi e colloquio orale (fonte: scheda del corso demo)\n\nFonti: https://example.org/dispense",
            sources: [{ id: "S1", title: "Dispense di esempio (demo)", url: "https://example.org/dispense" }],
          })
        : research(input, p),
    );
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/degrees") {
    const university = str(body.university, 200).trim();
    if (!university) return send(res, 400, { error: "Indica l'ateneo." });
    const id = startJob("degrees", (p) =>
      MOCK
        ? mockRun(p, {
            found: true, academicYear: "demo", caveats: ["Elenco dimostrativo: non sono i veri corsi dell'ateneo."], sources: [],
            degrees: [
              { name: "Ingegneria Informatica (demo)", level: "L", classe: "L-8", url: "" },
              { name: "Economia e Management (demo)", level: "L", classe: "L-18", url: "" },
              { name: "Giurisprudenza (demo)", level: "LMCU", classe: "LMG/01", url: "" },
              { name: "Ingegneria Gestionale (demo)", level: "LM", classe: "LM-31", url: "" },
            ],
          })
        : degrees({ university }, p),
    );
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/parse-curriculum") {
    const text = str(body.text, 200_000);
    if (text.trim().length < 20) return send(res, 400, { error: "Incolla il testo del piano di studi." });
    const id = startJob("parse-curriculum", (p) =>
      MOCK
        ? mockRun(p, {
            found: true, degreeName: "", academicYear: "", caveats: ["Analisi dimostrativa: con l'AI vera il testo viene letto dal modello."], sources: [],
            courses: [
              { name: "Analisi matematica 1", year: 1, cfu: 9, format: "sconosciuto", formatEvidence: "", kind: "obbligatorio", group: "", url: "" },
              { name: "Insegnamenti a scelta dello studente", year: 3, cfu: 12, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "", url: "" },
            ],
          })
        : parseCurriculum({ text, university: str(body.university, 200), degree: str(body.degree, 200) }),
    );
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/import-rows") {
    const kind = str(body.kind, 20);
    if (!IMPORT_HEADERS[kind]) return send(res, 400, { error: "Tipo di importazione non valido." });
    const text = str(body.text, 400_000);
    const pdf = typeof body.pdf === "string" && /^[A-Za-z0-9+/=]+$/.test(body.pdf.slice(0, 1000)) ? body.pdf : "";
    if (!text.trim() && !pdf) return send(res, 400, { error: "Nessun contenuto da leggere." });
    const today = /^\d{4}-\d{2}-\d{2}$/.test(str(body.today, 10)) ? body.today : new Date().toISOString().slice(0, 10);
    const id = startJob("import-rows", (p) =>
      MOCK
        ? mockRun(p, {
            found: true, notes: ["Lettura dimostrativa: con l'AI vera il documento viene letto dal modello."],
            rows: [IMPORT_HEADERS[kind], ...{
              esami: [["Analisi matematica 1", "14/01/2027", "09:00", "Aula 3", "Scritto", "9", "1"]],
              insegnamenti: [["Analisi matematica 1", "1", "9", "Obbligatorio", "", "Scritto"]],
              orari: [["Analisi matematica 1", "Lunedì", "09:00", "11:00", "Aula 3"], ["Fisica generale", "Mercoledì", "09:00", "12:00", "Lab 2"]],
            }[kind]],
          })
        : importRows({ kind, text, pdf, today }, p),
    );
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/curriculum") {
    const university = str(body.university, 200).trim();
    const degree = str(body.degree, 200).trim();
    if (!university || !degree) return send(res, 400, { error: "Indica ateneo e corso di studio." });
    const id = startJob("curriculum", (p) =>
      MOCK
        ? mockRun(p, {
            found: true, degreeName: `${degree} (demo)`, academicYear: "demo", caveats: ["Dati dimostrativi: non sono il vero piano di studi."], sources: [],
            courses: [
              { name: "Analisi matematica 1 (demo)", year: 1, cfu: 9, format: "scritto", formatEvidence: "demo", kind: "obbligatorio", group: "", url: "" },
              { name: "Diritto privato (demo)", year: 2, cfu: 6, format: "orale", formatEvidence: "demo", kind: "obbligatorio", group: "", url: "" },
              { name: "Fondamenti di informatica (demo)", year: 1, cfu: 9, format: "sconosciuto", formatEvidence: "", kind: "obbligatorio", group: "", url: "" },
              { name: "Teoria dei giochi (demo)", year: 3, cfu: 6, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "A scelta: area economica", url: "" },
              { name: "Statistica applicata (demo)", year: 3, cfu: 6, format: "scritto", formatEvidence: "demo", kind: "a_scelta", group: "A scelta: area economica", url: "" },
              { name: "Insegnamenti a scelta dello studente (demo)", year: 3, cfu: 12, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "", url: "" },
            ],
          })
        : curriculum({ university, degree }, p),
    );
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/exam-format") {
    const input = { university: str(body.university, 200), degree: str(body.degree, 200), course: str(body.course, 200), academicYear: str(body.academicYear, 20) };
    if (!input.university || !input.course) return send(res, 400, { error: "Servono ateneo e insegnamento." });
    const id = startJob("exam-format", (p) =>
      MOCK
        ? mockRun(p, {
            found: true, format: "problemi", details: "Scritto di 2 ore con esercizi; orale facoltativo (demo).",
            evidence: `L'esame di ${input.course} consiste in una prova scritta con esercizi e domande di teoria (risposta simulata).`,
            url: "https://www.example.org/syllabus-demo", academicYear: input.academicYear || "2026-27", teacher: "", caveats: ["Risposta della modalità demo: nessuna ricerca vera."],
          })
        : examFormat(input, p),
    );
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/transcribe") {
    const images = (Array.isArray(body.images) ? body.images : []).filter((i) => typeof i?.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.mediaType));
    if (!images.length || images.length > 12 || images.length !== body.images.length) return send(res, 400, { error: "Da 1 a 12 immagini JPEG/PNG per volta." });
    if (images.some((i) => i.data.length > 8 * 1024 * 1024)) return send(res, 400, { error: "Immagine troppo grande (max ~6 MB)." });
    const input = { images, firstPage: Math.max(1, Math.round(Number(body.firstPage)) || 1), title: str(body.title, 200), handwritten: !!body.handwritten };
    const id = startJob("transcribe", (p) => (MOCK ? mockRun(p, mockTranscription(input)) : transcribe(input, p)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/exam-format-text") {
    const text = str(body.text, 40_000);
    if (text.trim().length < 20) return send(res, 400, { error: "Incolla il testo della scheda dell'insegnamento." });
    const id = startJob("exam-format", (p) => (MOCK ? mockRun(p, formatFromSyllabus(text)) : examFormatFromText({ text, course: str(body.course, 200) })));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/dispensa") {
    const { materials, research } = parseMaterials(body);
    if (!materials.some((m) => m.text || m.data) && !research) return send(res, 400, { error: "Aggiungi almeno un materiale." });
    const topic = (t) => ({ id: str(t?.id, 12), title: str(t?.title, 300), importance: Math.min(3, Math.max(1, Number(t?.importance) || 2)), summary: str(t?.summary, 3000),
      hints: (Array.isArray(t?.hints) ? t.hints : []).slice(0, 10).map((x) => ({ quote: str(x?.quote, 400), source: str(x?.source, 160) })),
      examQuestions: (Array.isArray(t?.examQuestions) ? t.examQuestions : []).slice(0, 30).map((q) => str(q, 400)).filter(Boolean) });
    const outline = (Array.isArray(body.outline) ? body.outline : []).slice(0, 80).map(topic).filter((t) => t.title);
    const topics = (Array.isArray(body.topics) ? body.topics : []).slice(0, 40).map(topic).filter((t) => t.id && t.title);
    if (!topics.length) return send(res, 400, { error: "Nessun capitolo da scrivere." });
    const input = { exam: parseExam(body.exam), materials, research, outline, topics, length: body.length === "sintetica" ? "sintetica" : "completa", solutions: body.solutions !== false };
    const id = startJob("dispensa", (p, partial) => (MOCK ? mockDispensa(input, p, partial) : writeDispensa(input, p, partial)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/module" || url.pathname === "/api/module-extend") {
    const { materials, research: res0 } = parseMaterials(body);
    if (!materials.some((m) => m.text || m.data) && !res0) return send(res, 400, { error: "Aggiungi almeno un materiale." });
    const input = { exam: parseExam(body.exam), materials, research: res0 };
    if (url.pathname === "/api/module") {
      const id = startJob("module", (p) => (MOCK ? mockRun(p, demoModule()) : buildModule(input, p)));
      return send(res, 202, { jobId: id });
    }
    input.existing = parseExisting(body.existing);
    if (!input.existing.topics.length) return send(res, 400, { error: "Il modulo da aggiornare è vuoto: generalo prima." });
    const notes = materials.filter((m) => !["esercizi", "svolti", "esami", "domande"].includes(m.role)).map((m) => m.text).filter(Boolean).join("\n\n"); // come la modalità base: le prove non diventano argomenti
    const examQs = demoExamQuestions(materials.filter((m) => m.role === "domande").map((m) => m.text).join("\n"), input.existing.topics);
    const worked = demoMethods(materials.filter((m) => m.role === "svolti").map((m) => m.text).join("\n\n"), input.existing.topics);
    const mockDelta = () => {
      const d = localDelta(notes, "Appunti nuovi");
      // esercizi svolti: il metodo sull'argomento esistente e 2 esercizi dello stesso tipo, svolti un passaggio per paragrafo
      const mt = worked.map((w) => ({ id: w.topicId, title: input.existing.topics.find((t) => t.id === w.topicId)?.title ?? "", summary: "", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", methods: [w.method] }));
      const mq = worked.flatMap((w) => [1, 2].map((k) => ({ kind: "problem", topicId: w.topicId, method: w.method.name, prompt: `[DEMO] Esercizio ${k} come «${w.method.name}», con dati diversi.`,
        options: [], correctIndex: -1, modelAnswer: "Dati: $P=50-Q$, $MC=10$.\n\nRicavo marginale: $MR=50-2Q$.\n\n$$MR=MC\\Rightarrow Q^*=20$$\n\nPrezzo: $P^*=30$.", explanation: "[DEMO]", rubric: w.method.steps })));
      return { ...d, topics: [...d.topics, ...mt], questions: [...d.questions, ...examQs, ...mq], examHints: [...findExamHints(notes, "sbobine"), { quote: "Questa frase non è nei materiali: il docente non l'ha mai detta.", source: "inventata", note: "", topicId: "" }] };
    };
    const id = startJob("module", (p) => (MOCK ? mockRun(p, { delta: mockDelta(), sources: [], mode: "local" }) : extendModule(input, p)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/books-from-text") {
    const text = str(body.text, 40_000);
    if (text.trim().length < 20) return send(res, 400, { error: "Incolla i testi di riferimento dalla scheda dell'insegnamento." });
    const id = startJob("books", (p) => (MOCK ? mockRun(p, normalizeBooks({ books: demoBooks(text) }, { sourceText: text })) : extractBooks({ text })));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/link-chapters") {
    const topics = parseTopics(body.topics);
    const chapters = (Array.isArray(body.chapters) ? body.chapters : []).slice(0, 200).map((c) => ({ id: str(c?.id, 12), title: str(c?.title, 300),
      sections: (Array.isArray(c?.sections) ? c.sections : []).slice(0, 20).map((x) => str(x, 200)) })).filter((c) => /^L\d{1,2}-\d{1,2}$/.test(c.id) && c.title);
    if (!topics.length || !chapters.length) return send(res, 400, { error: "Servono gli argomenti del modulo e i capitoli dei libri." });
    const input = { exam: parseExam(body.exam), topics, chapters };
    const id = startJob("chapters", (p) => (MOCK
      ? mockRun(p, { links: [...normalizeChapterLinks({ links: demoChapterLinks(chapters, topics) }, { chapterIds: chapters.map((c) => c.id), topicIds: topics.map((t) => t.id) })].map(([topicId, chapterIds]) => ({ topicId, chapterIds })) })
      : linkChapters(input)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/transcribe-pdf") {
    const data = typeof body.data === "string" ? body.data : "";
    const count = Math.round(Number(body.count));
    if (!data || data.length > 30 * 1024 * 1024 || !(count >= 1 && count <= 20)) return send(res, 400, { error: "Da 1 a 20 pagine di PDF per volta." });
    const input = { data, firstPage: Math.max(1, Math.round(Number(body.firstPage)) || 1), count, title: str(body.title, 200) };
    const id = startJob("transcribe-pdf", (p) => (MOCK ? mockRun(p, mockPdfTranscription(input)) : transcribePdf(input, p)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/assign-exercises") {
    const topics = parseTopics(body.topics);
    const exercises = (Array.isArray(body.exercises) ? body.exercises : []).slice(0, 60).map((e) => ({ id: str(e?.id, 8), label: str(e?.label, 200), text: str(e?.text, 6000), solution: str(e?.solution, 8000) }))
      .filter((e) => /^E\d{1,3}$/.test(e.id) && e.text.trim());
    if (!exercises.length || !topics.length) return send(res, 400, { error: "Servono gli esercizi e gli argomenti del modulo." });
    const input = { exam: parseExam(body.exam), topics, exercises };
    const id = startJob("assign-exercises", (p) => (MOCK
      ? mockRun(p, { assign: [...normalizeAssignments({ assign: demoAssign(exercises, topics).map((a) => ({ ...a, note: "" })) }, { ids: exercises.map((e) => e.id), topicIds: topics.map((t) => t.id) })].map(([id, a]) => ({ id, ...a })) })
      : assignExercises(input)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/past-exams") {
    const topics = parseTopics(body.topics);
    const papers = (Array.isArray(body.papers) ? body.papers : []).slice(0, 40).map((p) => ({
      id: str(p?.id, 8), label: str(p?.label, 120), text: str(p?.text, 300_000), data: typeof p?.data === "string" ? p.data : "",
    })).filter((p) => /^P\d{1,2}$/.test(p.id) && (p.text.trim() || p.data));
    if (!papers.length) return send(res, 400, { error: "Nessuna prova da analizzare." });
    if (!topics.length) return send(res, 400, { error: "Serve il modulo di studio (gli argomenti a cui collegare le prove)." });
    const input = { exam: parseExam(body.exam), topics, papers };
    const id = startJob("past-exams", (p) => (MOCK
      ? mockRun(p, normalizePastExams(demoAnalysis(papers.map((x) => ({ ...x, text: x.text || "1. Esercizio sul PDF (demo)" })), topics), { paperIds: papers.map((x) => x.id), topicIds: topics.map((t) => t.id) }))
      : analyzePastExams(input, p)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/grade-exam") {
    const topics = parseTopics(body.topics);
    const paper = { label: str(body.paper?.label, 120), text: str(body.paper?.text, 300_000), data: typeof body.paper?.data === "string" ? body.paper.data : "", durationMin: Math.max(0, Number(body.paper?.durationMin) || 0) };
    const answer = str(body.answer, 200_000);
    if (!paper.text.trim() && !paper.data) return send(res, 400, { error: "Manca il testo della prova." });
    if (!answer.trim()) return send(res, 400, { error: "Lo svolgimento è vuoto." });
    const input = { exam: parseExam(body.exam), topics, paper, answer, minutes: Math.max(0, Math.round(Number(body.minutes) || 0)) };
    const id = startJob("grade-exam", (p) => (MOCK ? mockRun(p, normalizeExamGrade(demoGrade(paper.text, answer), { topicIds: topics.map((t) => t.id) })) : gradeExam(input, p)));
    return send(res, 202, { jobId: id });
  }

  if (url.pathname === "/api/grade") {
    const answer = str(body.answer, 20000);
    if (!answer.trim()) return send(res, 400, { error: "Risposta vuota." });
    if (MOCK) {
      const rubric = Array.isArray(body.rubric) ? body.rubric.map(String) : [];
      const low = answer.toLowerCase();
      const covered = rubric.filter((r) => r.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => low.includes(w)));
      const score = rubric.length ? covered.length / rubric.length : 0.5;
      return send(res, 200, {
        score, verdict: score > 0.8 ? "corretta" : score > 0.4 ? "parziale" : "errata",
        feedback: "[DEMO] Valutazione simulata per parole chiave: con una chiave API reale la risposta viene corretta dal modello.",
        covered, missing: rubric.filter((r) => !covered.includes(r)),
      });
    }
    const out = await gradeAnswer({
      question: str(body.question, 4000), reference: str(body.reference, 8000),
      rubric: (Array.isArray(body.rubric) ? body.rubric : []).slice(0, 12).map((r) => str(r, 500)),
      answer, language: str(body.language, 40) || "italiano",
    });
    return send(res, 200, out);
  }

  return send(res, 404, { error: "Endpoint inesistente." });
}

// pdf.js (lettura dei PDF nel browser): solo i due file necessari, serviti da node_modules.
// pdf-lib (estrazione di pagine dai PDF, nel browser): un file autonomo.
const NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules");
const VENDOR = {
  "/vendor/pdfjs/pdf.min.mjs": join("pdfjs-dist", "legacy", "build", "pdf.min.mjs"),
  "/vendor/pdfjs/pdf.worker.min.mjs": join("pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  "/vendor/pdf-lib/pdf-lib.esm.min.js": join("pdf-lib", "dist", "pdf-lib.esm.min.js"),
};

// Codice condiviso server/browser (fuori da public/): solo i file elencati.
const SHARED = { "/shared/normalize.js": "normalize.js", "/shared/prompts.js": "prompts.js" };
const SHARED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "shared");

// KaTeX (formule): modulo, CSS e font da node_modules/katex/dist.
const KATEX_DIR = join(NODE_MODULES, "katex", "dist");
const KATEX_TYPES = { ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };

async function serveStatic(req, res, url) {
  if (SHARED[url.pathname]) return send(res, 200, await readFile(join(SHARED_DIR, SHARED[url.pathname])), { "Content-Type": MIME[".js"] });
  if (url.pathname.startsWith("/vendor/katex/")) {
    const file = normalize(join(KATEX_DIR, decodeURIComponent(url.pathname.slice("/vendor/katex/".length))));
    const type = KATEX_TYPES[extname(file)];
    if (!type || !file.startsWith(KATEX_DIR + sep)) return send(res, 404, "Non trovato");
    try {
      return send(res, 200, await readFile(file), { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
    } catch {
      return send(res, 404, "KaTeX non installato (npm install)");
    }
  }
  if (VENDOR[url.pathname]) {
    try {
      return send(res, 200, await readFile(join(NODE_MODULES, VENDOR[url.pathname])), { "Content-Type": MIME[".js"], "Cache-Control": "public, max-age=86400" });
    } catch {
      return send(res, 404, "Libreria non installata (npm install)");
    }
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = normalize(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, "Vietato");
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    const data = await readFile(file);
    send(res, 200, data, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  } catch {
    send(res, 404, "Non trovato");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Metodo non consentito");
    return await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : friendlyError(e) });
  }
});

server.listen(PORT, HOST, () => {
  const ai = MOCK ? "DEMO (risposte simulate)" : aiConfigured() ? `attiva (${MODEL})` : "non configurata (modalità base)";
  console.log(`Studify su http://${HOST}:${PORT}  —  AI: ${ai}`);
});
