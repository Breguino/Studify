// Ripetizione dilazionata (variante semplificata di SM-2), consapevole della data d'esame:
// nessuna carta viene programmata oltre il giorno prima dell'esame.
import { addDays, daysBetween } from "./dates.js";

export const GRADES = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

export const newState = () => ({ ease: 2.5, interval: 0, reps: 0, lapses: 0, due: null });

/** Prossimo intervallo (giorni) senza modificare lo stato: serve per l'anteprima sui pulsanti. */
export function nextInterval(state, grade) {
  const s = state ?? newState();
  switch (grade) {
    case GRADES.AGAIN:
      return 1;
    case GRADES.HARD:
      return Math.max(1, Math.round((s.interval || 1) * 1.2));
    case GRADES.GOOD:
      return s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.interval + 1, Math.round(s.interval * s.ease));
    default:
      return s.reps === 0 ? 3 : s.reps === 1 ? 6 : Math.max(s.interval + 2, Math.round(s.interval * s.ease * 1.3));
  }
}

/** Limita la scadenza al giorno prima dell'esame (o a oggi se manca ≤1 giorno). */
export function capDue(due, today, examDate) {
  if (!examDate) return due;
  const latest = daysBetween(today, examDate) <= 1 ? today : addDays(examDate, -1);
  return due > latest ? latest : due;
}

export function review(state, grade, today, examDate) {
  const s = { ...(state ?? newState()) };
  const interval = nextInterval(s, grade);
  if (grade === GRADES.AGAIN) {
    s.reps = 0;
    s.lapses += 1;
    s.ease = Math.max(1.3, s.ease - 0.2);
  } else if (grade === GRADES.HARD) {
    s.ease = Math.max(1.3, s.ease - 0.15);
    s.reps += 1;
  } else if (grade === GRADES.GOOD) {
    s.reps += 1;
  } else {
    s.ease = Math.min(3.0, s.ease + 0.15);
    s.reps += 1;
  }
  s.interval = interval;
  s.due = capDue(addDays(today, interval), today, examDate);
  s.last = today;
  return s;
}

export const isNew = (state) => !state || state.due == null;
export const isDue = (state, today) => !!state && state.due != null && state.due <= today;

/** Carte "mature": le riconosci stabilmente (intervallo ≥ 3 giorni, nessuna ricaduta recente). */
export const isMature = (state) => !!state && state.reps >= 2 && state.interval >= 3;

/** Quante carte nuove introdurre oggi per riuscire a vederle tutte prima dell'esame. */
export function dailyNewLimit(newCount, daysLeft, { min = 5, max = 40 } = {}) {
  if (newCount <= 0) return 0;
  const days = Math.max(1, daysLeft - 1);
  return Math.min(newCount, Math.min(max, Math.max(min, Math.ceil(newCount / days))));
}

/**
 * Coda di studio: prima le scadute (le più in ritardo per prime), poi le nuove.
 * Le nuove sono ordinate per importanza dell'argomento (poi ordine originale).
 */
export function buildQueue(cards, states, today, { newLimit = 10, topicImportance = {} } = {}) {
  const due = cards
    .filter((c) => isDue(states[c.id], today))
    .sort((a, b) => states[a.id].due.localeCompare(states[b.id].due));
  const fresh = cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => isNew(states[c.id]))
    .sort((a, b) => (topicImportance[b.c.topicId] ?? 2) - (topicImportance[a.c.topicId] ?? 2) || a.i - b.i)
    .slice(0, newLimit)
    .map(({ c }) => c);
  return { due, fresh, queue: [...due, ...fresh] };
}
