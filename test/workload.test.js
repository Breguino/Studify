import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../public/js/planner.js";
import { feasibility, overlapping, studyStart, windowDays, windowHours } from "../public/js/workload.js";

const T = "2026-10-01";
const topics = Array.from({ length: 6 }, (_, i) => ({ id: `t${i + 1}`, title: `A${i + 1}`, importance: 2, difficulty: 2 }));

test("finestra di studio: una settimana prima dell'esame, mai prima di oggi", () => {
  const exam = { id: "a", date: "2027-01-27", hoursPerDay: 3, studyDays: 7 };
  assert.equal(studyStart(exam, T), "2027-01-20");
  assert.equal(windowDays(exam, T), 7);
  assert.equal(studyStart({ ...exam, studyDays: 0 }, T), T, "0 = da oggi");
  assert.equal(windowDays({ ...exam, studyDays: 0 }, T), 118);
  const soon = { ...exam, date: "2026-10-05" };
  assert.equal(studyStart(soon, T), T, "esame tra 4 giorni con una settimana: si parte da oggi");
  assert.equal(windowDays(soon, T), 4);
});

test("buildPlan con inizio: i giorni sono solo nella finestra, fasi complete", () => {
  const p = buildPlan({ examDate: "2027-01-27", examType: "problemi", level: 2, hoursPerDay: 3, topics, today: T, start: "2027-01-20" });
  assert.equal(p.start, "2027-01-20");
  assert.equal(p.days.length, 7);
  assert.equal(p.days[0].date, "2027-01-20");
  assert.equal(p.days.at(-1).date, "2027-01-26", "ultimo giorno = vigilia");
  assert.equal(p.days.at(-1).phase, "light");
  assert.ok(p.days.some((d) => d.phase === "simulate"));
  const learned = p.days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn").map((t) => t.topicId);
  assert.ok(learned.length > 0);
  // inizio nel passato → oggi
  assert.equal(buildPlan({ examDate: "2026-10-10", examType: "orale", level: 3, hoursPerDay: 2, topics, today: T, start: "2026-09-01" }).days[0].date, T);
});

test("ore disponibili nella finestra: tolte le lezioni giorno per giorno", () => {
  const exam = { id: "a", date: "2026-10-08", hoursPerDay: 3, studyDays: 3 }; // 5, 6, 7 ottobre
  assert.equal(windowHours(exam, T), 9);
  const busy = (d) => (d === "2026-10-06" ? 120 : d === "2026-10-07" ? 400 : 0); // 2 h; più del budget
  assert.equal(windowHours(exam, T, busy), 3 + 1 + 0);
});

test("stima del carico dai CFU: una settimana a 3 h per 9 CFU è poco, otto settimane bastano", () => {
  const week = feasibility({ cfu: 9, available: 21, hoursPerDay: 3 });
  assert.deepEqual([week.low, week.high, week.level], [135, 162, "low"]);
  assert.equal(Math.round(week.share * 100), 16);
  assert.equal(week.daysNeeded, 45);
  assert.equal(feasibility({ cfu: 9, available: 90, hoursPerDay: 3 }).level, "tight");
  assert.equal(feasibility({ cfu: 6, available: 168, hoursPerDay: 3 }).level, "ok");
  assert.equal(feasibility({ cfu: 0, available: 20, hoursPerDay: 3 }), null, "senza CFU nessuna stima");
});

test("esami sovrapposti: giorni in comune tra le finestre", () => {
  const a = { id: "a", date: "2027-01-27", hoursPerDay: 3, studyDays: 7 }; // 20-26 gen
  const b = { id: "b", date: "2027-01-24", hoursPerDay: 2, studyDays: 7 }; // 17-23 gen
  const c = { id: "c", date: "2027-02-10", hoursPerDay: 2, studyDays: 7 }; // 3-9 feb
  const past = { id: "d", date: "2026-09-01", hoursPerDay: 2 };
  const o = overlapping(a, [a, b, c, past], T);
  assert.deepEqual(o.map((x) => [x.exam.id, x.from, x.days]), [["b", "2027-01-20", 4]]);
});
