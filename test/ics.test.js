import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandRule, guessIcsKind, icsRows, isIcsText, parseIcs, shortRoom, titleCase, unfold, utcToLocal, wallToUtc } from "../public/js/ics.js";
import { CANON_HEADERS, autoMap, buildTimetable, detectKind, tableFrom } from "../public/js/importers.js";
import { busyMinutes, lessonsOn, overlaps } from "../public/js/timetable.js";

const fixture = readFileSync(new URL("./fixtures/calendario-lezioni.ics", import.meta.url), "utf8");
const ev = (lines) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${lines}END:VCALENDAR\r\n`;
const vevent = (props) => `BEGIN:VEVENT\r\n${Object.entries(props).map(([k, v]) => `${k}:${v}`).join("\r\n")}\r\nEND:VEVENT\r\n`;

test("ics: righe ripiegate, riconoscimento del formato", () => {
  assert.equal(unfold("A:uno\r\n due\r\nB:x\n\ty"), "A:unodue\r\nB:xy");
  assert.ok(isIcsText("BEGIN:VCALENDAR\r\n..."));
  assert.ok(isIcsText("﻿BEGIN:VCALENDAR"));
  assert.ok(!isIcsText("Insegnamento;Data"));
});

test("ics: fusi orari — UTC → Europe/Rome con ora legale e cambio d'ora del 25/10/2026", () => {
  assert.deepEqual(utcToLocal(Date.UTC(2026, 9, 1, 7, 0)), { date: "2026-10-01", time: "09:00" }, "CEST (+2)");
  assert.deepEqual(utcToLocal(Date.UTC(2026, 9, 26, 8, 0)), { date: "2026-10-26", time: "09:00" }, "CET (+1): stessa ora locale, un'ora UTC dopo");
  assert.deepEqual(utcToLocal(Date.UTC(2026, 9, 31, 23, 30)), { date: "2026-11-01", time: "00:30" }, "a cavallo della mezzanotte");
  assert.equal(wallToUtc(2026, 10, 1, 9, 0), Date.UTC(2026, 9, 1, 7, 0));
  assert.equal(wallToUtc(2026, 11, 2, 9, 0), Date.UTC(2026, 10, 2, 8, 0));
  assert.equal(wallToUtc(2026, 10, 1, 9, 0, "UTC"), Date.UTC(2026, 9, 1, 9, 0));
});

test("ics: nomi e luoghi leggibili", () => {
  assert.equal(titleCase("ECONOMIA POLITICA II"), "Economia politica II");
  assert.equal(titleCase("BUSINESS ENGLISH (B2)"), "Business english (B2)");
  assert.equal(titleCase("ABILITÀ INFORMATICHE"), "Abilità informatiche");
  assert.equal(titleCase("Analisi Matematica"), "Analisi Matematica", "già in maiuscole/minuscole miste: invariato");
  assert.equal(shortRoom("Aula 'Livia Dancelli' - C.da S. Chiara 50 - Contrada Santa Chiara - 50 - Brescia"), "Aula 'Livia Dancelli'");
  assert.equal(shortRoom(""), "");
  assert.equal(shortRoom("LAB INF. 1 - Via Branze 38"), "LAB INF. 1");
});

test("ics: estratto reale anonimizzato (CINECA, orari UTC, righe ripiegate)", () => {
  for (const text of [fixture, fixture.replace(/\n/g, "\r\n")]) {
    const { events, stats } = parseIcs(text);
    assert.equal(stats.total, 16);
    assert.equal(events.length, 16);
    const first = events[0];
    assert.deepEqual([first.date, first.start, first.end, first.title], ["2026-10-01", "09:00", "11:15", "Matematica generale"]);
    assert.equal(first.room, "Aula 'Livia Dancelli'");
    assert.ok(first.location.includes("Brescia"), "luogo completo ripiegato su più righe riunito");
    const around = events.filter((e) => e.date >= "2026-10-24" && e.date <= "2026-10-27");
    assert.ok(around.length >= 3);
    assert.ok(around.every((e) => ["09:00", "11:15", "14:30", "16:45", "19:00"].includes(e.start)), `orari locali stabili a cavallo del cambio d'ora: ${around.map((e) => e.start)}`);
    assert.ok(events.every((e) => e.description === "DOCENTE"));
  }
});

test("ics: eventi annullati, tutto il giorno e senza fine ignorati; durata al posto di DTEND; TZID", () => {
  const text = ev(
    vevent({ UID: "a", DTSTART: "20261005T090000Z", DTEND: "20261005T110000Z", SUMMARY: "Lezione A" }) +
    vevent({ UID: "b", DTSTART: "20261005T090000Z", DTEND: "20261005T110000Z", SUMMARY: "Annullata", STATUS: "CANCELLED" }) +
    vevent({ UID: "c", "DTSTART;VALUE=DATE": "20261006", SUMMARY: "Festa" }) +
    vevent({ UID: "d", DTSTART: "20261007T090000Z", SUMMARY: "Senza fine" }) +
    vevent({ UID: "e", DTSTART: "20261008T090000Z", DURATION: "PT1H30M", SUMMARY: "Con durata" }) +
    vevent({ UID: "f", "DTSTART;TZID=Europe/Rome": "20261009T140000", "DTEND;TZID=Europe/Rome": "20261009T153000", SUMMARY: "Ora locale" }) +
    vevent({ UID: "g", "DTSTART;TZID=America/New_York": "20261009T080000", "DTEND;TZID=America/New_York": "20261009T090000", SUMMARY: "New York" }) +
    vevent({ UID: "h", DTSTART: "20261012T090000", DTEND: "20261012T100000", SUMMARY: "Flottante\\, con virgola" }),
  );
  const { events, stats } = parseIcs(text);
  assert.deepEqual([stats.cancelled, stats.allDay, stats.noEnd], [1, 1, 1]);
  const by = (t) => events.find((e) => e.summary === t);
  assert.deepEqual([by("Lezione A").start, by("Lezione A").end], ["11:00", "13:00"], "UTC → ora di Roma");
  assert.deepEqual([by("Con durata").start, by("Con durata").end], ["11:00", "12:30"]);
  assert.deepEqual([by("Ora locale").start, by("Ora locale").end], ["14:00", "15:30"], "TZID Roma: già ora locale");
  assert.equal(by("New York").start, "14:00", "08:00 a New York (EDT) = 14:00 a Roma");
  assert.equal(by("Flottante, con virgola").start, "09:00", "orario flottante = locale; \\, → virgola");
  assert.ok(!by("Annullata") && !by("Festa") && !by("Senza fine"));
});

test("ics: ricorrenze settimanali con BYDAY, INTERVAL, COUNT, UNTIL, EXDATE e modifica di una singola data", () => {
  assert.deepEqual(expandRule("FREQ=WEEKLY;COUNT=3", "2026-10-05"), ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.deepEqual(expandRule("FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261015T000000Z", "2026-10-05"), ["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
  assert.deepEqual(expandRule("FREQ=WEEKLY;INTERVAL=2;COUNT=3", "2026-10-05"), ["2026-10-05", "2026-10-19", "2026-11-02"]);
  assert.deepEqual(expandRule("FREQ=DAILY;COUNT=3", "2026-10-30"), ["2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.deepEqual(expandRule("FREQ=MONTHLY;COUNT=5", "2026-10-05"), ["2026-10-05"], "mensili: solo la prima");
  assert.equal(expandRule("FREQ=WEEKLY", "2026-10-05").length, 105, "senza fine: al massimo due anni");

  const text = ev(
    vevent({ UID: "r", DTSTART: "20261005T070000Z", DTEND: "20261005T091500Z", RRULE: "FREQ=WEEKLY;BYDAY=MO;COUNT=4", EXDATE: "20261012T070000Z", SUMMARY: "RICORRENTE" }) +
    vevent({ UID: "r", "RECURRENCE-ID": "20261019T070000Z", DTSTART: "20261019T120000Z", DTEND: "20261019T141500Z", SUMMARY: "RICORRENTE" }),
  );
  const { events } = parseIcs(text);
  assert.deepEqual(events.map((e) => `${e.date} ${e.start}`), ["2026-10-05 09:00", "2026-10-19 14:00", "2026-10-26 09:00"].sort().map((x) => x), "12/10 escluso (EXDATE); 19/10 spostato alle 14:00 (stessa data, ora diversa)");
});

test("ics: ricorrenza a cavallo del cambio d'ora mantiene l'ora locale (09:00 prima e dopo)", () => {
  const { events } = parseIcs(ev(vevent({ UID: "w", DTSTART: "20261019T070000Z", DTEND: "20261019T091500Z", RRULE: "FREQ=WEEKLY;COUNT=3", SUMMARY: "S" })));
  assert.deepEqual(events.map((e) => [e.date, e.start, e.end]), [["2026-10-19", "09:00", "11:15"], ["2026-10-26", "09:00", "11:15"], ["2026-11-02", "09:00", "11:15"]]);
});

test("ics: da eventi a righe canoniche e importazione come orario", () => {
  const { events } = parseIcs(fixture);
  assert.equal(guessIcsKind(events), "orari");
  assert.equal(guessIcsKind(parseIcs(ev(vevent({ UID: "x", DTSTART: "20261201T080000Z", DTEND: "20261201T100000Z", SUMMARY: "Esame di Analisi - appello" }))).events), "esami");
  const rows = icsRows(events, "orari", CANON_HEADERS.orari);
  assert.deepEqual(rows[0], CANON_HEADERS.orari);
  assert.deepEqual(rows[1], ["Matematica generale", "01/10/2026", "09:00", "11:15", "Aula 'Livia Dancelli'"]);
  const { headers, data, firstRow } = tableFrom(rows, true, 0);
  assert.equal(detectKind(headers, data.slice(0, 20)).kind, "orari");
  const r = buildTimetable(data, autoMap("orari", headers), { today: "2026-10-01" }, firstRow);
  assert.equal(r.errors.length, 0);
  assert.equal(r.items.length, 16);
  assert.deepEqual(r.items[0], { course: "Matematica generale", date: "2026-10-01", start: "09:00", end: "11:15", room: "Aula 'Livia Dancelli'" });
  assert.ok(r.courses.length >= 5);
  const as = icsRows(events, "esami", CANON_HEADERS.esami);
  assert.equal(as[0].length, as[1].length);
  const names = icsRows(events, "insegnamenti", CANON_HEADERS.insegnamenti);
  assert.equal(new Set(names.slice(1).map((r) => r[0])).size, names.length - 1, "un insegnamento una volta sola");
});

test("orario: lezioni sovrapposte non si sottraggono due volte", () => {
  const tt = { items: [
    { course: "A", date: "2026-10-05", start: "09:00", end: "11:15", room: "" },
    { course: "B", date: "2026-10-05", start: "09:00", end: "11:15", room: "" },
    { course: "C", date: "2026-10-05", start: "10:00", end: "12:00", room: "" },
    { course: "D", date: "2026-10-05", start: "14:30", end: "16:45", room: "" },
  ] };
  assert.equal(lessonsOn(tt, "2026-10-05").length, 4);
  assert.equal(busyMinutes(tt, "2026-10-05"), 180 + 135, "09:00–12:00 unite + 14:30–16:45");
  assert.equal(busyMinutes({ items: [] }, "2026-10-05"), 0);
});

test("orario: sovrapposizioni tra insegnamenti diversi segnalate, stesso insegnamento e voci settimanali no", () => {
  const items = [
    { course: "Matematica II", date: "2026-10-02", start: "09:00", end: "11:15", room: "" },
    { course: "Economia politica II", date: "2026-10-02", start: "11:00", end: "13:00", room: "" },
    { course: "Statistica", date: "2026-10-02", start: "14:30", end: "16:45", room: "" },
    { course: "Statistica", date: "2026-10-02", start: "15:00", end: "17:00", room: "" },
    { course: "X", weekday: 1, start: "09:00", end: "11:00", room: "" },
    { course: "Y", weekday: 1, start: "09:00", end: "11:00", room: "" },
  ];
  const ov = overlaps(items);
  assert.equal(ov.length, 1);
  assert.deepEqual([ov[0].a.course, ov[0].b.course, ov[0].date], ["Matematica II", "Economia politica II", "2026-10-02"]);
  assert.equal(overlaps([]).length, 0);
});
