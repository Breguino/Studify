import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfLib from "pdf-lib";
import { officeText } from "../public/js/office-text.js";
import { extractPdfPages, setPdfLib } from "../public/js/pdf-pages.js";
import { extractPages } from "../public/js/pdf-extract.js";
import { guessRole } from "../public/js/material-roles.js";
import { markSent, parseRange, pendingMaterials, sliceText, unsentPages } from "../public/js/module-update.js";
import { materialText } from "../shared/prompts.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

test("Word: paragrafi, tabulazioni ed entità; PowerPoint: slide in ordine numerico separate da \\f", async () => {
  const d = await officeText(fx("esercizi.docx"), "esercizi.docx");
  assert.equal(d.pages, 0);
  assert.equal(d.text, "Esercizio 1\nCalcola l'elasticità della domanda: Q = 100 − 2P\na)\tper P = 10\n\nSoluzione: ε = −0,25");
  const p = await officeText(fx("slide.pptx"), "slide.pptx");
  assert.equal(p.pages, 3);
  assert.deepEqual(p.text.split("\f"), ["Lezione 1\nDomanda e offerta", "Equilibrio\nQ<sub>d</sub> = Q<sub>s</sub>", "Esternalità"], "slide10 dopo slide2");
  await assert.rejects(officeText(new Uint8Array(50), "x.docx"), /documento Office valido/);
});

test("PDF: estrazione delle pagine scelte (pdf-lib), il resto non viene mandato", async () => {
  setPdfLib(pdfLib);
  const b64 = fx("libro.pdf").toString("base64");
  const out = await extractPdfPages(b64, 5, 8);
  const { pages, numPages } = await extractPages(pdfjs, Buffer.from(out, "base64"));
  assert.equal(numPages, 4);
  assert.match(pages[0].items.map((i) => i.str).join(" "), /pagina 5\b/);
  assert.match(pages[3].items.map((i) => i.str).join(" "), /pagina 8\b/);
  assert.equal((await extractPages(pdfjs, Buffer.from(await extractPdfPages(b64, 11, 99), "base64"))).numPages, 2, "oltre la fine: si ferma all'ultima");
});

test("intervalli di pagine: parse, testo per pagine, solo le pagine nuove dopo un ampliamento", () => {
  assert.deepEqual(parseRange("45-120", 100), { from: 45, to: 100 });
  assert.deepEqual(parseRange(" 9 - 3 "), { from: 3, to: 9 });
  assert.equal(parseRange(""), null);
  assert.equal(parseRange("abc"), null);
  assert.equal(sliceText("p1\fp2\fp3\fp4", "2-3"), "p2\n\np3");
  assert.equal(sliceText("senza pagine", "2-3"), "senza pagine");
  const libro = { id: "b", pages: "1-40" };
  assert.equal(unsentPages(libro), "1-40", "mai mandato: l'intervallo scelto");
  markSent(libro);
  assert.equal(unsentPages(libro), undefined);
  libro.pages = "1-80";
  assert.equal(unsentPages(libro), "41-80", "capitoli successivi: solo le pagine nuove");
  markSent(libro);
  assert.equal(libro.sentPages, "1-80");
  libro.pages = "20-60";
  assert.equal(unsentPages(libro), undefined, "restringere non manda nulla");
  libro.pages = null;
  assert.equal(unsentPages(libro), null, "tutte le pagine (numero sconosciuto): si manda tutto");
  assert.equal(unsentPages({ ...libro, numPages: 120 }), "81-120", "tutte, fino all'ultima: solo le pagine nuove");
  markSent(libro);
  assert.equal(libro.sentPages, "all");
  const exam = { module: { materialIds: ["b", "n"] }, materials: [libro, { id: "n" }, { id: "x" }] };
  assert.deepEqual(pendingMaterials(exam).map((m) => m.id), ["x"]);
  libro.sentPages = "1-40"; libro.pages = "1-60";
  assert.deepEqual(pendingMaterials(exam).map((m) => m.id), ["b", "x"], "pagine aggiunte a un libro già nel modulo → di nuovo da aggiungere");
});

test("tipo di materiale: dal nome del file e nel prompt", () => {
  assert.equal(guessRole("Eserciziario_cap3.pdf", true), "esercizi");
  assert.equal(guessRole("Temi d'esame 2024.pdf", true), "esami");
  assert.equal(guessRole("Slide lezione 4.pptx", true), "slide");
  assert.equal(guessRole("Lezione 4.pptx", true), "slide", "una presentazione è una presentazione");
  assert.equal(guessRole("Dispensa capitolo 2.pdf", true), "dispense");
  assert.equal(guessRole("Mankiw - Capitolo 5.pdf", true), "libro");
  assert.equal(guessRole("appunti_settimana2.md"), "appunti");
  assert.equal(guessRole("documento.pdf", true), "dispense");
  assert.equal(guessRole("note.txt"), "appunti");
  assert.equal(materialText({ role: "esercizi", title: 'Temi "2024"', pages: "3-5", text: "Es. 1" }), `<esercizi titolo="Temi '2024'" pagine="3-5">\nEs. 1\n</esercizi>`);
  assert.equal(materialText({ title: "L1", text: "x" }), `<appunti_studente titolo="L1">\nx\n</appunti_studente>`);
});

test("equazioni di Word e PowerPoint (OMML) → LaTeX valido per KaTeX", async () => {
  const katex = (await import("katex")).default;
  const d = await officeText(fx("formule.docx"), "formule.docx");
  const lines = d.text.split("\n");
  assert.equal(lines[0], String.raw`L'elasticità è $\varepsilon =\left| \frac{\Delta Q/Q}{\Delta P/P}\right|$, in valore assoluto.`);
  assert.ok(d.text.includes(String.raw`$$\bar{x}=\frac{1}{n}\sum_{i=1}^{n}{x}_{i}$$`), "media con barra e sommatoria");
  const VAR = "$$" + String.raw`{s}^{2}=\frac{1}{n-1}\sum_{i=1}^{n}{\left({x}_{i}-\bar{x}\right)}^{2}$$`;
  assert.ok(d.text.includes(VAR), "varianza campionaria");
  assert.ok(d.text.includes(String.raw`Limite notevole: $\lim_{x\to 0}\frac{\sin x}{x}=1$`), "lim e sin come operatori");
  assert.ok(d.text.includes(String.raw`\hat{{\beta}_{1}}=\sqrt{{a}^{2}+{b}^{2}}\le \int_{0}^{\infty}{e}^{-x}dx`), "accento, radice, integrale");
  assert.ok(d.text.includes(String.raw`\begin{matrix}1 & 2 \\ 3 & 4 \end{matrix}`) && d.text.includes(String.raw`\left\{\begin{aligned}2x+y=5 \\ x-y=1 \end{aligned}\right.`), "matrice e sistema");
  assert.ok(d.text.includes(String.raw`Media | $\mu =E\left[ X \right]$`), "formula in una tabella");
  assert.ok(!d.text.includes("cancellato") && d.text.endsWith("Fine."), "testo cancellato (revisioni) escluso");
  const p = await officeText(fx("formule.pptx"), "formule.pptx");
  assert.equal(p.text, `Varianza campionaria\n\n${VAR}`, "equazione presa una volta (non l'immagine di riserva), niente numero di slide");
  for (const t of [d.text, p.text])
    for (const m of t.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g)) assert.doesNotThrow(() => katex.renderToString(m[1] ?? m[2], { throwOnError: true }), m[0]);
});
