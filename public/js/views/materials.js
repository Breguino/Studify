import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { findExamFormat } from "../exam-type.js";
import { EXAM_TYPES } from "../methods.js";
import { buildLocalModule } from "../local-builder.js";
import * as store from "../store.js";
import { badge, h, readFileAs, toast, uid } from "../ui.js";

const MAX_PDF_TOTAL = 24 * 1024 * 1024;
const KIND = { notes: "Appunti", pdf: "PDF", web: "Ricerca online" };

// Operazioni lunghe in corso, per esame: sopravvivono ai re-render della pagina.
const jobs = new Map();

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function jobLine(exam, kind, label) {
  const job = jobs.get(exam.id);
  if (!job || job.kind !== kind) return null;
  const el = h("span", {}, `${label}…`);
  job.el = el;
  return h("div", { class: "callout row" }, h("span", { class: "spinner" }), el, h("span", { class: "muted small" }, "può richiedere qualche minuto, puoi cambiare pagina"));
}

async function run(exam, kind, fn) {
  if (jobs.has(exam.id)) return toast("C'è già un'operazione in corso per questo esame.", "error");
  jobs.set(exam.id, { kind, el: null, started: Date.now() });
  core.rerender();
  try {
    await fn((chars) => {
      const j = jobs.get(exam.id);
      if (j?.el) j.el.textContent = `${kind === "research" ? "Ricerca in corso" : "Generazione in corso"}… ~${Math.round(chars / 1000)}k caratteri prodotti`;
    });
  } catch (e) {
    toast(e.message, "error");
  } finally {
    jobs.delete(exam.id);
    store.save();
    core.rerender();
  }
}

async function addFiles(exam, files) {
  let pdfTotal = exam.materials.filter((m) => m.kind === "pdf").reduce((s, m) => s + m.size, 0);
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, "");
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      if (pdfTotal + file.size > MAX_PDF_TOTAL) {
        toast(`«${file.name}»: superato il limite di ${kb(MAX_PDF_TOTAL)} di PDF per esame.`, "error");
        continue;
      }
      const dataUrl = await readFileAs(file, "dataurl");
      const fileId = uid();
      await store.putFile(fileId, dataUrl.slice(dataUrl.indexOf(",") + 1));
      exam.materials.push({ id: uid(), kind: "pdf", title: name, fileId, size: file.size });
      pdfTotal += file.size;
    } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/")) {
      const text = await readFileAs(file, "text");
      exam.materials.push({ id: uid(), kind: "notes", title: name, text, size: text.length });
    } else toast(`«${file.name}»: formato non supportato (usa .txt, .md o .pdf).`, "error");
  }
  store.save();
  core.rerender();
}

async function removeMaterial(exam, m) {
  if (m.fileId) await store.delFile(m.fileId);
  exam.materials = exam.materials.filter((x) => x.id !== m.id);
  store.save();
  core.rerender();
}

async function generate(exam) {
  const hasProgress = exam.module && (Object.keys(exam.srs).length || Object.keys(exam.qstats).length || Object.keys(exam.learned).length);
  if (hasProgress && !confirm("Rigenerare il modulo azzera flashcard, quiz e argomenti già svolti per questo esame. Continuare?")) return;
  await run(exam, "module", async (onProgress) => {
    const materials = [];
    let research = null;
    for (const m of exam.materials) {
      if (m.kind === "web") research = { notes: m.text, sources: m.sources };
      else if (m.kind === "pdf") materials.push({ kind: "pdf", title: m.title, data: await store.getFile(m.fileId) });
      else materials.push({ kind: "notes", title: m.title, text: m.text });
    }
    const mod = await api.runJob("/api/module", {
      exam: { name: exam.name, type: exam.type, level: exam.level, daysLeft: daysLeft(exam), language: exam.language, university: exam.university, degree: exam.degree, cfu: exam.cfu },
      materials, research,
    }, onProgress);
    resetProgress(exam, mod);
    toast("Modulo pronto!", "ok");
  });
}

function resetProgress(exam, mod) {
  Object.assign(exam, { module: mod, moduleBuiltAt: new Date().toISOString(), srs: {}, qstats: {}, learned: {}, done: {}, plan: null });
}

function generateLocal(exam) {
  const text = exam.materials.filter((m) => m.kind === "notes").map((m) => m.text).join("\n\n");
  if (!text.trim()) return toast("La modalità base funziona solo con appunti testuali (non PDF).", "error");
  const mod = buildLocalModule(text, exam.name);
  if (!mod.topics.length) return toast("Non ho trovato argomenti: aggiungi titoli (#, 1., MAIUSCOLO) agli appunti.", "error");
  resetProgress(exam, mod);
  store.save();
  toast(`Modulo base: ${mod.topics.length} argomenti, ${mod.flashcards.length} flashcard.`, "ok");
  core.rerender();
}

export function materialsTab(exam) {
  const ai = core.ai.ai;
  const hasContent = exam.materials.length > 0;
  const busy = jobs.has(exam.id);

  /* --- incolla appunti --- */
  const title = h("input", { placeholder: "Titolo (es. Lezione 3 — Elasticità)" });
  const text = h("textarea", { placeholder: "Incolla qui i tuoi appunti…" });
  const paste = h("form", { class: "stack", onsubmit: (e) => {
    e.preventDefault();
    if (!text.value.trim()) return toast("Incolla del testo.", "error");
    exam.materials.push({ id: uid(), kind: "notes", title: title.value.trim() || `Appunti ${exam.materials.length + 1}`, text: text.value, size: text.value.length });
    store.save();
    core.rerender();
  } }, h("h3", {}, "Incolla appunti"), title, text, h("div", {}, h("button", { class: "btn", type: "submit" }, "Aggiungi")));

  /* --- carica file --- */
  const input = h("input", { type: "file", multiple: true, accept: ".txt,.md,.markdown,.pdf,application/pdf,text/plain", hidden: true });
  input.addEventListener("change", () => addFiles(exam, [...input.files]));
  const drop = h("div", { class: "file-drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && input.click(),
    ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); addFiles(exam, [...e.dataTransfer.files]); } },
    h("b", {}, "Carica file"), h("div", { class: "small" }, ".txt, .md o .pdf (anche dispense scansionate non testuali: il PDF viene letto dall'AI)"), input);

  /* --- ricerca online --- */
  const focus = h("textarea", { placeholder: "Programma o argomenti da cercare (facoltativo). Es.: elasticità, teoria del consumatore, monopolio", style: { minHeight: "80px" } });
  const researchBox = h("div", { class: "card stack" },
    h("h3", {}, "Cerca materiale online con l'AI"),
    h("p", { class: "muted small", style: { margin: 0 } }, "L'AI cerca dispense e fonti autorevoli e le riassume con i link. Leggi sempre il risultato prima di fidarti: puoi eliminarlo se non è pertinente."),
    focus,
    jobLine(exam, "research", "Ricerca in corso"),
    h("div", {}, h("button", { class: "btn", disabled: !ai || busy, onclick: () => run(exam, "research", async (p) => {
      const r = await api.runJob("/api/research", { examName: exam.name, university: exam.university, degree: exam.degree, focus: focus.value, language: exam.language }, p);
      exam.materials = exam.materials.filter((m) => m.kind !== "web");
      exam.materials.push({ id: uid(), kind: "web", title: "Ricerca online", text: r.notes, sources: r.sources, size: r.notes.length });
      toast(`Trovate ${r.sources.length} fonti.`, "ok");
    }) }, exam.materials.some((m) => m.kind === "web") ? "Ripeti la ricerca" : "Cerca online"), !ai ? h("span", { class: "muted small" }, " Richiede l'AI (ANTHROPIC_API_KEY).") : null));

  /* --- formato d'esame trovato dalla ricerca online --- */
  const web = exam.materials.find((m) => m.kind === "web");
  const found = web ? findExamFormat(web.text) : null;
  const formatBox = found && found.type !== exam.type
    ? h("div", { class: "callout row between" },
        h("span", {}, h("b", {}, "La ricerca indica: "), found.text, `. Il tuo esame è impostato come «${EXAM_TYPES[exam.type]}».`),
        h("button", { class: "btn small", onclick: () => { exam.type = found.type; exam.plan = null; store.save(); core.rerender(); } }, `Imposta «${EXAM_TYPES[found.type]}»`))
    : null;

  /* --- elenco materiali --- */
  const list = hasContent
    ? h("div", { class: "stack", style: { gap: "8px" } }, exam.materials.map((m) =>
        h("div", { class: "card flat" },
          h("div", { class: "row between" }, h("div", {}, h("b", {}, m.title), " ", badge(KIND[m.kind], m.kind === "web" ? "brand" : ""), " ", h("span", { class: "muted small" }, kb(m.size))),
            h("button", { class: "btn small danger", onclick: () => removeMaterial(exam, m), "aria-label": `Rimuovi ${m.title}` }, "Rimuovi")),
          m.kind === "web" ? h("details", {}, h("summary", { class: "small" }, `Anteprima e ${m.sources.length} fonti`),
            h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: "260px", overflow: "auto", font: "inherit", fontSize: ".9rem" } }, m.text),
            h("ul", { class: "source-list" }, m.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null)))
    : h("p", { class: "muted" }, "Nessun materiale ancora. Aggiungi appunti, file o fai partire una ricerca online.");

  /* --- generazione --- */
  const gen = h("div", { class: "card stack" },
    h("h3", {}, exam.module ? "Rigenera il modulo" : "Genera il modulo di studio"),
    h("p", { class: "muted small", style: { margin: 0 } }, ai
      ? "L'AI legge tutti i materiali e produce argomenti, flashcard, domande e l'elenco delle lacune. Il tuo materiale ha la priorità sulle fonti web."
      : "AI non disponibile: la modalità base ricava argomenti e flashcard dalle definizioni presenti nei tuoi appunti testuali (niente quiz)."),
    jobLine(exam, "module", "Generazione in corso"),
    h("div", { class: "row" },
      ai ? h("button", { class: "btn primary", disabled: !hasContent || busy, onclick: () => generate(exam) }, exam.module ? "Rigenera con l'AI" : "Genera con l'AI") : null,
      !ai ? h("button", { class: "btn primary", disabled: !hasContent || busy, onclick: () => generateLocal(exam) }, "Crea modulo base") : null,
      exam.module ? h("a", { class: "btn", href: `#/exam/${exam.id}/today` }, "Vai al piano") : null));

  return h("div", { class: "stack" },
    h("div", { class: "grid" }, h("div", { class: "card stack" }, paste, drop), researchBox),
    formatBox, h("h2", { style: { margin: "6px 0 0" } }, `Materiali (${exam.materials.length})`), list, gen);
}
