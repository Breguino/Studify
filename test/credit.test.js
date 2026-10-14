import { test } from "node:test";
import assert from "node:assert/strict";
import { HEAVY_JOBS, creditState } from "../public/js/credit.js";

test("credito: livelli e testi", () => {
  const ok = creditState({ spent: 1.2, limit: 3 });
  assert.deepEqual({ pct: ok.pct, level: ok.level, text: ok.text }, { pct: 40, level: "ok", text: "Credito di Claude del mese: 40% usato." });
  const low = creditState({ spent: 2.55, limit: 3 });
  assert.equal(low.level, "low");
  assert.match(low.text, /85% usato/);
  const out = creditState({ spent: 3.4, limit: 3 });
  assert.equal(out.level, "out");
  assert.equal(out.pct, 100, "mai oltre il 100%");
  assert.match(out.text, /si rinnova il primo del mese/);
});

test("credito: senza limite noto non si dice nulla", () => {
  assert.equal(creditState({ spent: 1, limit: null }), null);
  assert.equal(creditState({ spent: NaN, limit: 3 }), null);
  assert.equal(creditState(), null);
});

test("credito: solo le richieste lunghe chiedono conferma", () => {
  assert.ok(HEAVY_JOBS.has("/api/module") && HEAVY_JOBS.has("/api/dispensa"));
  assert.ok(!HEAVY_JOBS.has("/api/exam-format-text"), "quella parte da sola alla creazione dell'esame: niente finestre a sorpresa");
});
