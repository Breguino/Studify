import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartText, officeText } from "../public/js/office-text.js";
import { guessRole, ROLES } from "../public/js/material-roles.js";
import { DISPENSA_SYSTEM, MODULE_PRINCIPLES, materialText } from "../shared/prompts.js";

const buf = (name) => { const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

test("PowerPoint: ordine della presentazione, titoli, note del relatore, grafici con i dati, testo alternativo delle immagini", async () => {
  const r = await officeText(buf("Slide Microeconomia lezioni 1-3.pptx"), "Slide.pptx");
  assert.equal(r.pages, 3);
  assert.deepEqual(r.sections, ["Domanda e offerta", "Elasticità", "Monopolio"], "la slide spostata (file slide3) è la seconda");
  const [s1, s2, s3] = r.text.split("\f");
  assert.match(s1, /^Domanda e offerta\nLa domanda è decrescente nel prezzo/);
  assert.match(s1, /Note del docente: Qui disegno la croce di domanda e offerta: all'esame la chiedo sempre\.$/, "note del relatore (non il numero della slide)");
  assert.ok(!/\b1$/.test(s1.split("\n").at(-2)));
  assert.match(s2, /\[Grafico a barre: Elasticità per bene\]\ncategoria \| Elasticità\nPane \| 0\.3\nVacanze \| 2\.1/, "i dati del grafico, nell'ordine delle categorie");
  assert.match(s2, /\[Immagine: Curva di domanda anelastica\]/);
  assert.match(s3, /^Monopolio\nCondizione di ottimo/, "la slide nascosta c'è");
  assert.deepEqual([r.figureSlides, r.notesSlides, r.hiddenSlides], [[1], 1, 1], "la slide 1 ha un grafico disegnato e un'immagine senza descrizione");
});

test("PowerPoint senza presentation.xml leggibile: ordine dei file", async () => {
  const r = await officeText(buf("slide.pptx"), "slide.pptx");
  assert.equal(r.pages, 3);
  assert.equal(r.sections.length, 3);
});

test("grafici: a dispersione con x e y, serie senza nome", () => {
  const xml = `<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:scatterChart><c:ser><c:xVal><c:numRef><c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal><c:yVal><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt></c:numCache></c:numRef></c:yVal></c:ser></c:scatterChart></c:plotArea></c:chart></c:chartSpace>`;
  assert.equal(chartText(xml), "[Grafico a dispersione]\nx | serie 1\n1 | 10\n2 | 8");
  assert.equal(chartText("<c:chartSpace xmlns:c='c'/>"), "");
});

test("tipo: slide del docente separate dalle dispense, con la loro regola", () => {
  assert.equal(ROLES.slide, "Slide del docente");
  assert.equal(ROLES.dispense, "Dispense del docente");
  for (const n of ["Slide lezione 4.pdf", "Lezione 4.pptx", "Lucidi capitolo 2.pdf", "Presentazione corso.pdf"]) assert.equal(guessRole(n, true), "slide", n);
  assert.equal(guessRole("Dispensa capitolo 2.pdf", true), "dispense");
  assert.equal(guessRole("Key concepts.pdf", true), "dispense", "«key» non è una presentazione");
  assert.equal(materialText({ role: "slide", title: "Lezione 4", pages: "1-20", text: "x" }), '<slide titolo="Lezione 4" pagine="1-20">\nx\n</slide>');
  assert.match(MODULE_PRINCIPLES, /slide del docente \(tag slide\): sono la traccia del corso[\s\S]*SOLO nelle slide[\s\S]*Note del docente/);
  assert.match(DISPENSA_SYSTEM, /SLIDE: sono schematiche\. Spiega per esteso[\s\S]*\[Slide n\]/);
});
