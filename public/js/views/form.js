import * as api from "../api.js";
import { core } from "../core.js";
import { go } from "../nav.js";
import { coursesForYear, examDefaultsFromCourse, FORMAT_LABEL, findCourse, yearLabel } from "../curriculum.js";
import { addDays, fmtDate, today } from "../dates.js";
import { formatFromSyllabus, suggestExamType } from "../exam-type.js";
import { busyMinutes, lastLessonOf, TENTATIVE_GAP_DAYS } from "../timetable.js";
import { feasibility, HOURS_PER_CFU, overlapping, studyStart, windowDays, windowHours } from "../workload.js";
import { PHASES, splitPhases } from "../planner.js";
import { EXAM_TYPES, sessionAdvice } from "../methods.js";
import * as store from "../store.js";
import { confirmDialog, h, stepper, toast } from "../ui.js";

const LEVELS = {
  1: "1 · Parto da zero",
  2: "2 · Ne so poco",
  3: "3 · Conosco le basi",
  4: "4 · Ci sono già dentro",
  5: "5 · Mi serve solo ripassare",
};
const WINDOWS = { 0: "Da oggi fino all'esame", 3: "3 giorni", 5: "5 giorni", 7: "1 settimana", 10: "10 giorni", 14: "2 settimane", 21: "3 settimane", 28: "4 settimane", 42: "6 settimane", 56: "8 settimane" };
const GENERIC_HINT = "Cambia il mix di metodi: all'orale conta spiegare, al test riconoscere.";

// Ricerche della modalità d'esame (per insegnamento): sopravvivono ai re-render e non si ripetono nella stessa sessione.
const formatSearches = new Map();
const key = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function searchFormat({ university, degree, academicYear, name, course }) {
  const k = key(course?.name ?? name);
  if (!formatSearches.has(k)) {
    const job = api.runJob("/api/exam-format", { university, degree, course: course?.name ?? name, academicYear }, () => {})
      .then((r) => {
        if (course) {
          if (r.found) Object.assign(course, { format: r.format, formatEvidence: r.evidence, url: r.url });
          course.formatSearch = { at: today(), found: r.found, details: r.details, teacher: r.teacher, academicYear: r.academicYear, caveats: r.caveats };
          store.save();
        }
        return r;
      })
      .catch((e) => { formatSearches.delete(k); throw e; });
    formatSearches.set(k, job);
  }
  return formatSearches.get(k);
}

/**
 * Scelte a pulsante (radio vere) con `value` in lettura e scrittura, come un <select>:
 * il resto del modulo le usa allo stesso modo (value, evento change che sale dai radio).
 */
function choices(name, opts, cur, cls = "") {
  const el = h("div", { class: `choices ${cls}` }, Object.entries(opts).map(([k, t]) => {
    const [n, label] = cls === "levels" ? t.split(" · ") : [null, t];
    return h("label", { class: "choice" }, h("input", { type: "radio", name, value: k, checked: String(k) === String(cur) }),
      n ? h("span", { class: "choice-text" }, h("b", {}, n), h("span", {}, label)) : h("span", {}, t));
  }));
  Object.defineProperty(el, "value", {
    get: () => el.querySelector("input:checked")?.value ?? "",
    set: (v) => { for (const r of el.querySelectorAll("input")) r.checked = r.value === String(v); },
  });
  return el;
}

export function examFormView(exam, prefill = {}) {
  const isNew = !exam;
  const prof = store.state.profile;
  const courses = prof?.courses ?? [];
  const v = exam ?? { name: prefill.name ?? "", date: addDays(today(), 30), type: "scritto", level: 2, hoursPerDay: 3, sessionMinutes: 25, language: "italiano", cfu: 0, year: prof?.studentYear || 0, dateTentative: false, studyDays: 0 };
  const university = exam ? exam.university : prof?.university ?? "";
  const degree = exam ? exam.degree : prof?.degree ?? "";
  const f = {};
  const field = (key, label, input, hint) => {
    f[key] = input;
    return h("label", {}, label, input, hint ? h("span", { class: "hint" }, hint) : null);
  };
  const group = (key, legend, input, hint) => {
    f[key] = input;
    return h("fieldset", { class: "field-group" }, h("legend", {}, legend), input, hint ? h("span", { class: "hint" }, hint) : null);
  };
  const select = (opts, cur) => h("select", {}, Object.entries(opts).map(([k, t]) => h("option", { value: k, selected: String(k) === String(cur) }, t)));
  let formatSource = exam?.formatSource ?? null;

  const where = h("div", { class: "callout row between" },
    university || degree
      ? h("span", {}, h("b", {}, university || "—"), degree ? ` · ${degree}` : "")
      : h("span", {}, "Non hai ancora indicato ateneo e corso di studio: aiutano a trovare materiali e a suggerire il formato d'esame."),
    h("a", { href: "#/profile" }, university || degree ? "Cambia" : "Imposta"));

  const courseList = h("datalist", { id: "courses" });
  const fillCourses = (year) => courseList.replaceChildren(...coursesForYear(courses, year).map((c) => h("option", { value: c.name }, `${c.kind === "a_scelta" ? "a scelta · " : ""}${c.cfu ? `${c.cfu} CFU` : ""}`)));
  const electiveNote = h("p", { class: "muted small", style: { margin: 0 } });
  const nameInput = h("input", { required: true, value: v.name, placeholder: "es. Microeconomia", list: "courses", autocomplete: "off" });
  const tentative = h("input", { type: "checkbox", id: "date-tentative", checked: !!v.dateTentative });
  const loadBox = h("div", { id: "load-box" });
  // modalità d'esame dal testo della scheda dell'insegnamento incollato (funziona anche senza ricerca web)
  const syllabus = h("textarea", { id: "syllabus-text", placeholder: "Incolla qui la sezione «Modalità di verifica dell'apprendimento» (o tutta la scheda) dalla pagina dell'insegnamento…", style: { minHeight: "90px" } });
  const syllabusMsg = h("span", { class: "hint", id: "syllabus-msg" });
  const syllabusBox = h("details", { id: "syllabus-box" },
    h("summary", { class: "small" }, "Incolla la scheda dell'insegnamento per ricavare il tipo di prova"),
    h("div", { class: "stack", style: { gap: "6px", marginTop: "6px" } }, syllabus,
      h("div", { class: "row" }, h("button", { type: "button", class: "btn small", onclick: () => readSyllabus() }, "Ricava il tipo di prova"), syllabusMsg)));
  const dateNote = h("span", { class: "hint" });

  const form = h(
    "form",
    {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        const data = {
          name: f.name.value.trim(),
          university,
          degree,
          cfu: Math.min(60, Math.max(0, Number(f.cfu.value) || 0)),
          year: Number(f.year.value) || 0,
          date: f.date.value,
          dateTentative: tentative.checked,
          type: f.type.value,
          level: Number(f.level.value),
          hoursPerDay: Math.min(12, Math.max(0.5, Number(f.hours.value) || 2)),
          sessionMinutes: Number(f.session.value),
          studyDays: Number(f.window.value) || 0,
          language: f.language.value.trim() || "italiano",
          formatSource: typeTouched ? null : formatSource,
        };
        if (!data.name) return toast("Dai un nome all'esame.", "error");
        if (!data.date || data.date <= today()) return toast("La data d'esame deve essere futura.", "error");
        if (isNew) {
          const created = store.newExam({ ...data, onboarding: true }); // passi 2 e 3: materiali, poi il modulo pronto
          go(`#/exam/${created.id}/materials`);
        } else {
          Object.assign(exam, data);
          exam.plan = null; // il piano dipende da data, tipo e ore
          store.save();
          go(`#/exam/${exam.id}`);
        }
      },
    },
    where,
    h("div", { class: "cols" },
      field("name", "Insegnamento / esame", nameInput, courses.length ? "Scegli dal tuo piano di studi per precompilare CFU e tipo di prova." : null),
      field("year", "Anno di corso", select({ 0: courses.length ? "Tutti gli anni" : "Non indicato", 1: "1° anno", 2: "2° anno", 3: "3° anno", 4: "4° anno", 5: "5° anno", 6: "6° anno" }, v.year || 0), courses.length ? "Filtra l'elenco degli insegnamenti." : null)),
    courseList, electiveNote,
    h("div", { class: "cols" },
      h("div", { class: "stack", style: { gap: "6px" } },
        field("date", "Data dell'esame", h("input", { type: "date", required: true, value: v.date, min: addDays(today(), 1) })),
        h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontWeight: 400 } }, tentative, "Data provvisoria: gli appelli non sono ancora usciti"),
        v.appelli?.filter((a) => a.date >= today()).length > 1
          ? h("label", {}, "Appello", h("select", { id: "appello", onchange: (e) => { if (e.target.value) f.date.value = e.target.value; } },
              v.appelli.filter((a) => a.date >= today()).map((a) => h("option", { value: a.date, selected: a.date === v.date }, `${fmtDate(a.date)}${a.time ? ` ore ${a.time}` : ""}${a.room ? ` · ${a.room}` : ""}`))), h("span", { class: "hint" }, "Altri appelli importati: scegli quello a cui ti presenti."))
          : null),
      field("cfu", "CFU (facoltativo)", h("input", { type: "number", min: 0, max: 60, value: v.cfu || "" }), "Indicano l'ampiezza del programma."),
    ),
    group("type", "Tipo di prova", choices("exam-type", EXAM_TYPES, v.type)),
    syllabusBox,
    group("level", "Quanto conosci già la materia?", choices("exam-level", LEVELS, v.level, "levels"), "Non c'è una risposta giusta: serve per dosare spiegazioni e difficoltà."),
    h("div", { class: "cols" },
      field("window", "Quanto tempo ti dai per prepararlo?", select(WINDOWS, WINDOWS[v.studyDays] ? v.studyDays : 0), "Lo studio si concentra negli ultimi giorni prima dell'esame; prima non ti propongo attività."),
      field("hours", "Ore di studio al giorno", h("input", { type: "number", min: 0.5, max: 12, step: 0.5, value: v.hoursPerDay })),
    ),
    h("details", { class: "more-settings" }, h("summary", {}, "Altre impostazioni"),
      h("div", { class: "cols" },
        field("session", "Durata di un blocco di studio", select({ 25: "25 min", 45: "45 min", 60: "60 min", 90: "90 min" }, v.sessionMinutes), sessionAdvice(v.sessionMinutes)),
        field("language", "Lingua del materiale", h("input", { value: v.language })))),
    h("div", { class: "row form-actions" }, h("a", { class: "btn ghost", href: isNew ? "#/" : `#/exam/${exam.id}` }, "Annulla"), h("button", { class: "btn primary", type: "submit" }, isNew ? "Continua: aggiungi i materiali" : "Salva")),
  );

  /* Anteprima del piano: giorni di studio, ore, fasi (le stesse del piano vero); sotto, il carico rispetto ai CFU. */
  const previewNum = h("b", {});
  const previewText = h("span", {});
  const phaseBar = h("div", { class: "phase-bar", "aria-hidden": "true" });
  const phaseList = h("ul", { class: "phase-list" });
  const aside = h("aside", { class: "plan-preview", "aria-labelledby": "plan-preview-title" },
    h("span", { class: "kicker", id: "plan-preview-title" }, "Il piano, a grandi linee"),
    h("div", { class: "plan-count" }, previewNum, previewText),
    phaseBar, phaseList, loadBox,
    h("p", { class: "plan-note" }, "Gli argomenti e i minuti di ogni giorno arrivano dal modulo, quando carichi i materiali."));
  function renderPreview(days, hours) {
    if (!days) {
      previewNum.textContent = "";
      previewText.textContent = "Scegli la data dell'esame per vedere il piano.";
      return phaseBar.replaceChildren(), phaseList.replaceChildren();
    }
    previewNum.textContent = String(days);
    previewText.replaceChildren(days === 1 ? "giorno di studio," : "giorni di studio,", h("br"), `${String(hours).replace(".", ",")} ${hours === 1 ? "ora" : "ore"} al giorno`);
    const ph = splitPhases(days);
    const parts = [["learn", ph.learn], ["consolidate", ph.consolidate], ["simulate", ph.sim], ["light", ph.light]].filter(([, n]) => n > 0);
    phaseBar.replaceChildren(...parts.map(([k, n]) => h("span", { "data-phase": k, style: { flexGrow: String(n) } })));
    phaseList.replaceChildren(...parts.map(([k, n]) => h("li", { "data-phase": k }, h("span", {}, PHASES[k]), h("span", {}, k === "light" && n === 1 ? "il giorno prima" : `${n} ${n === 1 ? "giorno" : "giorni"}`))));
  }

  /* Tipo di prova e CFU si precompilano finché l'utente non li sceglie a mano.
     Priorità: piano di studi (dichiarato da scheda o da te) > euristica sulla materia. */
  const hint = h("span", { class: "hint" }, GENERIC_HINT);
  f.type.parentElement.append(hint);
  let typeTouched = !isNew;
  let cfuTouched = !isNew;
  f.type.addEventListener("change", () => { typeTouched = true; formatSource = null; refresh(); });
  f.cfu.addEventListener("input", () => (cfuTouched = true));

  function refresh() {
    hint.replaceChildren(GENERIC_HINT);
    if (typeTouched) return;
    const name = f.name.value;
    if (!name.trim()) return;
    const course = findCourse(courses, name);
    if (course?.year && !yearTouched) f.year.value = course.year;
    const d = examDefaultsFromCourse(course);
    if (d && !cfuTouched && d.cfu) f.cfu.value = d.cfu;
    if (d?.type) {
      f.type.value = d.type;
      formatSource = { text: d.evidence, url: d.url };
      const web = course.formatSearch?.found;
      hint.replaceChildren(...[
        web ? `Dalla scheda dell'insegnamento${course.formatSearch.source === "incollata" ? " che hai incollato" : ""}${course.formatSearch.academicYear ? ` (a.a. ${course.formatSearch.academicYear}${course.formatSearch.teacher ? `, ${course.formatSearch.teacher}` : ""})` : ""}: ${FORMAT_LABEL[d.type]}. «${d.evidence}» ` : `Dal tuo piano di studi: ${FORMAT_LABEL[d.type]}${d.evidence && d.evidence !== "demo" ? ` (${d.evidence})` : ""}. `,
        web && course.formatSearch.details ? `${course.formatSearch.details} ` : null,
        d.url ? h("a", { href: d.url, target: "_blank", rel: "noopener noreferrer" }, "fonte") : null, d.url ? " · " : null,
        web ? "Le modalità cambiano tra docenti e anni: verifica." : "Verifica con il tuo docente.",
      ].filter(Boolean));
      return;
    }
    formatSource = null;
    const sg = suggestExamType(name);
    f.type.value = sg.type;
    hint.replaceChildren(sg.match
      ? `Suggerito dalla materia («${sg.match}»): ${sg.label}. Dipende dal docente: correggilo se il tuo è diverso.`
      : "Materia non riconosciuta: ho messo «scritto + orale». Scegli quello del tuo esame.");
  }
  f.name.addEventListener("input", refresh);

  /* Modalità d'esame dalla scheda dell'insegnamento sul sito dell'ateneo (solo con ricerca web: server con chiave API).
     Parte da sola per gli insegnamenti del piano senza modalità nota, una volta sola; per gli altri c'è un bottone. */
  const searchLine = h("span", { class: "hint", id: "format-search" });
  hint.after(searchLine);
  const webOk = !!core.ai?.ai && core.ai.web !== false;
  let timer = null;
  function refreshSearch(auto = true) {
    clearTimeout(timer);
    searchLine.replaceChildren();
    const name = f.name.value.trim();
    if (!webOk || name.length < 4) return;
    const course = findCourse(courses, name);
    const exact = course && key(course.name) === key(name);
    if (course?.format && course.format !== "sconosciuto") return; // già nota (piano dal web o ricerca precedente)
    if (!university) return searchLine.replaceChildren("Indica l'ateneo (", h("a", { href: "#/profile" }, "Imposta"), ") per cercare la modalità d'esame sulla scheda dell'insegnamento.");
    const pending = formatSearches.get(key(course?.name ?? name));
    const start = () => show(searchFormat({ university, degree, academicYear: prof?.academicYear ?? "", name, course }), name);
    if (pending) return show(pending, name);
    if (course?.formatSearch && !course.formatSearch.found)
      return searchLine.replaceChildren(`Modalità d'esame non trovata sul sito (cercata il ${fmtDate(course.formatSearch.at)}): resta il suggerimento dalla materia, oppure incolla la scheda qui sotto. `, h("button", { type: "button", class: "btn small ghost", onclick: start }, "Cerca di nuovo"));
    if (exact && auto) { timer = setTimeout(start, 600); return; }
    searchLine.replaceChildren(h("button", { type: "button", class: "btn small ghost", onclick: start }, `Cerca la modalità d'esame sul sito dell'ateneo`));
  }
  function show(job, name) {
    searchLine.replaceChildren(h("span", { class: "spinner" }), ` Cerco la modalità d'esame di «${name}» sulla scheda dell'insegnamento…`);
    job.then((r) => {
      if (key(f.name.value) !== key(name) || !form.isConnected) return;
      if (!r.found) return refreshSearch(false);
      searchLine.replaceChildren();
      // scelta fatta a mano: non la tocco, ma dico cosa dice la scheda
      if (typeTouched) return searchLine.replaceChildren(`Sulla scheda dell'insegnamento: ${FORMAT_LABEL[r.format]}. `, h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, "fonte"));
      if (findCourse(courses, name)) return refresh(); // salvata nel piano: refresh mostra fonte e citazione
      f.type.value = r.format;
      formatSource = { text: r.evidence, url: r.url };
      hint.replaceChildren(`Dalla scheda dell'insegnamento: ${FORMAT_LABEL[r.format]}. «${r.evidence}» `, h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, "fonte"), " · Le modalità cambiano tra docenti e anni: verifica.");
    }, (e) => {
      if (key(f.name.value) !== key(name) || !form.isConnected) return;
      searchLine.replaceChildren(`Ricerca non riuscita: ${e.message} `, h("button", { type: "button", class: "btn small ghost", onclick: () => show(searchFormat({ university, degree, academicYear: prof?.academicYear ?? "", name, course: findCourse(courses, name) }), name) }, "Riprova"));
    });
  }
  f.name.addEventListener("input", () => refreshSearch());

  /* Finestra di studio e carico: ore disponibili contro l'ordine di grandezza dato dai CFU. */
  const fmtH = (x) => `${Math.round(x)} h`;
  function refreshLoad() {
    const t = today();
    const draft = { id: exam?.id ?? "_new", date: f.date.value, hoursPerDay: Number(f.hours.value) || 0, studyDays: Number(f.window.value) || 0 };
    if (!draft.date || draft.date <= t) return loadBox.replaceChildren(), renderPreview(0);
    const tt = prof?.timetable;
    const start = studyStart(draft, t);
    const days = windowDays(draft, t);
    const avail = windowHours(draft, t, (d) => busyMinutes(tt, d));
    const cfu = Math.min(60, Math.max(0, Number(f.cfu.value) || 0));
    const fz = feasibility({ cfu, available: avail, hoursPerDay: draft.hoursPerDay });
    const clipped = draft.studyDays && start === t && days < draft.studyDays;
    const lines = [
      h("div", {}, h("b", {}, start === t ? `Studio da oggi, ${days} ${days === 1 ? "giorno" : "giorni"}` : `Studio dal ${fmtDate(start)}: ${days} giorni`),
        ` · circa ${fmtH(avail)} disponibili${tt?.items?.length ? " (tolte le lezioni)" : ""}.`,
        clipped ? ` Mancano solo ${days} giorni all'esame: la finestra parte da oggi.` : ""),
    ];
    if (fz) {
      const pct = Math.round(fz.share * 100);
      lines.push(h("div", {}, `Ordine di grandezza per ${cfu} CFU partendo da zero: ${fmtH(fz.low)}–${fmtH(fz.high)} di studio individuale `,
        h("span", { class: "muted" }, `(1 CFU = ${HOURS_PER_CFU.total} ore di lavoro, lezioni comprese).`)));
      if (fz.level !== "ok")
        lines.push(h("div", {}, h("b", {}, fz.level === "low" ? `Il tempo copre circa il ${pct}% di quella stima. ` : `Il tempo è un po' stretto (circa ${pct}%). `),
          `Va bene se hai già studiato durante il semestre o conosci la materia; altrimenti, a ${draft.hoursPerDay} h al giorno, servirebbero circa ${fz.daysNeeded} giorni. `,
          "Con poco tempo il piano dà la precedenza agli argomenti più importanti e segnala quelli rimandati."));
    } else lines.push(h("div", { class: "muted" }, "Indica i CFU per una stima del carico."));
    const others = overlapping(draft, store.state.exams, t);
    if (others.length)
      lines.push(h("div", {}, h("b", {}, "Si sovrappone a: "), others.map((o) => `${o.exam.name} (${o.days} giorni in comune, ${o.exam.hoursPerDay} h/giorno)`).join("; "),
        `. In quei giorni le ore si sommano: ${draft.hoursPerDay + others.reduce((x, o) => Math.max(x, o.exam.hoursPerDay), 0)} h o più.`));
    loadBox.className = `load-box${fz && fz.level === "low" ? " warn" : ""}`;
    loadBox.replaceChildren(...lines);
    renderPreview(days, draft.hoursPerDay);
  }
  for (const k of ["date", "hours", "cfu", "window"]) f[k].addEventListener("input", refreshLoad);
  f.window.addEventListener("change", refreshLoad);
  f.name.addEventListener("input", () => setTimeout(refreshLoad)); // i CFU si precompilano dal piano
  refreshLoad();

  async function readSyllabus() {
    const text = syllabus.value.trim();
    if (text.length < 20) return syllabusMsg.replaceChildren("Incolla il testo della scheda.");
    const name = f.name.value.trim();
    syllabusMsg.replaceChildren(h("span", { class: "spinner" }), " Leggo la scheda…");
    let r;
    try {
      r = core.ai?.ai ? await api.runJob("/api/exam-format-text", { text: text.slice(0, 40_000), course: name }, () => {}) : formatFromSyllabus(text);
    } catch (e) {
      return syllabusMsg.replaceChildren(`Non riuscito: ${e.message}`);
    }
    if (!r.found) return syllabusMsg.replaceChildren("Nel testo non trovo la modalità d'esame: incolla la sezione «Modalità di verifica dell'apprendimento».");
    const course = findCourse(courses, name);
    if (course) {
      Object.assign(course, { format: r.format, formatEvidence: r.evidence, url: r.url || "" });
      course.formatSearch = { at: today(), found: true, source: "incollata", details: r.details, teacher: r.teacher, academicYear: r.academicYear, caveats: r.caveats };
      store.save();
    }
    typeTouched = false; // scelta esplicita: il tipo viene dalla scheda, con la sua citazione
    f.type.value = r.format;
    formatSource = { text: r.evidence, url: r.url || "" };
    searchLine.replaceChildren();
    hint.replaceChildren(...[`Dalla scheda che hai incollato: ${FORMAT_LABEL[r.format]}. «${r.evidence}» `, r.details ? `${r.details} ` : null,
      r.local ? "Lettura automatica senza AI: controlla." : "Verifica che sia la scheda del tuo anno e del tuo docente."].filter(Boolean));
    syllabusMsg.replaceChildren(`✓ Tipo di prova: ${FORMAT_LABEL[r.format]}.`);
  }
  if (isNew) refreshSearch();
  // L'anno filtra l'elenco; se in quell'anno ci sono attività a scelta lo ricorda (al 3° anno di solito ci sono).
  let yearTouched = !isNew;
  const refreshYear = () => {
    const y = Number(f.year.value) || 0;
    fillCourses(y);
    const el = y ? courses.filter((c) => c.year === y && c.kind === "a_scelta") : [];
    const named = el.filter((c) => !/insegnamenti a scelta|a scelta dello studente/i.test(c.name));
    electiveNote.textContent = el.length
      ? `${yearLabel(y)}: ci sono attività a scelta${named.length ? ` (${named.map((c) => c.name).join(", ")})` : ""}. Se hai scelto un altro insegnamento, scrivi il suo nome.`
      : "";
  };
  f.year.addEventListener("change", () => { yearTouched = true; refreshYear(); });
  if (isNew && v.name) refresh(); // dal libretto («Prepara»): CFU e tipo di prova dal piano di studi
  refreshYear();
  if (isNew) refresh();

  /* Appelli non ancora pubblicati: se dall'orario so quando finiscono le lezioni propongo una data provvisoria
     (la data di default, fra 30 giorni, cadrebbe in pieno semestre e comprimerebbe il piano). */
  f.date.parentElement.append(dateNote);
  let dateTouched = !isNew;
  const hasAppelli = !!v.appelli?.length;
  function updateDateNote() {
    const last = hasAppelli ? null : lastLessonOf(prof?.timetable, f.name.value);
    const est = last && last.date >= today() ? addDays(last.date, TENTATIVE_GAP_DAYS) : null;
    if (est && !dateTouched && f.date.value !== est) { f.date.value = est; tentative.checked = true; }
    const after = tentative.checked ? "Quando escono gli appelli importali da «Importa»: la data provvisoria viene sostituita e il piano ricalcolato." : "";
    if (!est) return dateNote.replaceChildren(after);
    dateNote.replaceChildren(...[
      `Le lezioni di ${last.course} finiscono il ${fmtDate(last.date)}. `,
      f.date.value === est
        ? (tentative.checked ? `Data provvisoria: una settimana dopo. ${after}` : null)
        : h("button", { type: "button", class: "btn small ghost", onclick: () => { f.date.value = est; tentative.checked = true; dateTouched = true; refreshDate(); } }, `Usa ${fmtDate(est)} come data provvisoria`),
    ].filter(Boolean));
  }
  function refreshDate() {
    updateDateNote();
    setTimeout(() => refreshLoad()); // la data (anche provvisoria) sposta la finestra di studio
  }
  f.date.addEventListener("input", () => { dateTouched = true; refreshDate(); });
  f.name.addEventListener("input", refreshDate);
  tentative.addEventListener("change", refreshDate);
  refreshDate();

  const page = h("div", { class: "stack exam-form-page" },
    isNew ? stepper(1) : null,
    h("div", { class: "page-intro" }, h("h1", {}, isNew ? "Che esame devi preparare?" : "Modifica esame"),
      isNew ? h("p", { class: "lead" }, "Bastano data, tipo di prova e il tempo che hai: il piano parte da qui e si affina con i materiali.") : null),
    h("div", { class: "form-layout" }, h("div", { class: "card form-card" }, form), aside));

  if (!isNew)
    form.append(
      h("hr", { style: { width: "100%", border: 0, borderTop: "1px solid var(--line)" } }),
      h("button", {
        class: "btn danger", type: "button", onclick: async () => {
          if (!(await confirmDialog(`Eliminare «${exam.name}» con tutti i materiali e i progressi?`, { ok: "Elimina", danger: true }))) return;
          await store.deleteExam(exam.id);
          go("#/");
        },
      }, "Elimina esame"),
    );
  return page;
}
