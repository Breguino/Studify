import * as api from "../api.js";
import { core } from "../core.js";
import { groupByYear, parseCurriculumText } from "../curriculum.js";
import { today } from "../dates.js";
import { EXAM_TYPES } from "../methods.js";
import * as store from "../store.js";
import { UNIVERSITIES, resolveUniversity } from "../universities.js";
import { badge, confirmDialog, h, toast } from "../ui.js";

const LEVEL_LABEL = { L: "Triennali", LM: "Magistrali", LMCU: "Ciclo unico", "": "Altri" };
const KIND_LABEL = { obbligatorio: "Obbligatorio", a_scelta: "A scelta", sconosciuto: "Non indicato" };
const KIND_SHORT = { obbligatorio: "Obblig.", a_scelta: "A scelta", sconosciuto: "—" };
const FORMAT_SHORT = { scritto: "Scritto", orale: "Orale", test: "Test", problemi: "Esercizi", misto: "Scr. + orale", sconosciuto: "—" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
let busy = null; // { kind, el } mentre una ricerca è in corso
let pasted = ""; // testo del piano incollato, conservato tra i re-render

async function runBusy(kind, fn) {
  if (busy) return;
  busy = { kind, el: null };
  core.rerender();
  try {
    await fn((chars, label) => {
      if (busy?.el) busy.el.textContent = label ?? `Consulto i siti dell'ateneo… ~${Math.round(chars / 1000)}k caratteri letti`;
    });
  } catch (e) {
    toast(e.message, "error");
  } finally {
    busy = null;
    store.save();
    core.rerender();
  }
}

/** Sostituisce gli insegnamenti non inseriti a mano con quelli appena letti. */
function applyCourses(p, r, label) {
  p.courses = [...r.courses, ...p.courses.filter((c) => c.manual)];
  p.sources = r.sources ?? [];
  p.academicYear = r.academicYear ?? "";
  p.caveats = r.caveats ?? [];
  p.degreeFound = r.degreeName ?? "";
  p.fetchedAt = today();
  p.origin = label;
  toast(`${r.courses.length} insegnamenti letti.`, "ok");
}

export function profileView() {
  const p = store.profile();
  const web = core.ai.web !== false;

  /* ---------- ateneo e corso di studio ---------- */
  const uni = h("input", { id: "uni", list: "unis", value: p.university, placeholder: "es. UNIBS, Politecnico di Milano…", autocomplete: "off" });
  const aliasNote = h("span", { class: "hint" }, "Puoi scrivere la sigla (UNIBS, POLIMI, UNIBO…): la riconosco.");
  const degree = h("input", { id: "degree", list: "degrees", value: p.degree, placeholder: "es. Ingegneria Informatica (L-8)", autocomplete: "off" });
  const resolve = () => {
    const full = resolveUniversity(uni.value);
    if (full && full !== uni.value) { uni.value = full; aliasNote.textContent = "Sigla riconosciuta."; }
  };
  const commit = () => {
    resolve();
    const changedUni = uni.value.trim() !== p.university;
    p.university = uni.value.trim();
    p.degree = degree.value.trim();
    if (changedUni) p.degrees = null; // l'elenco dei corsi appartiene all'ateneo precedente
    store.save();
  };
  uni.addEventListener("change", () => { commit(); core.rerender(); });
  degree.addEventListener("change", commit);
  degree.addEventListener("blur", commit);

  const items = p.degrees?.items ?? [];
  const picker = items.length
    ? h("select", { id: "degree-pick", "aria-label": "Scegli dall'elenco dei corsi di studio", onchange: (e) => { if (e.target.value) { degree.value = e.target.value; commit(); core.rerender(); } } },
        h("option", { value: "" }, `Scegli tra i ${items.length} corsi trovati…`),
        ["L", "LM", "LMCU", ""].filter((l) => items.some((d) => d.level === l)).map((l) =>
          h("optgroup", { label: LEVEL_LABEL[l] }, items.filter((d) => d.level === l).map((d) => h("option", { value: d.name, selected: d.name === p.degree }, `${d.name}${d.classe ? ` (${d.classe})` : ""}`)))))
    : null;

  const degreesBox = h("div", { class: "stack", style: { gap: "8px" } },
    web
      ? h("div", {}, h("button", { class: "btn", disabled: !core.ai.ai || !!busy || !uni.value.trim(), onclick: () => { commit(); runBusy("degrees", async (on) => {
          const r = await api.runJob("/api/degrees", { university: p.university }, on);
          p.degrees = { items: r.degrees, academicYear: r.academicYear, fetchedAt: today(), sources: r.sources, caveats: r.caveats };
          toast(`Trovati ${r.degrees.length} corsi di studio.`, "ok");
        }); } }, items.length ? "Aggiorna l'elenco dei corsi" : "Trova i corsi di studio dell'ateneo"))
      : h("p", { class: "muted small", style: { margin: 0 } }, "Qui Claude non può consultare il sito dell'ateneo: scrivi il nome del tuo corso. Il piano di studi si può incollare qui sotto."),
    busy?.kind === "degrees" ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (busy.el = h("span", {}, "Consulto l'offerta formativa dell'ateneo…"))) : null,
    picker,
    items.length ? h("p", { class: "muted small", style: { margin: 0 } }, `Dati dal web${p.degrees.academicYear ? ` (a.a. ${p.degrees.academicYear})` : ""}: da verificare sul sito dell'ateneo.`) : null);

  /* ---------- piano di studi ---------- */
  const groups = groupByYear(p.courses);
  const rowFor = (c) => {
    const sel = (opts, cur, onChange, label) => h("select", { "aria-label": label, onchange: (e) => { onChange(e.target.value); store.save(); core.rerender(); } },
      Object.entries(opts).map(([k, t]) => h("option", { value: k, selected: String(k) === String(cur) }, t)));
    return h("tr", {},
      h("td", {}, c.name, c.manual ? [" ", badge("manuale")] : null),
      h("td", {}, c.cfu || "—"),
      h("td", {}, sel(KIND_SHORT, c.kind, (v) => (c.kind = v), `Tipo di ${c.name}`)),
      h("td", {}, sel(FORMAT_SHORT, c.format, (v) => { c.format = v; if (v !== "sconosciuto" && !c.formatEvidence) c.formatEvidence = "indicato da te"; if (v === "sconosciuto") { c.formatEvidence = ""; c.url = ""; } }, `Prova d'esame di ${c.name}`),
        c.url ? h("div", { class: "small" }, h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", title: c.formatEvidence }, "fonte")) : null),
      h("td", {}, sel({ 0: "—", 1: "1°", 2: "2°", 3: "3°", 4: "4°", 5: "5°", 6: "6°" }, c.year || 0, (v) => (c.year = Number(v)), `Anno di ${c.name}`)),
      h("td", {}, h("button", { class: "btn small ghost", "aria-label": `Rimuovi ${c.name}`, onclick: () => { p.courses = p.courses.filter((x) => x !== c); store.save(); core.rerender(); } }, "✕")));
  };
  const table = (courses) => h("div", { style: { overflowX: "auto" } }, h("table", {},
    h("thead", {}, h("tr", {}, ["Insegnamento", "CFU", "Tipo", "Prova", "Anno", ""].map((t) => h("th", {}, t)))),
    h("tbody", {}, courses.map(rowFor))));

  const yearBlocks = groups.map((g) => {
    const electiveCount = g.electives.reduce((n, e) => n + e.courses.length, 0);
    return h("details", { class: "card flat", open: g.year === 0 ? true : g.year <= 3 },
      h("summary", {}, h("b", {}, g.label), " ", h("span", { class: "muted small" }, [g.required.length ? plural(g.required.length, "insegnamento", "insegnamenti") : null, electiveCount ? `${electiveCount} a scelta` : null].filter(Boolean).join(" · "))),
      g.required.length ? table(g.required) : null,
      ...g.electives.map((e) => h("div", { class: "stack", style: { gap: "4px", marginTop: "10px" } },
        h("div", {}, badge("A scelta", "warn"), " ", h("b", {}, e.group)), table(e.courses))));
  });

  const manualName = h("input", { id: "m-name", placeholder: "Nome insegnamento", "aria-label": "Nome insegnamento" });
  const manualYear = h("select", { id: "m-year", "aria-label": "Anno" }, [0, 1, 2, 3, 4, 5].map((y) => h("option", { value: y }, y ? `${y}° anno` : "Anno?")));
  const manualCfu = h("input", { id: "m-cfu", type: "number", min: 0, max: 60, placeholder: "CFU", "aria-label": "CFU" });
  const manualKind = h("select", { id: "m-kind", "aria-label": "Tipo" }, Object.entries(KIND_LABEL).filter(([k]) => k !== "sconosciuto").map(([k, t]) => h("option", { value: k }, t)));
  const manualType = h("select", { id: "m-type", "aria-label": "Prova d'esame" }, [["sconosciuto", "Prova: non so"], ...Object.entries(EXAM_TYPES)].map(([k, t]) => h("option", { value: k }, t)));
  const addManual = h("form", { class: "row inline-form", onsubmit: (e) => {
    e.preventDefault();
    const name = manualName.value.trim();
    if (!name) return;
    if (p.courses.some((c) => c.name.toLowerCase() === name.toLowerCase() && (c.year || 0) === Number(manualYear.value))) return toast("Insegnamento già presente.", "error");
    p.courses.push({ name, year: Number(manualYear.value), cfu: Number(manualCfu.value) || 0, kind: manualKind.value, group: "", format: manualType.value, formatEvidence: manualType.value === "sconosciuto" ? "" : "indicato da te", url: "", manual: true });
    store.save();
    core.rerender();
  } }, manualName, manualYear, manualCfu, manualKind, manualType, h("button", { class: "btn", type: "submit" }, "Aggiungi"));

  const paste = h("textarea", { id: "paste", placeholder: "Incolla qui il piano di studi copiato dal sito dell'ateneo, da Esse3 o dal PDF del manifesto degli studi: anni, insegnamenti, CFU, attività a scelta…", style: { minHeight: "130px" } });
  paste.value = pasted;
  paste.addEventListener("input", () => (pasted = paste.value));
  const need = () => (paste.value.trim().length < 20 ? (toast("Incolla il testo del piano di studi.", "error"), false) : true);
  const pasteBox = h("details", { class: "stack", open: !p.courses.length },
    h("summary", {}, h("b", {}, "Incolla il piano di studi")),
    h("div", { class: "stack", style: { marginTop: "8px" } },
      h("p", { class: "muted small", style: { margin: 0 } }, "È la strada più affidabile: i dati vengono dal sito del tuo ateneo, non da una ricerca. Include gli insegnamenti a scelta del terzo anno, se ci sono."),
      paste,
      busy?.kind === "parse" ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (busy.el = h("span", {}, "Leggo il piano di studi…"))) : null,
      h("div", { class: "row" },
        core.ai.ai ? h("button", { class: "btn primary", disabled: !!busy, onclick: () => need() && runBusy("parse", async (on) => { commit(); applyCourses(p, await api.runJob("/api/parse-curriculum", { text: paste.value, university: p.university, degree: p.degree }, on), "incollato (AI)"); }) }, "Leggi con l'AI") : null,
        h("button", { class: core.ai.ai ? "btn" : "btn primary", disabled: !!busy, onclick: () => {
          if (!need()) return;
          const r = parseCurriculumText(paste.value);
          if (!r.courses.length) return toast("Non ho riconosciuto insegnamenti. Servono righe con i CFU (es. «Analisi 1 – 9 CFU»).", "error");
          applyCourses(p, { courses: r.courses, sources: [], academicYear: "", caveats: ["Lettura rapida senza AI: controlla anni, tipo e CFU."], degreeName: "" }, "incollato (lettura rapida)");
          store.save(); core.rerender();
        } }, "Lettura rapida (senza AI)"))));

  const searchBox = web && core.ai.ai
    ? h("div", { class: "stack", style: { gap: "8px" } },
        busy?.kind === "curriculum" ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (busy.el = h("span", {}, "Consulto i siti dell'ateneo…")), h("span", { class: "muted small" }, "può richiedere qualche minuto")) : null,
        h("div", {}, h("button", { class: "btn", disabled: !!busy, onclick: () => { commit(); if (!p.university || !p.degree) return toast("Indica ateneo e corso di studio.", "error"); runBusy("curriculum", async (on) => applyCourses(p, await api.runJob("/api/curriculum", { university: p.university, degree: p.degree }, on), "dal web")); } },
          p.origin === "dal web" ? "Cerca di nuovo sul sito dell'ateneo" : "Cerca il piano sul sito dell'ateneo")))
    : null;

  const provenance = p.fetchedAt
    ? h("div", { class: "callout warn" }, h("b", {}, "Da verificare. "), `Piano ${p.origin ?? "letto"} il ${p.fetchedAt}${p.academicYear ? ` (a.a. ${p.academicYear})` : ""}${p.degreeFound ? ` per «${p.degreeFound}»` : ""}. Confrontalo con la guida dello studente: i piani cambiano ogni anno e di curriculum in curriculum.`,
        p.caveats?.length ? h("ul", {}, p.caveats.map((c) => h("li", {}, c))) : null)
    : null;

  const thirdYearNote = groups.some((g) => g.year === 3 && g.electives.length === 0) || !groups.some((g) => g.year === 3)
    ? h("p", { class: "muted small", style: { margin: 0 } }, "Al terzo anno di solito ci sono insegnamenti a scelta: se il tuo piano non li elenca, aggiungili qui sotto con tipo «A scelta».")
    : null;

  return h("div", { class: "stack", style: { maxWidth: "860px" } },
    h("h1", {}, "Ateneo e corso di studio"),
    h("p", { class: "muted", style: { margin: 0 } }, "Scegli ateneo e corso: il piano di studi per anno ti permette poi di creare un esame scegliendo l'insegnamento, con CFU e tipo di prova già compilati. Resta nel tuo browser."),
    h("datalist", { id: "unis" }, UNIVERSITIES.map(([n, a]) => h("option", { value: n }, a))),
    h("datalist", { id: "degrees" }, items.map((d) => h("option", { value: d.name }, d.level))),
    h("div", { class: "card stack" },
      h("h3", {}, "1 · Ateneo"), h("label", {}, "Ateneo", uni, aliasNote),
      h("h3", { style: { marginTop: "6px" } }, "2 · Corso di studio"), h("label", {}, "Corso di studio", degree), degreesBox),
    h("div", { class: "card stack" },
      h("h3", {}, "3 · Piano di studi per anno"),
      provenance, searchBox, pasteBox,
      p.courses.length ? h("div", { class: "stack", style: { gap: "10px" } }, yearBlocks) : h("p", { class: "muted" }, "Nessun insegnamento ancora."),
      thirdYearNote,
      h("h3", { style: { marginBottom: 0 } }, "Aggiungi a mano"), addManual,
      p.courses.length ? h("div", {}, h("button", { class: "btn small danger", onclick: async () => { if (await confirmDialog("Rimuovere tutti gli insegnamenti del piano?", { ok: "Rimuovi", danger: true })) { p.courses = []; p.fetchedAt = null; store.save(); core.rerender(); } } }, "Svuota il piano")) : null,
      p.sources?.length ? h("details", {}, h("summary", {}, `Fonti consultate (${p.sources.length})`), h("ul", { class: "source-list" }, p.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null),
    h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/new", onclick: commit }, "Aggiungi un esame"), h("a", { class: "btn", href: "#/import" }, "Importa piano da CSV / Excel"), h("a", { class: "btn ghost", href: "#/" }, "Home")));
}
