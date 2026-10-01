import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseCurriculumTable, parseCurriculumText } from "../public/js/curriculum.js";
import { extractPages } from "../public/js/pdf-extract.js";
import { clusterRows, cellsOfRow, hasText, layoutText, pagesToRows, plainLines, charWidth } from "../public/js/pdf-table.js";

const pdf = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const read = (n) => extractPages(pdfjs, pdf(n));

test("pdf: appelli su due pagine → una tabella, intestazione ripetuta e numeri di pagina tolti", async () => {
  const { pages, numPages } = await read("appelli.pdf");
  assert.equal(numPages, 2);
  assert.ok(hasText(pages));
  const rows = pagesToRows(pages);
  const header = rows.find((r) => r[0] === "Insegnamento");
  assert.deepEqual(header, ["Insegnamento", "Data", "Ora", "Aula", "Prova", "CFU"]);
  assert.equal(rows.filter((r) => r[0] === "Insegnamento").length, 1, "intestazione ripetuta sulla seconda pagina: una sola");
  const data = rows.filter((r) => /^\d{2}\/\d{2}\/\d{4}$/.test(r[1] ?? ""));
  assert.equal(data.length, 6);
  assert.deepEqual(data[2], ["Diritto privato", "21/01/2027", "14:30", "Aula Magna", "Orale", "6"]);
  assert.deepEqual(data[3], ["Fisica generale", "10/01/2020", "09:00", "Aula 1", "Scritto e orale", "9"]);
  assert.ok(!rows.some((r) => /pagina \d/i.test(r.join(" "))), "niente «Pagina 1 di 2»");
});

test("pdf: piano di studi → righe di testo con anni, CFU e gruppo a scelta", async () => {
  const { pages } = await read("piano.pdf");
  const lines = plainLines(pages);
  assert.ok(lines.includes("1° anno"));
  assert.ok(lines.some((l) => l.startsWith("Analisi matematica 1") && l.includes("9 CFU")));
  assert.ok(lines.some((l) => /A scelta \(un esame tra i seguenti\)/.test(l)));
  const i = lines.findIndex((l) => l.startsWith("Statistica applicata"));
  assert.equal(lines[i + 1], "", "lo spazio verticale prima di «Prova finale» diventa una riga vuota: chiude il gruppo a scelta");
  const r = parseCurriculumText(lines.join("\n"));
  const by = (n) => r.courses.find((c) => c.name === n);
  assert.equal(r.courses.length, 9);
  assert.equal(by("Statistica applicata").kind, "a_scelta");
  assert.equal(by("Prova finale").kind, "obbligatorio");
  assert.equal(by("Insegnamenti a scelta dello studente").cfu, 12);
  assert.deepEqual([by("Basi di dati").year, by("Fisica generale").year, by("Teoria dei giochi").year], [2, 1, 3]);
});

test("pdf: layout a griglia — le colonne restano allineate ai giorni", async () => {
  const { pages } = await read("orario-griglia.pdf");
  const { text } = layoutText(pages);
  const lines = text.split("\n");
  const head = lines.find((l) => l.includes("Lunedi"));
  const colOf = (line, word) => line.indexOf(word);
  const mon = colOf(head, "Lunedi"), thu = colOf(head, "Giovedi");
  assert.ok(mon > 0 && thu > mon);
  const analisiLines = lines.filter((l) => l.includes("Analisi 1"));
  assert.equal(analisiLines.length, 4, "lun 9-10, lun 10-11, gio 14-15, gio 15-16");
  const mondayRow = lines.find((l) => l.includes("09:00-10:00"));
  assert.ok(Math.abs(colOf(mondayRow, "Analisi 1") - mon) <= 2, "«Analisi 1» sta sotto «Lunedi»");
  const slot14 = lines.find((l) => l.includes("14:00-15:00"));
  assert.ok(Math.abs(colOf(slot14, "Analisi 1") - thu) <= 2, "e di giovedì alle 14");
});

test("pdf: raggruppamento in righe e celle su dati sintetici; PDF senza testo riconosciuto", () => {
  const it = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 10 });
  const items = [it("Corso", 10, 100), it("Aula", 120, 100.4), it("Analisi", 10, 80), it("1", 48, 80), it("A3", 120, 79.8)];
  const rows = clusterRows(items);
  assert.equal(rows.length, 2);
  assert.deepEqual(cellsOfRow(rows[1].items, charWidth(items)), ["Analisi 1", "A3"], "parole vicine unite, colonna lontana separata");
  assert.equal(hasText([{ items: [] }, { items: [it("x", 0, 0)] }]), false);
});

test("piano di studi reale (Economia e analisi dei dati 2026-27): anni, CFU, attività a scelta, somma = totale dichiarato", async () => {
  const { pages } = await read("piano-economia-analisi-dati.pdf");
  const r = parseCurriculumTable(pagesToRows(pages, { blanks: true }));
  assert.deepEqual(r.years, [1, 2, 3]);
  assert.equal(r.courses.length, 24);
  assert.deepEqual(r.meta, { degreeName: "Economia e analisi dei dati", academicYear: "2026-27", declaredTotal: 180, sum: 180 });
  const by = (n) => r.courses.find((c) => c.name === n);
  const y = (n) => r.courses.filter((c) => c.year === n);
  assert.deepEqual([y(1).length, y(2).length, y(3).length], [8, 8, 8]);
  assert.equal(y(1).reduce((s, c) => s + c.cfu, 0), 59, "«Totale 1° anno 59»");
  assert.equal(y(2).reduce((s, c) => s + c.cfu, 0), 63, "«Totale 2° anno 63»");
  assert.equal(y(3).reduce((s, c) => s + c.cfu, 0), 58, "«Totale 3° anno 58»");
  assert.equal(by("Abilità informatiche").cfu, 2);
  assert.equal(by("Diritto pubblico e transizione digitale").year, 1);
  assert.equal(by("Coding per l’analisi dei dati").cfu, 9, "apostrofo tipografico conservato, quadrimestre «2Q» e codice SSD esclusi");
  assert.equal(by("Business English (B2)").year, 2);
  assert.equal(by("Statistics for Business Analytics").year, 3);
  assert.deepEqual([by("Scelta libera dello studente").kind, by("Scelta libera dello studente").cfu, by("Scelta libera dello studente").group], ["a_scelta", 12, "Altre attività"]);
  assert.deepEqual([by("Tirocinio").kind, by("Tirocinio").cfu], ["a_scelta", 3]);
  assert.deepEqual([by("Prova finale").kind, by("Prova finale").cfu], ["obbligatorio", 4], "la prova finale non è a scelta");
  assert.ok(!r.courses.some((c) => /totale|ssd|altre attivit|scelta libera dello studente \(15/i.test(c.name)), "righe di totale, intestazioni e l'alternativa «15 CFU» escluse");
  assert.ok(r.courses.every((c) => !/^[A-Z]+-\d{2}\//.test(c.name)), "nessun codice SSD nei nomi");
});

test("lettore di piani in tabella: SSD vecchio stile, 'N CFU' nel testo, intestazione senza anno", () => {
  const rows = [
    ["Corso di Laurea Magistrale in", "Scienze Statistiche"],
    ["Insegnamenti 1° anno", "CFU"],
    ["SECS-S/01", "Statistica avanzata", "9", "I sem."],
    ["MAT/05", "Analisi funzionale", "6", "II sem."],
    ["Totale 1° anno", "15"],
    ["Insegnamenti 2° anno", "CFU"],
    ["ING-INF/05", "Basi di dati 6 CFU"],
    ["Insegnamento a scelta", "(9 CFU)"],
    [],
    ["Totale", "30"],
  ];
  const r = parseCurriculumTable(rows);
  assert.equal(r.meta.degreeName, "Scienze statistiche");
  assert.deepEqual(r.courses.map((c) => [c.year, c.name, c.cfu, c.kind]), [
    [1, "Statistica avanzata", 9, "obbligatorio"],
    [1, "Analisi funzionale", 6, "obbligatorio"],
    [2, "Basi di dati", 6, "obbligatorio"],
    [2, "Insegnamento a scelta", 9, "a_scelta"],
  ]);
  assert.equal(r.meta.declaredTotal, 30);
  assert.equal(r.meta.sum, 30);
});

test("un elenco di appelli NON viene scambiato per un piano di studi (nessuna sezione per anno)", async () => {
  const { pages } = await read("appelli.pdf");
  const r = parseCurriculumTable(pagesToRows(pages, { blanks: true }));
  assert.ok(!r.years.some((y) => y > 0), "senza intestazioni di anno non si attiva il riconoscimento automatico");
});
