// Esercizi svolti dal docente → esercizi guidati: esempio svolto (con autospiegazione), svolgimento da completare, esercizio da solo.
// È la sequenza degli studi sugli esempi svolti (Sweller; Renkl & Atkinson 2003, «fading»); a chi sa già impostare gli esercizi
// gli esempi servono poco o peggiorano (effetto di inversione dell'esperienza, Kalyuga 2003): si parte dall'esercizio da solo.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Uno svolgimento diviso in passaggi: paragrafi (una riga vuota tra un passaggio e l'altro); una formula a sé resta un passaggio. */
export function splitSteps(text) {
  return String(text ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

/** Tutti i metodi del docente nel modulo, con il loro argomento. */
export const allMethods = (mod) => (mod?.topics ?? []).flatMap((t) => (t.methods ?? []).map((m, i) => ({ ...m, topic: t, index: i })));

/**
 * Che cosa fare negli esercizi guidati di un metodo: l'esercizio da completare e quello da fare da solo (domande «problem»
 * dell'argomento, prima quelle dello stesso metodo, poi le mai fatte o sbagliate) e da dove partire.
 * @returns {{complete: object|null, solo: object|null, expert: boolean, steps: string[]}}
 */
export function guidedPlan(exam, topicId, method) {
  const qs = (exam.module?.questions ?? []).filter((q) => q.topicId === topicId && q.kind === "problem");
  const score = (q) => (exam.qstats[q.id] ? mean(exam.qstats[q.id].recent) : null);
  const rank = (q) => (q.method === method.name ? 0 : q.method ? 2 : 1) + (score(q) == null ? 0 : score(q) < 0.7 ? 0.1 : 0.5);
  const sorted = [...qs].sort((a, b) => rank(a) - rank(b));
  const complete = sorted.find((q) => splitSteps(q.modelAnswer).length >= 3) ?? null;
  const solo = sorted.find((q) => q !== complete) ?? null;
  // già bravo: livello alto, o esercizi di questo argomento riusciti (almeno 2 tentativi, media ≥ 0,75)
  const done = qs.map(score).filter((x) => x != null);
  const expert = exam.level >= 4 || (done.length >= 2 && mean(done) >= 0.75);
  const steps = expert ? ["solo"] : ["example", ...(complete ? ["complete"] : []), "solo"];
  return { complete, solo, expert, steps };
}

/** Nello svolgimento da completare si vedono i primi passaggi (circa metà, almeno uno) e lo studente scrive gli altri. */
export function fade(text) {
  const parts = splitSteps(text);
  const shown = Math.max(1, Math.floor(parts.length / 2));
  return { shown: parts.slice(0, shown), hidden: parts.slice(shown) };
}

/* ------------------------- solo per la modalità demo e le prove ------------------------- */

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const HEAD = /^\s*(?:#{1,4}\s*)?(?:esercizio|es\.|esempio|problema)\s*(?:svolto\s*)?(?:n\.?\s*)?(\d{1,3}[a-z]?)\b[^\n]{0,80}$/gim;

/** Metodi finti (modalità demo): un metodo per esercizio svolto («Esercizio 1 …»), argomento dalle parole del titolo. */
export function demoMethods(text, topics) {
  const s = String(text ?? "");
  const heads = [...s.matchAll(HEAD)];
  const words = topics.map((t) => ({ id: t.id, w: norm(t.title).split(/[^a-z]+/).filter((x) => x.length > 5).map((x) => x.slice(0, 7)) }));
  return heads.map((h, i) => {
    const body = s.slice(h.index + h[0].length, heads[i + 1]?.index ?? s.length).trim();
    const [problem, ...rest] = body.split(/\n\s*\n/);
    const topic = words.find((t) => t.w.some((x) => norm(h[0] + problem).includes(x))) ?? { id: topics[0]?.id };
    return {
      topicId: topic.id,
      method: { name: h[0].trim().replace(/^#{1,4}\s*/, "").replace(/^(esercizio|es\.|esempio|problema)\s*(svolto\s*)?\d+[a-z]?\s*[:.—–-]?\s*/i, "").trim() || `Esercizio ${h[1]}`,
        steps: ["Scrivi i dati e che cosa si chiede.", "Scegli la condizione da usare (come fa il docente).", "Risolvi un passaggio per riga.", "Controlla e interpreta il risultato."],
        problem: problem.trim(), solution: rest.join("\n\n").trim(), source: `Esercizio ${h[1]}` },
    };
  });
}
