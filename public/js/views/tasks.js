// Le attività del piano, come righe da spuntare: nella scheda «Oggi» e nella home.
import { flashQueue, isDone, setDone, taskHref } from "../domain.js";
import { METHODS } from "../methods.js";
import { badge, h } from "../ui.js";
import { core } from "../core.js";

/** Il docente parla per l'esame dell'argomento di questa attività? */
const saidForExam = (exam, task) => !!task.topicId && (exam.module?.examHints ?? []).some((x) => x.topicId === task.topicId);

/**
 * Una riga del piano. `now`: è l'attività da fare adesso (in evidenza, con «Inizia» principale).
 * `compact`: per la home, titolo e una riga di dettagli.
 */
export function taskRow(exam, task, { now = false, compact = false } = {}) {
  const done = isDone(exam, task);
  const href = taskHref(exam, task);
  const method = task.method ? METHODS[task.method].name : "";
  let extra = "";
  if (task.kind === "flash" && exam.module) {
    const q = flashQueue(exam);
    extra = `${q.due.length} da ripassare, ${q.fresh.length} nuove`;
  }
  const check = h("input", { type: "checkbox", checked: done, "aria-label": `Segna «${task.title}» come fatto` });
  check.addEventListener("change", () => {
    setDone(exam, task, check.checked);
    core.rerender();
  });
  const meta = compact
    ? h("div", { class: "t-meta" }, [task.minutes ? `${task.minutes} min` : "", method, extra].filter(Boolean).join(" · "))
    : h("div", { class: "t-meta" },
        method ? badge(method, now ? "brand" : "") : null,
        saidForExam(exam, task) ? badge("il docente ne parla per l'esame", "bad") : null,
        extra ? h("span", {}, extra) : null);
  return h("div", { class: `task${done ? " done" : ""}${now ? " now" : ""}${compact ? " compact" : ""}` },
    task.kind === "rest" ? h("span", { "aria-hidden": "true" }, "🌙") : check,
    h("div", { class: "spacer t-body" },
      now && !done ? h("span", { class: "t-now" }, "Adesso") : null,
      h("div", { class: "t-title" }, task.title), meta),
    !compact && task.minutes ? h("span", { class: "t-min" }, `${task.minutes} min`) : null,
    href && !done && !compact ? h("a", { class: `btn small${now ? " primary" : ""}`, href }, "Inizia") : null);
}
