import { rich, richParas } from "../math.js";
import { today } from "../dates.js";
import { flashQueue } from "../domain.js";
import { GRADES, nextInterval, review } from "../srs.js";
import * as store from "../store.js";
import { bar, emptyState, h } from "../ui.js";
import { core } from "../core.js";

const fmtInt = (d) => (d <= 1 ? "1 g" : `${d} g`);

export function flashView(exam, query) {
  const mod = exam.module;
  if (!mod) return emptyState("Nessun modulo", "Crea prima il modulo.", h("a", { class: "btn", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  const taskId = query.get("task");
  const includeAll = query.get("all") === "1";
  const root = h("div", { class: "session" });
  const stats = { reviewed: 0, again: 0 };
  let { queue, excluded } = flashQueue(exam, { topicId: query.get("topic"), includeAll });
  const total0 = queue.length;
  const requeues = new Map();
  let revealed = false;

  const finish = () => {
    if (taskId && total0 > 0) { exam.done[taskId] = true; store.save(); }
    const next = Object.values(exam.srs).map((s) => s.due).filter((d) => d && d > today()).sort()[0];
    root.replaceChildren(
      h("div", { class: "card stack", style: { textAlign: "center" } },
        h("h2", {}, total0 ? "Sessione completata 🎉" : "Niente da ripassare ora"),
        total0 ? h("p", {}, `${stats.reviewed} risposte, ${stats.reviewed - stats.again} ricordate al primo colpo.`) : h("p", { class: "muted" }, "Non ci sono carte in scadenza né nuove da introdurre oggi."),
        next ? h("p", { class: "muted small" }, `Prossime carte in scadenza: ${next}.`) : null,
        excluded && !includeAll ? h("div", { class: "callout" }, `${excluded} carte di argomenti non ancora studiati sono state escluse. `, h("a", { href: `#/exam/${exam.id}/flash?all=1` }, "Includile")) : null,
        h("div", { class: "row", style: { justifyContent: "center" } },
          h("button", { class: "btn", onclick: () => { const q = flashQueue(exam, { topicId: query.get("topic"), includeAll: true, extra: 10 }); queue = q.fresh.slice(0, 10); if (!queue.length) return; stats.reviewed = stats.again = 0; render(); } }, "+10 carte nuove"),
          h("a", { class: "btn primary", href: `#/exam/${exam.id}/today` }, "Torna al piano"))));
  };

  const grade = (g) => {
    const card = queue[0];
    exam.srs[card.id] = review(exam.srs[card.id], g, today(), exam.date);
    store.logActivity(exam);
    stats.reviewed++;
    queue = queue.slice(1);
    if (g === GRADES.AGAIN) {
      stats.again++;
      const n = requeues.get(card.id) ?? 0;
      if (n < 2) { requeues.set(card.id, n + 1); queue.splice(Math.min(queue.length, 4), 0, card); } // la rivedi a breve, non subito
    }
    store.save();
    revealed = false;
    render();
  };

  function onKey(e) {
    if (!root.isConnected) return removeEventListener("keydown", onKey);
    if (e.target.matches("input,textarea,select")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!revealed && queue.length) { revealed = true; render(); } }
    else if (revealed && "1234".includes(e.key)) grade(Number(e.key) - 1);
  }
  addEventListener("keydown", onKey);

  function render() {
    if (!queue.length) return finish();
    const card = queue[0];
    const topic = mod.topics.find((t) => t.id === card.topicId);
    const st = exam.srs[card.id];
    root.replaceChildren(
      h("div", { class: "session-head" }, h("a", { class: "btn ghost small back", href: `#/exam/${exam.id}/today` }, "← Esci"), h("span", { class: "muted small" }, `${queue.length} rimaste · ${topic?.title ?? ""}`)),
      bar(1 - queue.length / Math.max(total0 + stats.again, 1), { label: "avanzamento sessione" }),
      h("div", { class: "flashcard", style: { marginTop: "14px" }, "aria-live": "polite" },
        h("div", {}, h("span", { class: "side" }, "Domanda"), rich(card.front), revealed ? h("div", { style: { marginTop: "18px" } }, h("span", { class: "side" }, "Risposta"), h("div", { class: "answer" }, richParas(card.back))) : null)),
      revealed
        ? h("div", { class: "grades" }, [["Di nuovo", GRADES.AGAIN, "again"], ["Difficile", GRADES.HARD, ""], ["Bene", GRADES.GOOD, "good"], ["Facile", GRADES.EASY, ""]].map(([t, g, c], i) =>
            h("button", { class: `btn ${c}`, onclick: () => grade(g) }, h("span", {}, `${t} `, h("span", { class: "kbd" }, i + 1)), h("small", {}, fmtInt(nextInterval(st, g))))))
        : h("div", { style: { marginTop: "14px", textAlign: "center" } }, h("button", { class: "btn primary", onclick: () => { revealed = true; render(); } }, "Mostra risposta ", h("span", { class: "kbd" }, "spazio")),
            h("p", { class: "muted small" }, "Prima prova a rispondere mentalmente (o ad alta voce): è lo sforzo di ricordare che consolida.")),
    );
  }
  render();
  return root;
}
