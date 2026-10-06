// Libretto: checklist degli insegnamenti del piano di studi, superati (voto e data) e da superare (con l'esame in preparazione
// nell'app, se c'è). Il libretto si può incollare da Esse3; la media e la base di laurea sono stime.
import { careerStats, counts, examsFor, gradeLabel, parseLibretto } from "../career.js";
import { groupByYear } from "../curriculum.js";
import { fmtDate, today } from "../dates.js";
import { daysLeft, statsFor } from "../domain.js";
import * as store from "../store.js";
import { badge, bar, h, pct, toast } from "../ui.js";

let editing = null; // l'insegnamento di cui si sta segnando il voto
let pasted = "";

const num = (x) => x.toLocaleString("it-IT", { maximumFractionDigits: 2 });
const ROMAN = /^(i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
/** «ANALISI MATEMATICA I» (come lo scrive Esse3) → «Analisi matematica I». */
const tidy = (s) => (s === s.toUpperCase() ? s.toLowerCase().split(" ").map((w, i) => (ROMAN.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ") : s);

function gradeForm(c) {
  const grade = h("select", { "aria-label": `Voto di ${c.name}` }, [...Array.from({ length: 13 }, (_, i) => String(18 + i)), "30L", "idoneo"].map((g) =>
    h("option", { value: g, selected: c.passed ? (c.passed.idoneo ? g === "idoneo" : g === (c.passed.laude ? "30L" : String(c.passed.grade))) : g === "27" }, g === "30L" ? "30 e lode" : g === "idoneo" ? "idoneo (senza voto)" : g)));
  const date = h("input", { type: "date", value: c.passed?.date ?? today(), "aria-label": `Data di ${c.name}`, style: { width: "160px" } });
  return h("form", { class: "row", style: { gap: "6px" }, onsubmit: (e) => {
    e.preventDefault();
    const g = grade.value;
    c.passed = g === "idoneo" ? { idoneo: true, date: date.value } : { grade: g === "30L" ? 30 : Number(g), laude: g === "30L", date: date.value };
    editing = null;
    store.save();
    rerender();
  } }, grade, date, h("button", { class: "btn small primary", type: "submit" }, "Salva"), h("button", { class: "btn small ghost", type: "button", onclick: () => { editing = null; rerender(); } }, "Annulla"));
}

let rerender = () => {};

function courseRow(c) {
  const exams = examsFor(store.state.exams, c).sort((a, b) => b.date.localeCompare(a.date));
  const ex = exams.find((e) => daysLeft(e) >= 0) ?? exams[0];
  const elective = c.kind === "a_scelta" && c.group;
  const status = c.passed
    ? h("span", { class: "row", style: { gap: "6px" } }, badge(`✓ ${gradeLabel(c.passed)}`, "good"), h("span", { class: "muted small" }, c.passed.date ? fmtDate(c.passed.date) : ""),
        h("button", { class: "btn small ghost", onclick: () => { editing = c; rerender(); } }, "Modifica"),
        h("button", { class: "btn small ghost", "aria-label": `Togli il voto di ${c.name}`, onclick: () => { delete c.passed; store.save(); rerender(); } }, "Togli"))
    : h("span", { class: "row", style: { gap: "6px" } },
        ex ? h("a", { class: "small", href: `#/exam/${ex.id}` }, daysLeft(ex) >= 0 ? `in preparazione: esame il ${fmtDate(ex.date)}${ex.module ? `, preparazione ${pct(statsFor(ex).ready ?? 0)}` : ""} →` : `esame del ${fmtDate(ex.date)} →`)
          : !elective || c.planned ? h("a", { class: "btn small", href: `#/new?course=${encodeURIComponent(c.name)}` }, "Prepara") : null,
        h("button", { class: "btn small", onclick: () => { editing = c; rerender(); } }, "Segna superato"));
  return h("li", { class: `career-row${c.passed ? " done" : ""}${counts(c) ? "" : " muted"}` },
    h("div", { class: "row between", style: { gap: "8px" } },
      h("span", {}, h("span", { class: "career-check", "aria-hidden": "true" }, c.passed ? "☑" : "☐"), " ", h("b", {}, c.name), c.cfu ? h("span", { class: "muted small" }, ` · ${c.cfu} CFU`) : null,
        elective && !c.passed ? h("label", { class: "small muted", style: { display: "inline-flex", gap: "4px", marginLeft: "8px", fontWeight: 400 } },
          h("input", { type: "checkbox", checked: !!c.planned, "aria-label": `Scelgo ${c.name}`, onchange: (e) => { c.planned = e.target.checked; store.save(); rerender(); } }), "lo scelgo") : null),
      editing === c ? null : status),
    editing === c ? gradeForm(c) : null);
}

/** Esami dell'app con la data passata e l'insegnamento non ancora segnato: com'è andata? */
function outcomeBox(courses) {
  const open = store.state.exams.filter((e) => daysLeft(e) < 0).map((e) => ({ e, c: courses.find((c) => examsFor([e], c).length) })).filter((x) => x.c && !x.c.passed);
  if (!open.length) return null;
  return h("div", { class: "callout" }, h("b", {}, "Com'è andata?"),
    h("ul", {}, open.map(({ e, c }) => h("li", {}, `«${e.name}» del ${fmtDate(e.date)}: `,
      h("button", { class: "btn small primary", onclick: () => { editing = c; rerender(); } }, "Superato, segna il voto"), " ",
      h("a", { class: "btn small ghost", href: `#/exam/${e.id}/edit` }, "Non ancora: scegli un altro appello")))));
}

function applyLibretto(p, text) {
  const rows = parseLibretto(text, p.courses);
  if (!rows.length) return toast("Non trovo esami superati: servono righe con il voto e la data (es. «Microeconomia 9 28 12/01/2025»).", "error");
  let marked = 0;
  let added = 0;
  for (const r of rows) {
    if (r.course) { if (!r.course.passed) marked++; r.course.passed = r.passed; if (!r.course.cfu && r.cfu) r.course.cfu = r.cfu; continue; }
    if (p.courses.some((c) => c.name.toLowerCase() === tidy(r.name).toLowerCase())) continue;
    p.courses.push({ name: tidy(r.name), year: 0, cfu: r.cfu, kind: "obbligatorio", group: "", format: "sconosciuto", formatEvidence: "", url: "", manual: true, fromLibretto: true, passed: r.passed });
    added++;
  }
  store.save();
  toast(`Libretto: ${rows.length} esami superati letti${marked ? `, ${marked} segnati nel piano` : ""}${added ? `, ${added} aggiunti (non erano nel piano: controlla l'anno)` : ""}.`, "ok");
}

export function careerView() {
  const p = store.profile();
  const root = h("div", { class: "stack", style: { maxWidth: "860px" } });
  rerender = () => root.replaceChildren(...content(p).filter(Boolean)); // replaceChildren(null) scriverebbe «null»
  rerender();
  return root;
}

function content(p) {
  const courses = p.courses ?? [];
  const s = careerStats(courses);
  const groups = groupByYear(courses);
  const text = h("textarea", { placeholder: "Incolla qui il libretto copiato da Esse3 (o dal portale del tuo ateneo): righe con insegnamento, CFU, voto e data.", style: { minHeight: "110px" } });
  text.value = pasted;
  text.addEventListener("input", () => (pasted = text.value));
  return [
    h("h1", {}, "Libretto"),
    h("p", { class: "muted", style: { margin: 0 } }, "Gli esami superati e quelli da superare, dal tuo piano di studi. Il libretto ufficiale resta quello dell'ateneo: questo serve a vedere a che punto sei e che cosa preparare dopo."),
    courses.length ? h("div", { class: "card stack" },
      h("div", { class: "row", style: { gap: "18px", flexWrap: "wrap" } },
        h("div", {}, h("div", { class: "muted small" }, "Esami superati"), h("div", { class: "score-big" }, `${s.passed}/${s.total}`)),
        h("div", { style: { minWidth: "200px", flex: 1 } }, h("div", { class: "muted small" }, `CFU: ${s.cfuPassed} su ${s.cfuTotal}`), bar(s.cfuTotal ? s.cfuPassed / s.cfuTotal : 0, { label: "CFU acquisiti" })),
        s.average != null ? h("div", {}, h("div", { class: "muted small" }, "Media ponderata"), h("div", { class: "score-big" }, num(s.average))) : null,
        s.base110 != null ? h("div", {}, h("div", { class: "muted small" }, "Base di laurea (stima)"), h("div", { class: "score-big" }, `${num(s.base110)}/110`)) : null),
      s.average != null ? h("p", { class: "muted small", style: { margin: 0 } }, `Media pesata sui CFU (aritmetica: ${num(s.simple)}); la lode vale 30 e le idoneità non contano. La base di laurea è media × 110 / 30: il tuo ateneo può calcolarla diversamente (lodi, esclusione del voto peggiore, bonus), controlla il regolamento.`) : null,
      s.cfuTotal && courses.some((c) => c.kind === "a_scelta" && c.group && !counts(c)) ? h("p", { class: "muted small", style: { margin: 0 } }, "Gli insegnamenti a scelta contano nel totale solo se li segni «lo scelgo» o li hai superati.") : null)
      : h("div", { class: "callout warn" }, "Il piano di studi non c'è ancora: caricalo da ", h("a", { href: "#/profile" }, "Ateneo e corso di studio"), ", oppure incolla qui sotto il libretto: gli esami superati entrano da soli."),
    outcomeBox(courses),
    h("details", { class: "card stack", open: !courses.some((c) => c.passed) }, h("summary", {}, h("b", {}, "Incolla il libretto da Esse3")),
      h("p", { class: "muted small", style: { margin: "6px 0 0" } }, "Su Esse3: Carriera → Libretto, seleziona la tabella e copiala (Ctrl+A, Ctrl+C). Si leggono solo le righe con voto e data; gli insegnamenti che non sono nel piano vengono aggiunti."),
      text, h("div", {}, h("button", { class: "btn primary", onclick: () => { applyLibretto(p, text.value); pasted = ""; rerender(); } }, "Leggi il libretto"))),
    ...groups.map((g) => h("div", { class: "card stack", style: { gap: "6px" } },
      h("h3", { style: { margin: 0 } }, g.label, h("span", { class: "muted small" }, ` · ${[...g.required, ...g.electives.flatMap((e) => e.courses)].filter((c) => c.passed).length} superati`)),
      g.required.length ? h("ul", { class: "career-list" }, g.required.map(courseRow)) : null,
      ...g.electives.map((e) => h("div", { class: "stack", style: { gap: "4px" } }, h("div", {}, badge("A scelta", "warn"), " ", h("b", { class: "small" }, e.group)), h("ul", { class: "career-list" }, e.courses.map(courseRow)))))),
    h("div", { class: "row" }, h("a", { class: "btn", href: "#/profile" }, "Modifica il piano di studi"), h("a", { class: "btn ghost", href: "#/" }, "Home")),
  ];
}

/** Riga per la home: a che punto sei. */
export function careerSummary() {
  const courses = store.state.profile?.courses ?? [];
  if (!courses.length) return null;
  const s = careerStats(courses);
  const stat = (n, label) => h("span", { class: "career-stat" }, h("b", {}, n), h("span", { class: "muted" }, label));
  return h("a", { class: "card career-summary", href: "#/libretto", "aria-label": `Libretto: ${s.passed} di ${s.total} esami superati, ${s.cfuPassed} di ${s.cfuTotal} CFU${s.average != null ? `, media ${num(s.average)}` : ""}` },
    h("div", { class: "career-stats" },
      h("span", { class: "kicker" }, "Libretto"),
      stat(s.passed, `di ${s.total} esami superati`),
      stat(s.cfuPassed, `di ${s.cfuTotal} CFU`),
      s.average != null ? stat(num(s.average), "media") : null),
    s.cfuTotal ? bar(s.cfuPassed / s.cfuTotal, { tone: "good", label: "CFU acquisiti" }) : null,
    h("span", { class: "career-open" }, "Apri il libretto →"));
}
