// Cosa mostrare di un esame «oggi»: il prossimo appello, la sessione del giorno, la settimana. Funzioni pure.
import { addDays, daysBetween, weekdayShort } from "./dates.js";

/** L'esame con l'appello più vicino da oggi in poi (a parità di data, il primo in elenco); null se non ce ne sono. */
export function nextExam(exams, today) {
  return [...exams].filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

/**
 * La sessione di un giorno del piano: minuti previsti e fatti, attività fatte, la prossima da fare.
 * `isDone(task)` dice se un'attività è fatta; `canStart(task)` se ha una pagina da aprire (le preferite come «prossima»).
 */
export function sessionOf(day, isDone, canStart = () => true) {
  const tasks = (day?.tasks ?? []).filter((t) => t.kind !== "rest");
  const done = tasks.filter(isDone);
  const todo = tasks.filter((t) => !isDone(t));
  return {
    tasks,
    minutes: tasks.reduce((s, t) => s + (t.minutes || 0), 0),
    doneMinutes: done.reduce((s, t) => s + (t.minutes || 0), 0),
    doneCount: done.length,
    next: todo.find(canStart) ?? todo[0] ?? null,
  };
}

/**
 * I prossimi `n` giorni a partire da oggi, per la striscia della settimana:
 * kind = "today" | "study" (con minuti) | "free" (nessuna attività) | "exam" (il giorno dell'appello) | "before" (la finestra di studio non è iniziata).
 */
export function weekStrip(plan, examDate, today, n = 7) {
  const byDate = new Map((plan?.days ?? []).map((d) => [d.date, d]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i);
    if (date > examDate) break;
    const d = byDate.get(date);
    const minutes = d ? d.tasks.filter((t) => t.kind !== "rest").reduce((s, t) => s + (t.minutes || 0), 0) : 0;
    const kind = date === examDate ? "exam" : i === 0 ? "today" : d ? (minutes ? "study" : "free") : plan?.start && date < plan.start ? "before" : "free";
    out.push({ date, day: weekdayShort(date), kind, minutes, phase: d?.phase ?? null });
  }
  return out;
}

/** Il primo giorno di simulazione d'esame ancora davanti (dopo oggi), con l'attività. */
export function nextSimulation(plan, today) {
  for (const d of plan?.days ?? []) {
    if (d.date <= today) continue;
    const t = d.tasks.find((x) => x.kind === "mock" || x.kind === "sim");
    if (t) return { date: d.date, task: t, inDays: daysBetween(today, d.date) };
  }
  return null;
}
