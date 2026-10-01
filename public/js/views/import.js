import { core } from "../core.js";
import { findCourse } from "../curriculum.js";
import { addDays, fmtDate, today } from "../dates.js";
import { BUILDERS, SCHEMAS, TEMPLATES, autoMap, colName, detectKind, looksLikeHeader, tableFrom } from "../importers.js";
import { go } from "../nav.js";
import * as store from "../store.js";
import { parseDelimited, readSpreadsheet } from "../tabular.js";
import { badge, confirmDialog, h, toast } from "../ui.js";

const MAX_FILE = 10 * 1024 * 1024;
let st = null; // stato dell'importazione in corso (resta finché non si importa o si ricomincia)
let pasted = "";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function load(sheets, fileName) {
  const sheetIdx = Math.max(0, sheets.findIndex((s) => s.rows.length > 1));
  st = { fileName, sheets, sheetIdx, hasHeader: true, kind: null, kindAuto: null, map: {}, until: "", include: null };
  setSheet(sheetIdx);
}

function setSheet(i) {
  st.sheetIdx = i;
  const sh = st.sheets[i];
  st.hasHeader = looksLikeHeader(sh.rows[0] ?? []);
  const { headers, data } = tableFrom(sh.rows, st.hasHeader, sh.offset);
  const det = detectKind(headers, data.slice(0, 20));
  st.kindAuto = det.kind;
  setKind(det.kind ?? "esami");
}

function setKind(kind) {
  st.kind = kind;
  const sh = st.sheets[st.sheetIdx];
  st.map = autoMap(kind, tableFrom(sh.rows, st.hasHeader, sh.offset).headers);
  st.include = null;
}

function compute() {
  const sh = st.sheets[st.sheetIdx];
  const t = tableFrom(sh.rows, st.hasHeader, sh.offset);
  const ctx = { today: today(), courses: store.state.profile?.courses ?? [], exams: store.state.exams };
  return { t, res: BUILDERS[st.kind](t.data, st.map, ctx, t.firstRow) };
}

/* ------------------------------- applicazione ------------------------------- */

function applyExams(items) {
  const prof = store.state.profile;
  let created = 0;
  let updated = 0;
  for (const it of items) {
    const exam = it.existingId ? store.getExam(it.existingId) : null;
    if (exam) {
      exam.appelli = it.appelli;
      if (!it.appelli.some((a) => a.date === exam.date) || exam.date < today()) exam.date = it.date;
      if (!exam.cfu && it.cfu) exam.cfu = it.cfu;
      if (!exam.year && it.year) exam.year = it.year;
      exam.plan = null;
      updated++;
    } else {
      const course = findCourse(prof?.courses ?? [], it.name);
      store.newExam({
        name: it.name, university: prof?.university ?? "", degree: prof?.degree ?? "", date: it.date, appelli: it.appelli,
        type: it.type, cfu: it.cfu, year: it.year,
        formatSource: it.typeSource === "piano" && course ? { text: course.formatEvidence, url: course.url } : null,
      });
      created++;
    }
  }
  store.save();
  return `${created} esami creati, ${updated} aggiornati.`;
}

function applyCourses(items) {
  const p = store.profile();
  let created = 0;
  let updated = 0;
  for (const it of items) {
    const { status, ...c } = it;
    const ex = p.courses.find((x) => norm(x.name) === norm(c.name) && (x.year || 0) === (c.year || 0));
    if (ex) {
      if (c.cfu) ex.cfu = c.cfu;
      if (c.kind !== "sconosciuto") ex.kind = c.kind;
      if (c.group) ex.group = c.group;
      if (c.format !== "sconosciuto") Object.assign(ex, { format: c.format, formatEvidence: c.formatEvidence });
      updated++;
    } else {
      p.courses.push(c);
      created++;
    }
  }
  store.save();
  return `${created} insegnamenti aggiunti, ${updated} aggiornati.`;
}

async function applyTimetable(res) {
  const p = store.profile();
  const items = res.items.filter((l) => st.include.has(l.course));
  if (!items.length) { toast("Seleziona almeno un insegnamento.", "error"); return null; }
  if (p.timetable?.items?.length && !(await confirmDialog(`Sostituire l'orario attuale (${p.timetable.items.length} lezioni) con questo (${items.length})?`, { ok: "Sostituisci" }))) return null;
  p.timetable = { items, until: st.until || null, importedAt: new Date().toISOString(), source: st.fileName };
  for (const e of store.state.exams) e.plan = null; // il piano tiene conto delle lezioni
  store.save();
  return `${items.length} lezioni importate: il piano ne terrà conto.`;
}

/* ---------------------------------- vista ---------------------------------- */

async function download(name, text) {
  if (core.downloads) {
    try { await core.downloads({ filename: name, data: "\uFEFF" + text }); } catch (e) { if (e?.code !== "declined") toast("Salvataggio del file non riuscito.", "error"); }
    return;
  }
  const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importView() {
  const root = h("div", { class: "stack", style: { maxWidth: "900px" } });
  const redraw = () => root.replaceChildren(...build());
  root.redraw = redraw;

  async function onFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) return toast("File troppo grande (max 10 MB).", "error");
    try {
      const { sheets } = await readSpreadsheet(file);
      if (!sheets.some((s) => s.rows.length)) throw new Error("Il file è vuoto.");
      load(sheets, file.name);
      redraw();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  function build() {
    const input = h("input", { type: "file", id: "import-file", accept: ".csv,.tsv,.txt,.xlsx,.xlsm,text/csv", hidden: true });
    input.addEventListener("change", () => onFile(input.files[0]));
    const drop = h("div", { class: "file-drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && input.click(),
      ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); } },
      h("b", {}, "Scegli un file CSV o Excel"), h("div", { class: "small" }, "(.csv, .tsv, .xlsx) oppure trascinalo qui. Il file resta nel tuo browser."), input);
    const paste = h("textarea", { id: "import-paste", placeholder: "Oppure incolla qui le righe copiate da Excel o da una pagina web (con le intestazioni)…", style: { minHeight: "90px" } });
    paste.value = pasted;
    paste.addEventListener("input", () => (pasted = paste.value));
    const source = h("div", { class: "card stack" },
      h("h3", {}, "1 · Il file"), drop, paste,
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => {
          const { rows, offset } = parseDelimited(paste.value);
          if (rows.length < 2) return toast("Incolla almeno l'intestazione e una riga.", "error");
          load([{ name: "Testo incollato", rows, offset }], "testo incollato");
          redraw();
        } }, "Leggi il testo incollato"),
        h("span", { class: "muted small" }, "Modelli da scaricare: "),
        ...Object.entries(SCHEMAS).map(([k, s]) => h("button", { class: "btn small ghost", onclick: () => download(`modello-${k}.csv`, TEMPLATES[k]) }, s.label))));

    if (!st) return [h("div", { class: "row between" }, h("h1", { style: { margin: 0 } }, "Importa da CSV o Excel"), h("a", { class: "btn ghost", href: "#/" }, "Home")),
      h("p", { class: "muted", style: { margin: 0 } }, "Puoi importare gli appelli d'esame (date), il piano di studi (insegnamenti) e gli orari delle lezioni. Le colonne vengono riconosciute dalle intestazioni e le puoi correggere prima di importare."), source];

    const { t, res } = compute();
    const schema = SCHEMAS[st.kind];
    const sh = st.sheets[st.sheetIdx];

    const kindBox = h("div", { class: "card stack" },
      h("div", { class: "row between" }, h("h3", { style: { margin: 0 } }, "2 · Cosa contiene"), h("button", { class: "btn small ghost", onclick: () => { st = null; redraw(); } }, "Ricomincia")),
      h("p", { class: "muted small", style: { margin: 0 } }, `${st.fileName}${st.sheets.length > 1 ? "" : ""} · ${t.data.length} righe${st.kindAuto ? ` · riconosciuto: ${SCHEMAS[st.kindAuto].label.toLowerCase()}` : " · tipo non riconosciuto: scegli tu"}`),
      st.sheets.length > 1 ? h("label", {}, "Foglio", h("select", { id: "import-sheet", onchange: (e) => { setSheet(Number(e.target.value)); redraw(); } }, st.sheets.map((s, i) => h("option", { value: i, selected: i === st.sheetIdx }, `${s.name} (${Math.max(0, s.rows.length - (i === st.sheetIdx && st.hasHeader ? 1 : 0))} righe)`)))) : null,
      h("div", { class: "row" }, Object.entries(SCHEMAS).map(([k, s]) => h("label", { style: { display: "flex", gap: "6px", alignItems: "center", fontWeight: 600 } },
        h("input", { type: "radio", name: "kind", value: k, checked: st.kind === k, onchange: () => { setKind(k); redraw(); } }), s.label))),
      h("p", { class: "muted small", style: { margin: 0 } }, schema.hint),
      h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontWeight: 400 } },
        h("input", { type: "checkbox", id: "import-header", checked: st.hasHeader, onchange: (e) => { st.hasHeader = e.target.checked; setKind(st.kind); redraw(); } }), "La prima riga contiene le intestazioni"));

    const mapBox = h("div", { class: "card stack" },
      h("h3", { style: { margin: 0 } }, "3 · Colonne"),
      h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" } }, schema.fields.map((f) =>
        h("label", {}, `${f.label}${f.required ? " *" : ""}`,
          h("select", { id: `map-${f.key}`, onchange: (e) => { st.map[f.key] = Number(e.target.value); st.include = null; redraw(); } },
            h("option", { value: -1 }, f.required ? "— scegli —" : "— non presente —"),
            t.headers.map((hd, i) => h("option", { value: i, selected: st.map[f.key] === i }, `${colName(i)}: ${hd}`)))))),
      h("details", {}, h("summary", { class: "small" }, "Prime righe del file"),
        h("div", { style: { overflowX: "auto" } }, h("table", {}, h("thead", {}, h("tr", {}, t.headers.map((hd) => h("th", {}, hd)))), h("tbody", {}, t.data.slice(0, 5).map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))))));

    const missing = schema.fields.filter((f) => f.required && !(st.map[f.key] >= 0));
    const errors = res.errors.length
      ? h("details", { class: "callout warn", open: res.items.length === 0 },
          h("summary", {}, h("b", {}, `${res.errors.length} righe non importate`)),
          h("ul", {}, res.errors.slice(0, 25).map((e) => h("li", {}, `Riga ${e.row}: ${e.message}`)), res.errors.length > 25 ? h("li", {}, `…e altre ${res.errors.length - 25}`) : null))
      : null;

    let preview;
    let action;
    if (missing.length) {
      preview = h("div", { class: "callout warn" }, `Indica la colonna: ${missing.map((f) => f.label).join(", ")}.`);
    } else if (st.kind === "esami") {
      preview = h("div", { style: { overflowX: "auto" } }, h("table", {},
        h("thead", {}, h("tr", {}, ["Insegnamento", "Appelli", "Prova", "CFU", "Anno", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, res.items.map((it) => h("tr", {},
          h("td", {}, it.name),
          h("td", {}, it.appelli.map((a) => `${fmtDate(a.date)}${a.time ? ` ${a.time}` : ""}`).join(" · ")),
          h("td", {}, it.type, " ", h("span", { class: "muted small" }, `(${{ file: "dal file", piano: "dal piano", materia: "suggerito" }[it.typeSource]})`)),
          h("td", {}, it.cfu || "—"), h("td", {}, it.year || "—"), h("td", {}, badge(it.status, it.status === "nuovo" ? "good" : "brand")))))));
      if (res.past) preview = h("div", { class: "stack" }, preview, h("p", { class: "muted small", style: { margin: 0 } }, `${res.past} appelli con data già passata non sono stati considerati.`));
      action = h("button", { class: "btn primary", disabled: !res.items.length, onclick: () => { const msg = applyExams(res.items); done(msg, "#/"); } }, `Importa ${res.items.length} esami`);
    } else if (st.kind === "insegnamenti") {
      preview = h("div", { style: { overflowX: "auto" } }, h("table", {},
        h("thead", {}, h("tr", {}, ["Insegnamento", "Anno", "CFU", "Tipo", "Prova", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, res.items.map((c) => h("tr", {}, h("td", {}, c.name), h("td", {}, c.year || "—"), h("td", {}, c.cfu || "—"), h("td", {}, c.kind === "a_scelta" ? badge("a scelta", "warn") : c.kind), h("td", {}, c.format), h("td", {}, badge(c.status, c.status === "nuovo" ? "good" : "brand")))))));
      action = h("button", { class: "btn primary", disabled: !res.items.length, onclick: () => done(applyCourses(res.items), "#/profile") }, `Importa ${res.items.length} insegnamenti`);
    } else {
      st.include ??= new Set(res.courses.map((c) => c.name));
      const until = h("input", { type: "date", id: "import-until", value: st.until, min: today(), onchange: (e) => (st.until = e.target.value) });
      const hasWeekly = res.items.some((l) => l.weekday);
      preview = h("div", { class: "stack" },
        h("p", { class: "muted small", style: { margin: 0 } }, "Spunta gli insegnamenti che frequenti: le loro lezioni riducono il tempo di studio dei giorni in cui cadono."),
        h("ul", { class: "checklist" }, res.courses.map((c) => h("li", {}, h("label", {}, h("input", { type: "checkbox", checked: st.include.has(c.name), onchange: (e) => { e.target.checked ? st.include.add(c.name) : st.include.delete(c.name); redraw(); } }), h("span", {}, `${c.name} `, h("span", { class: "muted small" }, `(${c.count} lezioni)`)))))),
        hasWeekly ? h("label", {}, "Le lezioni settimanali valgono fino al", until, h("span", { class: "hint" }, "Data di fine delle lezioni del semestre. Senza data le sottraggo da tutti i giorni del piano.")) : null);
      action = h("button", { class: "btn primary", disabled: !res.items.length, onclick: async () => { const msg = await applyTimetable(res); if (msg) done(msg, "#/"); } }, `Importa ${res.items.filter((l) => st.include.has(l.course)).length} lezioni`);
    }

    return [h("div", { class: "row between" }, h("h1", { style: { margin: 0 } }, "Importa da CSV o Excel"), h("a", { class: "btn ghost", href: "#/" }, "Home")),
      source, kindBox, mapBox,
      h("div", { class: "card stack" }, h("h3", { style: { margin: 0 } }, "4 · Anteprima"), preview, errors, action ? h("div", {}, action) : null)];
  }

  function done(msg, where) {
    toast(msg, "ok");
    st = null;
    pasted = "";
    go(where);
  }

  redraw();
  return root;
}
