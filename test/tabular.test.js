import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeText, excelSerial, minutesBetween, parseDate, parseDelimited, parseTime, parseTimeRange, parseWeekday, readSpreadsheet, readXlsx, weekdayOf } from "../public/js/tabular.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const TODAY = "2026-10-01";

test("CSV: delimitatore automatico, virgolette, a capo nelle celle, BOM, righe vuote", () => {
  assert.deepEqual(parseDelimited("\uFEFFA;B;C\n1;2;3\n\n4;5;6\n").rows, [["A", "B", "C"], ["1", "2", "3"], [], ["4", "5", "6"]], "la riga vuota interna resta: i numeri di riga corrispondono al foglio");
  assert.equal(parseDelimited("\n\nA;B\n1;2").offset, 2, "righe vuote iniziali tolte, contate in offset");
  assert.equal(parseDelimited("A;B\n1;2").delimiter, ";");
  assert.equal(parseDelimited("A\tB\n1\t2").delimiter, "\t");
  const q = parseDelimited('Insegnamento,Nota\r\n"Analisi, 1","dice ""ciao""\nsu due righe"\r\nFisica,ok');
  assert.deepEqual(q.rows[1], ["Analisi, 1", 'dice "ciao"\nsu due righe']);
  assert.deepEqual(q.rows[2], ["Fisica", "ok"]);
  assert.equal(parseDelimited("1,5;2,5\n3,5;4,5").delimiter, ";", "la virgola decimale non è il delimitatore");
  assert.deepEqual(parseDelimited("").rows, []);
});

test("testo: UTF-8 oppure Windows-1252", () => {
  assert.equal(decodeText(Buffer.from("Lunedì", "utf8")), "Lunedì");
  assert.equal(decodeText(Buffer.from([0x4c, 0x75, 0x6e, 0x65, 0x64, 0xec])), "Lunedì", "ì in cp1252");
});

test("date: formati italiani, ISO, mesi a parole, seriali Excel, giorno prima del mese", () => {
  const d = (v, o) => parseDate(v, { today: TODAY, ...o });
  assert.deepEqual(d("15/01/2027"), { date: "2027-01-15", time: null });
  assert.deepEqual(d("5-2-27"), { date: "2027-02-05", time: null });
  assert.deepEqual(d("15.01.2027 09:30"), { date: "2027-01-15", time: "09:30" });
  assert.deepEqual(d("2027-01-15T14.30"), { date: "2027-01-15", time: "14:30" });
  assert.deepEqual(d("lun 18 gennaio 2027"), { date: "2027-01-18", time: null });
  assert.deepEqual(d("4 feb 2027"), { date: "2027-02-04", time: null });
  assert.equal(d("12 ott").date, "2026-10-12", "senza anno: prossima occorrenza");
  assert.equal(d("12 gen").date, "2027-01-12", "senza anno: anno dopo se già passata");
  assert.equal(d("30/02/2027"), null, "data inesistente");
  assert.equal(d("pippo"), null);
  assert.equal(d(""), null);
  assert.equal(d("13/25/2027")?.date, undefined, "né giorno né mese plausibili");
  assert.equal(d("01/13/2027").date, "2027-01-13", "formato americano evidente");
  assert.equal(d("46401").date, excelSerial(46401).date, "seriale Excel come testo");
});

test("Excel: seriali, epoca 1904, orari", () => {
  assert.deepEqual(excelSerial(46401), { date: "2027-01-14", time: null });
  assert.deepEqual(excelSerial(46401.375), { date: "2027-01-14", time: "09:00" });
  assert.equal(excelSerial(0, true).date, "1904-01-01");
});

test("orari e giorni", () => {
  assert.equal(parseTime("9"), "09:00");
  assert.equal(parseTime("9.30"), "09:30");
  assert.equal(parseTime("14:05:00"), "14:05");
  assert.equal(parseTime("0.375"), "09:00");
  assert.equal(parseTime("25:00"), null);
  assert.deepEqual(parseTimeRange("09:00-11:00"), { start: "09:00", end: "11:00" });
  assert.deepEqual(parseTimeRange("9.00 – 11.30"), { start: "09:00", end: "11:30" });
  assert.deepEqual(parseTimeRange("dalle 9 alle 11"), { start: "09:00", end: "11:00" });
  assert.equal(parseTimeRange("mattina"), null);
  assert.equal(parseWeekday("Lunedì"), 1);
  assert.equal(parseWeekday("gio."), 4);
  assert.equal(parseWeekday("Sunday"), 7);
  assert.equal(parseWeekday("3"), 3);
  assert.equal(parseWeekday("marzo"), null, "un mese non è un giorno");
  assert.equal(parseWeekday("martedì"), 2);
  assert.equal(parseWeekday("Mar."), 2);
  assert.equal(weekdayOf("2026-10-01"), 4, "1 ottobre 2026 è giovedì");
  assert.equal(minutesBetween("09:00", "11:30"), 150);
});

test("xlsx reale (openpyxl): date e orari con formato, numeri, più fogli", async () => {
  const wb = await readXlsx(fx("appelli.xlsx"));
  assert.deepEqual(wb.sheets.map((s) => s.name), ["Appelli", "Note"]);
  const [head, ...rows] = wb.sheets[0].rows;
  assert.deepEqual(head, ["Insegnamento", "Data appello", "Ora", "Aula", "Tipo prova", "CFU", "Anno"]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], ["Analisi matematica 1", "2027-01-14", "09:00", "Aula 3", "Scritto", "9", "1"]);
  assert.equal(rows[2][2], "14:30", "ora con formato HH:MM");
  assert.equal(rows[4][2], "", "cella vuota");
  assert.equal(wb.sheets[1].rows[1][0], "Gli appelli possono cambiare");
});

test("readSpreadsheet: .xlsx, CSV, .xls rifiutato con istruzioni, zip non valido", async () => {
  const x = await readSpreadsheet({ name: "orari.xlsx", arrayBuffer: async () => fx("orari.xlsx").buffer.slice(fx("orari.xlsx").byteOffset, fx("orari.xlsx").byteOffset + fx("orari.xlsx").byteLength) });
  assert.equal(x.sheets[0].rows[1][1], "Lunedì");
  assert.equal(x.sheets[0].rows[1][2], "09:00");
  const c = await readSpreadsheet({ name: "a.csv", arrayBuffer: async () => Buffer.from("A;B\n1;2").buffer.slice(0) });
  assert.equal(c.sheets[0].rows.length >= 1, true);
  await assert.rejects(readSpreadsheet({ name: "vecchio.xls", arrayBuffer: async () => new ArrayBuffer(10) }), /\.xlsx oppure CSV/);
  await assert.rejects(readXlsx(new Uint8Array(100).buffer), /non sembra un documento Office valido/);
});
