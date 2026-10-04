// Statistiche di padronanza, selezione domande e stima di preparazione.
import { isMature } from "./srs.js";

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Registra l'esito (0..1) di una domanda / spiegazione. Mantiene gli ultimi 5 esiti. */
export function recordScore(qstats, key, score) {
  const prev = qstats[key] ?? { n: 0, recent: [] };
  return { ...qstats, [key]: { n: prev.n + 1, recent: [...prev.recent, score].slice(-5), last: score } };
}

export function topicStats(module, srs, qstats, learned = {}) {
  const out = {};
  for (const t of module.topics) {
    const cards = module.flashcards.filter((c) => c.topicId === t.id);
    const qs = module.questions.filter((q) => q.topicId === t.id);
    const mature = cards.filter((c) => isMature(srs[c.id])).length;
    const seen = cards.filter((c) => srs[c.id]?.due).length;
    const results = [];
    for (const q of qs) if (qstats[q.id]) results.push(mean(qstats[q.id].recent));
    const ex = qstats[`x:${t.id}`];
    if (ex) results.push(mean(ex.recent));
    const sim = qstats[`s:${t.id}`]; // esercizi su questo argomento nelle simulazioni d'esame
    if (sim) results.push(mean(sim.recent));
    const expected = qs.length + 1; // domande + spiegazione
    const quiz = results.length ? mean(results) * Math.min(1, results.length / Math.min(3, expected)) : null;
    const cardScore = cards.length ? mature / cards.length : null;
    let score = null;
    if (cardScore != null && quiz != null) score = 0.5 * cardScore + 0.5 * quiz;
    else if (cardScore != null && seen > 0) score = cardScore;
    else if (quiz != null) score = quiz;
    out[t.id] = { cards: cards.length, seen, mature, attempted: results.length, quiz, score, learned: !!learned[t.id] };
  }
  return out;
}

/** Stima 0..1 pesata per importanza. `null` se non c'è ancora nessun dato. */
export function readiness(module, stats) {
  let num = 0;
  let den = 0;
  let any = false;
  for (const t of module.topics) {
    const s = stats[t.id]?.score;
    if (s != null) any = true;
    num += (s ?? 0) * t.importance;
    den += t.importance;
  }
  return any && den ? num / den : null;
}

/** Argomenti dove c'è più da guadagnare: lacuna (1 - punteggio, 0 se mai toccato) pesata per importanza. */
export function weakTopics(module, stats, n = 3) {
  return module.topics
    .map((t, i) => ({ t, i, gap: (1 - (stats[t.id]?.score ?? 0)) * t.importance }))
    .sort((a, b) => b.gap - a.gap || a.i - b.i)
    .slice(0, n)
    .map((x) => x.t);
}

/**
 * Seleziona n domande: prima gli errori recenti, poi le mai viste, poi le meglio riuscite.
 * Interleaving: l'ordine alterna gli argomenti (a meno di blocked=true).
 */
export function pickQuestions(questions, qstats, n, { topicIds, kind, weakOnly = false, blocked = false, rng = Math.random } = {}) {
  let pool = questions.filter((q) => (!topicIds || topicIds.includes(q.topicId)) && (!kind || q.kind === kind));
  if (weakOnly) pool = pool.filter((q) => qstats[q.id] && mean(qstats[q.id].recent) < 0.7);
  const prio = (q) => {
    const st = qstats[q.id];
    if (!st) return 2; // mai vista
    return mean(st.recent) < 0.7 ? 3 : 1 - mean(st.recent); // errata > nuova > ben riuscita
  };
  const sorted = pool.map((q) => ({ q, p: prio(q) + rng() * 0.01 })).sort((a, b) => b.p - a.p).slice(0, n).map((x) => x.q);
  if (blocked) return sorted.sort((a, b) => a.topicId.localeCompare(b.topicId));
  const groups = new Map();
  for (const q of sorted) (groups.get(q.topicId) ?? groups.set(q.topicId, []).get(q.topicId)).push(q);
  const lists = [...groups.values()];
  const out = [];
  while (out.length < sorted.length) for (const l of lists) if (l.length) out.push(l.shift());
  return out;
}
