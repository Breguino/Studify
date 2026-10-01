import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL, aiConfigured, buildModule, friendlyError, gradeAnswer, research } from "./ai.js";
import { normalizeModule } from "./schema.js";

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
  const job = { id, kind, status: "running", chars: 0, startedAt: Date.now(), result: null, error: null };
  jobs.set(id, job);
  fn((n) => (job.chars += n))
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

function parseExam(e = {}) {
  const level = Math.min(5, Math.max(1, Number(e.level) || 2));
  return {
    name: str(e.name, 200) || "Esame",
    type: str(e.type, 20),
    level,
    daysLeft: Math.max(0, Number(e.daysLeft) || 0),
    language: str(e.language, 40) || "italiano",
  };
}

/* ---------------------------------- routes --------------------------------- */

async function api(req, res, url) {
  if (!sameOriginOk(req)) return send(res, 403, { error: "Origine non consentita." });

  if (req.method === "GET" && url.pathname === "/api/status")
    return send(res, 200, { ai: MOCK || aiConfigured(), mock: MOCK, model: MOCK ? "demo" : MODEL });

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const job = jobs.get(url.pathname.split("/").pop());
    if (!job) return send(res, 404, { error: "Job non trovato (server riavviato?)." });
    return send(res, 200, { status: job.status, chars: job.chars, result: job.result, error: job.error });
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
    const input = { examName: name, university: str(body.university, 200), focus: str(body.focus, 5000), language: str(body.language, 40) || "italiano" };
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

  if (url.pathname === "/api/module") {
    const materials = (Array.isArray(body.materials) ? body.materials : []).slice(0, 40).map((m) => ({
      kind: ["pdf", "notes", "web"].includes(m.kind) ? m.kind : "notes",
      title: str(m.title, 200) || "Appunti",
      text: str(m.text, 2_000_000),
      data: m.kind === "pdf" && typeof m.data === "string" ? m.data : "",
    }));
    const res0 = body.research && typeof body.research.notes === "string"
      ? {
          notes: str(body.research.notes, 400_000),
          sources: (Array.isArray(body.research.sources) ? body.research.sources : []).slice(0, 30).map((s) => ({
            id: str(s.id, 10), title: str(s.title, 300), url: str(s.url, 1000),
          })),
        }
      : null;
    if (!materials.some((m) => m.text || m.data) && !res0) return send(res, 400, { error: "Aggiungi almeno un materiale." });
    const input = { exam: parseExam(body.exam), materials, research: res0 };
    const id = startJob("module", (p) => (MOCK ? mockRun(p, demoModule()) : buildModule(input, p)));
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

async function serveStatic(req, res, url) {
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
