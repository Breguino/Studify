// Normalizzazione dei dati generati dall'AI. Nessuna dipendenza: gira sia sul server sia nel browser
// (la versione pubblicata come pagina Claude la usa senza zod).
export const FORMATS = ["scritto", "orale", "test", "problemi", "misto", "sconosciuto"];
// obbligatorio = previsto dal piano; a_scelta = a scelta dello studente (tipico del 3° anno); sconosciuto = non indicato
export const KINDS = ["obbligatorio", "a_scelta", "sconosciuto"];
export const LEVELS = ["L", "LM", "LMCU", ""];

const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);
const str = (s) => (typeof s === "string" ? s.trim() : "");

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
    topics.push({
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
  }
  const flashcards = [];
  for (const c of raw.flashcards ?? []) {
    const topicId = idMap.get(c.topicId);
    if (!topicId || !str(c.front) || !str(c.back)) continue;
    flashcards.push({ id: `c${flashcards.length + 1}`, topicId, front: str(c.front), back: str(c.back), type: c.type });
  }
  const questions = [];
  for (const q of raw.questions ?? []) {
    const topicId = idMap.get(q.topicId);
    if (!topicId || !str(q.prompt)) continue;
    const options = (q.options ?? []).map(str).filter(Boolean);
    const correctIndex = Math.round(q.correctIndex);
    if (q.kind === "mcq" && (options.length < 2 || !(correctIndex >= 0 && correctIndex < options.length))) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      topicId,
      kind: q.kind,
      prompt: str(q.prompt),
      options: q.kind === "mcq" ? options : [],
      correctIndex: q.kind === "mcq" ? correctIndex : -1,
      modelAnswer: str(q.modelAnswer),
      explanation: str(q.explanation),
      rubric: (q.rubric ?? []).map(str).filter(Boolean),
    });
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
