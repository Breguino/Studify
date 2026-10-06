import { test } from "node:test";
import assert from "node:assert/strict";
import { nextExam, nextSimulation, sessionOf, weekStrip } from "../public/js/today.js";
import { fmtDayLong, weekdayShort } from "../public/js/dates.js";

test("nextExam: l'appello più vicino da oggi in poi", () => {
  const exams = [{ id: "a", date: "2026-11-09" }, { id: "b", date: "2026-10-01" }, { id: "c", date: "2026-10-27" }, { id: "d", date: "2026-10-27" }];
  assert.equal(nextExam(exams, "2026-10-06").id, "c");
  assert.equal(nextExam(exams, "2026-10-28").id, "a");
  assert.equal(nextExam(exams, "2026-12-01"), null);
  assert.equal(nextExam([], "2026-10-06"), null);
  assert.equal(nextExam([{ id: "x", date: "2026-10-06" }], "2026-10-06").id, "x", "l'esame di oggi conta");
});

test("sessionOf: minuti, fatte e prossima attività", () => {
  const day = { tasks: [
    { id: 1, kind: "flash", minutes: 15 },
    { id: 2, kind: "learn", minutes: 35 },
    { id: 3, kind: "quiz", minutes: 15 },
    { id: 4, kind: "rest", minutes: 0 },
  ] };
  const s = sessionOf(day, (t) => t.id === 1);
  assert.equal(s.tasks.length, 3, "il riposo non è un'attività");
  assert.equal(s.minutes, 65);
  assert.equal(s.doneMinutes, 15);
  assert.equal(s.doneCount, 1);
  assert.equal(s.next.id, 2);
  assert.equal(sessionOf(day, (t) => t.id === 1, (t) => t.id === 3).next.id, 3, "la prossima è la prima che si può aprire");
  assert.equal(sessionOf(day, () => true).next, null, "tutto fatto");
  assert.deepEqual(sessionOf(null, () => false), { tasks: [], minutes: 0, doneMinutes: 0, doneCount: 0, next: null });
});

test("weekStrip: oggi, giorni di studio, giorno libero, appello", () => {
  const plan = { start: "2026-10-06", days: [
    { date: "2026-10-06", phase: "learn", tasks: [{ kind: "learn", minutes: 40 }, { kind: "flash", minutes: 15 }] },
    { date: "2026-10-07", phase: "learn", tasks: [{ kind: "learn", minutes: 70 }] },
    { date: "2026-10-08", phase: "light", tasks: [] },
  ] };
  const w = weekStrip(plan, "2026-10-09", "2026-10-06");
  assert.deepEqual(w.map((d) => d.kind), ["today", "study", "free", "exam"], "si ferma all'appello");
  assert.equal(w[0].minutes, 55);
  assert.equal(w[1].minutes, 70);
  assert.equal(w[0].day, "mar");
  assert.equal(weekStrip(plan, "2026-12-01", "2026-10-06").length, 7);
});

test("weekStrip: prima della finestra di studio", () => {
  const plan = { start: "2026-10-09", days: [{ date: "2026-10-09", phase: "learn", tasks: [{ kind: "learn", minutes: 30 }] }] };
  const w = weekStrip(plan, "2026-10-20", "2026-10-06", 5);
  assert.deepEqual(w.map((d) => d.kind), ["today", "before", "before", "study", "free"]);
});

test("nextSimulation: il primo giorno di simulazione dopo oggi", () => {
  const plan = { days: [
    { date: "2026-10-06", tasks: [{ kind: "mock", title: "oggi" }] },
    { date: "2026-10-10", tasks: [{ kind: "quiz" }] },
    { date: "2026-10-24", tasks: [{ kind: "sim", title: "Simulazione con un tema d'esame vero" }] },
  ] };
  const s = nextSimulation(plan, "2026-10-06");
  assert.equal(s.date, "2026-10-24");
  assert.equal(s.inDays, 18);
  assert.equal(nextSimulation({ days: [] }, "2026-10-06"), null);
});

test("date per esteso", () => {
  assert.equal(fmtDayLong("2026-10-06"), "martedì 6 ottobre");
  assert.equal(fmtDayLong("2026-11-01"), "domenica 1 novembre");
  assert.equal(weekdayShort("2026-10-05"), "lun");
});
