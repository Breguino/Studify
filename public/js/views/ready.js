// Passo 3 del primo esame: il modulo è pronto. Che cosa contiene, da dove viene, che cosa controllare, e la prima sessione.
import { ensurePlan } from "../domain.js";
import { fmtDayLong, today } from "../dates.js";
import { pagesLabel, shortName, topicReading } from "../books.js";
import { topicFrequency } from "../past-exams.js";
import { rich } from "../math.js";
import * as store from "../store.js";
import { go } from "../nav.js";
import { badge, emptyState, h, stepper } from "../ui.js";

const IMPORTANCE = ["", "marginale", "importante", "centrale"];
const SHOWN = 6;

/** Da dove viene un argomento: pagine delle dispense e dei libri, prove d'esame, domande del docente. */
function sourcesOf(exam, t, freq) {
  const parts = topicReading(exam, t.id).slice(0, 2).map((r) => `${shortName(r.book)}${r.pages ? ` ${pagesLabel(r.book, r.pages)}` : ""}`);
  const k = freq.n ? freq.freq.get(t.id) ?? 0 : 0;
  if (k) parts.push(`in ${k}/${freq.n} ${freq.n === 1 ? "prova d'esame" : "prove d'esame"}`);
  const off = exam.module.questions.filter((q) => q.official && q.topicId === t.id).length;
  if (off) parts.push(`${off} ${off === 1 ? "domanda o esercizio" : "domande o esercizi"} del docente`);
  return parts.join(" · ");
}

function topicRow(exam, t, freq) {
  const said = (exam.module.examHints ?? []).some((x) => x.topicId === t.id);
  const src = sourcesOf(exam, t, freq);
  return h("div", { class: "ready-topic" },
    h("div", { class: "ready-topic-text" }, h("b", {}, rich(t.title)), src ? h("span", { class: "small muted" }, src) : null),
    h("div", { class: "row" },
      badge(IMPORTANCE[t.importance] || "importante", t.importance === 3 ? "brand" : ""),
      said ? badge("il docente ne parla per l'esame", "bad") : null,
      t.origin === "model" ? badge("da verificare", "warn") : t.origin === "online" ? badge("dal web", "brand") : badge("dai tuoi materiali", "good")));
}

export function readyView(exam) {
  const mod = exam.module;
  if (!mod) return emptyState("Il modulo non c'è ancora", "Carica i materiali e genera il modulo: poi lo controlli qui.", h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  const plan = ensurePlan(exam);
  const waiting = !!plan?.start && plan.start > today();
  const first = waiting ? null : plan?.days[0];
  const freq = topicFrequency(exam);
  const official = mod.questions.filter((q) => q.official).length;
  const unverified = (mod.examHints ?? []).filter((x) => x.verified === false).length;
  const toCheck = mod.topics.filter((t) => t.origin === "model").length + (mod.gaps?.length ?? 0);
  const topics = mod.topics.map((t, i) => ({ t, i })).sort((a, b) => b.t.importance - a.t.importance || a.i - b.i).map((x) => x.t);
  const start = () => {
    exam.onboarding = false;
    store.save();
    go(`#/exam/${exam.id}/today`);
  };
  const stat = (n, label, tone = "") => h("div", { class: `ready-stat ${tone}` }, h("b", {}, String(n)), h("span", {}, label));

  return h("div", { class: "stack ready" },
    stepper(3),
    h("div", { class: "page-intro" }, h("h1", {}, `Il modulo di ${exam.name} è pronto`),
      h("p", { class: "lead" }, toCheck || unverified
        ? "Dai un'occhiata a ciò che è segnato «da verificare»: il resto viene dai tuoi materiali, con la fonte accanto."
        : "Viene dai tuoi materiali, con la fonte accanto: dai un'occhiata e parti.")),
    h("div", { class: "ready-stats" },
      stat(mod.topics.length, mod.topics.length === 1 ? "argomento" : "argomenti"),
      stat(mod.flashcards.length, "flashcard"),
      stat(mod.questions.length, "domande da quiz"),
      official ? stat(official, "domande ed esercizi del docente, con la sua soluzione", "good") : null,
      mod.examHints?.length ? stat(mod.examHints.length, mod.examHints.length === 1 ? "frase del docente sull'esame" : "frasi del docente sull'esame", "bad") : null),
    h("div", { class: "form-layout" },
      h("section", { class: "card ready-topics", "aria-labelledby": "ready-topics-title" },
        h("div", { class: "row between" }, h("h2", { id: "ready-topics-title" }, "Argomenti, dal più importante"),
          h("span", { class: "small muted" }, freq.n ? "L'importanza tiene conto degli esami passati" : "L'importanza viene dai materiali")),
        topics.slice(0, SHOWN).map((t) => topicRow(exam, t, freq)),
        topics.length > SHOWN ? h("details", {}, h("summary", { class: "ready-more" }, `Mostra gli altri ${topics.length - SHOWN} argomenti`), topics.slice(SHOWN).map((t) => topicRow(exam, t, freq))) : null,
        toCheck ? h("div", { class: "callout warn" }, h("b", {}, `${toCheck} ${toCheck === 1 ? "cosa" : "cose"} da verificare: `), "argomenti che non vengono dai tuoi materiali e lacune individuate. ", h("a", { href: `#/exam/${exam.id}/module` }, "Le trovi nel modulo")) : null,
        unverified ? h("p", { class: "small muted", style: { margin: 0 } }, `${unverified} ${unverified === 1 ? "frase del docente presa" : "frasi del docente prese"} da un PDF non ${unverified === 1 ? "è stata verificata" : "sono state verificate"} sul testo: controllale nel modulo.`) : null),
      h("aside", { class: "plan-preview ready-start", "aria-labelledby": "ready-start-title" },
        h("span", { class: "kicker" }, waiting ? "Il piano è pronto" : "Il piano parte oggi"),
        h("h2", { id: "ready-start-title" }, waiting ? `Lo studio inizia ${fmtDayLong(plan.start)}` : first ? `Prima sessione: ${first.minutes} min` : "Il piano è pronto"),
        first ? h("ul", { class: "ready-tasks" }, first.tasks.filter((t) => t.kind !== "rest").map((t) => h("li", {}, h("span", {}, t.title), h("b", {}, `${t.minutes} min`)))) : null,
        h("button", { class: "btn ready-go", type: "button", onclick: start }, waiting ? "Vai al piano →" : "Inizia oggi →"),
        h("a", { class: "ready-link", href: `#/exam/${exam.id}/module` }, "Rivedi tutto il modulo"),
        h("p", { class: "plan-note" }, "Puoi aggiungere materiali quando vuoi: il piano si ricalcola."))),
  );
}
