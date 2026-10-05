// SOLO PER LE PROVE: simula `window.claude` (sample, db, user, downloads) in un browser normale.
// Non viene incluso nel file da pubblicare.
import demo from "../public/demo/module.json";
import { demoAnalysis, demoGrade } from "../public/js/past-exams.js";
import { demoExamQuestions } from "../public/js/exam-questions.js";
import { demoMethods } from "../public/js/worked.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = (window.__sampleCalls = []);
const saved = (window.__saved = []);
const KEY = "fake-claude-db";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const store = load();
const persist = () => localStorage.setItem(KEY, JSON.stringify(store));
window.__dbWrites = 0;

const IMPORT_ROWS = {
  esami: [["Analisi matematica 1", "14/01/2027", "09:00", "Aula 3", "Scritto", "9", "1"], ["Diritto privato", "21/01/2027", "14:30", "Aula Magna", "Orale", "6", "2"]],
  insegnamenti: [["Analisi 1", "1", "9", "Obbligatorio", "", "Scritto"], ["Teoria dei giochi", "3", "6", "A scelta", "Area economica", ""]],
  orari: [["Analisi 1", "Lunedì", "09:00", "11:00", "Aula 3"], ["Analisi 1", "Giovedì", "14:00", "16:00", "Aula 3"], ["Fisica generale", "Mercoledì", "09:00", "12:00", "Lab 2"]],
};
// Indicazioni sull'esame: una frase vera presa dalle sbobine del prompt e una inventata (che l'app deve scartare).
function hintsFrom(prompt) {
  const block = prompt.match(/<sbobina[^>]*>([\s\S]*?)<\/sbobina>/)?.[1] ?? "";
  const real = block.split(/\n|(?<=[.!?])\s+/).find((x) => /chied/i.test(x));
  return [
    ...(real ? [{ quote: real.trim(), source: "Sbobine", note: "Argomento che il docente dice di chiedere.", topicId: "t1" }] : []),
    { quote: "Il docente ha detto che all'esame non chiede mai le formule.", source: "Sbobine", note: "", topicId: "" },
  ];
}

// Prove d'esame (analisi) e svolgimento (correzione) letti dal prompt, come li legge Claude.
const papersIn = (prompt) => [...prompt.matchAll(/<prova id="(P\d+)" titolo="([^"]*)">\n?([\s\S]*?)\n?<\/prova>/g)].map((m) => ({ id: m[1], label: m[2], text: m[3] }));
const topicsIn = (prompt) => [...(prompt.split(/Argomenti del modulo[^\n]*\n/)[1] ?? "").split("\n\n")[0].matchAll(/^(t\d+): (.+)$/gm)].map((m) => ({ id: m[1], title: m[2] }));

// Domande d'esame «D12. …» nel prompt → id per argomento (dalle parole del titolo), come le assegnerebbe Claude.
const examIdsByTopic = (prompt, topics) => {
  const out = new Map();
  for (const q of demoExamQuestions(prompt, topics)) out.set(q.topicId, [...(out.get(q.topicId) ?? []), ...q.examRefs]);
  return out;
};

// Esercizi svolti dal docente nel prompt → nomi dei metodi per argomento.
const workedIn = (prompt) => [...prompt.matchAll(/<esercizi_svolti[^>]*>\n([\s\S]*?)\n<\/esercizi_svolti>/g)].map((m) => m[1]).join("\n\n");
const methodNamesByTopic = (prompt) => {
  const out = new Map();
  for (const w of demoMethods(workedIn(prompt), demo.topics)) out.set(w.topicId, [...(out.get(w.topicId) ?? []), w.method.name]);
  return out;
};

const answer = (prompt) => {
  if (prompt.includes("METODI DEL DOCENTE DA RICAVARE")) {
    const names = [...prompt.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
    const real = demoMethods(workedIn(prompt), demo.topics).map((w) => w.method).filter((m) => names.includes(m.name));
    // un metodo con un esercizio inventato (dati che nei materiali non ci sono): l'app deve scartarlo
    return { methods: [...real, { name: "Metodo inventato", steps: ["Primo passo", "Secondo passo"], problem: "Con costo totale C = 9999 + 777Q e prezzo 4321 trova la quantità che massimizza il profitto.", solution: "Q = 12", source: "Esercizio 99" }] };
  }
  if (prompt.includes("DOMANDE D'ESAME DA PREPARARE")) {
    const list = prompt.split("<domande_esame_argomento>")[1].split("</domande_esame_argomento>")[0];
    const qs = demoExamQuestions(list, [{ id: "x", title: "x" }]).map(({ topicId, ...q }) => ({
      ...q, modelAnswer: "Risposta modello dai materiali (finta): $$\\varepsilon_P=\\left|\\frac{\\Delta\\%Q}{\\Delta\\%P}\\right|$$", followUp: "E se la domanda fosse perfettamente rigida, che cosa succederebbe al ricavo?",
    }));
    if (qs[0]) qs[0].examRefs = [...qs[0].examRefs, "D999"]; // id inesistente: l'app deve scartarlo
    return { questions: qs };
  }
  if (prompt.includes("PROVE D'ESAME PASSATE")) {
    const out = demoAnalysis(papersIn(prompt), topicsIn(prompt));
    const ids = out.papers.map((p) => p.id);
    out.structure = "Prova di 2 ore con 3 esercizi: due di calcolo e una domanda di teoria (analisi finta).";
    if (ids.length >= 2) out.recurring = [{ pattern: "Calcolo dell'elasticità da una funzione di domanda", topicId: "t2", paperIds: ids }, { pattern: "Compare in una prova sola", topicId: "", paperIds: [ids[0]] }];
    out.uncovered = ["Esternalità (chiesta nelle prove, non nel modulo)"];
    return out;
  }
  if (prompt.includes("CORREGGE LA PROVA")) {
    const paper = prompt.match(/<prova titolo="[^"]*">\n([\s\S]*?)\n<\/prova>/)?.[1] ?? "";
    const sv = prompt.match(/<svolgimento>\n([\s\S]*?)\n<\/svolgimento>/)?.[1] ?? "";
    const g = demoGrade(paper, sv);
    g.items[0].feedback = "Imposti bene $\\varepsilon_P$, ma il segno va tolto: $|-0{,}5|=0{,}5$.";
    g.items[0].topicId = "t2";
    return g;
  }
  if (prompt.includes("Trasforma il documento in righe di tabella")) {
    const kind = prompt.includes("Giorno | Inizio") ? "orari" : prompt.includes("Data | Ora") ? "esami" : "insegnamenti";
    return { found: true, notes: ["Letto dal documento (finto)."], rows: IMPORT_ROWS[kind] };
  }
  if (prompt.includes("<piano_di_studi>")) return { found: true, degreeName: "", academicYear: "", caveats: [], courses: [
    { name: "Analisi 1", year: 1, cfu: 9, format: "sconosciuto", formatEvidence: "", kind: "obbligatorio", group: "", url: "" },
    { name: "Teoria dei giochi", year: 3, cfu: 6, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "A scelta: area economica", url: "" },
    { name: "Statistica applicata", year: 3, cfu: 6, format: "sconosciuto", formatEvidence: "", kind: "a_scelta", group: "A scelta: area economica", url: "" } ] };
  if (prompt.includes("<risposta_studente>")) return { score: 0.75, verdict: "parziale", feedback: "Quasi: manca il punto sul riequilibrio.", covered: ["Individua l'eccesso di offerta"], missing: ["Indica la condizione di equilibrio"] };
  if (prompt.includes("<scheda_insegnamento>")) {
    const text = prompt.split("<scheda_insegnamento>")[1].split("</scheda_insegnamento>")[0];
    const sentence = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+/).find((x) => /scritt|oral/i.test(x)) ?? "";
    return { found: !!sentence, format: /eserciz/i.test(sentence) ? "problemi" : "scritto", evidence: sentence.trim(), details: /facoltativ/i.test(text) ? "Orale facoltativo (finto)." : "", url: "", academicYear: "2026-27", teacher: "", caveats: [] };
  }
  if (prompt.includes("<modulo_esistente>")) {
    const worked = methodNamesByTopic(prompt);
    if (worked.size) // esercizi svolti: gli argomenti esistenti su cui il docente svolge esercizi
      return { examHints: [], gaps: demo.gaps, topics: [...worked].map(([id, names]) => ({ id, title: demo.topics.find((t) => t.id === id).title, importance: 3, difficulty: 2, summary: "", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "", methodNames: names })) };
    const byTopic = examIdsByTopic(prompt.split("Materiali NUOVI")[1] ?? "", demo.topics);
    if (byTopic.size) // solo un elenco di domande d'esame: gli argomenti esistenti a cui si riferiscono, senza riassunto nuovo
      return { examHints: [], gaps: demo.gaps, topics: [...byTopic].map(([id, ids]) => ({ id, title: demo.topics.find((t) => t.id === id).title, importance: 3, difficulty: 2, summary: "", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "", examQuestionIds: ids })) };
    return { examHints: hintsFrom(prompt), gaps: ["Lacuna aggiornata dopo gli appunti nuovi (finta)."], topics: [
      { id: "t1", title: demo.topics[0].title, importance: 3, difficulty: 2, summary: "Riassunto aggiornato con gli appunti nuovi (finto).", keyConcepts: [{ term: "Prezzo massimo", definition: "tetto imposto dallo Stato" }], mustKnow: [], commonMistakes: [], origin: "notes", excerpt: "estratto" },
      { id: "n1", title: "Esternalità", importance: 3, difficulty: 2, summary: "Costi o benefici che ricadono su terzi.", keyConcepts: [{ term: "Esternalità", definition: "effetto su terzi" }], mustKnow: ["Definire un'esternalità"], commonMistakes: [], origin: "notes", excerpt: "estratto" } ] };
  }
  if (prompt.includes("<argomento>")) {
    const t = JSON.parse(prompt.split("<argomento>")[1].split("</argomento>")[0]);
    const topic = demo.topics.find((x) => x.title === t.title);
    // con i metodi del docente: 2 esercizi per metodo, stesso procedimento, un passaggio per paragrafo
    const methods = [...(prompt.split("<metodi_del_docente>")[1]?.split("</metodi_del_docente>")[0] ?? "").matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    const worked = methods.flatMap((name) => [1, 2].map((k) => ({ kind: "problem", method: name, prompt: `Esercizio ${k} sul metodo «${name}»: la domanda è $Q=${80 + 10 * k}-2P$, trova l'elasticità in $P=${10 * k}$.`, options: [], correctIndex: -1,
      modelAnswer: `Quantità nel punto: $Q=${80 + 10 * k}-${20 * k}=${80 - 10 * k}$.\n\nDerivata: $\\dfrac{dQ}{dP}=-2$.\n\n$$\\varepsilon_P=\\left|-2\\cdot\\frac{${10 * k}}{${80 - 10 * k}}\\right|$$\n\nConfronta con 1 per dire se è elastica.`, explanation: "", rubric: ["Calcola Q nel punto", "Derivata", "Formula dell'elasticità", "Conclusione"] })));
    if (!topic || prompt.includes("<carte_esistenti>")) return {
      flashcards: [1, 2, 3].map((i) => ({ front: `${t.title}: domanda nuova ${i}?`, back: `Risposta ${i}`, type: "definizione" })),
      questions: [{ kind: "open", prompt: `Spiega ${t.title} con un esempio.`, options: [], correctIndex: -1, modelAnswer: "…", explanation: "…", rubric: ["definizione", "esempio"] }, ...worked],
    };
    return {
      flashcards: demo.flashcards.filter((c) => c.topicId === topic.id).map(({ front, back, type }) => ({ front, back, type })),
      questions: demo.questions.filter((q) => q.topicId === topic.id).map(({ topicId, id, ...q }) => q),
    };
  }
  const byTopic = examIdsByTopic(prompt, demo.topics);
  const worked = methodNamesByTopic(prompt);
  return { title: demo.title, overview: demo.overview, gaps: demo.gaps, examHints: hintsFrom(prompt), topics: demo.topics.map((t) => ({ ...t, excerpt: "estratto dagli appunti", examQuestionIds: byTopic.get(t.id) ?? [], methodNames: worked.get(t.id) ?? [] })) };
};

// Trascrizione delle pagine (immagini): risponde con i marcatori e una formula in LaTeX per pagina.
function transcription(prompt) {
  const m = prompt.match(/le pagine da (\d+) a (\d+)/) ?? prompt.match(/la pagina (\d+)/);
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  const out = [];
  if (prompt.includes("SCRITTI A MANO")) {
    for (let p = from; p <= to; p++)
      out.push(`=== PAGINA ${p} ===\n# Lezione ${p} — Elasticità\nL'elasticità della domanda misura quanto varia $Q$ quando varia $P$.\n\n$$\\varepsilon_P=\\left|\\frac{\\Delta\\%Q}{\\Delta\\%P}\\right|$$\n\n- se $\\varepsilon_P>1$ → domanda **elastica**\n- beni di lusso[?] più elastici\n(nota: chiesto all'esame)`);
    return out.join("\n\n");
  }
  for (let p = from; p <= to; p++)
    out.push(`=== PAGINA ${p} ===\n# Capitolo ${Math.ceil(p / 4)}, pagina ${p}\nLa varianza campionaria è\n\n$$s^2=\\frac{1}{n-1}\\sum_{i=1}^{n}\\left(x_i-\\bar{x}\\right)^2$$\n\ne la media $\\bar{x}=\\frac{1}{n}\\sum_i x_i$ (pagina ${p}).`);
  return out.join("\n\n");
}

const sample = async (prompt, opts = {}) => {
  calls.push({ kind: "text", chars: prompt.length, prompt, images: opts.images?.length ?? 0 });
  await sleep(120);
  if (prompt.includes("DISPENSA UNICA")) {
    const title = prompt.match(/Scrivi ora il capitolo «([^»]+)»/)?.[1] ?? "Capitolo";
    const text = `### Spiegazione\nTesto integrato su ${title} dai materiali [Appunti] e dalle sbobine [Sbobine, lez. 2].\n\n> Integrazione (non è nei tuoi materiali): un passaggio aggiunto per capire.\n\n### Formule e definizioni chiave\n- Elasticità:\n\n$$\\varepsilon_P=\\left|\\frac{\\Delta\\%Q}{\\Delta\\%P}\\right|$$\n\n| Valore | Domanda |\n| --- | --- |\n| $\\varepsilon_P>1$ | elastica |\n| $\\varepsilon_P<1$ | anelastica |\n\n### Errori da evitare\n- Confondere **movimento** e *spostamento* della curva.\n\n### Mettiti alla prova\n1. Definisci ${title}.\n2. Calcola $\\varepsilon_P$ se $\\Delta\\%Q=-5$ e $\\Delta\\%P=10$.\n\n=== SOLUZIONI ===\n1. Vedi la spiegazione.\n2. $\\varepsilon_P=0{,}5$.`;
    opts.onText?.({ text, delta: text });
    return { text, truncated: false, modelTierApplied: "default" };
  }
  if (prompt.includes("Trascrivi fedelmente")) {
    const text = transcription(prompt);
    opts.onText?.({ text, delta: text });
    return { text, truncated: false, modelTierApplied: "default" };
  }
  const text = "# Traccia di studio\n\nDomanda e offerta: ...\n\nLacune: verifica sul tuo corso.";
  opts.onText?.({ text, delta: text });
  return { text, truncated: false, modelTierApplied: "default" };
};
sample.json = async (prompt, opts = {}) => {
  calls.push({ kind: "json", chars: prompt.length, prompt, images: opts.images?.length ?? 0, imageBytes: (opts.images ?? []).map((b) => b.size) });
  if (window.__failTopic && prompt.includes("<argomento>") && prompt.includes(window.__failTopic)) throw { code: "invalid_json", message: "x" };
  await sleep(120);
  const out = answer(prompt);
  opts.onText?.({ text: JSON.stringify(out).slice(0, 500), delta: "" });
  return JSON.parse(JSON.stringify(out));
};
sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 8, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png"] } });

const docRef = (path) => ({
  id: path.split("/").pop(), path,
  async get() { const d = store[path]; return { id: this.id, exists: d !== undefined, data: () => d, metadata: {} }; },
  async set(data) { window.__dbWrites++; if (JSON.stringify(data).length > 256 * 1024) throw { code: "invalid_argument", message: "doc too large" }; store[path] = data; persist(); },
  async delete() { delete store[path]; persist(); },
});
const db = { doc: docRef, collection: (c) => ({ doc: (id) => docRef(`${c}/${id}`) }) };

const caps = { sample, db, user: { id: async () => "user_1", isOwner: async () => true }, downloads: { save: async (req) => { saved.push(req); return { status: "saved" }; } } };
window.claude = { use: async (name) => caps[name] ?? null };
