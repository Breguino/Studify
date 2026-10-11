import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heroPlan, hoursLabel, planSummary } from "../web/landing-plan.js";
import { buildPlan } from "../public/js/planner.js";

const demo = JSON.parse(readFileSync(new URL("../public/demo/module.json", import.meta.url), "utf8"));
const topics = demo.topics;

test("scheda della landing: data dell'esame, fasi e oggi come nel piano dell'app", () => {
  const p = heroPlan({ days: 21, hours: 2, topics, start: "2026-10-11" });
  assert.equal(p.examDate, "2026-11-01");
  assert.equal(p.examLabel, "domenica 1 novembre");
  assert.equal(p.examShort, "dom 1 nov");
  assert.deepEqual(p.phases.map((x) => [x.phase, x.days]), [["learn", 5], ["consolidate", 12], ["simulate", 3], ["light", 1]]);
  assert.equal(p.phases.reduce((s, x) => s + x.days, 0), 21, "le fasi coprono tutti i giorni");
  const app = buildPlan({ examDate: "2026-11-01", examType: "misto", level: 2, hoursPerDay: 2, topics, today: "2026-10-11" });
  assert.equal(p.today.minutes, app.days[0].minutes, "i minuti di oggi sono quelli dell'app");
  assert.ok(p.today.tasks.length >= 1 && p.today.tasks.every((t) => t.kind !== "rest"));
  assert.deepEqual(p.week.map((d) => d.label), ["oggi", "lun", "mar", "mer", "gio", "ven"]);
  assert.ok(p.week.every((d) => !d.exam));
});

test("scheda della landing: esame vicino, la settimana si ferma all'esame", () => {
  const p = heroPlan({ days: 5, hours: 1, topics, start: "2026-10-11" });
  assert.deepEqual(p.week.map((d) => d.exam), [false, false, false, false, false, true]);
  assert.equal(p.week.at(-1).date, "2026-10-16");
  assert.ok(p.phases.every((x) => x.days > 0), "niente fasi da 0 giorni");
});

test("scheda della landing: più ore al giorno, sessione di oggi non più corta", () => {
  const a = heroPlan({ days: 30, hours: 1, topics, start: "2026-10-11" });
  const b = heroPlan({ days: 30, hours: 3, topics, start: "2026-10-11" });
  assert.ok(b.today.minutes >= a.today.minutes);
  assert.ok(a.today.minutes <= 60, "con un'ora al giorno, oggi non più di un'ora");
});

test("scheda della landing: testi", () => {
  assert.equal(hoursLabel(1), "1 ora");
  assert.equal(hoursLabel(1.5), "1,5 ore");
  const p = heroPlan({ days: 21, hours: 2, topics, start: "2026-10-11" });
  assert.match(planSummary(p, 21, 2), /^Esame domenica 1 novembre, tra 21 giorni, 2 ore al giorno: comprensione 5 giorni, .*ripasso leggero 1 giorno\. Oggi \d+ minuti\.$/);
});
