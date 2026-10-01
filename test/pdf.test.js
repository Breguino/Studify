import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseCurriculumText } from "../public/js/curriculum.js";
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
