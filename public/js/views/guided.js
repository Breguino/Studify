// Esercizi guidati dal metodo del docente: 1) studia il suo esercizio svolto un passaggio alla volta, chiedendoti il perché;
// 2) completa lo svolgimento di un esercizio simile; 3) risolvine uno da solo. Chi è già bravo parte dal terzo (vedi worked.js).
import { renderMarkdown } from "../markdown.js";
import { rich } from "../math.js";
import { recordScore } from "../progress.js";
import * as store from "../store.js";
import { badge, emptyState, h } from "../ui.js";
import { fade, guidedPlan, splitSteps } from "../worked.js";
import { methodByTutor } from "../provenance.js";
import { openReview } from "./quiz.js";

const STEP_NAME = (who) => ({ example: `Studia l'esempio ${who}`, complete: "Completa lo svolgimento", solo: "Risolvi da solo" });

export function guidedView(exam, tid, query) {
  const t = exam.module?.topics.find((x) => x.id === tid);
  const mi = Math.max(0, Number(query.get("m")) || 0);
  const method = t?.methods?.[mi];
  const back = h("a", { class: "muted", href: `#/exam/${exam.id}/topic/${tid}` }, "← Argomento");
  if (!method) return emptyState("Nessun metodo del docente", "Questo argomento non ha esercizi svolti dal docente: caricali nei materiali con il tipo «Esercizi svolti dal docente».", h("a", { class: "btn", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  const taskId = query.get("task");
  const who = methodByTutor(exam, method) ? "del tutor" : "del docente"; // esercizi svolti al tutorato: è il tutor, non chi fa l'esame
  const plan = guidedPlan(exam, tid, method);
  // da solo: un esercizio simile; se non c'è, si rifà quello del docente senza guardare
  const solo = plan.solo ?? (method.problem ? { prompt: method.problem, modelAnswer: method.solution, rubric: method.steps, own: true } : null);
  const steps = plan.steps.filter((s) => (s !== "solo" || solo) && (s !== "example" || method.problem));
  const root = h("div", { class: "session guided" });
  let k = 0;

  const head = () => h("div", { class: "session-head" }, back,
    h("div", { class: "row" }, badge("esercizi guidati", "brand"), h("span", { class: "muted small" }, `${k + 1}/${steps.length} · ${STEP_NAME(who)[steps[k]]}`)));
  const methodList = () => h("ol", { class: "method-steps" }, method.steps.map((st) => h("li", {}, rich(st))));
  const next = () => { k++; render(); };

  function example() {
    const parts = splitSteps(method.solution);
    let shown = 1;
    const sol = h("div", { class: "worked-solution" });
    const more = h("button", { class: "btn" });
    const after = h("div", { class: "stack", hidden: true },
      h("div", { class: "callout" }, h("b", {}, "Il metodo, in generale:"), methodList()),
      h("label", { class: "stack", style: { gap: "4px", fontWeight: 400 } }, h("span", { class: "small" }, "In una frase: quando si usa questo metodo, e qual è il passaggio dove è più facile sbagliare?"),
        h("textarea", { class: "self-explain", "aria-label": "La tua spiegazione", style: { minHeight: "70px" } })),
      h("div", {}, h("button", { class: "btn primary", onclick: next }, steps[k + 1] === "complete" ? "Avanti: completa uno svolgimento" : "Avanti: risolvi da solo")));
    const show = () => {
      sol.replaceChildren(...parts.slice(0, shown).flatMap((p, i) => [h("div", { class: "step-label small muted" }, `Passaggio ${i + 1}`), ...renderMarkdown(p)]));
      more.textContent = `Passaggio successivo (${shown + 1}/${parts.length})`;
      more.hidden = shown >= parts.length;
      after.hidden = shown < parts.length;
    };
    more.addEventListener("click", () => { shown++; show(); });
    show();
    return h("div", { class: "card stack" },
      h("h2", { style: { margin: 0 } }, rich(method.name)),
      h("div", { class: "callout" }, h("b", {}, "Un passaggio alla volta: "), `prima di andare avanti chiediti perché ${who === "del tutor" ? "il tutor" : "il docente"} fa quel passaggio e da dove viene ogni numero. Spiegarsi i passaggi è ciò che rende utile un esempio svolto; leggerlo e basta dà solo l'impressione di aver capito.`),
      h("div", { class: "worked" }, h("b", { class: "small" }, `Esercizio ${who}${method.source ? ` (${method.source})` : ""}`), ...renderMarkdown(method.problem || "")),
      sol, h("div", {}, more), after,
      method.verified ? null : h("p", { class: "muted small", style: { margin: 0 } }, "Copiato da Claude da un PDF: se un passaggio non torna, controlla sul materiale originale."));
  }

  function complete() {
    const q = plan.complete;
    const { shown, hidden } = fade(q.modelAnswer);
    const ta = h("textarea", { "aria-label": "I passaggi mancanti", placeholder: `Scrivi i ${hidden.length} passaggi che mancano, uno per riga…` });
    const box = h("div", { class: "stack" });
    const check = h("button", { class: "btn primary", onclick: () => {
      check.remove();
      ta.disabled = true;
      box.append(h("div", { class: "callout" }, h("b", {}, "I passaggi mancanti"), ...hidden.flatMap((p) => renderMarkdown(p))),
        h("p", { class: "small", style: { margin: 0 } }, "Confronta con i tuoi: stessi passaggi, stesso ordine? Se ti sei bloccato, rileggi il metodo prima di passare all'esercizio da solo."),
        h("details", { class: "small" }, h("summary", {}, "Il metodo"), methodList()),
        h("div", {}, h("button", { class: "btn primary", onclick: next }, "Avanti: risolvi da solo")));
    } }, "Controlla");
    return h("div", { class: "card stack" },
      h("p", { class: "muted small", style: { margin: 0 } }, `Un esercizio dello stesso tipo: i primi passaggi ci sono, completa tu gli altri con il metodo ${who}.`),
      h("div", { class: "q-prompt" }, ...renderMarkdown(q.prompt)),
      h("div", { class: "worked-solution" }, ...shown.flatMap((p, i) => [h("div", { class: "step-label small muted" }, `Passaggio ${i + 1}`), ...renderMarkdown(p)])),
      ta, box, h("div", {}, check));
  }

  function soloStep() {
    let hint = false;
    const ta = h("textarea", { "aria-label": "Il tuo svolgimento", placeholder: "Svolgi l'esercizio, un passaggio per riga, senza guardare gli appunti…", style: { minHeight: "180px" } });
    const hintBox = h("div", { hidden: true }, h("div", { class: "callout warn" }, h("b", {}, "Il metodo (aiuto usato): "), methodList()));
    const hintBtn = h("button", { class: "btn ghost small", onclick: () => { hint = true; hintBox.hidden = false; hintBtn.remove(); } }, "Mi blocco: mostra il metodo");
    const review = h("div", { class: "stack" });
    const check = h("button", { class: "btn primary", onclick: () => {
      check.remove();
      hintBtn.remove();
      ta.disabled = true;
      const rv = openReview({ question: solo.prompt, reference: solo.modelAnswer, rubric: solo.rubric?.length ? solo.rubric : method.steps, answer: ta.value, language: exam.language });
      review.append(rv.el, h("div", {}, h("button", { class: "btn primary", onclick: () => {
        // con l'aiuto del metodo un esercizio riuscito vale al massimo 0,7: va rifatto senza
        if (!solo.own) exam.qstats = recordScore(exam.qstats, solo.id, hint ? Math.min(0.7, rv.score()) : rv.score());
        if (taskId) exam.done[taskId] = true;
        store.logActivity(exam);
        store.save();
        done(rv.score(), hint);
      } }, "Conferma")));
    } }, "Controlla");
    return h("div", { class: "card stack" },
      plan.expert ? h("div", { class: "callout" }, h("b", {}, "Parti dall'esercizio: "), "con i risultati che hai, gli esempi svolti ti servirebbero poco. Se ti blocchi, apri il metodo.") : null,
      solo.own ? h("p", { class: "muted small", style: { margin: 0 } }, `Non ci sono ancora esercizi simili nel modulo: rifai quello ${who} senza guardare la soluzione.`) : null,
      h("div", { class: "q-prompt" }, ...renderMarkdown(solo.prompt)),
      ta, hintBox, h("div", { class: "row" }, check, hintBtn), review);
  }

  function done(score, hint) {
    const others = t.methods.map((m, i) => [m, i]).filter(([, i]) => i !== mi);
    root.replaceChildren(h("div", { class: "card stack" },
      h("h2", { style: { margin: 0 } }, "Fatto"),
      h("p", { style: { margin: 0 } }, score >= 0.75 && !hint ? `Hai risolto l'esercizio con il metodo ${who}. Tra qualche giorno rifallo con esercizi misti: riconoscere quale metodo usare è la parte che all'esame conta di più.`
        : hint ? "Ti è servito il metodo: rifai un esercizio di questo tipo domani, senza aiuto." : `Qualche passaggio non torna: rileggi l'esempio ${who} e riprova domani con un esercizio nuovo.`),
      h("div", { class: "row" },
        h("a", { class: "btn primary", href: `#/exam/${exam.id}/quiz?mode=topics&topics=${tid}&kind=problem` }, "Altri esercizi su questo argomento"),
        ...others.map(([m, i]) => h("a", { class: "btn", href: `#/exam/${exam.id}/guided/${tid}?m=${i}` }, `Metodo: ${m.name}`)),
        h("a", { class: "btn ghost", href: `#/exam/${exam.id}/today` }, "Torna al piano"))));
  }

  function render() {
    const body = { example, complete, solo: soloStep }[steps[k]]();
    root.replaceChildren(head(), body);
  }
  if (!steps.length) return emptyState("Niente da esercitare", "Il metodo non ha un esercizio svolto né esercizi simili.", back);
  render();
  return root;
}
