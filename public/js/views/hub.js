import { go } from "../nav.js";
import { daysLeft, ensurePlan, flashQueue, isDone, methodsFor, setDone, taskHref } from "../domain.js";
import { fmtDate, fmtDay, today } from "../dates.js";
import { METHODS, EXAM_TYPES } from "../methods.js";
import { PHASES } from "../planner.js";
import { fmtLesson } from "../timetable.js";
import * as store from "../store.js";
import { badge, emptyState, h, paras } from "../ui.js";
import { core } from "../core.js";
import { materialsTab } from "./materials.js";
import { methodsTab, progressTab } from "./insights.js";

const TABS = [
  ["today", "Oggi"],
  ["materials", "Materiali"],
  ["module", "Modulo"],
  ["methods", "Metodi"],
  ["progress", "Progressi"],
];

export function hubView(exam, tab) {
  if (!TABS.some(([k]) => k === tab)) tab = "today";
  const dl = daysLeft(exam);
  const apHere = exam.appelli?.find((a) => a.date === exam.date);
  const others = (exam.appelli ?? []).filter((a) => a.date !== exam.date && a.date >= today());
  const body = { today: todayTab, materials: materialsTab, module: moduleTab, methods: methodsTab, progress: progressTab }[tab](exam);
  return h(
    "div",
    { class: "stack", style: { gap: "0" } },
    h("div", { class: "row between" },
      h("div", {}, h("h1", { style: { marginBottom: "2px" } }, exam.name),
        h("div", { class: "muted" }, `${fmtDate(exam.date)}${exam.dateTentative ? " (data provvisoria)" : ""}${apHere?.time ? ` ore ${apHere.time}` : ""}${apHere?.room ? ` · ${apHere.room}` : ""} · ${dl > 0 ? `tra ${exam.dateTentative ? "circa " : ""}${dl} giorni` : dl === 0 ? "oggi" : "già passato"} · ${EXAM_TYPES[exam.type]}`,
          exam.formatSource?.url ? h("span", {}, " (", h("a", { href: exam.formatSource.url, target: "_blank", rel: "noopener noreferrer" }, "fonte del formato"), ")") : null),
        exam.dateTentative ? h("div", { class: "muted small" }, "Gli appelli non sono ancora usciti: quando escono ", h("a", { href: "#/import" }, "importali"), " (o cambia la data da «Modifica») e il piano si ricalcola.") : null,
        others.length ? h("div", { class: "muted small" }, `Altri appelli: ${others.map((a) => fmtDate(a.date)).join(", ")} (cambia da «Modifica»)`) : null,
        exam.university ? h("div", { class: "muted small" }, [exam.university, exam.degree, exam.year ? `${exam.year}° anno` : "", exam.cfu ? `${exam.cfu} CFU` : ""].filter(Boolean).join(" · ")) : null),
      h("a", { class: "btn ghost", href: `#/exam/${exam.id}/edit` }, "Modifica")),
    h("nav", { class: "tabs", "aria-label": "Sezioni" }, TABS.map(([k, t]) => h("a", { href: `#/exam/${exam.id}/${k}`, "aria-current": k === tab ? "page" : null }, t))),
    body,
  );
}

/* --------------------------------- OGGI --------------------------------- */

function taskRow(exam, task) {
  const done = isDone(exam, task);
  const href = taskHref(exam, task);
  let meta = task.minutes ? `${task.minutes} min` : "";
  if (task.method) meta += ` · ${METHODS[task.method].name}`;
  if (task.kind === "flash" && exam.module) {
    const q = flashQueue(exam);
    meta += ` · ${q.due.length} da ripassare, ${q.fresh.length} nuove`;
  }
  const check = h("input", { type: "checkbox", checked: done, "aria-label": `Segna «${task.title}» come fatto` });
  check.addEventListener("change", () => {
    setDone(exam, task, check.checked);
    core.rerender();
  });
  return h("div", { class: `task ${done ? "done" : ""}` },
    task.kind === "rest" ? h("span", { "aria-hidden": "true" }, "🌙") : check,
    h("div", { class: "spacer" }, h("div", { class: "t-title" }, task.title), h("div", { class: "t-meta" }, meta)),
    href && !done ? h("a", { class: "btn primary small", href }, "Inizia") : null);
}

function todayTab(exam) {
  if (!exam.module)
    return emptyState("Manca il modulo di studio", "Aggiungi i materiali e genera il modulo: da lì costruiamo il piano giorno per giorno.", h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Aggiungi materiali"));
  if (daysLeft(exam) <= 0) return h("div", { class: "callout warn" }, daysLeft(exam) === 0 ? "L'esame è oggi: in bocca al lupo! Un ultimo sguardo ai punti deboli, poi niente di nuovo." : "La data d'esame è passata. Puoi modificarla dalle impostazioni dell'esame.");

  const plan = ensurePlan(exam);
  const m = methodsFor(exam);
  const [first, ...rest] = plan.days;
  const tasks = first?.tasks ?? [];
  const minutes = tasks.reduce((s, t) => s + t.minutes, 0);
  const budget = exam.hoursPerDay * 60;

  return h("div", { class: "stack" },
    ...m.warnings.map((w) => h("div", { class: "callout warn" }, w)),
    plan.skipped.length ? h("div", { class: "callout warn" }, h("b", {}, "Rimandati per mancanza di tempo: "), plan.skipped.map((id) => exam.module.topics.find((t) => t.id === id)?.title).join(", "), ". Li affronterai se avanza tempo.") : null,
    h("div", { class: "row between" },
      h("div", {}, h("h2", { style: { marginBottom: 0 } }, `Oggi · ${fmtDay(today())}`), h("span", { class: "muted small" }, first ? `${PHASES[first.phase]} · ~${minutes} min su ${first.lessons?.length ? first.usable : Math.round(budget)} disponibili` : "")),
      h("button", { class: "btn small", onclick: () => { ensurePlan(exam, true); core.rerender(); } }, "Ricalcola piano")),
    first?.lessons?.length ? h("div", { class: "callout" }, h("b", {}, "Oggi hai lezione: "), first.lessons.map(fmtLesson).join(" · "), first.avail > 0 ? `. Tempo di studio rimasto: ~${first.avail} min.` : ". Poco tempo di studio oggi: solo un po' di flashcard.") : null,
    first?.overload ? h("div", { class: "callout warn" }, "Il carico di oggi supera il tempo che hai indicato: fai prima le attività in cima.") : null,
    h("div", { class: "stack", style: { gap: "8px" } }, tasks.map((t) => taskRow(exam, t))),
    rest.length ? h("div", {}, h("h2", { style: { marginTop: "18px" } }, "Prossimi giorni"), h("div", { class: "stack", style: { gap: "8px" } },
      rest.map((d) => h("details", { class: "day" },
        h("summary", {}, h("b", {}, fmtDay(d.date)), badge(PHASES[d.phase], d.phase === "simulate" ? "warn" : "brand"), h("span", { class: "muted small" }, `~${d.minutes} min`), d.lessons?.length ? badge(`lezioni ${d.lessons.length}`) : null, d.overload ? badge("carico alto", "warn") : null),
        h("ul", {}, d.lessons?.length ? h("li", {}, `Lezioni: ${d.lessons.map(fmtLesson).join(" · ")}`) : null, d.tasks.filter((t) => t.kind !== "flash").map((t) => h("li", {}, t.title))))))) : null,
  );
}

/* --------------------------------- MODULO -------------------------------- */

const ORIGIN = { notes: "dai tuoi appunti", online: "dal web", model: "conoscenza generale dell'AI (verifica)" };

function moduleTab(exam) {
  const mod = exam.module;
  if (!mod) return emptyState("Nessun modulo", "Crealo dalla scheda Materiali.", h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Vai ai materiali"));
  return h("div", { class: "stack" },
    h("div", { class: "card" }, h("h2", {}, mod.title || "Modulo di studio"), paras(mod.overview),
      h("div", { class: "row" }, badge(`${mod.topics.length} argomenti`, "brand"), badge(`${mod.flashcards.length} flashcard`), badge(`${mod.questions.length} domande`), mod.local ? badge("modalità base", "warn") : null)),
    mod.gaps?.length ? h("div", { class: "callout warn" }, h("b", {}, "Cose da verificare / lacune individuate"), h("ul", {}, mod.gaps.map((g) => h("li", {}, g)))) : null,
    h("div", { class: "stack", style: { gap: "10px" } }, mod.topics.map((t) =>
      h("a", { class: "topic card flat", href: `#/exam/${exam.id}/topic/${t.id}`, style: { textDecoration: "none", color: "inherit" } },
        h("div", { class: "row between" }, h("h3", { style: { margin: 0 } }, t.title),
          h("div", { class: "row" }, badge(["", "marginale", "importante", "centrale"][t.importance], t.importance === 3 ? "bad" : t.importance === 2 ? "warn" : ""), exam.learned[t.id] ? badge("studiato", "good") : null)),
        h("p", { class: "muted small", style: { margin: "6px 0 0" } }, t.summary.slice(0, 180) + (t.summary.length > 180 ? "…" : ""))))),
    mod.sources?.length ? h("details", {}, h("summary", {}, `Fonti online (${mod.sources.length})`), h("ul", { class: "source-list" }, mod.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null,
    h("p", { class: "muted small" }, "Il modulo è una bozza generata da te + AI: confrontalo con il programma e con il docente. Le fonti web e le conoscenze generali vanno verificate."),
  );
}

/* ---------------------------------- ARGOMENTO ---------------------------------- */

export function topicView(exam, tid, query) {
  const mod = exam.module;
  const t = mod?.topics.find((x) => x.id === tid);
  if (!t) return h("div", { class: "empty" }, h("h3", {}, "Argomento non trovato"), h("a", { class: "btn", href: `#/exam/${exam.id}/module` }, "Torna al modulo"));
  const taskId = query.get("task");
  const idx = mod.topics.indexOf(t);
  const prev = mod.topics[idx - 1];
  const next = mod.topics[idx + 1];
  const srcs = (t.sourceIds ?? []).map((id) => mod.sources?.find((s) => s.id === id)).filter(Boolean);

  const complete = h("button", { class: "btn primary", onclick: () => {
    exam.learned[t.id] = true;
    if (taskId) exam.done[taskId] = true;
    store.logActivity(exam);
    store.save();
    go(`#/exam/${exam.id}/quiz?mode=topics&topics=${t.id}`);
  } }, exam.learned[t.id] ? "Rifai un quiz su questo argomento" : "Ho studiato: mettimi alla prova");

  return h("div", { class: "stack", style: { maxWidth: "760px" } },
    h("a", { class: "muted", href: `#/exam/${exam.id}/module` }, "← Modulo"),
    h("div", { class: "row between" }, h("h1", {}, t.title), h("div", { class: "row" }, badge(`difficoltà ${t.difficulty}/3`), badge(["", "marginale", "importante", "centrale"][t.importance], t.importance === 3 ? "bad" : "warn"))),
    h("div", { class: "callout" }, h("b", {}, "Prima di leggere: "), "scrivi o pensa a 3 cose che già sai su questo argomento (anche sbagliate). Il tentativo di ricordare rende la lettura successiva più efficace."),
    h("div", { class: "card" }, h("h3", {}, "In breve"), paras(t.summary)),
    t.keyConcepts.length ? h("div", { class: "card" }, h("h3", {}, "Concetti chiave"), t.keyConcepts.map((k) => h("div", { class: "concept" }, h("b", {}, k.term), k.definition))) : null,
    t.mustKnow.length ? h("div", { class: "card" }, h("h3", {}, "Da saper dire senza appunti"), h("ul", {}, t.mustKnow.map((m) => h("li", {}, m)))) : null,
    t.commonMistakes.length ? h("div", { class: "callout warn" }, h("b", {}, "Errori frequenti"), h("ul", {}, t.commonMistakes.map((m) => h("li", {}, m)))) : null,
    h("p", { class: "muted small" }, `Origine: ${ORIGIN[t.origin] ?? ORIGIN.notes}.`, srcs.length ? h("span", {}, " Fonti: ", srcs.map((s, i) => [i ? ", " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url)])) : null),
    h("div", { class: "row between" },
      h("div", { class: "row" }, complete, h("a", { class: "btn", href: `#/exam/${exam.id}/explain/${t.id}` }, "Spiega a parole tue")),
      h("div", { class: "row" }, prev ? h("a", { class: "btn ghost", href: `#/exam/${exam.id}/topic/${prev.id}` }, "← Precedente") : null, next ? h("a", { class: "btn ghost", href: `#/exam/${exam.id}/topic/${next.id}` }, "Successivo →") : null)),
  );
}
