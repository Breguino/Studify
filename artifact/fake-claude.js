// SOLO PER LE PROVE: simula `window.claude` (sample, db, user, downloads) in un browser normale.
// Non viene incluso nel file da pubblicare.
import demo from "../public/demo/module.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = (window.__sampleCalls = []);
const saved = (window.__saved = []);
const KEY = "fake-claude-db";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const store = load();
const persist = () => localStorage.setItem(KEY, JSON.stringify(store));
window.__dbWrites = 0;

const answer = (prompt) => {
  if (prompt.includes("<piano_di_studi>")) return { found: true, degreeName: "", academicYear: "", caveats: [], courses: [
    { name: "Analisi 1", year: 1, cfu: 9, format: "sconosciuto", formatEvidence: "", kind: "obbligatorio", group: "", url: "" },
    { name: "Teoria dei giochi", year: 3, cfu: 6, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "A scelta: area economica", url: "" },
    { name: "Statistica applicata", year: 3, cfu: 6, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "A scelta: area economica", url: "" } ] };
  if (prompt.includes("<risposta_studente>")) return { score: 0.75, verdict: "parziale", feedback: "Quasi: manca il punto sul riequilibrio.", covered: ["Individua l'eccesso di offerta"], missing: ["Indica la condizione di equilibrio"] };
  if (prompt.includes("<argomento>")) {
    const t = JSON.parse(prompt.split("<argomento>")[1].split("</argomento>")[0]);
    const topic = demo.topics.find((x) => x.title === t.title);
    return {
      flashcards: demo.flashcards.filter((c) => c.topicId === topic.id).map(({ front, back, type }) => ({ front, back, type })),
      questions: demo.questions.filter((q) => q.topicId === topic.id).map(({ topicId, id, ...q }) => q),
    };
  }
  return { title: demo.title, overview: demo.overview, gaps: demo.gaps, topics: demo.topics.map((t) => ({ ...t, excerpt: "estratto dagli appunti" })) };
};

const sample = async (prompt, opts = {}) => {
  calls.push({ kind: "text", chars: prompt.length });
  await sleep(120);
  const text = "# Traccia di studio\n\nDomanda e offerta: ...\n\nLacune: verifica sul tuo corso.";
  opts.onText?.({ text, delta: text });
  return { text, truncated: false, modelTierApplied: "default" };
};
sample.json = async (prompt, opts = {}) => {
  calls.push({ kind: "json", chars: prompt.length, prompt });
  if (window.__failTopic && prompt.includes("<argomento>") && prompt.includes(window.__failTopic)) throw { code: "invalid_json", message: "x" };
  await sleep(120);
  const out = answer(prompt);
  opts.onText?.({ text: JSON.stringify(out).slice(0, 500), delta: "" });
  return JSON.parse(JSON.stringify(out));
};
sample.limits = async () => ({ maxPromptBytes: 262144 });

const docRef = (path) => ({
  id: path.split("/").pop(), path,
  async get() { const d = store[path]; return { id: this.id, exists: d !== undefined, data: () => d, metadata: {} }; },
  async set(data) { window.__dbWrites++; if (JSON.stringify(data).length > 256 * 1024) throw { code: "invalid_argument", message: "doc too large" }; store[path] = data; persist(); },
  async delete() { delete store[path]; persist(); },
});
const db = { doc: docRef, collection: (c) => ({ doc: (id) => docRef(`${c}/${id}`) }) };

const caps = { sample, db, user: { id: async () => "user_1", isOwner: async () => true }, downloads: { save: async (req) => { saved.push(req); return { status: "saved" }; } } };
window.claude = { use: async (name) => caps[name] ?? null };
