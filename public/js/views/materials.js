import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { findExamFormat } from "../exam-type.js";
import { EXAM_TYPES } from "../methods.js";
import { buildLocalModule, localDelta } from "../local-builder.js";
import { addRange, applyUpdate, compactModule, markSent, mathyPages, parseRange, pendingMaterials, rangesCover, replacePages, sliceText, unsentPages, updateSummary } from "../module-update.js";
import { officeText } from "../office-text.js";
import { extractPdfPages } from "../pdf-pages.js";
import { readPdf } from "../pdf-text.js";
import { guessRole, roleOf, ROLES } from "../material-roles.js";
import * as store from "../store.js";
import { fmtDate, today } from "../dates.js";
import { richParas } from "../math.js";
import { badge, confirmDialog, h, readFileAs, toast, uid } from "../ui.js";

const MAX_PDF_TOTAL = 300 * 1024 * 1024; // archiviati nel browser: anche libri interi, poi se ne scelgono le pagine
// Per una richiesta all'AI (limiti dell'API: 600 pagine e 32 MB; il server accetta 40 MB di richiesta in base64)
const MAX_SEND_PAGES = 600;
const MAX_SEND_BYTES = 28 * 1024 * 1024;
const KIND = { notes: "Testo", pdf: "PDF", web: "Ricerca online" }; // il formato; il tipo (libro, esercizi…) è a parte

// Operazioni lunghe in corso, per esame: sopravvivono ai re-render della pagina.
const jobs = new Map();

const now = () => new Date().toISOString();
// Ridisegno dopo l'evento: un campo con il focus rimosso durante «change» farebbe scattare un secondo ridisegno annidato.
const rerenderSoon = () => setTimeout(() => core.rerender());
const chars = (n) => (n < 1000 ? `${n} caratteri` : `~${Math.round(n / 1000)}k caratteri`);
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function jobLine(exam, kind, label) {
  const job = jobs.get(exam.id);
  if (!job || job.kind !== kind) return null;
  const el = h("span", {}, `${label}…`);
  job.el = el;
  return h("div", { class: "callout row" }, h("span", { class: "spinner" }), el, h("span", { class: "muted small" }, "può richiedere qualche minuto, puoi cambiare pagina"));
}

async function run(exam, kind, fn, meta = {}) {
  if (jobs.has(exam.id)) return toast("C'è già un'operazione in corso per questo esame.", "error");
  jobs.set(exam.id, { kind, el: null, started: Date.now(), ...meta });
  core.rerender();
  try {
    await fn((chars, label) => {
      const j = jobs.get(exam.id);
      if (j?.el) j.el.textContent = label ?? `${{ research: "Ricerca in corso", update: "Aggiornamento in corso" }[kind] ?? "Generazione in corso"}… ~${Math.round(chars / 1000)}k caratteri prodotti`;
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
    if ((/\.pdf$/i.test(file.name) || file.type === "application/pdf") && core.ai.pdf === false && core.pdfText) {
      // pagina Claude: il PDF non si può inviare, ma il testo si estrae qui e diventa un appunto
      try {
        if (file.size > 8 * 1024 * 1024) toast(`Leggo «${file.name}»: per un libro può volerci qualche decina di secondi…`);
        const { text, pages } = await core.pdfText(file);
        const pdfFileId = uid();
        await store.putFile(pdfFileId, new Uint8Array(await file.arrayBuffer())); // solo per questa sessione: serve a «Leggi formule»
        const scanned = text.replace(/\f/g, "").trim().length < 80;
        if (scanned && !core.pdfPageImages) toast(`«${file.name}»: PDF senza testo selezionabile (scansione): incolla il testo a mano.`, "error");
        else {
          exam.materials.push({ id: uid(), kind: "notes", role: guessRole(file.name, true), title: `${name} (da PDF)`, text: scanned ? Array(pages).fill("").join("\f") : text, size: text.length, numPages: pages, fromPdf: true, pdfFileId, fileName: file.name, addedAt: now() });
          if (scanned) toast(`«${file.name}» è una scansione: scegli le pagine e usa «Leggi formule e testo con Claude».`);
        }
      } catch (e) {
        toast(`«${file.name}»: ${e.message}`, "error");
      }
    } else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      if (pdfTotal + file.size > MAX_PDF_TOTAL) {
        toast(`«${file.name}»: superato il limite di ${kb(MAX_PDF_TOTAL)} di PDF per esame.`, "error");
        continue;
      }
      const dataUrl = await readFileAs(file, "dataurl");
      const fileId = uid();
      await store.putFile(fileId, dataUrl.slice(dataUrl.indexOf(",") + 1));
      let numPages;
      try {
        numPages = (await readPdf(await file.arrayBuffer(), { maxPages: 0 })).numPages;
      } catch {
        /* il conteggio serve solo a scegliere le pagine */
      }
      exam.materials.push({ id: uid(), kind: "pdf", role: guessRole(file.name, true), title: name, fileId, size: file.size, numPages, addedAt: now() });
      pdfTotal += file.size;
    } else if (/\.(docx|pptx)$/i.test(file.name)) {
      try {
        const { text, pages } = await officeText(await file.arrayBuffer(), file.name);
        if (text.replace(/\f/g, "").trim().length < 20) toast(`«${file.name}»: nessun testo trovato (solo immagini?).`, "error");
        else exam.materials.push({ id: uid(), kind: "notes", role: guessRole(file.name, /\.pptx$/i.test(file.name)), title: name, text, size: text.length, numPages: pages || undefined, addedAt: now() });
      } catch (e) {
        toast(`«${file.name}»: ${e.message}`, "error");
      }
    } else if (/\.(doc|ppt)$/i.test(file.name)) {
      toast(`«${file.name}»: il vecchio formato Office non è supportato. Salvalo come .docx/.pptx o PDF.`, "error");
    } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/")) {
      const text = await readFileAs(file, "text");
      exam.materials.push({ id: uid(), kind: "notes", role: guessRole(file.name), title: name, text, size: text.length, addedAt: now() });
    } else toast(`«${file.name}»: formato non supportato (usa .pdf, .docx, .pptx, .txt o .md).`, "error");
  }
  store.save();
  core.rerender();
}

async function removeMaterial(exam, m) {
  if (m.fileId) await store.delFile(m.fileId);
  if (m.pdfFileId) await store.delFile(m.pdfFileId);
  exam.materials = exam.materials.filter((x) => x.id !== m.id);
  store.save();
  core.rerender();
}

const hasProgress = (exam) => exam.module && (Object.keys(exam.srs).length || Object.keys(exam.qstats).length || Object.keys(exam.learned).length);
const examInfo = (exam) => ({ name: exam.name, type: exam.type, level: exam.level, daysLeft: daysLeft(exam), language: exam.language, university: exam.university, degree: exam.degree, cfu: exam.cfu });

/**
 * Materiali nel formato delle API: dei PDF e dei testi divisi in pagine si mandano solo le pagine scelte
 * (con `onlyNew`, solo quelle non ancora nel modulo). Controlla i limiti di una richiesta prima di partire.
 */
async function payload(list, { onlyNew = false } = {}) {
  const materials = [];
  let research = null;
  let pages = 0;
  let bytes = 0;
  for (const m of list) {
    const range = onlyNew ? unsentPages(m) : parseRange(m.pages, m.numPages) ? m.pages : null;
    const r = parseRange(range, m.numPages);
    if (m.kind === "web") research = { notes: m.text, sources: m.sources, generated: !!m.generated };
    else if (m.kind === "pdf") {
      let data = await store.getFile(m.fileId);
      if (r && extractPdfPages && (r.from > 1 || r.to < (m.numPages ?? Infinity))) data = await extractPdfPages(data, r.from, r.to);
      pages += r ? r.to - r.from + 1 : m.numPages ?? 0;
      bytes += data.length;
      materials.push({ kind: "pdf", role: roleOf(m), title: m.title, pages: r ? `${r.from}-${r.to}` : "", data });
    } else materials.push({ kind: "notes", role: roleOf(m), title: m.title, pages: r ? `${r.from}-${r.to}` : "", text: sliceText(m.text, range) });
  }
  if (pages > MAX_SEND_PAGES || bytes > MAX_SEND_BYTES)
    throw new Error(`Troppo materiale PDF per una volta (${pages} pagine, ${kb(bytes * 0.75)}): il limite è ${MAX_SEND_PAGES} pagine e ~${kb(MAX_SEND_BYTES * 0.75)}. Nel materiale scegli le pagine (es. i capitoli del programma) e aggiungi il resto dopo con «Aggiungi al modulo».`);
  return { materials, research };
}

async function generate(exam) {
  if (hasProgress(exam) && !(await confirmDialog("Rigenerare il modulo azzera flashcard, quiz e argomenti già svolti per questo esame. Se hai solo aggiunto appunti nuovi, usa «Aggiungi al modulo». Continuare?", { ok: "Rigenera tutto", danger: true }))) return;
  await run(exam, "module", async (onProgress) => {
    const mod = await api.runJob("/api/module", { exam: examInfo(exam), ...(await payload(exam.materials)) }, onProgress);
    resetProgress(exam, mod);
    exam.materials.forEach(markSent);
    toast("Modulo pronto!", "ok");
  });
}

function resetProgress(exam, mod) {
  mod.materialIds = exam.materials.map((m) => m.id);
  Object.assign(exam, { module: mod, moduleBuiltAt: now(), moduleUpdatedAt: null, srs: {}, qstats: {}, learned: {}, done: {}, plan: null });
}

/** Aggiunge al modulo i materiali nuovi: argomenti nuovi o approfonditi, carte e domande nuove; i progressi restano. */
async function update(exam) {
  const pending = pendingMaterials(exam);
  if (!pending.length) return;
  await run(exam, "update", async (onProgress) => {
    const res = await api.runJob("/api/module-extend", { exam: examInfo(exam), ...(await payload(pending, { onlyNew: true })), existing: compactModule(exam.module) }, onProgress);
    toast(updateSummary(applyUpdate(exam, res, pending.map((m) => m.id))), "ok");
    pending.forEach(markSent);
  });
}

function updateLocal(exam) {
  const pending = pendingMaterials(exam);
  const text = pending.filter((m) => m.kind === "notes" && roleOf(m) !== "esercizi").map((m) => sliceText(m.text, unsentPages(m))).join("\n\n");
  if (!text.trim()) return toast("La modalità base usa solo appunti testuali (non PDF).", "error");
  toast(updateSummary(applyUpdate(exam, { delta: localDelta(text, "Appunti nuovi"), mode: "local" }, pending.map((m) => m.id))), "ok");
  pending.forEach(markSent);
  store.save();
  core.rerender();
}

function generateLocal(exam) {
  const text = exam.materials.filter((m) => m.kind === "notes" && roleOf(m) !== "esercizi").map((m) => sliceText(m.text, m.pages)).join("\n\n");
  if (!text.trim()) return toast("La modalità base funziona solo con appunti testuali (non PDF).", "error");
  const mod = buildLocalModule(text, exam.name);
  if (!mod.topics.length) return toast("Non ho trovato argomenti: aggiungi titoli (#, 1., MAIUSCOLO) agli appunti.", "error");
  resetProgress(exam, mod);
  exam.materials.forEach(markSent);
  store.save();
  toast(`Modulo base: ${mod.topics.length} argomenti, ${mod.flashcards.length} flashcard.`, "ok");
  core.rerender();
}

/** Anteprima del testo usato (pagine scelte), con le formule disegnate: per controllare che siano giuste. */
function preview(m) {
  const box = h("div", { class: "material-preview" });
  return h("details", { ontoggle: (e) => {
    if (!e.target.open || box.childNodes.length) return;
    const pages = sliceText(m.text, m.pages);
    const text = pages.length > 6000 ? `${pages.slice(0, 6000).replace(/\$[^$]*$/, "")}\n\n…` : pages;
    box.replaceChildren(...richParas(text.replace(/\f/g, "\n\n").replace(/^#{1,4}\s+/gm, ""))); // titoli Markdown della trascrizione
  } }, h("summary", { class: "small" }, "Anteprima del testo"), box);
}

const MAX_TRANSCRIBE = 30; // pagine per volta da far leggere a Claude come immagini

/**
 * Pagina Claude: le formule estratte come testo da un PDF escono storpiate. Qui le pagine scelte diventano immagini e Claude
 * le trascrive con le formule in LaTeX. Il PDF resta in memoria solo per la sessione: dopo una ricarica va riselezionato.
 */
function formulaRow(exam, m) {
  if (!core.pdfPageImages || !(m.fromPdf || m.title.endsWith("(da PDF)")) || !m.numPages) return null;
  const r = parseRange(m.pages, m.numPages) ?? { from: 1, to: m.numPages };
  const n = r.to - r.from + 1;
  const job = jobs.get(exam.id);
  if (job?.kind === "transcribe" && job.mid === m.id) return jobLine(exam, "transcribe", "Leggo le pagine con Claude");
  if (rangesCover(m.mathPages, r.from, r.to)) return h("div", { class: "small" }, badge("formule lette con Claude", "good"), h("span", { class: "muted" }, ` pagine ${m.mathPages.replace(/,/g, ", ")}`));
  const mathy = mathyPages(sliceText(m.text, m.pages));
  const picker = h("input", { type: "file", accept: ".pdf,application/pdf", hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const data = new Uint8Array(await f.arrayBuffer());
    const pages = (await core.pdfText(f)).pages;
    if (pages !== m.numPages) return toast(`Non sembra lo stesso PDF (${pages} pagine invece di ${m.numPages}).`, "error");
    m.pdfFileId ??= uid();
    await store.putFile(m.pdfFileId, data);
    transcribe(exam, m, r, data);
  } });
  const go = async () => {
    const data = m.pdfFileId ? await store.getFile(m.pdfFileId) : null;
    if (!data) return picker.click(); // dopo una ricarica il PDF non c'è più: lo si riseleziona
    transcribe(exam, m, r, data);
  };
  return h("div", { class: "stack", style: { gap: "4px" } },
    h("div", { class: "row", style: { gap: "8px" } },
      h("button", { class: "btn small", disabled: n > MAX_TRANSCRIBE || jobs.has(exam.id), onclick: go }, `Leggi formule e figure con Claude (${n === 1 ? `pagina ${r.from}` : `pagine ${r.from}–${r.to}`})`), picker),
    h("span", { class: "small muted" }, n > MAX_TRANSCRIBE ? `Scegli al massimo ${MAX_TRANSCRIBE} pagine per volta.` : mathy
      ? `${mathy} ${mathy === 1 ? "pagina sembra avere" : "pagine sembrano avere"} formule: dal testo del PDF escono storpiate. Claude legge le pagine come immagini e le trascrive esatte (circa ${Math.ceil(n / 3)} richieste).`
      : "Consigliato se ci sono formule, tabelle o grafici: Claude legge le pagine come immagini."));
}

async function transcribe(exam, m, r, data) {
  await run(exam, "transcribe", async (onProgress) => {
    onProgress(0, "Preparo le immagini delle pagine…");
    const { images } = await core.pdfPageImages(data, r.from, r.to);
    const pages = await api.runJob("/api/transcribe", { images, firstPage: r.from, title: m.title.replace(/ \(da PDF\)$/, "") }, onProgress);
    m.text = replacePages(m.text, r.from, pages, m.numPages);
    m.size = m.text.length;
    pages.forEach((p, k) => { if (p != null) m.mathPages = addRange(m.mathPages, r.from + k, r.from + k); });
    const missing = pages.filter((p) => p == null).length;
    const inModule = m.sentPages !== undefined;
    toast(`Pagine lette con Claude${missing ? ` (${missing} non trascritte: riprova)` : ""}.${inModule ? " Queste pagine erano già nel modulo con le formule del testo del PDF: per rifare carte e domande usa «Rigenera tutto»." : ""}`, missing ? "error" : "ok");
  }, { mid: m.id });
}

/** «Pagine 45–120 di 380»: per libri e slide si sceglie la parte da usare (vuoto = tutte). */
function pagePicker(m) {
  const r = parseRange(m.pages, m.numPages);
  const unit = m.fileId || m.title.endsWith("(da PDF)") ? "pagine" : "slide";
  const num = (v, label) => h("input", { type: "number", min: 1, max: m.numPages, value: v ?? "", placeholder: label, "aria-label": `${label} (${m.title})`, style: { width: "78px", padding: "4px 8px" },
    onchange: (e) => {
      const box = e.target.parentElement.querySelectorAll("input");
      const a = Number(box[0].value) || 1;
      const b = Number(box[1].value) || m.numPages;
      m.pages = a <= 1 && b >= m.numPages ? null : `${Math.min(a, b)}-${Math.max(a, b)}`;
      store.save();
      rerenderSoon();
    } });
  const count = r ? r.to - r.from + 1 : m.numPages;
  return h("label", { class: "small muted page-pick", style: { display: "flex", gap: "6px", alignItems: "center", fontWeight: 400 } },
    unit === "pagine" ? "Pagine" : "Slide", num(r?.from, "da"), "–", num(r?.to, "a"), `di ${m.numPages}`,
    h("span", {}, r ? ` · ne uso ${count}` : " · tutte"),
    m.kind === "notes" ? h("span", {}, ` (${chars(sliceText(m.text, m.pages).length)})`) : null);
}

export function materialsTab(exam) {
  const ai = core.ai.ai;
  const hasContent = exam.materials.length > 0;
  const busy = jobs.has(exam.id);

  /* --- incolla appunti --- */
  const title = h("input", { placeholder: "Titolo (es. Lezione 3 — Elasticità)" });
  const pasteRole = h("select", { id: "paste-role", "aria-label": "Tipo di materiale" }, Object.entries(ROLES).map(([k, t]) => h("option", { value: k }, t)));
  const text = h("textarea", { placeholder: "Incolla qui i tuoi appunti…" });
  const paste = h("form", { class: "stack", onsubmit: (e) => {
    e.preventDefault();
    if (!text.value.trim()) return toast("Incolla del testo.", "error");
    exam.materials.push({ id: uid(), kind: "notes", role: pasteRole.value, title: title.value.trim() || `${ROLES[pasteRole.value]} ${exam.materials.length + 1}`, text: text.value, size: text.value.length, addedAt: now() });
    store.save();
    core.rerender();
  } }, h("h3", {}, "Incolla appunti, esercizi o parti di libro"), h("div", { class: "row", style: { gap: "8px", flexWrap: "nowrap" } }, title, pasteRole), text, h("div", {}, h("button", { class: "btn", type: "submit" }, "Aggiungi")));

  /* --- carica file --- */
  const input = h("input", { type: "file", multiple: true, accept: `${core.ai.pdf === false && !core.pdfText ? "" : ".pdf,application/pdf,"}.docx,.pptx,.txt,.md,.markdown,text/plain`, hidden: true });
  input.addEventListener("change", () => addFiles(exam, [...input.files]));
  const drop = h("div", { class: "file-drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && input.click(),
    ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); addFiles(exam, [...e.dataTransfer.files]); } },
    h("b", {}, "Carica libro, dispense, slide, esercizi"), h("div", { class: "small" }, core.ai.pdf === false
      ? (core.pdfText ? ".pdf, .docx, .pptx, .txt, .md: di un PDF si legge il testo (le scansioni no; le formule possono uscire male)" : ".docx, .pptx, .txt o .md (i PDF non sono supportati qui: copia il testo e incollalo)")
      : ".pdf (anche scansioni e formule: il PDF viene letto dall'AI), .docx, .pptx, .txt, .md"),
      h("div", { class: "small muted" }, "Di un libro scegli poi le pagine dei capitoli del programma."), input);

  /* --- ricerca online (o, senza web, traccia dal programma) --- */
  const webOk = core.ai.web !== false;
  const focus = h("textarea", { placeholder: webOk ? "Programma o argomenti da cercare (facoltativo). Es.: elasticità, teoria del consumatore, monopolio" : "Incolla qui il programma del corso o elenca gli argomenti. Es.: elasticità, teoria del consumatore, monopolio", style: { minHeight: "80px" } });
  const hasWeb = exam.materials.some((m) => m.kind === "web");
  const researchBox = h("div", { class: "card stack" },
    h("h3", {}, webOk ? "Cerca materiale online con l'AI" : "Traccia di studio dal programma"),
    h("p", { class: "muted small", style: { margin: 0 } }, webOk
      ? "L'AI cerca dispense e fonti autorevoli e le riassume con i link. Leggi sempre il risultato prima di fidarti: puoi eliminarlo se non è pertinente."
      : "Qui Claude non può navigare sul web. Dal programma che indichi può scrivere una traccia di studio dalla sua conoscenza generale: è una bozza NON verificata e senza fonti, da confrontare con il tuo corso."),
    focus,
    jobLine(exam, "research", webOk ? "Ricerca in corso" : "Scrittura in corso"),
    h("div", {}, h("button", { class: "btn", disabled: !ai || busy, onclick: () => {
      if (!webOk && !focus.value.trim()) return toast("Indica il programma o gli argomenti da cui partire.", "error");
      return run(exam, "research", async (p) => {
        const r = await api.runJob("/api/research", { examName: exam.name, university: exam.university, degree: exam.degree, focus: focus.value, language: exam.language }, p);
        exam.materials = exam.materials.filter((m) => m.kind !== "web");
        exam.materials.push({ id: uid(), kind: "web", title: webOk ? "Ricerca online" : "Traccia AI (non verificata)", text: r.notes, sources: r.sources, size: r.notes.length, generated: !webOk, addedAt: now() });
        toast(webOk ? `Trovate ${r.sources.length} fonti.` : "Traccia pronta: leggila prima di usarla.", "ok");
      });
    } }, hasWeb ? (webOk ? "Ripeti la ricerca" : "Rigenera la traccia") : (webOk ? "Cerca online" : "Genera la traccia")), !ai ? h("span", { class: "muted small" }, " Richiede l'AI (ANTHROPIC_API_KEY).") : null));

  /* --- formato d'esame trovato dalla ricerca online --- */
  const web = exam.materials.find((m) => m.kind === "web");
  const found = web ? findExamFormat(web.text) : null;
  const formatBox = found && found.type !== exam.type
    ? h("div", { class: "callout row between" },
        h("span", {}, h("b", {}, "La ricerca indica: "), found.text, `. Il tuo esame è impostato come «${EXAM_TYPES[exam.type]}».`),
        h("button", { class: "btn small", onclick: () => { exam.type = found.type; exam.plan = null; store.save(); core.rerender(); } }, `Imposta «${EXAM_TYPES[found.type]}»`))
    : null;

  /* --- elenco materiali --- */
  const pending = pendingMaterials(exam);
  const isPending = new Set(pending.map((m) => m.id));
  const list = hasContent
    ? h("div", { class: "stack", style: { gap: "8px" } }, exam.materials.map((m) =>
        h("div", { class: "card flat" },
          h("div", { class: "row between" }, h("div", {}, h("b", {}, m.title), " ", badge(KIND[m.kind], m.kind === "web" ? "brand" : ""), " ", isPending.has(m.id) ? badge("non ancora nel modulo", "warn") : null, " ", h("span", { class: "muted small" }, kb(m.size)),
              m.kind !== "web" ? h("div", { class: "row", style: { gap: "6px", marginTop: "4px" } }, h("label", { class: "small muted", style: { display: "flex", gap: "6px", alignItems: "center", fontWeight: 400 } }, "Tipo",
                h("select", { class: "role-select", "aria-label": `Tipo di ${m.title}`, onchange: (e) => { m.role = e.target.value; store.save(); rerenderSoon(); } },
                  Object.entries(ROLES).map(([k, t]) => h("option", { value: k, selected: roleOf(m) === k }, t)))),
                m.numPages > 1 ? pagePicker(m) : null) : null,
              m.kind === "notes" ? formulaRow(exam, m) : null),
            h("button", { class: "btn small danger", onclick: () => removeMaterial(exam, m), "aria-label": `Rimuovi ${m.title}` }, "Rimuovi")),
          m.kind === "web" ? h("details", {}, h("summary", { class: "small" }, m.generated ? "Anteprima (bozza dalla conoscenza di Claude, senza fonti)" : `Anteprima e ${m.sources.length} fonti`),
            h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: "260px", overflow: "auto", font: "inherit", fontSize: ".9rem" } }, m.text),
            h("ul", { class: "source-list" }, m.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null,
          m.kind === "notes" ? preview(m) : null)))
    : h("p", { class: "muted" }, "Nessun materiale ancora. Aggiungi appunti, file o fai partire una ricerca online.");

  /* --- generazione / aggiornamento --- */
  const toPlan = exam.module ? h("a", { class: "btn", href: `#/exam/${exam.id}/today` }, "Vai al piano") : null;
  let gen;
  if (!exam.module)
    gen = h("div", { class: "card stack" },
      h("h3", {}, "Genera il modulo di studio"),
      h("p", { class: "muted small", style: { margin: 0 } }, ai
        ? "L'AI legge tutti i materiali e produce argomenti, flashcard, domande e l'elenco delle lacune. Il tuo materiale ha la priorità sulle fonti web."
        : "AI non disponibile: la modalità base ricava argomenti e flashcard dalle definizioni presenti nei tuoi appunti testuali (niente quiz)."),
      h("p", { class: "muted small", style: { margin: 0 } }, "Non serve aspettare di avere tutto: puoi partire dagli appunti delle prime lezioni e aggiungere gli altri man mano."),
      jobLine(exam, "module", "Generazione in corso"),
      h("div", { class: "row" },
        ai ? h("button", { class: "btn primary", disabled: !hasContent || busy, onclick: () => generate(exam) }, "Genera con l'AI") : null,
        !ai ? h("button", { class: "btn primary", disabled: !hasContent || busy, onclick: () => generateLocal(exam) }, "Crea modulo base") : null));
  else {
    const regen = ai
      ? h("button", { class: "btn ghost", disabled: !hasContent || busy, onclick: () => generate(exam) }, "Rigenera tutto")
      : h("button", { class: "btn ghost", disabled: !hasContent || busy, onclick: async () => { if (!hasProgress(exam) || (await confirmDialog("Rigenerare il modulo azzera flashcard, quiz e argomenti già svolti. Continuare?", { ok: "Rigenera tutto", danger: true }))) generateLocal(exam); } }, "Rigenera tutto");
    gen = pending.length
      ? h("div", { class: "card stack" },
          h("h3", {}, pending.length === 1 ? "Aggiungi il materiale nuovo al modulo" : `Aggiungi i ${pending.length} materiali nuovi al modulo`),
          h("p", { class: "muted small", style: { margin: 0 } }, `${pending.map((m) => `«${m.title}»`).join(", ")}: `,
            ai ? "l'AI li confronta con il modulo e aggiunge argomenti nuovi, approfondisce quelli che hai già e crea carte e domande solo sui contenuti nuovi."
              : "la modalità base aggiunge argomenti e flashcard ricavati dalle definizioni.",
            h("b", {}, " Flashcard, quiz e argomenti già studiati restano come sono.")),
          jobLine(exam, "update", "Aggiornamento in corso"), jobLine(exam, "module", "Generazione in corso"),
          h("div", { class: "row" },
            h("button", { class: "btn primary", disabled: busy, onclick: () => (ai ? update(exam) : updateLocal(exam)) }, "Aggiungi al modulo"),
            regen, toPlan))
      : h("div", { class: "card stack" },
          h("h3", {}, "Il modulo comprende tutti i materiali"),
          h("p", { class: "muted small", style: { margin: 0 } }, `${exam.moduleUpdatedAt ? `Ultimo aggiornamento: ${fmtDate(today(new Date(exam.moduleUpdatedAt)))}. ` : ""}Dopo la prossima lezione aggiungi qui gli appunti e poi «Aggiungi al modulo»: ripassare ogni settimana quello che hai appena studiato funziona meglio che concentrare tutto prima dell'esame.`),
          jobLine(exam, "module", "Generazione in corso"),
          h("div", { class: "row" }, toPlan, regen));
  }

  return h("div", { class: "stack" },
    h("div", { class: "grid" }, h("div", { class: "card stack" }, paste, drop), researchBox),
    formatBox, h("h2", { style: { margin: "6px 0 0" } }, `Materiali (${exam.materials.length})`), list, gen);
}
