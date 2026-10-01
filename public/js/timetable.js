// Orario delle lezioni: voci settimanali ({weekday: 1..7}) o in data precisa ({date}).
import { minutesBetween, weekdayOf } from "./tabular.js";

/** Lezioni di un giorno, in ordine di orario. Le voci settimanali valgono fino a `tt.until` (se indicato). */
export function lessonsOn(tt, date) {
  if (!tt?.items?.length) return [];
  const wd = weekdayOf(date);
  const weekly = !tt.until || date <= tt.until;
  return tt.items
    .filter((l) => (l.date ? l.date === date : weekly && l.weekday === wd))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const busyMinutes = (tt, date) => lessonsOn(tt, date).reduce((s, l) => s + Math.max(0, minutesBetween(l.start, l.end)), 0);

export const fmtLesson = (l) => `${l.start}–${l.end}${l.course ? ` ${l.course}` : ""}${l.room ? ` (${l.room})` : ""}`;
