// Normalizzazione dei dati generati dall'AI. Nessuna dipendenza: gira sia sul server sia nel browser
// (la versione pubblicata come pagina Claude la usa senza zod).
export const FORMATS = ["scritto", "orale", "test", "problemi", "misto", "sconosciuto"];
// obbligatorio = previsto dal piano; a_scelta = a scelta dello studente (tipico del 3° anno); sconosciuto = non indicato
export const KINDS = ["obbligatorio", "a_scelta", "sconosciuto"];
export const LEVELS = ["L", "LM", "LMCU", ""];

const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);
const str = (s) => (typeof s === "string" ? s.trim() : "");

const normTopic = (t, id, validSource) => ({
  id,
  title: str(t.title),
  importance: clamp(t.importance, 1, 3, 2),
  difficulty: clamp(t.difficulty, 1, 3, 2),
  summary: str(t.summary),
  keyConcepts: (t.keyConcepts ?? []).filter((k) => str(k.term) && str(k.definition)),
  mustKnow: (t.mustKnow ?? []).map(str).filter(Boolean),
  commonMistakes: (t.commonMistakes ?? []).map(str).filter(Boolean),
  origin: t.origin ?? "notes",
  sourceIds: (t.sourceIds ?? []).filter((s) => validSource.has(s)),
});

const normCard = (c, id, topicId) => (topicId && str(c.front) && str(c.back) ? { id, topicId, front: str(c.front), back: str(c.back), type: c.type } : null);

function normQuestion(q, id, topicId) {
  if (!topicId || !str(q.prompt)) return null;
  const options = (q.options ?? []).map(str).filter(Boolean);
  const correctIndex = Math.round(q.correctIndex);
  if (q.kind === "mcq" && (options.length < 2 || !(correctIndex >= 0 && correctIndex < options.length))) return null;
  return {
    id,
    topicId,
    kind: q.kind,
    prompt: str(q.prompt),
    options: q.kind === "mcq" ? options : [],
    correctIndex: q.kind === "mcq" ? correctIndex : -1,
    modelAnswer: str(q.modelAnswer),
    explanation: str(q.explanation),
    rubric: (q.rubric ?? []).map(str).filter(Boolean),
  };
}

/**
 * Rende il modulo coerente: id stabili e univoci, riferimenti validi, valori nei range.
 * `sources` è la lista [{id,title,url}] fornita al modello: gli id sconosciuti vengono scartati.
 */
export function normalizeModule(raw, sources = []) {
  const validSource = new Set(sources.map((s) => s.id));
  const idMap = new Map();
  const topics = [];
  for (const t of raw.topics ?? []) {
    if (!str(t.title)) continue;
    const id = `t${topics.length + 1}`;
    idMap.set(t.id, id);
    topics.push(normTopic(t, id, validSource));
  }
  const flashcards = [];
  for (const c of raw.flashcards ?? []) {
    const card = normCard(c, `c${flashcards.length + 1}`, idMap.get(c.topicId));
    if (card) flashcards.push(card);
  }
  const questions = [];
  for (const q of raw.questions ?? []) {
    const qq = normQuestion(q, `q${questions.length + 1}`, idMap.get(q.topicId));
    if (qq) questions.push(qq);
  }
  return {
    title: str(raw.title),
    overview: str(raw.overview),
    topics,
    flashcards,
    questions,
    gaps: (raw.gaps ?? []).map(str).filter(Boolean),
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
export function mergeModule(base, raw, sources = [], { now = new Date().toISOString(), replaceGaps = true, summary = "replace" } = {}) {
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
  for (const t of raw.topics ?? []) {
    if (!str(t.title) && !byId.has(t.id)) continue;
    const target = byId.get(t.id) ?? byTitle.get(key(t.title));
    const n = normTopic({ ...t, title: t.title || target?.title }, "", validSource);
    if (target) {
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
    const topic = { ...n, id, sourceIds: remapSources(n.sourceIds), addedAt: now };
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
  const qKeys = new Set(mod.questions.map((q) => key(q.prompt)));
  let qNext = nextNum(mod.questions, "q");
  let addedQuestions = 0;
  for (const q of raw.questions ?? []) {
    const qq = normQuestion(q, `q${qNext}`, idMap.get(q.topicId));
    if (!qq || qKeys.has(key(qq.prompt))) continue;
    qKeys.add(key(qq.prompt));
    mod.questions.push({ ...qq, addedAt: now });
    qNext++;
    addedQuestions++;
    updated.add(qq.topicId);
  }
  for (const id of fresh) updated.delete(id);
  for (const id of updated) byId.get(id).updatedAt = now;

  const gaps = (raw.gaps ?? []).map(str).filter(Boolean);
  if (replaceGaps && Array.isArray(raw.gaps)) mod.gaps = gaps;
  else mod.gaps = [...new Set([...(mod.gaps ?? []), ...gaps])];
  return { module: mod, added: { topics: addedTopics, updated: updated.size, flashcards: addedCards, questions: addedQuestions } };
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
 * Modalità d'esame di un insegnamento trovata online. Vale solo con una citazione dalla pagina (evidence) e un URL
 * effettivamente visto nella ricerca: senza, il formato torna «sconosciuto» (meglio nessuna risposta che una dedotta).
 */
export function normalizeExamFormat(raw, seenUrls = new Set()) {
  const url = seenUrls.has(raw?.url) ? raw.url : "";
  const evidence = str(raw?.evidence).slice(0, 600);
  let format = FORMATS.includes(raw?.format) ? raw.format : "sconosciuto";
  if (!evidence || !url) format = "sconosciuto";
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
