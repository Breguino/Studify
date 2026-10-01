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

/** Minuti occupati in un giorno: l'unione degli intervalli, così due lezioni sovrapposte non si sottraggono due volte. */
export function busyMinutes(tt, date) {
  const iv = lessonsOn(tt, date)
    .map((l) => [minutesBetween("00:00", l.start), minutesBetween("00:00", l.end)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curEnd = -Infinity;
  let curStart = 0;
  for (const [a, b] of iv) {
    if (a > curEnd) { if (curEnd > -Infinity) total += curEnd - curStart; curStart = a; curEnd = b; }
    else curEnd = Math.max(curEnd, b);
  }
  return curEnd > -Infinity ? total + curEnd - curStart : 0;
}

export const fmtLesson = (l) => `${l.start}–${l.end}${l.course ? ` ${l.course}` : ""}${l.room ? ` (${l.room})` : ""}`;

/** Lezioni di insegnamenti diversi che si sovrappongono nello stesso giorno: [{date, a, b}] (un elemento per coppia). */
export function overlaps(items) {
  const byDate = new Map();
  for (const l of items) {
    if (!l.date) continue; // le voci settimanali si confrontano per giorno della settimana: qui servono solo le datate
    byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  }
  const out = [];
  for (const [date, list] of [...byDate].sort(([x], [y]) => x.localeCompare(y))) {
    const l = [...list].sort((p, q) => p.start.localeCompare(q.start));
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length && l[j].start < l[i].end; j++) if (l[i].course !== l[j].course) out.push({ date, a: l[i], b: l[j] });
  }
  return out;
}
