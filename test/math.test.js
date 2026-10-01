import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { clipRich, hasMath, splitMath } from "../public/js/math.js";
import { mergeModule, normalizeModule, repairLatex } from "../shared/normalize.js";
import { addRange, mathyPages, rangesCover, replacePages } from "../public/js/module-update.js";

const types = (s) => splitMath(s).map((p) => (p.type === "math" ? `${p.display ? "D" : "M"}:${p.value}` : `T:${p.value}`));

test("splitMath: delimitatori $, $$, \\( \\), \\[ \\] e dollari che non sono formule", () => {
  assert.deepEqual(types("La media $\\bar{x}$ e $$s^2=\\frac{1}{n}$$ fine"), ["T:La media ", "M:\\bar{x}", "T: e ", "D:s^2=\\frac{1}{n}", "T: fine"]);
  assert.deepEqual(types("\\(a+b\\) e \\[c\\]"), ["M:a+b", "T: e ", "D:c"]);
  assert.deepEqual(types("costa 5$ e 10$ al giorno"), ["T:costa 5$ e 10$ al giorno"], "prezzi");
  assert.deepEqual(types("tra $ 3 e $ 5"), ["T:tra $ 3 e $ 5"], "dollaro seguito da spazio");
  assert.deepEqual(types("prezzo \\$5 e $x$"), ["T:prezzo $5 e ", "M:x"], "\\$ è un dollaro");
  assert.deepEqual(types("$x$5"), ["T:$x$5"], "chiusura seguita da cifra: non è una formula");
  assert.deepEqual(types("aperta $x senza chiusura"), ["T:aperta $x senza chiusura"]);
  assert.equal(hasMath("nessuna formula"), false);
});

test("clipRich: anteprima accorciata senza tagliare una formula", () => {
  const s = "Primo pezzo di testo $\\frac{\\Delta Q}{\\Delta P}$ e poi tanto altro testo che non entra nell'anteprima.";
  const c = clipRich(s, 30);
  assert.ok(c.endsWith("…"));
  assert.ok(!/\$[^$]*$/.test(c.slice(0, -1).replace(/\$[^$]*\$/g, "")), `nessun $ aperto: ${c}`);
  assert.equal(clipRich("breve $x$", 50), "breve $x$");
});

test("repairLatex: comandi rovinati dal JSON tornano comandi; il testo normale non cambia", () => {
  const broken = JSON.parse(String.raw`"$\frac{a}{b}$, $\beta_1$, $\theta$, $\nabla f$, $\rho$, $\times$ e $$\\sqrt{x}$$\nRiga nuova\tcolonna"`);
  assert.equal(repairLatex(broken), String.raw`$\frac{a}{b}$, $\beta_1$, $\theta$, $\nabla f$, $\rho$, $\times$ e $$\sqrt{x}$$` + "\nRiga nuova\tcolonna");
  assert.equal(repairLatex("Testo\nsenza formule"), "Testo\nsenza formule");
  assert.equal(repairLatex("$$\n\\frac{1}{2}\n$$"), "$$\n\\frac{1}{2}\n$$", "a capo veri dentro $$ restano");
  const m = normalizeModule({ topics: [{ id: "a", title: "T", summary: broken }], flashcards: [{ topicId: "a", front: "f", back: JSON.parse('"$\\\\bar{x}$ e $\\frac{1}{2}$"') }], questions: [] });
  for (const t of [m.topics[0].summary, m.flashcards[0].back]) for (const x of t.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g)) assert.doesNotThrow(() => katex.renderToString(x[1] ?? x[2], { throwOnError: true }), x[0]);
  const { module } = mergeModule(m, { topics: [], flashcards: [{ topicId: "t1", front: JSON.parse('"Che cos\'è $\\theta$?"'), back: "b" }], questions: [] });
  assert.equal(module.flashcards.at(-1).front, "Che cos'è $\\theta$?", "anche negli aggiornamenti");
});

test("demo: tutte le formule del modulo di esempio sono LaTeX valido", async () => {
  const { readFileSync } = await import("node:fs");
  const demo = JSON.stringify(JSON.parse(readFileSync(new URL("../public/demo/module.json", import.meta.url), "utf8")));
  const all = JSON.parse(demo);
  const texts = [...all.topics.flatMap((t) => [t.summary, ...t.keyConcepts.map((k) => k.definition)]), ...all.flashcards.flatMap((c) => [c.front, c.back]), ...all.questions.flatMap((q) => [q.prompt, q.modelAnswer, q.explanation, ...(q.options ?? [])])];
  let n = 0;
  for (const t of texts) for (const p of splitMath(t)) if (p.type === "math") { n++; assert.doesNotThrow(() => katex.renderToString(p.value, { throwOnError: true, displayMode: p.display }), p.value); }
  assert.ok(n >= 8, `formule nel demo: ${n}`);
});

test("pagine trascritte: sostituzione, intervalli, pagine con probabili formule", () => {
  assert.equal(replacePages("a\fb\fc", 2, ["B", null], 4), "a\fB\fc\f");
  assert.equal(addRange("1-4,9-10", 5, 7), "1-7,9-10");
  assert.equal(addRange("", 3, 3), "3-3");
  assert.equal(rangesCover("1-8", 3, 6), true);
  assert.equal(rangesCover("1-4,6-9", 3, 7), false);
  const garbled = "Varianza\ns\n2\n=\n1\nn − 1\n∑\n(xi − x̄)\n2\ni=1";
  assert.equal(mathyPages(`Testo normale di una pagina di libro senza formule.\nAltra riga.\nTerza riga.\f${garbled}`), 1);
  const fromPdf = "Capitolo 2\n\nLa varianza campionaria e:\nn\n2  1  2\ns  =  ∑  ( xi - x )\nn - 1\ni = 1\n\ndove n e il numero di osservazioni.";
  assert.equal(mathyPages(fromPdf), 1, "formula spezzata dal testo di un PDF (meno come trattino)");
  assert.equal(mathyPages("Il mercato è in equilibrio quando la domanda e l'offerta coincidono.\nSe il prezzo sale, la quantità domandata scende e a volte cresce l'offerta.\nÈ il caso più comune."), 0, "prosa con parole di una lettera: no");
});
