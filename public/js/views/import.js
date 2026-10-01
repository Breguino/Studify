import * as api from "../api.js";
import { core } from "../core.js";
import { findCourse, parseCurriculumText } from "../curriculum.js";
import { addDays, fmtDate, today } from "../dates.js";
import { BUILDERS, CANON_HEADERS, SCHEMAS, TEMPLATES, autoMap, colName, detectKind, findHeaderRow, looksLikeHeader, tableFrom } from "../importers.js";
import { go } from "../nav.js";
import { hasText, layoutText, pagesToRows, plainLines } from "../pdf-table.js";
import { readPdf } from "../pdf-text.js";
import * as store from "../store.js";
import { parseDelimited, readSpreadsheet } from "../tabular.js";
import { badge, confirmDialog, h, readFileAs, toast } from "../ui.js";

const MAX_FILE = 10 * 1024 * 1024;
let st = null; // stato dell'importazione in corso (resta finché non si importa o si ricomincia)
let pasted = "";
let aiBusy = null; // { el } mentre l'AI legge un PDF

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function load(sheets, fileName, extra = {}) {
  const sheetIdx = Math.max(0, sheets.findIndex((s) => s.rows.length > 1));
  st = { fileName, sheets, sheetIdx, hasHeader: true, kind: null, kindAuto: null, map: {}, until: "", include: null, pdf: null, notes: [], fromAI: false, ...extra };
  setSheet(sheetIdx);
  if (extra.forceKind) { setKind(extra.forceKind); st.kindAuto = extra.forceKind; }
}

function setSheet(i) {
  st.sheetIdx = i;
  let sh = st.sheets[i];
  if (!sh.headerScanned) {
    // titoli e note sopra l'intestazione vengono saltati, la numerazione delle righe resta quella del file
    const idx = findHeaderRow(sh.rows);
    sh = st.sheets[i] = idx > 0 ? { ...sh, rows: sh.rows.slice(idx), offset: (sh.offset ?? 0) + idx, headerScanned: true } : { ...sh, headerScanned: true };
  }
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

/* ----------------------------------- PDF ----------------------------------- */

const isPdf = (f) => /\.pdf$/i.test(f.name ?? "") || f.type === "application/pdf";

async function loadPdf(file) {
  const buf = await file.arrayBuffer();
  const { pages, numPages, truncated } = await readPdf(buf);
  if (truncated) toast(`Letto solo le prime ${pages.length} pagine su ${numPages}.`, "info");
  if (!hasText(pages)) {
    if (!core.ai.ai) throw new Error("Questo PDF è una scansione (senza testo selezionabile): per leggerlo serve l'AI. Usa un PDF con testo o un CSV/Excel.");
    load([{ name: "PDF scansionato", rows: [], offset: 0 }], file.name, { pdf: { file, numPages, textless: true, text: "" } });
    return;
  }
  const { text, chars } = layoutText(pages);
  load([{ name: `PDF (${numPages} pag.)`, rows: pagesToRows(pages), offset: 0 }], file.name, { pdf: { file, numPages, textless: false, text, chars, lines: plainLines(pages) } });
}

/** Il PDF (o il suo testo con le colonne allineate) → righe canoniche, lette dall'AI. */
async function aiRead(kind, redraw) {
  const pdf = st.pdf;
  const body = { kind, today: today() };
  if (!pdf.textless) body.text = pdf.text;
  else if (core.ai.pdf) body.pdf = (await readFileAs(pdf.file, "dataurl")).split(",")[1];
  else if (core.pdfImages) {
    const r = await core.pdfImages(pdf.file);
    body.images = r.images;
    if (r.truncated) toast(`Letto solo le prime ${r.images.length} pagine su ${r.numPages}.`, "info");
  } else throw new Error("Questa versione non può leggere PDF scansionati: usa un PDF con testo o un CSV.");
  aiBusy = { el: null };
  redraw();
  try {
    const r = await api.runJob("/api/import-rows", body, (_, label) => { if (aiBusy?.el && label) aiBusy.el.textContent = label; });
    load([{ name: "Letto dall'AI", rows: r.rows, offset: 0 }], pdf.file.name, { pdf, notes: r.notes, fromAI: true, forceKind: kind });
  } finally {
    aiBusy = null;
  }
}

/** Piano di studi dal testo del PDF, senza AI: righe canoniche ricavate con la lettura rapida. */
function localCurriculum() {
  const { courses } = parseCurriculumText(st.pdf.lines.join("\n"));
  if (!courses.length) throw new Error("Nel testo non ho riconosciuto insegnamenti con i CFU. Prova con l'AI.");
  const rows = [CANON_HEADERS.insegnamenti, ...courses.map((c) => [c.name, String(c.year || ""), String(c.cfu || ""), c.kind === "a_scelta" ? "A scelta" : "Obbligatorio", c.group, ""])];
  load([{ name: "Elenco dal PDF", rows, offset: 0 }], st.pdf.file.name, { pdf: st.pdf, forceKind: "insegnamenti", notes: ["Lettura rapida senza AI: controlla anni, tipo e CFU."] });
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
  const redraw = () => root.replaceChildren(...build().filter(Boolean)); // replaceChildren scrive "null" per i valori nulli
  root.redraw = redraw;

  async function onFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) return toast("File troppo grande (max 10 MB).", "error");
    try {
      if (isPdf(file)) await loadPdf(file);
      else {
        const { sheets } = await readSpreadsheet(file);
        if (!sheets.some((s) => s.rows.length)) throw new Error("Il file è vuoto.");
        load(sheets, file.name);
      }
      redraw();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  function build() {
    const input = h("input", { type: "file", id: "import-file", accept: ".csv,.tsv,.txt,.xlsx,.xlsm,.pdf,text/csv,application/pdf", hidden: true });
    input.addEventListener("change", () => onFile(input.files[0]));
    const drop = h("div", { class: "file-drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && input.click(),
      ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); } },
      h("b", {}, "Scegli un file CSV, Excel o PDF"), h("div", { class: "small" }, "(.csv, .tsv, .xlsx, .pdf) oppure trascinalo qui. Il file resta nel tuo browser."), input);
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

    if (!st) return [h("div", { class: "row between" }, h("h1", { style: { margin: 0 } }, "Importa da CSV, Excel o PDF"), h("a", { class: "btn ghost", href: "#/" }, "Home")),
      h("p", { class: "muted", style: { margin: 0 } }, "Puoi importare gli appelli d'esame (date), il piano di studi (insegnamenti) e gli orari delle lezioni. Le colonne vengono riconosciute dalle intestazioni e le puoi correggere prima di importare. I PDF con tabelle semplici si leggono da soli; per orari a griglia e scansioni c'è la lettura con l'AI."), source];

    const { t, res } = compute();
    const schema = SCHEMAS[st.kind];
    const sh = st.sheets[st.sheetIdx];

    const kindBox = h("div", { class: "card stack" },
      h("div", { class: "row between" }, h("h3", { style: { margin: 0 } }, "2 · Cosa contiene"), h("button", { class: "btn small ghost", onclick: () => { st = null; redraw(); } }, "Ricomincia")),
      h("p", { class: "muted small", style: { margin: 0 } }, `${st.fileName}${st.pdf?.textless && !st.fromAI ? "" : ` · ${t.data.length} righe`}${st.kindAuto ? ` · riconosciuto: ${SCHEMAS[st.kindAuto].label.toLowerCase()}` : " · tipo non riconosciuto: scegli tu"}`),
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
          h("summary", {}, h("b", {}, res.errors.length === 1 ? "1 riga non importata" : `${res.errors.length} righe non importate`)),
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
      if (res.past) preview = h("div", { class: "stack" }, preview, h("p", { class: "muted small", style: { margin: 0 } }, `${res.past === 1 ? "1 appello con data già passata non è stato considerato" : `${res.past} appelli con data già passata non sono stati considerati`}.`));
      action = h("button", { class: "btn primary", disabled: !res.items.length, onclick: () => { const msg = applyExams(res.items); done(msg, "#/"); } }, `Importa ${res.items.length} ${res.items.length === 1 ? "esame" : "esami"}`);
    } else if (st.kind === "insegnamenti") {
      preview = h("div", { style: { overflowX: "auto" } }, h("table", {},
        h("thead", {}, h("tr", {}, ["Insegnamento", "Anno", "CFU", "Tipo", "Prova", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, res.items.map((c) => h("tr", {}, h("td", {}, c.name), h("td", {}, c.year || "—"), h("td", {}, c.cfu || "—"), h("td", {}, c.kind === "a_scelta" ? badge("a scelta", "warn") : c.kind), h("td", {}, c.format), h("td", {}, badge(c.status, c.status === "nuovo" ? "good" : "brand")))))));
      action = h("button", { class: "btn primary", disabled: !res.items.length, onclick: () => done(applyCourses(res.items), "#/profile") }, `Importa ${res.items.length} ${res.items.length === 1 ? "insegnamento" : "insegnamenti"}`);
    } else {
      st.include ??= new Set(res.courses.map((c) => c.name));
      const until = h("input", { type: "date", id: "import-until", value: st.until, min: today(), onchange: (e) => (st.until = e.target.value) });
      const hasWeekly = res.items.some((l) => l.weekday);
      preview = h("div", { class: "stack" },
        h("p", { class: "muted small", style: { margin: 0 } }, "Spunta gli insegnamenti che frequenti: le loro lezioni riducono il tempo di studio dei giorni in cui cadono."),
        h("ul", { class: "checklist" }, res.courses.map((c) => h("li", {}, h("label", {}, h("input", { type: "checkbox", checked: st.include.has(c.name), onchange: (e) => { e.target.checked ? st.include.add(c.name) : st.include.delete(c.name); redraw(); } }), h("span", {}, `${c.name} `, h("span", { class: "muted small" }, `(${c.count === 1 ? "1 lezione" : `${c.count} lezioni`})`)))))),
        hasWeekly ? h("label", {}, "Le lezioni settimanali valgono fino al", until, h("span", { class: "hint" }, "Data di fine delle lezioni del semestre. Senza data le sottraggo da tutti i giorni del piano.")) : null);
      action = h("button", { class: "btn primary", disabled: !res.items.length, onclick: async () => { const msg = await applyTimetable(res); if (msg) done(msg, "#/"); } }, (() => { const n = res.items.filter((l) => st.include.has(l.course)).length; return `Importa ${n} ${n === 1 ? "lezione" : "lezioni"}`; })());
    }

    const textless = !!st.pdf?.textless && !st.fromAI;
    const pdfBox = st.pdf
      ? h("div", { class: `callout stack${textless ? " warn" : ""}` },
          h("div", {}, h("b", {}, st.fromAI ? "Letto dall'AI dal PDF. " : textless ? "PDF scansionato. " : `PDF letto (${st.pdf.numPages} pagine). `),
            st.fromAI ? "Controlla l'anteprima: l'AI può sbagliare." : textless ? "Non c'è testo selezionabile: serve l'AI per leggerlo." : "Le tabelle semplici si leggono da sole; per orari a griglia o impaginazioni complesse fai leggere il documento all'AI."),
          st.notes?.length ? h("ul", { style: { margin: 0 } }, st.notes.map((n) => h("li", {}, n))) : null,
          aiBusy ? h("div", { class: "row" }, h("span", { class: "spinner" }), (aiBusy.el = h("span", {}, "L'AI legge il documento…")), h("span", { class: "muted small" }, "può richiedere un minuto")) : null,
          h("div", { class: "row" },
            h("button", { class: "btn primary", id: "import-ai", disabled: !core.ai.ai || !!aiBusy, onclick: async () => { try { await aiRead(st.kind, redraw); } catch (e) { toast(e.message, "error"); } redraw(); } }, st.fromAI ? "Rileggi con l'AI" : "Leggi con l'AI"),
            !core.ai.ai ? h("span", { class: "muted small" }, "L'AI non è disponibile.") : null,
            st.pdf.lines && st.kind === "insegnamenti" && !st.fromAI ? h("button", { class: "btn", id: "import-local", onclick: () => { try { localCurriculum(); } catch (e) { toast(e.message, "error"); } redraw(); } }, "Lettura rapida come elenco (senza AI)") : null),
          st.pdf.text ? h("details", {}, h("summary", { class: "small" }, "Testo estratto dal PDF"), h("pre", { style: { whiteSpace: "pre", overflow: "auto", maxHeight: "260px", font: "12px ui-monospace, monospace" } }, st.pdf.text.slice(0, 8000))) : null)
      : null;

    return [h("div", { class: "row between" }, h("h1", { style: { margin: 0 } }, "Importa da CSV, Excel o PDF"), h("a", { class: "btn ghost", href: "#/" }, "Home")),
      source, kindBox, pdfBox,
      ...(textless ? [] : [mapBox, h("div", { class: "card stack" }, h("h3", { style: { margin: 0 } }, "4 · Anteprima"), preview, errors, action ? h("div", {}, action) : null)])];
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
