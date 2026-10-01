import { daysLeft, methodsFor, statsFor } from "../domain.js";
import { addDays, today } from "../dates.js";
import { sessionAdvice } from "../methods.js";
import { weakTopics } from "../progress.js";
import { badge, bar, emptyState, h, pct } from "../ui.js";

/* --------------------------------- METODI --------------------------------- */

export function methodsTab(exam) {
  const m = methodsFor(exam);
  const MODE = { normale: "Preparazione tranquilla", intensivo: "Preparazione intensiva", emergenza: "Modalità emergenza" };
  return h("div", { class: "stack", style: { maxWidth: "760px" } },
    h("div", { class: "card" },
      h("h2", {}, "Come studierai e perché"),
      h("p", { class: "muted" }, `Scelti in base a: tipo di prova (${exam.type}), giorni rimasti (${Math.max(daysLeft(exam), 0)}), tuo livello di partenza (${exam.level}/5) e ore al giorno (${exam.hoursPerDay}).`),
      badge(MODE[m.mode], m.mode === "emergenza" ? "bad" : m.mode === "intensivo" ? "warn" : "good")),
    ...m.warnings.map((w) => h("div", { class: "callout warn" }, w)),
    h("div", { class: "stack", style: { gap: "10px" } }, m.methods.map((x) =>
      h("div", { class: "method" },
        h("div", { class: "row between" }, h("b", {}, x.name), h("span", { class: "small muted" }, `priorità ${x.weight}/100`)),
        bar(x.weight / 100, { label: `priorità ${x.name}` }),
        h("div", { class: "small" }, x.how),
        x.why.length ? h("ul", {}, x.why.map((w) => h("li", {}, w))) : null))),
    h("div", { class: "card flat" }, h("h3", {}, "Ritmo"), h("p", { style: { margin: 0 } }, sessionAdvice(exam.sessionMinutes))),
    h("details", { class: "card flat" },
      h("summary", {}, h("b", {}, "Perché non ti chiediamo se sei «visivo» o «uditivo»?")),
      h("p", { class: "muted", style: { marginTop: "8px" } }, "Gli studi non trovano alcun vantaggio nell'adattare il metodo allo «stile di apprendimento» dichiarato. Quello che conta davvero è come ti eserciti: mettersi alla prova (richiamo attivo) e ripassare a intervalli superano di molto rileggere e evidenziare. Per questo il piano è guidato da tipo di esame, tempo e livello — e non dalle preferenze."),
      h("p", { class: "muted small", style: { margin: 0 } }, "Riferimenti: Dunlosky et al. 2013 (Psychological Science in the Public Interest); Roediger & Karpicke 2006; Pashler et al. 2008 sugli stili di apprendimento.")),
  );
}

/* -------------------------------- PROGRESSI ------------------------------- */

const tone = (s) => (s == null ? "" : s >= 0.75 ? "good" : s >= 0.45 ? "warn" : "bad");

export function progressTab(exam) {
  if (!exam.module) return emptyState("Nessun dato", "Genera prima il modulo di studio.");
  const { stats, ready } = statsFor(exam);
  const weak = weakTopics(exam.module, stats, 3);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i - 13));
  const max = Math.max(1, ...days.map((d) => exam.activity[d] ?? 0));
  const reviews = days.reduce((s, d) => s + (exam.activity[d] ?? 0), 0);

  return h("div", { class: "stack" },
    h("div", { class: "grid" },
      h("div", { class: "card" }, h("div", { class: "muted small" }, "Preparazione stimata"), h("div", { class: "score-big" }, pct(ready)), ready == null ? h("p", { class: "muted small" }, "Inizia con flashcard o quiz per ottenere una stima.") : bar(ready, { tone: tone(ready), label: "preparazione" }),
        h("p", { class: "muted small", style: { margin: "8px 0 0" } }, "È una stima su memoria (flashcard consolidate) e quiz, non una previsione del voto.")),
      h("div", { class: "card" }, h("div", { class: "muted small" }, "Attività, ultimi 14 giorni"),
        h("div", { class: "spark", role: "img", "aria-label": `${reviews} azioni negli ultimi 14 giorni` }, days.map((d) => h("i", { class: (exam.activity[d] ?? 0) ? "" : "zero", style: { height: `${Math.max(8, ((exam.activity[d] ?? 0) / max) * 100)}%` }, title: `${d}: ${exam.activity[d] ?? 0}` }))),
        h("p", { class: "small muted", style: { margin: "8px 0 0" } }, `${reviews} tra carte ripassate, domande e spiegazioni.`))),
    weak.length ? h("div", { class: "callout" }, h("b", {}, "Dove conviene lavorare ora: "), weak.map((t) => t.title).join(" · "), " ",
      h("a", { href: `#/exam/${exam.id}/quiz?mode=topics&topics=${weak.map((t) => t.id).join(",")}` }, "Fai un quiz mirato →")) : null,
    h("div", { class: "card", style: { overflowX: "auto" } }, h("table", {},
      h("thead", {}, h("tr", {}, ["Argomento", "Flashcard solide", "Quiz", "Stato"].map((t) => h("th", {}, t)))),
      h("tbody", {}, exam.module.topics.map((t) => {
        const s = stats[t.id];
        return h("tr", {},
          h("td", {}, h("a", { href: `#/exam/${exam.id}/topic/${t.id}` }, t.title)),
          h("td", {}, s.cards ? `${s.mature}/${s.cards}` : "—"),
          h("td", {}, s.quiz == null ? "—" : pct(s.quiz)),
          h("td", { style: { minWidth: "140px" } }, h("div", { class: "progress-line" }, bar(s.score ?? 0, { tone: tone(s.score), label: `padronanza ${t.title}` }), h("span", { class: "small" }, pct(s.score)))));
      })))));
}
