import { go } from "../nav.js";
import { daysLeft, dueCount, ensurePlan, flashQueue, isDone, methodsFor, setDone, taskHref } from "../domain.js";
import { daysBetween, fmtDate, fmtDay, today } from "../dates.js";
import { METHODS, EXAM_TYPES } from "../methods.js";
import { PHASES } from "../planner.js";
import { fmtLesson } from "../timetable.js";
import { studyStart, windowDays } from "../workload.js";
import { clipRich, rich, richParas } from "../math.js";
import * as store from "../store.js";
import { badge, emptyState, h } from "../ui.js";
import { core } from "../core.js";
import { materialsTab } from "./materials.js";
import { methodsTab, progressTab } from "./insights.js";
import { dispensaTab } from "./dispensa.js";
import { esamiTab } from "./esami.js";
import { allPapers, analysisValid, topicFrequency } from "../past-exams.js";
import { examQuestionStats } from "../exam-questions.js";
import { renderMarkdown } from "../markdown.js";
import { pagesLabel, readingMinutes, shortName, topicReading, uncoveredChapters } from "../books.js";
import { timeOfQuote } from "../transcripts.js";
import { methodByTutor, saidByTutor } from "../provenance.js";

const TABS = [
  ["today", "Oggi"],
  ["materials", "Materiali"],
  ["module", "Modulo"],
  ["dispensa", "Dispensa"],
  ["esami", "Esami passati"],
  ["methods", "Metodi"],
  ["progress", "Progressi"],
];

export function hubView(exam, tab) {
  if (!TABS.some(([k]) => k === tab)) tab = "today";
  const dl = daysLeft(exam);
  const apHere = exam.appelli?.find((a) => a.date === exam.date);
  const others = (exam.appelli ?? []).filter((a) => a.date !== exam.date && a.date >= today());
  const body = { today: todayTab, materials: materialsTab, module: moduleTab, dispensa: dispensaTab, esami: esamiTab, methods: methodsTab, progress: progressTab }[tab](exam);
  return h(
    "div",
    { class: "stack", style: { gap: "0" } },
    h("div", { class: "row between no-print" },
      h("div", {}, h("h1", { style: { marginBottom: "2px" } }, exam.name),
        h("div", { class: "muted" }, `${fmtDate(exam.date)}${exam.dateTentative ? " (data provvisoria)" : ""}${apHere?.time ? ` ore ${apHere.time}` : ""}${apHere?.room ? ` · ${apHere.room}` : ""} · ${dl > 0 ? `tra ${exam.dateTentative ? "circa " : ""}${dl} giorni` : dl === 0 ? "oggi" : "già passato"} · ${EXAM_TYPES[exam.type]}`,
          exam.formatSource?.url ? h("span", {}, " (", h("a", { href: exam.formatSource.url, target: "_blank", rel: "noopener noreferrer" }, "fonte del formato"), ")") : null),
        exam.dateTentative ? h("div", { class: "muted small" }, "Gli appelli non sono ancora usciti: quando escono ", h("a", { href: "#/import" }, "importali"), " (o cambia la data da «Modifica») e il piano si ricalcola.") : null,
        exam.studyDays ? h("div", { class: "muted small" }, `Studio ${studyStart(exam, today()) > today() ? `dal ${fmtDate(studyStart(exam, today()))}` : "in corso"}: ${windowDays(exam, today())} giorni prima dell'esame, ${exam.hoursPerDay} h al giorno.`) : null,
        others.length ? h("div", { class: "muted small" }, `Altri appelli: ${others.map((a) => fmtDate(a.date)).join(", ")} (cambia da «Modifica»)`) : null,
        exam.university ? h("div", { class: "muted small" }, [exam.university, exam.degree, exam.year ? `${exam.year}° anno` : "", exam.cfu ? `${exam.cfu} CFU` : ""].filter(Boolean).join(" · ")) : null),
      h("a", { class: "btn ghost", href: `#/exam/${exam.id}/edit` }, "Modifica")),
    h("nav", { class: "tabs no-print", "aria-label": "Sezioni" }, TABS.map(([k, t]) => h("a", { href: `#/exam/${exam.id}/${k}`, "aria-current": k === tab ? "page" : null }, t))),
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
  const waiting = plan.start && plan.start > today(); // la finestra di studio non è ancora iniziata
  const [first, ...rest] = waiting ? [null, ...plan.days] : plan.days;
  const due = dueCount(exam);
  const tasks = first?.tasks ?? [];
  const minutes = tasks.reduce((s, t) => s + t.minutes, 0);
  const budget = exam.hoursPerDay * 60;

  return h("div", { class: "stack" },
    ...m.warnings.map((w) => h("div", { class: "callout warn" }, w)),
    plan.skipped.length ? h("div", { class: "callout warn" }, h("b", {}, "Rimandati per mancanza di tempo: "), plan.skipped.map((id) => exam.module.topics.find((t) => t.id === id)?.title).join(", "), ". Li affronterai se avanza tempo.") : null,
    waiting ? h("div", { class: "callout" }, h("b", {}, `Lo studio di ${exam.name} inizia ${fmtDay(plan.start)}`),
      ` (tra ${daysBetween(today(), plan.start)} ${daysBetween(today(), plan.start) === 1 ? "giorno" : "giorni"}): ti sei dato ${plan.days.length} giorni prima dell'esame. `,
      due ? h("span", {}, "Nel frattempo hai ", h("a", { href: `#/exam/${exam.id}/flash` }, `${due} flashcard da ripassare`), ": bastano pochi minuti e tengono vivo quello che hai già studiato.") : "Fino ad allora nessuna attività per questo esame, salvo gli appunti nuovi da aggiungere al modulo.",
      " Per cambiare la finestra usa «Modifica».") : null,
    h("div", { class: "row between" },
      h("div", {}, h("h2", { style: { marginBottom: 0 } }, waiting ? "Il piano" : `Oggi · ${fmtDay(today())}`), h("span", { class: "muted small" }, first ? `${PHASES[first.phase]} · ~${minutes} min su ${first.lessons?.length ? first.usable : Math.round(budget)} disponibili` : "")),
      h("button", { class: "btn small", onclick: () => { ensurePlan(exam, true); core.rerender(); } }, "Ricalcola piano")),
    first?.lessons?.length ? h("div", { class: "callout" }, h("b", {}, "Oggi hai lezione: "), first.lessons.map(fmtLesson).join(" · "), first.avail > 0 ? `. Tempo di studio rimasto: ~${first.avail} min.` : ". Poco tempo di studio oggi: solo un po' di flashcard.") : null,
    first?.overload ? h("div", { class: "callout warn" }, "Il carico di oggi supera il tempo che hai indicato: fai prima le attività in cima.") : null,
    h("div", { class: "stack", style: { gap: "8px" } }, tasks.map((t) => taskRow(exam, t))),
    rest.length ? h("div", {}, h("h2", { style: { marginTop: "18px" } }, waiting ? `Dal ${fmtDate(plan.start)}` : "Prossimi giorni"), h("div", { class: "stack", style: { gap: "8px" } },
      rest.map((d) => h("details", { class: "day" },
        h("summary", {}, h("b", {}, fmtDay(d.date)), badge(PHASES[d.phase], d.phase === "simulate" ? "warn" : "brand"), h("span", { class: "muted small" }, `~${d.minutes} min`), d.lessons?.length ? badge(`lezioni ${d.lessons.length}`) : null, d.overload ? badge("carico alto", "warn") : null),
        h("ul", {}, d.lessons?.length ? h("li", {}, `Lezioni: ${d.lessons.map(fmtLesson).join(" · ")}`) : null, d.tasks.filter((t) => t.kind !== "flash").map((t) => h("li", {}, t.title))))))) : null,
  );
}

/* --------------------------------- MODULO -------------------------------- */

const ORIGIN = { notes: "dai tuoi materiali", online: "dal web", model: "conoscenza generale dell'AI (verifica)" };

/** In quale registrazione e a che minuto c'è la frase (dalle trascrizioni automatiche, che hanno i segni dei minuti). */
function whenSaid(exam, quote) {
  for (const m of exam.materials) {
    if (!m.auto) continue;
    const at = timeOfQuote(m.text, quote);
    if (at) return `dal min ${at} della registrazione «${m.title}»`; // il segno è l'inizio del paragrafo (circa un minuto)
  }
  return null;
}

/** Frasi del docente sull'esame (dalle sbobine o dagli appunti), con la fonte. */
function hintsBox(exam, hints, mod, title = "Cosa ha detto il docente sull'esame") {
  if (!hints?.length) return null;
  const topicTitle = (id) => mod.topics.find((t) => t.id === id)?.title;
  return h("div", { class: "callout hints" }, h("b", {}, `${title} (${hints.length})`),
    h("ul", {}, hints.map((x) => h("li", {},
      h("q", {}, rich(x.quote)),
      h("span", { class: "muted small" }, ` — ${[x.source, whenSaid(exam, x.quote), title === "Cosa ha detto il docente sull'esame" ? topicTitle(x.topicId) : null].filter(Boolean).join(" · ")}`),
      saidByTutor(exam, x.quote) ? h("div", { class: "small" }, badge("detta al tutorato, non dal docente", "warn")) : null,
      x.note ? h("div", { class: "small" }, rich(x.note)) : null,
      x.verified === false ? h("div", { class: "small muted" }, "Citazione da un PDF: non verificata sul testo, controllala.") : null))),
    h("div", { class: "small muted" }, "Frasi copiate dai materiali: quelle da sbobine o appunti di colleghi sono di seconda mano, e se sono di un anno precedente il docente potrebbe aver cambiato idea."));
}

/** Capitoli del programma (dai libri consigliati) che nessun argomento del modulo copre; capitoli delle dispense senza argomento. */
function uncoveredBox(exam) {
  const all = uncoveredChapters(exam);
  const u = all.filter((x) => x.book.kind !== "dispense");
  const d = all.filter((x) => x.book.kind === "dispense");
  const n = (k) => `${k} ${k === 1 ? "capitolo" : "capitoli"}`;
  return [
    u.length ? h("div", { class: "callout warn" }, h("b", {}, `Nel programma ma non nei tuoi materiali (${n(u.length)})`),
      h("ul", {}, u.map((x) => h("li", {}, h("i", {}, x.book.title), ` — cap. ${x.chapter.n} «`, rich(x.chapter.title), "»"))),
      h("div", { class: "small" }, "Il programma li comprende: studiali sul libro o aggiungi gli appunti e le slide di quelle lezioni, poi «Aggiungi al modulo».")) : null,
    d.length ? h("div", { class: "callout warn" }, h("b", {}, `Nelle dispense del docente ma senza un argomento nel modulo (${n(d.length)})`),
      h("ul", {}, d.map((x) => h("li", {}, h("i", {}, shortName(x.book)), ` — cap. ${x.chapter.n} «`, rich(x.chapter.title), "»", h("span", { class: "muted small" }, ` · p. ${x.chapter.page}${x.book.pdfPages ? " del PDF" : ""}`)))),
      h("div", { class: "small" }, "L'AI ha ricevuto queste pagine ma non ne ha fatto un argomento: forse le ha accorpate a un altro (controlla qui sotto), o le ha saltate. In quel caso studiale direttamente sulle dispense.")) : null,
  ].filter(Boolean);
}

/** Aggiunto o approfondito con gli appunti nelle ultime due settimane. */
const recent = (iso) => !!iso && daysBetween(today(new Date(iso)), today()) <= 14;

/** «in 4/5 prove»: quante prove d'esame passate chiedono l'argomento (dopo l'analisi). */
function examBadge(t, { n, freq }) {
  if (!n) return null;
  const k = freq.get(t.id) ?? 0;
  return k ? badge(`in ${k}/${n} ${n === 1 ? "prova" : "prove"}`, k / n >= 0.5 && n >= 3 ? "bad" : "warn") : null;
}

function moduleTab(exam) {
  const mod = exam.module;
  if (!mod) return emptyState("Nessun modulo", "Crealo dalla scheda Materiali.", h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Vai ai materiali"));
  const freq = topicFrequency(exam);
  const papers = allPapers(exam).length;
  const asked = examQuestionStats(exam);
  const askedBadge = (t) => {
    const a = asked.perTopic.get(t.id);
    return a ? badge(`${a.questions} ${a.questions === 1 ? "domanda d'esame" : "domande d'esame"}${a.weight > a.questions ? ` · chieste ${a.weight} volte` : ""}`, "warn") : null;
  };
  return h("div", { class: "stack" },
    h("div", { class: "card" }, h("h2", {}, mod.title || "Modulo di studio"), richParas(mod.overview),
      h("div", { class: "row" }, badge(`${mod.topics.length} argomenti`, "brand"), badge(`${mod.flashcards.length} flashcard`), badge(`${mod.questions.length} domande`), mod.examHints?.length ? badge(`${mod.examHints.length} ${mod.examHints.length === 1 ? "indicazione" : "indicazioni"} sull'esame`, "bad") : null, mod.local ? badge("modalità base", "warn") : null),
      exam.moduleUpdatedAt ? h("p", { class: "muted small", style: { margin: "8px 0 0" } }, `Aggiornato con appunti nuovi il ${fmtDate(today(new Date(exam.moduleUpdatedAt)))}.`) : null),
    hintsBox(exam, mod.examHints, mod),
    papers ? h("div", { class: "callout row between" }, h("span", {}, freq.n
      ? `Esami passati: ${freq.n} ${freq.n === 1 ? "prova analizzata" : "prove analizzate"}. Accanto a ogni argomento, in quante prove compare.`
      : `Hai ${papers} ${papers === 1 ? "prova" : "prove"} d'esame tra i materiali: analizzale per vedere quali argomenti escono di più.`),
      h("a", { class: "btn small", href: `#/exam/${exam.id}/esami` }, freq.n ? "Esami passati" : "Analizza")) : null,
    asked.inQuiz.length ? h("div", { class: "callout row between" }, h("span", {}, `${asked.inQuiz.length} domande d'esame vere sono nel quiz, con la risposta modello.${asked.uncovered.length ? ` Altre ${asked.uncovered.length} dell'elenco non ancora.` : ""}`),
      h("a", { class: "btn small", href: `#/exam/${exam.id}/quiz?mode=exam` }, "Allenati")) : null,
    uncoveredBox(exam),
    mod.gaps?.length ? h("div", { class: "callout warn" }, h("b", {}, "Cose da verificare / lacune individuate"), h("ul", {}, mod.gaps.map((g) => h("li", {}, rich(g))))) : null,
    h("div", { class: "stack", style: { gap: "10px" } }, mod.topics.map((t) =>
      h("a", { class: "topic card flat", href: `#/exam/${exam.id}/topic/${t.id}`, style: { textDecoration: "none", color: "inherit" } },
        h("div", { class: "row between" }, h("h3", { style: { margin: 0 } }, rich(t.title)),
          h("div", { class: "row" }, examBadge(t, freq), askedBadge(t), officialBadge(mod, t), t.methods?.length ? badge(t.methods.length === 1 ? "metodo del docente" : `${t.methods.length} metodi del docente`, "brand") : null, (mod.examHints ?? []).some((x) => x.topicId === t.id) ? badge("il docente ne parla per l'esame", "bad") : null, recent(t.addedAt) ? badge("nuovo", "brand") : recent(t.updatedAt) ? badge("approfondito", "brand") : null, badge(["", "marginale", "importante", "centrale"][t.importance], t.importance === 3 ? "bad" : t.importance === 2 ? "warn" : ""), exam.learned[t.id] ? badge("studiato", "good") : null)),
        h("p", { class: "muted small", style: { margin: "6px 0 0" } }, rich(clipRich(t.summary, 180)))))),
    mod.sources?.length ? h("details", {}, h("summary", {}, `Fonti online (${mod.sources.length})`), h("ul", { class: "source-list" }, mod.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null,
    h("p", { class: "muted small" }, "Il modulo è una bozza generata da te + AI: confrontalo con il programma e con il docente. Le fonti web e le conoscenze generali vanno verificate."),
  );
}

/* ---------------------------------- ARGOMENTO ---------------------------------- */

/** Che cosa leggere sui libri consigliati per questo argomento (dall'indice), con le pagine e il tempo. */
function readingBox(exam, t) {
  const r = topicReading(exam, t.id);
  if (!r.length) return null;
  const mins = (n) => { const m = readingMinutes(n, exam.level); return m >= 60 ? `~${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `~${m} min`; };
  const disp = r.some((x) => x.book.kind === "dispense");
  return h("div", { class: "callout" }, h("b", {}, disp ? (r.every((x) => x.book.kind === "dispense") ? "Da leggere sulle dispense del docente" : "Da leggere: prima le dispense del docente") : "Da leggere sul libro"),
    h("ul", {}, r.map((x) => h("li", {}, h("i", {}, x.book.title), x.book.kind === "dispense" && !/dispens/i.test(x.book.title) ? " (dispense)" : "", ` — cap. ${x.chapter.n} «`, rich(x.chapter.title), "»",
      x.pages ? h("span", { class: "muted small" }, ` · ${pagesLabel(x.book, x.pages)}${x.count ? ` (${x.count} pagine, ${mins(x.count)})` : ""}`) : null,
      x.book.own === "no" ? h("span", { class: "muted small" }, " · non ce l'hai: in biblioteca?") : null))),
    h("div", { class: "small muted" }, `Leggi dopo aver provato a ricordare (vedi sopra) e chiudi ${r.every((x) => x.book.kind === "dispense") ? "le dispense" : "il libro"} per rispondere alle domande: rileggere da solo non fissa.`));
}

/** «3 esercizi con soluzione»: esercizi delle esercitazioni su questo argomento. */
const officialBadge = (mod, t) => {
  const qs = mod.questions.filter((q) => q.official && q.topicId === t.id);
  const n = qs.length;
  if (!n) return null;
  return qs.every((q) => q.official.quiz) ? badge(`${n} ${n === 1 ? "domanda del docente" : "domande del docente"}`, "good") : badge(`${n} ${n === 1 ? "esercizio con soluzione" : "esercizi con soluzione"}`, "good");
};

/** Gli esercizi delle esercitazioni su questo argomento, con la soluzione ufficiale. */
function officialBox(exam, t) {
  const qs = exam.module.questions.filter((q) => q.official && q.topicId === t.id);
  if (!qs.length) return null;
  const quiz = qs.every((q) => q.official.quiz);
  return h("div", { class: "callout" }, h("b", {}, `${quiz ? "Domande dei quiz del docente" : qs.some((q) => q.official.quiz) ? "Esercitazioni e quiz del docente" : "Esercizi delle esercitazioni"} (${qs.length})`),
    h("ul", {}, qs.slice(0, 8).map((q) => h("li", {}, h("span", { class: "muted small" }, `${q.official.source}: `), rich(clipRich(q.prompt, 120))))),
    h("div", { class: "small muted" }, "Prova a farli da solo prima di guardare la soluzione ufficiale: è il tentativo, anche sbagliato, che fa imparare."),
    h("a", { class: "btn small", href: `#/exam/${exam.id}/quiz?mode=official&topics=${t.id}` }, quiz ? "Rispondi a queste domande" : "Fai questi esercizi"));
}

/** Come risolve il docente gli esercizi di questo argomento: i passaggi, il suo esercizio svolto, gli esercizi guidati. */
function methodsBox(exam, t) {
  if (!t.methods?.length) return null;
  const byTutor = t.methods.map((m) => !!methodByTutor(exam, m));
  const all = byTutor.every(Boolean);
  return h("div", { class: "card stack" }, h("h3", { style: { margin: 0 } }, all ? "Come lo risolve il tutor" : "Come lo risolve il docente"),
    h("p", { class: "muted small", style: { margin: 0 } }, all
      ? "Dagli esercizi svolti al tutorato: un buon procedimento da imparare, ma all'esame valgono notazione e impostazione del docente, se sono diverse."
      : "Dai suoi esercizi svolti: all'esame si aspetta questo procedimento e questa notazione."),
    ...t.methods.map((m, i) => h("div", { class: "method-box" },
      h("div", { class: "row between" }, h("b", {}, rich(m.name), !all && byTutor[i] ? h("span", {}, " ", badge("dal tutorato", "warn")) : null), h("a", { class: "btn small primary", href: `#/exam/${exam.id}/guided/${t.id}?m=${i}` }, "Esercizi guidati")),
      h("ol", { class: "method-steps" }, m.steps.map((st) => h("li", {}, rich(st)))),
      m.problem ? h("details", { class: "small" }, h("summary", {}, `L'esercizio svolto ${byTutor[i] ? "al tutorato" : "dal docente"}${m.source ? ` (${m.source})` : ""}`),
        h("div", { class: "worked" }, ...renderMarkdown(m.problem), h("div", { class: "worked-solution" }, ...renderMarkdown(m.solution || "(svolgimento non trovato)"))),
        m.verified ? null : h("p", { class: "muted" }, "Copiato da Claude da un PDF: controllalo sul materiale originale.")) : null)));
}

/** Le domande d'esame vere su questo argomento (dagli elenchi), le più chieste prima. */
function examQuestionsBox(exam, t) {
  const { inQuiz, weight } = examQuestionStats(exam);
  const qs = inQuiz.filter((q) => q.topicId === t.id).sort((a, b) => weight(b) - weight(a));
  if (!qs.length) return null;
  return h("div", { class: "callout" }, h("b", {}, `Domande d'esame su questo argomento (${qs.length})`),
    h("ul", {}, qs.slice(0, 8).map((q) => h("li", {}, rich(q.prompt), weight(q) > 1 ? h("span", { class: "muted small" }, ` — chiesta ${weight(q)} volte`) : null))),
    qs.length > 8 ? h("div", { class: "small muted" }, `… e altre ${qs.length - 8}.`) : null,
    h("a", { class: "btn small", href: `#/exam/${exam.id}/quiz?mode=exam&topics=${t.id}` }, "Rispondi a queste domande"));
}

/** Che cosa hanno chiesto su questo argomento le prove d'esame passate (dall'analisi). */
function askedBox(exam, t) {
  if (!analysisValid(exam)) return null;
  const { n, freq } = topicFrequency(exam);
  const labels = new Map(allPapers(exam).map((p) => [p.key, p.label]));
  const asked = Object.entries(exam.pastExams.papers).filter(([k]) => labels.has(k))
    .flatMap(([k, p]) => p.items.filter((it) => it.topicIds.includes(t.id)).map((it) => ({ ...it, paper: p.label || labels.get(k) })));
  if (!asked.length) return n >= 3 ? h("p", { class: "muted small" }, `Negli esami passati: non compare in nessuna delle ${n} prove analizzate (non vuol dire che non uscirà).`) : null;
  return h("div", { class: "callout" }, h("b", {}, `Negli esami passati: in ${freq.get(t.id)} ${n === 1 ? "prova" : `prove su ${n}`}`),
    h("ul", {}, asked.slice(0, 6).map((it) => h("li", {}, rich(it.summary), h("span", { class: "muted small" }, ` — ${it.paper}, es. ${it.n}`)))),
    asked.length > 6 ? h("div", { class: "small muted" }, `… e altri ${asked.length - 6}.`) : null);
}

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
    h("div", { class: "row between" }, h("h1", {}, rich(t.title)), h("div", { class: "row" }, badge(`difficoltà ${t.difficulty}/3`), badge(["", "marginale", "importante", "centrale"][t.importance], t.importance === 3 ? "bad" : "warn"))),
    h("div", { class: "callout" }, h("b", {}, "Prima di leggere: "), "scrivi o pensa a 3 cose che già sai su questo argomento (anche sbagliate). Il tentativo di ricordare rende la lettura successiva più efficace."),
    hintsBox(exam, (mod.examHints ?? []).filter((x) => x.topicId === t.id), mod, "Il docente su questo argomento"),
    askedBox(exam, t),
    examQuestionsBox(exam, t),
    readingBox(exam, t),
    methodsBox(exam, t),
    officialBox(exam, t),
    h("div", { class: "card" }, h("h3", {}, "In breve"), richParas(t.summary)),
    t.keyConcepts.length ? h("div", { class: "card" }, h("h3", {}, "Concetti chiave"), t.keyConcepts.map((k) => h("div", { class: "concept" }, h("b", {}, rich(k.term)), rich(k.definition)))) : null,
    t.mustKnow.length ? h("div", { class: "card" }, h("h3", {}, "Da saper dire senza appunti"), h("ul", {}, t.mustKnow.map((m) => h("li", {}, rich(m))))) : null,
    t.commonMistakes.length ? h("div", { class: "callout warn" }, h("b", {}, "Errori frequenti"), h("ul", {}, t.commonMistakes.map((m) => h("li", {}, rich(m))))) : null,
    h("p", { class: "muted small" }, `Origine: ${ORIGIN[t.origin] ?? ORIGIN.notes}.`, srcs.length ? h("span", {}, " Fonti: ", srcs.map((s, i) => [i ? ", " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url)])) : null),
    h("div", { class: "row between" },
      h("div", { class: "row" }, complete, h("a", { class: "btn", href: `#/exam/${exam.id}/explain/${t.id}` }, "Spiega a parole tue")),
      h("div", { class: "row" }, prev ? h("a", { class: "btn ghost", href: `#/exam/${exam.id}/topic/${prev.id}` }, "← Precedente") : null, next ? h("a", { class: "btn ghost", href: `#/exam/${exam.id}/topic/${next.id}` }, "Successivo →") : null)),
  );
}
