// Normalizzazione dei dati generati dall'AI. Nessuna dipendenza: gira sia sul server sia nel browser
// (la versione pubblicata come pagina Claude la usa senza zod).
export const FORMATS = ["scritto", "orale", "test", "problemi", "misto", "sconosciuto"];
// obbligatorio = previsto dal piano; a_scelta = a scelta dello studente (tipico del 3° anno); sconosciuto = non indicato
export const KINDS = ["obbligatorio", "a_scelta", "sconosciuto"];
export const LEVELS = ["L", "LM", "LMCU", ""];

/*
 * LaTeX rovinato dal JSON. In una stringa JSON «\frac» è valido ma significa form feed + "rac", «\beta» backspace + "eta",
 * «\theta» tab + "heta", «\nabla» a capo + "abla", «\rho» ritorno a capo + "ho": non dà errore, la formula si rompe e basta.
 * Qui si rimettono i backslash: \f e \b sempre (nel testo non servono mai), tab/a capo/ritorno solo dentro una formula
 * o davanti a un comando noto. Si toglie anche il backslash doppio davanti a un comando ($\\frac$ → $\frac$).
 */
const CMD = "frac|dfrac|tfrac|sqrt|sum|prod|int|oint|iint|lim|log|ln|exp|sin|cos|tan|alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|vartheta|Theta|lambda|Lambda|mu|nu|xi|pi|Pi|rho|sigma|Sigma|tau|phi|varphi|Phi|chi|psi|Psi|omega|Omega|cdot|times|div|pm|mp|le|leq|ge|geq|neq|ne|approx|equiv|sim|propto|infty|partial|nabla|to|rightarrow|Rightarrow|leftarrow|Leftarrow|leftrightarrow|iff|implies|left|right|bar|hat|tilde|vec|dot|ddot|overline|underline|mathbb|mathrm|mathbf|mathcal|text|textbf|operatorname|begin|end|quad|qquad|forall|exists|in|notin|subset|subseteq|cup|cap|ldots|cdots|binom|max|min|sup|inf|det|Pr|neg|land|lor|mid|perp|angle|circ|prime";
const AFTER = {
  "\t": new RegExp(`^(?:heta|imes|ext|extbf|extit|extrm|au|ilde|riangle|op|o(?![a-z])|frac|an(?![a-z])|anh|hinspace)`),
  "\r": new RegExp(`^(?:ho|ight|ightarrow|angle|m(?![a-z])|vert|Vert)`),
  "\n": new RegExp(`^(?:abla|eq|e(?![a-z])|eg|u(?![a-z])|ot|i(?![a-z])|ewline|exists|leq|geq|mid|parallel|subseteq|supseteq|sim|cong|prec|succ|vdash|o(?![a-z])|leftarrow|rightarrow|Rightarrow|Leftarrow)`),
};
const DOUBLE = new RegExp(`\\\\\\\\(?=(?:${CMD})(?![a-zA-Z]))`, "g");

export function repairLatex(text) {
  const s = String(text ?? "");
  if (!/[\t\n\r\f\b$]|\\\\/.test(s)) return s;
  let out = "";
  let inMath = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "$" && s[i - 1] !== "\\") {
      if (s[i + 1] === "$") { out += "$$"; i++; }
      else out += c;
      inMath = !inMath;
      continue;
    }
    if (c === "\f") { out += "\\f"; continue; }
    if (c === "\b") { out += "\\b"; continue; }
    if (c in AFTER) {
      const rest = s.slice(i + 1, i + 14);
      if (/^[a-zA-Z]/.test(rest) && AFTER[c].test(rest) && (inMath || c !== "\n")) { out += `\\${{ "\t": "t", "\r": "r", "\n": "n" }[c]}`; continue; }
    }
    out += c;
  }
  // backslash doppio davanti a un comando, solo dentro le formule
  return out.replace(/(\$\$?)([\s\S]*?)\1/g, (m, d, body) => `${d}${body.replace(DOUBLE, "\\")}${d}`);
}

const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);
const str = (s) => (typeof s === "string" ? s.trim() : "");
// testo che può contenere formule: si ripara PRIMA di togliere gli spazi (un «\f» iniziale, cioè \frac rovinato, è uno «spazio»)
const tex = (s) => (typeof s === "string" ? repairLatex(s).trim() : "");

const normTopic = (t, id, validSource) => ({
  id,
  title: tex(t.title),
  importance: clamp(t.importance, 1, 3, 2),
  difficulty: clamp(t.difficulty, 1, 3, 2),
  summary: tex(t.summary),
  keyConcepts: (t.keyConcepts ?? []).filter((k) => str(k.term) && str(k.definition)).map((k) => ({ term: tex(k.term), definition: tex(k.definition) })),
  mustKnow: (t.mustKnow ?? []).map(tex).filter(Boolean),
  commonMistakes: (t.commonMistakes ?? []).map(tex).filter(Boolean),
  origin: t.origin ?? "notes",
  sourceIds: (t.sourceIds ?? []).filter((s) => validSource.has(s)),
});

/**
 * Controllo degli esercizi svolti che l'AI dice di aver copiato dai materiali: le parole lunghe e soprattutto i numeri dell'esercizio
 * devono esserci (un esempio inventato ha dati diversi). Le formule convertite in LaTeX non contano: si guardano parole e numeri.
 * @returns {(problem: string) => boolean|null} true = trovato, false = inventato, null = non verificabile (quasi solo formule, o PDF)
 */
export function exampleChecker(text, { hasPdf = false } = {}) {
  const plain = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\\[a-z]+/g, " ").replace(/(\d),(\d)/g, "$1.$2").replace(/\{,\}/g, ".");
  const words = (s) => plain(s).match(/[a-z]{5,}/g) ?? [];
  const nums = (s) => plain(s).match(/\d+(?:\.\d+)?/g)?.filter((x) => x.length >= 2) ?? [];
  const hayW = new Set(words(text));
  const hayN = new Set(nums(text));
  return (problem) => {
    const w = words(problem);
    const n = [...new Set(nums(problem))];
    if (w.length < 4 && n.length < 2) return null;
    const okW = !w.length || w.filter((x) => hayW.has(x)).length / w.length >= 0.6;
    const okN = n.length < 2 || n.filter((x) => hayN.has(x)).length / n.length >= 0.6;
    if (okW && okN) return true;
    return hasPdf ? null : false;
  };
}

/** Metodi del docente di un argomento: nomi unici, almeno 2 passaggi; un esercizio svolto non trovato nei materiali fa scartare il metodo. */
function normMethods(list, check) {
  const methods = [];
  const dropped = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const name = tex(x?.name).slice(0, 120);
    const steps = (Array.isArray(x?.steps) ? x.steps : []).map(tex).filter(Boolean).slice(0, 10).map((st) => st.slice(0, 500));
    if (!name || steps.length < 2 || seen.has(key(name))) continue;
    const problem = tex(x?.problem).slice(0, 3000);
    const ok = check && problem ? check(problem) : null;
    if (ok === false) { dropped.push(name); continue; }
    seen.add(key(name));
    methods.push({ name, steps, problem, solution: problem ? tex(x?.solution).slice(0, 8000) : "", source: str(x?.source).slice(0, 160), verified: ok === true });
  }
  return { methods: methods.slice(0, 4), dropped };
}

const droppedGap = (names) => names.map((n) => `Il metodo «${n}» non corrisponde agli esercizi svolti caricati ed è stato scartato: controlla che il materiale sia completo.`);

const normCard = (c, id, topicId) => (topicId && str(c.front) && str(c.back) ? { id, topicId, front: tex(c.front), back: tex(c.back), type: c.type } : null);

/**
 * `refs` (Map «D12» → chiave della domanda d'esame): gli examRefs validi diventano chiavi, gli altri si scartano.
 * examRefs e followUp ci sono solo nelle domande che vengono da un elenco di domande d'esame.
 */
function normQuestion(q, id, topicId, refs = null, methodOf = null) {
  if (!topicId || !str(q.prompt)) return null;
  const options = (q.options ?? []).map(tex).filter(Boolean);
  const correctIndex = Math.round(q.correctIndex);
  if (q.kind === "mcq" && (options.length < 2 || !(correctIndex >= 0 && correctIndex < options.length))) return null;
  const examRefs = refs ? [...new Set((Array.isArray(q.examRefs) ? q.examRefs : []).map((x) => refs.get(x)).filter(Boolean))] : [];
  const followUp = examRefs.length ? tex(q.followUp).slice(0, 500) : "";
  return {
    id,
    topicId,
    kind: q.kind,
    prompt: tex(q.prompt),
    options: q.kind === "mcq" ? options : [],
    correctIndex: q.kind === "mcq" ? correctIndex : -1,
    modelAnswer: tex(q.modelAnswer),
    explanation: tex(q.explanation),
    rubric: (q.rubric ?? []).map(tex).filter(Boolean),
    ...(examRefs.length ? { examRefs } : {}),
    ...(followUp ? { followUp } : {}),
    ...(methodOf && q.kind !== "mcq" && methodOf(topicId, q.method) ? { method: methodOf(topicId, q.method) } : {}),
  };
}

/** (argomento, nome) → il nome del metodo com'è nell'argomento, null se l'argomento non ha quel metodo. */
const methodLookup = (topics) => {
  const by = new Map(topics.map((t) => [t.id, new Map((t.methods ?? []).map((m) => [key(m.name), m.name]))]));
  return (topicId, name) => (typeof name === "string" && name.trim() ? by.get(topicId)?.get(key(name)) ?? null : null);
};

/** Gli id «D12» delle domande d'esame presenti nei materiali (righe «D12. …» dei materiali di tipo domande), id → riga. */
export function examQuestionLines(materials) {
  const out = new Map();
  for (const m of materials ?? []) {
    if (m.role !== "domande" || typeof m.text !== "string") continue;
    for (const [, id, line] of m.text.matchAll(/^(D\d{1,4})\. (.+)$/gm)) out.set(id, line);
  }
  return out;
}

/** Id → se stesso: per tenere gli examRefs validi finché il browser non li traduce nelle sue chiavi. */
export const identityRefs = (materials) => new Map([...examQuestionLines(materials).keys()].map((id) => [id, id]));

const flatQ = (s) => String(s ?? "").toLowerCase().normalize("NFC").replace(/[’‘`´]/g, "'").replace(/[“”«»"]/g, "").replace(/\s+/g, " ").replace(/^[\s'.…,;:]+|[\s'.…,;:]+$/g, "").trim();

/**
 * Controllo delle citazioni del docente: `text` è il testo dei materiali mandati al modello. Una citazione che non compare
 * (nemmeno nei suoi primi 60 caratteri) è inventata o parafrasata: si scarta. Se alcuni materiali erano PDF (che qui non si
 * possono leggere) la citazione non trovata resta, ma segnata come non verificata.
 * @returns {(quote: string) => boolean|null} true = trovata, false = da scartare, null = non verificabile
 */
export function quoteChecker(text, { hasPdf = false } = {}) {
  const hay = flatQ(text);
  return (quote) => {
    const q = flatQ(quote);
    if (q.length < 8) return false;
    if (hay.includes(q) || (q.length > 60 && hay.includes(q.slice(0, 60)))) return true;
    return hasPdf ? null : false;
  };
}

function normHints(list, idMap, check) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const quote = tex(x?.quote).slice(0, 400);
    const key = flatQ(quote);
    if (!quote || seen.has(key)) continue;
    const ok = check ? check(quote) : null;
    if (ok === false) continue;
    seen.add(key);
    out.push({ quote, source: str(x?.source).slice(0, 160), note: tex(x?.note).slice(0, 300), topicId: idMap.get(x?.topicId) ?? "", verified: ok === true });
  }
  return out;
}

/**
 * Rende il modulo coerente: id stabili e univoci, riferimenti validi, valori nei range.
 * `sources` è la lista [{id,title,url}] fornita al modello: gli id sconosciuti vengono scartati.
 * `checkQuote` (vedi quoteChecker) verifica le citazioni del docente in examHints.
 */
export function normalizeModule(raw, sources = [], { checkQuote = null, examRefs = null, checkExample = null } = {}) {
  const validSource = new Set(sources.map((s) => s.id));
  const idMap = new Map();
  const topics = [];
  const dropped = [];
  for (const t of raw.topics ?? []) {
    if (!str(t.title)) continue;
    const id = `t${topics.length + 1}`;
    idMap.set(t.id, id);
    const topic = normTopic(t, id, validSource);
    const m = normMethods(t.methods, checkExample);
    if (m.methods.length) topic.methods = m.methods;
    dropped.push(...m.dropped);
    topics.push(topic);
  }
  const methodOf = methodLookup(topics);
  const flashcards = [];
  for (const c of raw.flashcards ?? []) {
    const card = normCard(c, `c${flashcards.length + 1}`, idMap.get(c.topicId));
    if (card) flashcards.push(card);
  }
  const questions = [];
  for (const q of raw.questions ?? []) {
    const qq = normQuestion(q, `q${questions.length + 1}`, idMap.get(q.topicId), examRefs, methodOf);
    if (qq) questions.push(qq);
  }
  return {
    title: tex(raw.title),
    overview: tex(raw.overview),
    topics,
    flashcards,
    questions,
    gaps: [...(raw.gaps ?? []).map(tex).filter(Boolean), ...droppedGap(dropped)],
    examHints: normHints(raw.examHints, idMap, checkQuote),
    sources,
  };
}

const key = (s) => str(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const nextNum = (items, prefix) => items.reduce((n, x) => Math.max(n, Number(String(x.id).slice(prefix.length)) || 0), 0) + 1;

/**
 * Aggiunge a un modulo esistente quello che l'AI ha ricavato dai materiali nuovi, SENZA toccare gli id esistenti
 * (flashcard, quiz e argomenti svolti sono indicizzati per id: rinumerare azzererebbe i progressi).
 * `raw` ha la forma del modulo: un argomento con l'id di uno esistente è un approfondimento (riassunto aggiornato,
 * concetti in più), uno con un id nuovo è un argomento nuovo; carte e domande puntano all'uno o all'altro.
 * Carte e domande già presenti (stesso testo) vengono scartate. Le lacune: `raw.gaps` le sostituisce (il modello vede quelle
 * attuali e restituisce l'elenco aggiornato) se `replaceGaps`, altrimenti si aggiungono.
 * @returns {{module: object, added: {topics: number, updated: number, flashcards: number, questions: number}}}
 */
export function mergeModule(base, raw, sources = [], { now = new Date().toISOString(), replaceGaps = true, summary = "replace", checkQuote = null, examRefs = null, checkExample = null } = {}) {
  const mod = structuredClone(base);
  mod.sources ??= [];
  // fonti nuove: id rinumerati se si sovrappongono a quelli già presenti
  const srcMap = new Map();
  let sNext = mod.sources.length + 1;
  for (const s of sources) {
    const same = mod.sources.find((x) => x.url && x.url === s.url);
    if (same) { srcMap.set(s.id, same.id); continue; }
    let id = s.id;
    while (mod.sources.some((x) => x.id === id)) id = `S${sNext++}`;
    mod.sources.push({ ...s, id });
    srcMap.set(s.id, id);
  }
  const validSource = new Set(srcMap.keys());
  const remapSources = (ids) => ids.map((x) => srcMap.get(x)).filter(Boolean);

  const byId = new Map(mod.topics.map((t) => [t.id, t]));
  const byTitle = new Map(mod.topics.map((t) => [key(t.title), t]));
  const idMap = new Map(mod.topics.map((t) => [t.id, t.id]));
  const updated = new Set();
  const fresh = new Set(); // argomenti creati da questa fusione
  let tNext = nextNum(mod.topics, "t");
  let addedTopics = 0;
  let addedMethods = 0;
  const droppedMethods = [];
  for (const t of raw.topics ?? []) {
    if (!str(t.title) && !byId.has(t.id)) continue;
    const target = byId.get(t.id) ?? byTitle.get(key(t.title));
    const n = normTopic({ ...t, title: t.title || target?.title }, "", validSource);
    const nm = normMethods(t.methods, checkExample);
    droppedMethods.push(...nm.dropped);
    if (target) {
      const have = new Set((target.methods ?? []).map((x) => key(x.name)));
      const fresh = nm.methods.filter((x) => !have.has(key(x.name)));
      if (fresh.length) { target.methods = [...(target.methods ?? []), ...fresh]; addedMethods += fresh.length; updated.add(target.id); }
      idMap.set(t.id, target.id);
      // "append": chi non vede il riassunto attuale (modalità base) lo completa invece di sostituirlo
      if (n.summary) target.summary = summary === "append" && target.summary && !target.summary.includes(n.summary) ? `${target.summary} ${n.summary}` : n.summary;
      const terms = new Set(target.keyConcepts.map((k) => key(k.term)));
      target.keyConcepts.push(...n.keyConcepts.filter((k) => !terms.has(key(k.term))));
      for (const f of ["mustKnow", "commonMistakes"]) {
        const have = new Set(target[f].map(key));
        target[f].push(...n[f].filter((x) => !have.has(key(x))));
      }
      if (n.origin === "notes") target.origin = "notes";
      target.sourceIds = [...new Set([...(target.sourceIds ?? []), ...remapSources(n.sourceIds)])];
      updated.add(target.id);
      continue;
    }
    const id = `t${tNext++}`;
    const topic = { ...n, id, sourceIds: remapSources(n.sourceIds), addedAt: now, ...(nm.methods.length ? { methods: nm.methods } : {}) };
    addedMethods += nm.methods.length;
    mod.topics.push(topic);
    fresh.add(id);
    byId.set(id, topic);
    byTitle.set(key(topic.title), topic);
    idMap.set(t.id, id);
    addedTopics++;
  }

  const cardKeys = new Set(mod.flashcards.map((c) => key(c.front)));
  let cNext = nextNum(mod.flashcards, "c");
  let addedCards = 0;
  for (const c of raw.flashcards ?? []) {
    const card = normCard(c, `c${cNext}`, idMap.get(c.topicId));
    if (!card || cardKeys.has(key(card.front))) continue;
    cardKeys.add(key(card.front));
    mod.flashcards.push({ ...card, addedAt: now });
    cNext++;
    addedCards++;
    updated.add(card.topicId);
  }
  const methodOf = methodLookup(mod.topics);
  const qKeys = new Map(mod.questions.map((q) => [key(q.prompt), q]));
  let qNext = nextNum(mod.questions, "q");
  let addedQuestions = 0;
  let examLinked = 0; // domande d'esame entrate nel quiz (nuove o già presenti)
  let addedExam = 0;
  for (const q of raw.questions ?? []) {
    const qq = normQuestion(q, `q${qNext}`, idMap.get(q.topicId), examRefs, methodOf);
    if (!qq) continue;
    const same = qKeys.get(key(qq.prompt));
    if (same) {
      // la domanda c'è già: se ora risulta una domanda d'esame, lo diventa (con i suoi progressi)
      if (qq.examRefs) {
        same.examRefs = [...new Set([...(same.examRefs ?? []), ...qq.examRefs])];
        if (qq.followUp && !same.followUp) same.followUp = qq.followUp;
        examLinked++;
      }
      continue;
    }
    const added = { ...qq, addedAt: now };
    qKeys.set(key(qq.prompt), added);
    mod.questions.push(added);
    if (qq.examRefs) { examLinked++; addedExam++; }
    qNext++;
    addedQuestions++;
    updated.add(qq.topicId);
  }
  for (const id of fresh) updated.delete(id);
  for (const id of updated) byId.get(id).updatedAt = now;

  const hints = normHints(raw.examHints, idMap, checkQuote).map((x) => ({ ...x, addedAt: now }));
  const haveHints = new Set((mod.examHints ?? []).map((x) => flatQ(x.quote)));
  const newHints = hints.filter((x) => !haveHints.has(flatQ(x.quote)));
  mod.examHints = [...(mod.examHints ?? []), ...newHints];

  const gaps = [...(raw.gaps ?? []).map(tex).filter(Boolean), ...droppedGap(droppedMethods)];
  if (replaceGaps && Array.isArray(raw.gaps)) mod.gaps = gaps;
  else mod.gaps = [...new Set([...(mod.gaps ?? []), ...gaps])];
  return { module: mod, added: { topics: addedTopics, updated: updated.size, flashcards: addedCards, questions: addedQuestions - addedExam, hints: newHints.length, examQuestions: examLinked, ...(addedMethods ? { methods: addedMethods } : {}) } };
}

/** Piano di studi: nomi unici, valori nei range, URL accettati solo se visti davvero nella ricerca. */
export function normalizeCurriculum(raw, seenUrls = new Set()) {
  const seen = new Set();
  const courses = [];
  for (const c of raw.courses ?? []) {
    const name = str(c.name);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const format = FORMATS.includes(c.format) ? c.format : "sconosciuto";
    const url = seenUrls.has(c.url) ? c.url : "";
    courses.push({
      name,
      year: clamp(c.year, 0, 6, 0),
      cfu: clamp(c.cfu, 0, 60, 0),
      // un formato dichiarato senza evidenza non è affidabile: lo si scarta
      format: format !== "sconosciuto" && !str(c.formatEvidence) ? "sconosciuto" : format,
      formatEvidence: str(c.formatEvidence),
      kind: KINDS.includes(c.kind) ? c.kind : "sconosciuto",
      group: str(c.group).slice(0, 120),
      url,
    });
  }
  return {
    found: !!raw.found,
    degreeName: str(raw.degreeName),
    academicYear: str(raw.academicYear),
    courses,
    caveats: (raw.caveats ?? []).map(str).filter(Boolean),
  };
}

/** Elenco dei corsi di studio di un ateneo: nomi unici, livello valido, URL solo se visti nella ricerca. */
export function normalizeDegrees(raw, seenUrls = new Set()) {
  const seen = new Set();
  const items = [];
  for (const d of raw.degrees ?? []) {
    const name = str(d.name);
    const level = LEVELS.includes(d.level) ? d.level : "";
    const key = `${name.toLowerCase()}|${level}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    items.push({ name, level, classe: str(d.classe).slice(0, 20), url: seenUrls.has(d.url) ? d.url : "" });
  }
  return { found: !!raw.found, academicYear: str(raw.academicYear), degrees: items, caveats: (raw.caveats ?? []).map(str).filter(Boolean) };
}

/**
 * Righe lette dall'AI → tabella con l'intestazione canonica (le righe sono portate alla stessa larghezza).
 * @returns {{found: boolean, rows: string[][], notes: string[]}} rows[0] = intestazione
 */
export function normalizeImportRows(raw, headers) {
  const w = headers.length;
  const rows = (Array.isArray(raw?.rows) ? raw.rows : [])
    .filter(Array.isArray)
    .map((r) => Array.from({ length: w }, (_, i) => (r[i] == null ? "" : String(r[i]).trim())))
    .filter((r) => r.filter(Boolean).length >= 2);
  return { found: !!raw?.found && rows.length > 0, rows: [headers, ...rows], notes: (raw?.notes ?? []).map(str).filter(Boolean).slice(0, 10) };
}

/**
 * Modalità d'esame di un insegnamento (dalla scheda trovata online o incollata dallo studente). Vale solo con una prova:
 * - ricerca web: citazione (evidence) e URL effettivamente visto nella ricerca (`seenUrls`);
 * - testo incollato (`sourceText`): la citazione deve comparire davvero nel testo.
 * Senza prova il formato torna «sconosciuto»: meglio nessuna risposta che una dedotta.
 */
export function normalizeExamFormat(raw, { seenUrls = new Set(), sourceText = null } = {}) {
  const flat = (s) => str(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").replace(/^[\s"'.…]+|[\s"'.…]+$/g, "");
  const evidence = str(raw?.evidence).slice(0, 600);
  let url;
  let proven;
  if (sourceText != null) {
    url = raw?.url && sourceText.includes(raw.url) ? raw.url : "";
    const src = flat(sourceText);
    const ev = flat(evidence);
    proven = ev.length >= 8 && (src.includes(ev) || (ev.length > 40 && src.includes(ev.slice(0, 40))));
  } else {
    url = seenUrls.has(raw?.url) ? raw.url : "";
    proven = !!evidence && !!url;
  }
  let format = FORMATS.includes(raw?.format) ? raw.format : "sconosciuto";
  if (!proven) format = "sconosciuto";
  return {
    found: !!raw?.found && format !== "sconosciuto",
    format,
    evidence: format === "sconosciuto" ? "" : evidence,
    details: str(raw?.details).slice(0, 400),
    url,
    academicYear: str(raw?.academicYear).slice(0, 20),
    teacher: str(raw?.teacher).slice(0, 120),
    caveats: (raw?.caveats ?? []).map(str).filter(Boolean).slice(0, 5),
  };
}

const num = (n, lo, hi) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : lo);
const KINDS_ITEM = ["esercizio", "teoria", "test", "altro"];

/**
 * Analisi delle prove passate: solo prove e argomenti che esistono (`paperIds`, `topicIds`), numeri nei range.
 * Gli esercizi ricorrenti valgono solo se compaiono davvero in almeno 2 prove elencate.
 * @returns {{papers: Object<string, object>, structure: string, recurring: object[], uncovered: string[], caveats: string[]}} papers per id
 */
export function normalizePastExams(raw, { paperIds = [], topicIds = [] } = {}) {
  const validP = new Set(paperIds);
  const validT = new Set(topicIds);
  const papers = {};
  for (const p of Array.isArray(raw?.papers) ? raw.papers : []) {
    if (!validP.has(p?.id) || papers[p.id]) continue;
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 40).map((it, k) => ({
      n: str(it?.n).slice(0, 8) || String(k + 1),
      summary: tex(it?.summary).slice(0, 240),
      topicIds: [...new Set((Array.isArray(it?.topicIds) ? it.topicIds : []).filter((id) => validT.has(id)))],
      kind: KINDS_ITEM.includes(it?.kind) ? it.kind : "altro",
      points: Math.round(num(it?.points, 0, 100) * 10) / 10,
    })).filter((it) => it.summary);
    papers[p.id] = {
      label: str(p.label).slice(0, 120),
      year: /^(19|20)\d{2}$/.test(str(p.year)) ? str(p.year) : "",
      durationMin: Math.round(num(p.durationMin, 0, 600)),
      hasSolutions: !!p.hasSolutions,
      items,
    };
  }
  const recurring = (Array.isArray(raw?.recurring) ? raw.recurring : []).map((r) => ({
    pattern: tex(r?.pattern).slice(0, 240),
    topicId: validT.has(r?.topicId) ? r.topicId : "",
    paperIds: [...new Set((Array.isArray(r?.paperIds) ? r.paperIds : []).filter((id) => papers[id]))],
  })).filter((r) => r.pattern && r.paperIds.length >= 2).sort((a, b) => b.paperIds.length - a.paperIds.length).slice(0, 12);
  return {
    papers,
    structure: tex(raw?.structure).slice(0, 1200),
    recurring,
    uncovered: (Array.isArray(raw?.uncovered) ? raw.uncovered : []).map(tex).filter(Boolean).slice(0, 12),
    caveats: (Array.isArray(raw?.caveats) ? raw.caveats : []).map(tex).filter(Boolean).slice(0, 8),
  };
}

const VERDICTS = ["corretto", "parziale", "errato", "non svolto"];

/** Correzione di una simulazione: punti tra 0 e il massimo di ogni esercizio, argomenti validi, LaTeX riparato. */
export function normalizeExamGrade(raw, { topicIds = [] } = {}) {
  const validT = new Set(topicIds);
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, 40).map((it, k) => {
    const maxPoints = Math.round(num(it?.maxPoints, 0, 100) * 10) / 10;
    const points = Math.round(num(it?.points, 0, maxPoints) * 10) / 10;
    return {
      n: str(it?.n).slice(0, 8) || String(k + 1),
      task: tex(it?.task).slice(0, 240),
      maxPoints,
      points,
      verdict: VERDICTS.includes(it?.verdict) ? it.verdict : points >= maxPoints ? "corretto" : points > 0 ? "parziale" : "errato",
      feedback: tex(it?.feedback).slice(0, 1500),
      topicId: validT.has(it?.topicId) ? it.topicId : "",
    };
  }).filter((it) => it.maxPoints > 0);
  return {
    items,
    overall: tex(raw?.overall).slice(0, 1500),
    priorities: (Array.isArray(raw?.priorities) ? raw.priorities : []).map(tex).filter(Boolean).slice(0, 6),
    readingIssues: (Array.isArray(raw?.readingIssues) ? raw.readingIssues : []).map(tex).filter(Boolean).slice(0, 6),
  };
}
