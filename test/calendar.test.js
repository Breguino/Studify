import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarSnapshot, calendarStale, escapeText, foldLine, icsFilename, parseTime, planToIcs } from "../public/js/calendar.js";

const exam = { id: "e1", name: "Microeconomia, parte 1", date: "2026-11-01" };
const days = [
  { date: "2026-10-12", minutes: 50, tasks: [{ kind: "flash", title: "Flashcard", minutes: 15 }] }, // ieri: fuori
  { date: "2026-10-13", minutes: 50, tasks: [{ kind: "flash", title: "Flashcard del giorno", minutes: 15 }, { kind: "learn", title: "Studia: Elasticità", minutes: 35 }] },
  { date: "2026-10-14", minutes: 0, tasks: [] }, // giorno libero: niente evento
  { date: "2026-10-31", minutes: 30, tasks: [{ kind: "quiz", title: "Ripasso leggero", minutes: 30 }, { kind: "rest", title: "Dormi bene", minutes: 0 }] },
];
const now = new Date("2026-10-13T08:00:00Z");

test("calendario: una sessione per giorno di studio da oggi, più l'appello", () => {
  const { ics, sessions } = planToIcs({ exam, days, today: "2026-10-13", time: "18:30", alarm: 10, url: "https://studify.example/app", now });
  assert.equal(sessions, 2);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3, "due sessioni e l'appello");
  assert.match(ics, /DTSTART:20261013T183000\r\nDURATION:PT50M/);
  assert.match(ics, /DTSTART:20261031T183000\r\nDURATION:PT30M/);
  assert.doesNotMatch(ics, /20261012T/, "i giorni passati restano fuori");
  assert.doesNotMatch(ics, /20261014T/, "i giorni senza studio restano fuori");
  assert.match(ics, /TRIGGER:-PT10M/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102/);
  assert.match(ics, /UID:e1-2026-10-13@studify/);
  assert.match(ics, /DTSTAMP:20261013T080000Z/);
  assert.doesNotMatch(ics, /Dormi bene/, "il riposo non è un'attività");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "righe di al massimo 75 byte");
});

test("calendario: testo protetto e righe piegate senza spezzare i caratteri", () => {
  assert.equal(escapeText("a, b; c\\d\ne"), "a\\, b\\; c\\\\d\\ne");
  const long = `DESCRIPTION:${"è".repeat(60)}`;
  const folded = foldLine(long);
  assert.ok(folded.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
  assert.equal(folded.replace(/\r\n /g, ""), long, "ricomposta è uguale");
});

test("calendario: orario e nome del file", () => {
  assert.deepEqual(parseTime("7:05"), [7, 5]);
  assert.deepEqual(parseTime("25:00"), [18, 0]);
  assert.deepEqual(parseTime(""), [18, 0]);
  assert.equal(icsFilename("Microeconomia (demo)"), "studify-microeconomia-demo.ics");
  assert.equal(icsFilename("Ànalisi I"), "studify-analisi-i.ics");
});

test("calendario: riscaricato, aggiorna gli eventi e annulla i giorni che non ci sono più", () => {
  const { ics } = planToIcs({ exam, days, today: "2026-10-13", sequence: 2, cancel: ["2026-10-13", "2026-10-20"], now });
  assert.equal((ics.match(/SEQUENCE:2/g) ?? []).length, 4, "le due sessioni, l'appello e il giorno annullato");
  assert.match(ics, /UID:e1-2026-10-20@studify\r\nDTSTAMP:[^\r]+\r\nSEQUENCE:2\r\nDTSTART:20261020T180000\r\nDURATION:PT30M\r\n[^]*?STATUS:CANCELLED/, "il 20 non è più nel piano: annullato");
  assert.equal((ics.match(/STATUS:CANCELLED/g) ?? []).length, 1, "il 13 c'è ancora: non si annulla");
});

test("calendario: si accorge quando il piano cambia dopo il download", () => {
  const snap = calendarSnapshot({ exam, days, today: "2026-10-13", time: "18:00" });
  assert.deepEqual(snap.days, { "2026-10-13": 50, "2026-10-31": 30 });
  const same = { exam, days, today: "2026-10-13", time: "18:00" };
  assert.equal(calendarStale(snap, same), false);
  assert.equal(calendarStale(snap, { ...same, today: "2026-10-14" }), false, "un giorno che passa non è un cambio");
  assert.equal(calendarStale(snap, { ...same, time: "7:30" }), true, "ora diversa");
  assert.equal(calendarStale(snap, { ...same, exam: { ...exam, date: "2026-11-05" } }), true, "data dell'esame spostata");
  assert.equal(calendarStale(snap, { ...same, days: days.map((d) => (d.date === "2026-10-31" ? { ...d, minutes: 45 } : d)) }), true, "minuti diversi");
  assert.equal(calendarStale(snap, { ...same, days: [...days, { date: "2026-10-20", minutes: 40, tasks: [] }] }), true, "giorno nuovo");
  assert.equal(calendarStale(null, same), false, "mai scaricato: niente avviso");
});
