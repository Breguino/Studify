import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHeaderRow, BUILDERS, SCHEMAS, TEMPLATES, autoMap, buildCourses, buildExams, buildTimetable, detectKind, looksLikeHeader, parseExamType, parseKind, parseYear, tableFrom } from "../public/js/importers.js";
import { readXlsx, parseDelimited } from "../public/js/tabular.js";
import { busyMinutes, lessonsOn } from "../public/js/timetable.js";
import { CANON_HEADERS } from "../public/js/importers.js";
import { IMPORT_HEADERS } from "../shared/prompts.js";

const TODAY = "2026-10-01";
const fx = (n) => { const b = readFileSync(new URL(`./fixtures/${n}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test("colonne: riconoscimento per sinonimi, una colonna non è assegnata due volte", () => {
  const h = ["Attività didattica", "Data appello", "Ora", "Aula", "Tipo prova", "CFU", "Anno di corso"];
  assert.deepEqual(autoMap("esami", h), { name: 0, date: 1, time: 2, room: 3, type: 4, cfu: 5, year: 6 });
  const h2 = ["Esame", "Data", "Orario", "Sede"];
  const m = autoMap("esami", h2);
  assert.equal(m.name, 0); assert.equal(m.date, 1); assert.equal(m.time, 2); assert.equal(m.room, 3); assert.equal(m.type, -1);
  const ins = autoMap("insegnamenti", ["Insegnamento", "Anno", "CFU", "Tipo", "Prova"]);
  assert.equal(ins.kind, 3, "«Tipo» = obbligatorio/a scelta");
  assert.equal(ins.format, 4, "«Prova» = prova d'esame");
  const ins2 = autoMap("insegnamenti", ["Insegnamento", "Tipo prova", "Tipologia"]);
  assert.equal(ins2.format, 1); assert.equal(ins2.kind, 2);
});

test("tipo di file: appelli, piano, orari", () => {
  assert.equal(detectKind(["Insegnamento", "Data", "Ora", "Aula"], [["Analisi", "14/01/2027", "9:00", "A"]]).kind, "esami");
  assert.equal(detectKind(["Insegnamento", "Anno", "CFU", "Tipo"]).kind, "insegnamenti");
  assert.equal(detectKind(["Insegnamento", "Giorno", "Inizio", "Fine", "Aula"], [["Analisi", "Lunedì", "9", "11", "A"]]).kind, "orari");
  assert.equal(detectKind(["Insegnamento", "Data", "Orario", "Aula"], [["Analisi", "14/01/2027", "09:00-11:00", "A"]]).kind, "orari", "data assoluta ma fascia oraria → lezione datata");
  assert.equal(detectKind(["Esame", "Data", "Orario", "Sede"], [["Analisi", "14/01/2027", "09:00", "A"]]).kind, "esami", "un solo orario → appello");
  assert.equal(detectKind(["Colonna A", "Colonna B"]).kind, null);
  assert.equal(looksLikeHeader(["Insegnamento", "Data", "Aula"]), true);
  assert.equal(looksLikeHeader(["Analisi 1", "14/01/2027", "Aula 3"]), false);
  assert.equal(looksLikeHeader(["Analisi 1", "9", "1"]), false);
});

test("valori: tipo di prova, anno, tipo insegnamento", () => {
  assert.equal(parseExamType("Scritto e orale"), "misto");
  assert.equal(parseExamType("Prova scritta"), "scritto");
  assert.equal(parseExamType("Colloquio"), "orale");
  assert.equal(parseExamType("Quiz a risposta multipla"), "test");
  assert.equal(parseExamType("Esercizi"), "problemi");
  assert.equal(parseExamType(""), null);
  assert.deepEqual(["1", "3° anno", "III", "secondo", "7", "boh"].map(parseYear), [1, 3, 3, 2, 0, 0]);
  assert.deepEqual(["Obbligatorio", "A scelta", "Opzionale", "Caratterizzante", "x"].map(parseKind), ["obbligatorio", "a_scelta", "a_scelta", "obbligatorio", "sconosciuto"]);
});

test("appelli da Excel reale: più appelli raggruppati, date passate scartate, tipo dal file/piano/materia", async () => {
  const wb = await readXlsx(fx("appelli.xlsx"));
  const { headers, data, firstRow } = tableFrom(wb.sheets[0].rows, true, wb.sheets[0].offset);
  const map = autoMap("esami", headers);
  const courses = [{ name: "Teoria dei giochi", year: 3, cfu: 6, format: "orale", formatEvidence: "x" }];
  const r = buildExams(data, map, { today: TODAY, courses, exams: [{ id: "e1", name: "diritto privato" }] }, firstRow);
  assert.equal(r.items.length, 3, "Fisica (2020) scartata perché passata");
  assert.equal(r.past, 1);
  const by = (n) => r.items.find((i) => i.name === n);
  assert.deepEqual(by("Analisi matematica 1").appelli.map((a) => a.date), ["2027-01-14", "2027-02-04"]);
  assert.equal(by("Analisi matematica 1").date, "2027-01-14");
  assert.equal(by("Analisi matematica 1").appelli[0].time, "09:00");
  assert.equal(by("Analisi matematica 1").appelli[0].room, "Aula 3");
  assert.equal(by("Analisi matematica 1").type, "scritto"); assert.equal(by("Analisi matematica 1").typeSource, "file");
  assert.equal(by("Analisi matematica 1").cfu, 9);
  assert.equal(by("Diritto privato").status, "aggiornato");
  assert.equal(by("Diritto privato").existingId, "e1");
  assert.equal(by("Teoria dei giochi").type, "orale"); assert.equal(by("Teoria dei giochi").typeSource, "piano", "senza tipo nel file: dal piano di studi");
  assert.equal(by("Teoria dei giochi").year, 3);
});

test("appelli da CSV con errori: righe segnalate con il numero, non bloccano le altre", () => {
  const csv = "Insegnamento;Data;Aula\nAnalisi;14/01/2027;A1\n;;\nFisica;31/02/2027;A2\n;15/01/2027;A3\nChimica;fra poco;A4\nStoria;10 feb 2027;A5\n";
  const { rows, offset } = parseDelimited(csv);
  const { headers, data, firstRow } = tableFrom(rows, true, offset);
  const r = buildExams(data, autoMap("esami", headers), { today: TODAY }, firstRow);
  assert.deepEqual(r.items.map((i) => i.name), ["Analisi", "Storia"]);
  assert.deepEqual(r.errors.map((e) => e.row), [4, 5, 6]);
  assert.match(r.errors[0].message, /data non riconosciuta «31\/02\/2027»/);
  assert.match(r.errors[1].message, /insegnamento mancante/);
  assert.equal(r.items[1].type, "orale", "materia: Storia → orale (suggerimento)");
});

test("piano di studi da CSV: anno, CFU, tipo, gruppo, prova; duplicati e righe vuote", () => {
  const { rows } = parseDelimited("Insegnamento;Anno;CFU;Tipo;Gruppo;Prova\nAnalisi 1;1;9;Obbligatorio;;Scritto\nAnalisi 1;1;9;Obbligatorio;;Scritto\nTeoria dei giochi;3;6;;Area economica;\n;;;;;\nEtica;3;6;A scelta;;Orale\n");
  const { headers, data, firstRow } = tableFrom(rows, true);
  const r = buildCourses(data, autoMap("insegnamenti", headers), { courses: [{ name: "Etica", year: 3 }] }, firstRow);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].format, "scritto"); assert.equal(r.items[0].formatEvidence, "importato da file");
  assert.equal(r.items[1].kind, "a_scelta", "gruppo indicato → a scelta"); assert.equal(r.items[1].group, "Area economica");
  assert.equal(r.items[2].status, "aggiornato");
  assert.ok(r.items.every((c) => c.manual === true), "non vengono sostituiti dalla ricerca web");
});

test("orari da Excel reale: voci settimanali, orari da celle formattate, corsi con conteggio", async () => {
  const wb = await readXlsx(fx("orari.xlsx"));
  const { headers, data, firstRow } = tableFrom(wb.sheets[0].rows, true, wb.sheets[0].offset);
  const r = buildTimetable(data, autoMap("orari", headers), { today: TODAY }, firstRow);
  assert.equal(r.errors.length, 0);
  assert.equal(r.items.length, 4);
  assert.deepEqual(r.items[0], { course: "Analisi matematica 1", weekday: 1, start: "09:00", end: "11:00", room: "Aula 3" });
  assert.deepEqual(r.courses, [{ name: "Analisi matematica 1", count: 2 }, { name: "Diritto privato", count: 1 }, { name: "Fisica generale", count: 1 }]);
});

test("orari: fascia 'dalle-alle', date precise, errori chiari", () => {
  const { rows } = parseDelimited("Corso;Data;Orario;Aula\nAnalisi;lun;09:00-11:00;A\nFisica;2026-11-03;9.00 – 10.30;B\nChimica;sabato;boh;C\nStoria;mai;10:00-11:00;D\nArte;mar;11:00-10:00;E");
  const { headers, data, firstRow } = tableFrom(rows, true);
  const map = autoMap("orari", headers);
  assert.ok(map.day >= 0 && map.range >= 0, "«Data» è il giorno, «Orario» la fascia");
  const r = buildTimetable(data, map, { today: TODAY }, firstRow);
  assert.deepEqual(r.items.map((l) => [l.course, l.weekday ?? l.date, l.start, l.end]), [["Analisi", 1, "09:00", "11:00"], ["Fisica", "2026-11-03", "09:00", "10:30"]]);
  assert.deepEqual(r.errors.map((e) => e.row), [4, 5, 6]);
});

test("orario: lezioni del giorno, minuti occupati, validità settimanale fino a una data", () => {
  const tt = { until: "2026-12-18", items: [
    { course: "A", weekday: 1, start: "09:00", end: "11:00", room: "" },
    { course: "B", weekday: 1, start: "14:00", end: "15:30", room: "" },
    { course: "C", date: "2026-11-03", start: "10:00", end: "12:00", room: "" },
  ] };
  assert.deepEqual(lessonsOn(tt, "2026-10-05").map((l) => l.course), ["A", "B"], "lunedì 5 ottobre 2026");
  assert.equal(busyMinutes(tt, "2026-10-05"), 210);
  assert.equal(busyMinutes(tt, "2026-10-06"), 0);
  assert.deepEqual(lessonsOn(tt, "2026-11-03").map((l) => l.course), ["C"]);
  assert.equal(busyMinutes(tt, "2027-01-11"), 0, "dopo la fine delle lezioni");
  assert.equal(busyMinutes(null, "2026-10-05"), 0);
});

test("modelli CSV: ogni modello è riconosciuto dal proprio tipo e costruito senza errori", () => {
  for (const kind of Object.keys(SCHEMAS)) {
    const { rows } = parseDelimited(TEMPLATES[kind]);
    const { headers, data, firstRow } = tableFrom(rows, true);
    assert.equal(detectKind(headers, data).kind, kind, kind);
    const r = BUILDERS[kind](data, autoMap(kind, headers), { today: TODAY, courses: [], exams: [] }, firstRow);
    assert.equal(r.errors.length, 0, kind);
    assert.ok(r.items.length >= 2, kind);
  }
});

test("intestazioni canoniche del client uguali a quelle dei prompt condivisi", () => {
  assert.deepEqual(CANON_HEADERS, IMPORT_HEADERS);
  for (const kind of Object.keys(IMPORT_HEADERS)) {
    const map = autoMap(kind, IMPORT_HEADERS[kind]);
    assert.ok(SCHEMAS[kind].fields.filter((f) => f.required).every((f) => map[f.key] >= 0), `${kind}: colonne obbligatorie riconosciute`);
    assert.equal(detectKind(IMPORT_HEADERS[kind], []).kind, kind, `${kind}: riconosciuto dalle intestazioni canoniche`);
  }
});

test("intestazione preceduta da titoli e note: trovata, righe numerate come nel file", () => {
  const rows = [["Calendario appelli - sessione invernale 2027"], [], ["Insegnamento", "Data", "Aula"], ["Analisi", "14/01/2027", "A1"], ["Fisica", "31/02/2027", "A2"]];
  assert.equal(findHeaderRow(rows), 2);
  assert.equal(findHeaderRow([["Analisi", "14/01/2027", "A1"]]), -1, "una riga di dati non è un'intestazione");
  assert.equal(findHeaderRow([["x"], ["y"]]), -1);
  const idx = findHeaderRow(rows);
  const { headers, data, firstRow } = tableFrom(rows.slice(idx), true, idx);
  const r = buildExams(data, autoMap("esami", headers), { today: TODAY }, firstRow);
  assert.deepEqual(r.items.map((i) => i.name), ["Analisi"]);
  assert.equal(r.errors[0].row, 5, "la riga di «Fisica» è la 5 del file (1-based), titolo e riga vuota compresi");
});
