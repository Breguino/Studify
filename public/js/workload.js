// Finestra di studio («mi do una settimana») e stima di quanto tempo serve rispetto a quello che c'è.
import { addDays, daysBetween } from "./dates.js";

/** Primo giorno di studio: oggi, oppure `studyDays` giorni prima dell'esame se è più tardi. */
export function studyStart(exam, today) {
  if (!exam.studyDays) return today;
  const s = addDays(exam.date, -exam.studyDays);
  return s > today ? s : today;
}

/** Giorni di studio nella finestra (dal primo giorno al giorno prima dell'esame). */
export const windowDays = (exam, today) => Math.max(0, daysBetween(studyStart(exam, today), exam.date));

/** Ore di studio disponibili nella finestra: ore al giorno meno le lezioni, giorno per giorno. */
export function windowHours(exam, today, busy = () => 0) {
  const start = studyStart(exam, today);
  const budget = Math.round((exam.hoursPerDay || 0) * 60);
  let min = 0;
  for (let i = 0, n = daysBetween(start, exam.date); i < n; i++) min += Math.max(0, budget - busy(addDays(start, i)));
  return min / 60;
}

/*
 * Carico nominale: per legge 1 CFU = 25 ore di lavoro complessivo dello studente, lezioni comprese (DM 270/2004).
 * Le ore di lezione per CFU variano (di solito 7-10): lo studio individuale è quindi circa 15-18 ore per CFU.
 * È un ordine di grandezza per chi parte da zero, non una misura: chi ha studiato durante il semestre ne usa meno.
 */
export const HOURS_PER_CFU = { total: 25, studyLow: 15, studyHigh: 18 };

/**
 * @returns {null | {available:number, low:number, high:number, share:number, level:"ok"|"tight"|"low", daysNeeded:number}}
 *   share = ore disponibili / stima bassa; daysNeeded = giorni alle ore indicate per arrivare alla stima bassa.
 */
export function feasibility({ cfu, available, hoursPerDay }) {
  if (!cfu || !(available >= 0)) return null;
  const low = cfu * HOURS_PER_CFU.studyLow;
  const high = cfu * HOURS_PER_CFU.studyHigh;
  const share = available / low;
  return {
    available, low, high, share,
    level: share >= 0.9 ? "ok" : share >= 0.5 ? "tight" : "low",
    daysNeeded: hoursPerDay > 0 ? Math.ceil(low / hoursPerDay) : Infinity,
  };
}

/** Altri esami con la finestra di studio che si sovrappone a questa: nei giorni comuni le ore si sommano. */
export function overlapping(exam, exams, today) {
  const s = studyStart(exam, today);
  return exams
    .filter((e) => e.id !== exam.id && e.date > today)
    .map((e) => {
      const s2 = studyStart(e, today);
      const from = s > s2 ? s : s2;
      const to = exam.date < e.date ? exam.date : e.date; // escluso
      return { exam: e, from, days: Math.max(0, daysBetween(from, to)) };
    })
    .filter((o) => o.days > 0);
}
