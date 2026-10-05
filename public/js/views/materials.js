import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { findExamFormat } from "../exam-type.js";
import { EXAM_TYPES } from "../methods.js";
import { buildLocalModule, findExamHints, localDelta } from "../local-builder.js";
import { splitLessons } from "../lessons.js";
import { uncertainCount } from "../../../shared/prompts.js";
import { addRange, applyUpdate, compactModule, markSent, mathyPages, parseRange, pendingMaterials, rangesCover, replacePages, sliceText, unsentPages, updateSummary } from "../module-update.js";
import { officeText } from "../office-text.js";
import { extractPdfPages } from "../pdf-pages.js";
import { readPdf } from "../pdf-text.js";
import { guessRole, isPractice, roleOf, ROLES } from "../material-roles.js";
import { applyExamBoost, papersOf, parseStarts, preparePapers } from "../past-exams.js";
import { countLabel, numberedQuestions, questionsOf, remapExamRefs } from "../exam-questions.js";
import { applyOfficial, isSolutionsFile, officialExercises, officialQuestions, orphanSolutions, pendingOfficial, stemOf } from "../exercises.js";
import { paperStartsOf } from "../lessons.js";
import * as store from "../store.js";
import { fmtDate, today } from "../dates.js";
import { clipRich, rich, richParas } from "../math.js";
import { blobToBase64, byName, isImage, prepareImage } from "../images.js";
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
  const audio = files.filter((f) => /^audio\/|^video\//.test(f.type) || /\.(mp3|m4a|wav|aac|ogg|opus|flac|mp4|mov|webm)$/i.test(f.name));
  if (audio.length) {
    toast(`«${audio[0].name}»${audio.length > 1 ? ` e altri ${audio.length - 1}` : ""}: le registrazioni audio non si possono usare direttamente (Claude legge testo, PDF e immagini, non audio). Trascrivi la registrazione con un servizio di trascrizione e carica qui il testo come «Sbobine».`, "error");
    files = files.filter((f) => !audio.includes(f));
  }
  const photos = files.filter(isImage);
  if (photos.length) await addHandwritten(exam, photos);
  for (const file of files.filter((f) => !isImage(f))) {
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
          exam.materials.push(structure({ id: uid(), kind: "notes", role: guessRole(file.name, true), title: `${name} (da PDF)`, text: scanned ? Array(pages).fill("").join("\f") : text, size: text.length, numPages: pages, fromPdf: true, pdfFileId, fileName: file.name, addedAt: now() }));
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
      const m = { id: uid(), kind: "pdf", role: guessRole(file.name, true), title: name, fileId, size: file.size, numPages, addedAt: now() };
      exam.materials.push(m);
      if (m.role === "esami") await findPdfPapers(m);
      if (m.role === "domande") await pdfToQuestions(m);
      pdfTotal += file.size;
    } else if (/\.(docx|pptx)$/i.test(file.name)) {
      try {
        const { text, pages, ...extra } = await officeText(await file.arrayBuffer(), file.name);
        if (text.replace(/\f/g, "").trim().length < 20) toast(`«${file.name}»: nessun testo trovato (solo immagini?).`, "error");
        else exam.materials.push(structure({ id: uid(), kind: "notes", role: guessRole(file.name, /\.pptx$/i.test(file.name)), title: name, text, size: text.length, numPages: pages || undefined, addedAt: now(),
          ...(extra.sections ? { sections: extra.sections, figureSlides: extra.figureSlides, notesSlides: extra.notesSlides, hiddenSlides: extra.hiddenSlides } : {}) }));
      } catch (e) {
        toast(`«${file.name}»: ${e.message}`, "error");
      }
    } else if (/\.(doc|ppt)$/i.test(file.name)) {
      toast(`«${file.name}»: il vecchio formato Office non è supportato. Salvalo come .docx/.pptx o PDF.`, "error");
    } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/")) {
      const text = await readFileAs(file, "text");
      exam.materials.push(structure({ id: uid(), kind: "notes", role: guessRole(file.name), title: name, text, size: text.length, addedAt: now() }));
    } else toast(`«${file.name}»: formato non supportato (usa .pdf, .docx, .pptx, .txt o .md).`, "error");
  }
  store.save();
  core.rerender();
}

async function removeMaterial(exam, m) {
  if (m.fileId) await store.delFile(m.fileId);
  if (m.pdfFileId) await store.delFile(m.pdfFileId);
  for (const id of m.imageIds ?? []) await store.delFile(id);
  exam.materials = exam.materials.filter((x) => x.id !== m.id);
  if (["esami", "domande"].includes(roleOf(m)) && exam.module) { applyExamBoost(exam); exam.plan = null; } // senza quelle prove o domande la frequenza cambia
  store.save();
  core.rerender();
}

/** Documento senza pagine con almeno 2 intestazioni di lezione → diviso per lezioni (si scelgono come le pagine). */
function withLessons(m) {
  if (m.numPages || m.handwritten) return m;
  const r = splitLessons(m.text);
  if (r) Object.assign(m, { text: r.text, numPages: r.sections.length, sections: r.sections, unit: "lezioni" });
  return m;
}

/** Esami passati: un file con più prove diviso per prova; gli elenchi di domande restano interi; gli altri documenti divisi per lezione. */
const structure = (m) => (roleOf(m) === "esami" ? preparePapers(m) : roleOf(m) === "domande" ? m : withLessons(m));

/** Testo di ogni pagina di un PDF salvato (versione con server), riga per riga. */
async function pdfPageTexts(m, maxPages = 300) {
  const data = await store.getFile(m.fileId);
  const { pages } = await readPdf(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), { maxPages });
  return pages.map((p) => {
    const lines = new Map();
    for (const it of p.items) { const y = Math.round(it.y / 3); lines.set(y, [...(lines.get(y) ?? []), it]); }
    return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")).join("\n");
  });
}

/** PDF di esami passati (versione con server): dal testo delle pagine si trova dove inizia ogni prova. */
async function findPdfPapers(m) {
  if (m.paperStarts || !(m.numPages > 1)) return;
  try {
    const r = paperStartsOf(await pdfPageTexts(m));
    if (r) Object.assign(m, { paperStarts: r.starts, paperLabels: r.labels });
  } catch {
    /* PDF scansionato o illeggibile: le prove si indicano a mano */
  }
}

/**
 * PDF con un elenco di domande d'esame (versione con server): l'elenco serve come testo, una domanda per voce, perché ogni domanda
 * diventa una domanda del quiz. Una scansione senza testo non si può leggere così: va fotografata o incollata.
 */
async function pdfToQuestions(m) {
  try {
    const text = (await pdfPageTexts(m, 1000)).join("\f");
    if (text.replace(/\f/g, "").trim().length < 20) return toast(`«${m.title}» non ha testo selezionabile: fotografa l'elenco (Appunti scritti a mano, poi tipo «Domande d'esame») o incollalo.`, "error");
    if (m.fileId) await store.delFile(m.fileId);
    Object.assign(m, { kind: "notes", text, size: text.length, fromPdf: true, fileId: undefined });
  } catch (e) {
    toast(`«${m.title}»: ${e.message}`, "error");
  }
}

/** Versione con server: Claude legge il PDF dell'esercitazione (formule comprese) e il PDF diventa testo, diviso in esercizi. */
function readPdfExercises(exam, m) {
  return run(exam, "transcribe", async (onProgress) => {
    const n = m.numPages ?? 1;
    if (n > 60) throw new Error("Al massimo 60 pagine per un'esercitazione: dividi il PDF.");
    const data = await store.getFile(m.fileId);
    const pages = [];
    for (let from = 1; from <= n; from += 5) {
      const to = Math.min(n, from + 4);
      const chunk = n === 1 || !extractPdfPages ? data : await extractPdfPages(data, from, to);
      const r = await api.runJob("/api/transcribe-pdf", { data: chunk, firstPage: from, count: to - from + 1, title: m.title }, (c, l) => onProgress(c, l ?? `Claude legge il PDF… pagine ${from}–${to} di ${n}`));
      pages.push(...r.pages);
    }
    const text = pages.map((p) => p ?? "").join("\f");
    if (!text.replace(/\f/g, "").trim()) throw new Error("Claude non ha restituito il testo del PDF. Riprova.");
    await store.delFile(m.fileId);
    Object.assign(m, { kind: "notes", text, size: text.length, numPages: n, fromPdf: true, mathPages: `1-${n}`, fileId: undefined });
    const ex = officialExercises(exam).filter((e) => e.materialId === m.id);
    const off = await syncOfficial(exam, onProgress);
    toast(`PDF letto: ${ex.length} esercizi, ${ex.filter((e) => e.solution).length} con soluzione.${off ? ` ${off}` : ""}`, "ok");
  }, { mid: m.id });
}

/** Esercitazioni: esercizi riconosciuti, soluzioni abbinate (anche da un file a parte), e se sono già nel quiz. */
function exercisesRow(exam, m) {
  if (roleOf(m) !== "esercizi") return null;
  const job = jobs.get(exam.id);
  if (job?.kind === "transcribe" && job.mid === m.id) return jobLine(exam, "transcribe", "Claude legge il PDF dell'esercitazione");
  if (m.kind === "pdf")
    return core.ai.ai ? h("div", { class: "row small", style: { gap: "8px" } },
      h("button", { class: "btn small", disabled: jobs.has(exam.id), onclick: () => readPdfExercises(exam, m) }, `Leggi esercizi e soluzioni con Claude (${m.numPages ?? "?"} ${m.numPages === 1 ? "pagina" : "pagine"})`),
      h("span", { class: "muted" }, "Per fare gli esercizi dell'esercitazione e confrontarti con la soluzione ufficiale, Claude legge il PDF (formule comprese) e lo divide in esercizi.")) : null;
  if (isSolutionsFile(m)) {
    const ex = officialExercises(exam).find((e) => e.solutionFrom === m.id);
    const partner = ex && exam.materials.find((x) => x.id === ex.materialId);
    return partner ? h("div", { class: "small" }, badge("soluzioni", "good"), h("span", { class: "muted" }, ` abbinate agli esercizi di «${partner.title}»`))
      : orphanSolutions(exam).includes(m) ? h("div", { class: "small callout warn" }, `File di soluzioni: non trovo il file degli esercizi con lo stesso nome («${stemOf(m.title)}»). Rinominali in modo che coincidano, per esempio «Esercitazione 3» e «Esercitazione 3 - soluzioni».`) : null;
  }
  const items = officialExercises(exam).filter((e) => e.materialId === m.id);
  if (!items.length) return h("div", { class: "small muted" }, "Non riconosco gli esercizi uno per uno: servono titoli come «Esercizio 1» (o una numerazione «1.», «2.») e, per le soluzioni, «Soluzione» sotto ciascuno o una sezione «Soluzioni» in fondo.");
  const solved = items.filter((e) => e.solution);
  const inQuiz = new Set(officialQuestions(exam.module).map((q) => q.official.key));
  const missing = solved.filter((e) => !inQuiz.has(e.key));
  const fromOther = solved.some((e) => e.solutionFrom && e.solutionFrom !== m.id);
  const mangled = m.fromPdf && !rangesCover(m.mathPages, 1, m.numPages ?? 1) && mathyPages(m.text);
  return h("div", { class: "stack small", style: { gap: "4px" } },
    h("div", { class: "row", style: { gap: "8px", alignItems: "center" } },
      badge(`${items.length} ${items.length === 1 ? "esercizio" : "esercizi"}`, "brand"),
      badge(`${solved.length} con soluzione${fromOther ? " (dal file delle soluzioni)" : ""}`, solved.length ? "good" : "warn"),
      exam.module && solved.length && !missing.length ? h("a", { href: `#/exam/${exam.id}/quiz?mode=official&set=${encodeURIComponent(m.id)}` }, "Fai l'esercitazione →") : null),
    h("details", {}, h("summary", {}, "Esercizi e soluzioni riconosciuti"),
      h("ol", { class: "paper-items" }, items.map((e) => h("li", { value: Number.parseInt(e.n, 10) || null }, rich(clipRich(e.text.split("\n")[0], 110)), " ", e.solution ? badge("soluzione", "good") : badge("senza soluzione", "warn"))))),
    mangled ? h("div", { class: "muted" }, "Le formule prese dal testo del PDF escono storpiate: prima «Leggi formule e figure con Claude», poi metti gli esercizi nel quiz.") : null,
    exam.module && missing.length ? h("div", { class: "row", style: { gap: "8px" } },
      h("button", { class: "btn small primary", disabled: jobs.has(exam.id) || !core.ai.ai, onclick: () => run(exam, "update", async (p) => { toast(`Esercitazioni: ${(await syncOfficial(exam, p)) ?? "niente da aggiungere."}`, "ok"); }) }, `Metti nel quiz ${missing.length === 1 ? "l'esercizio" : `i ${missing.length} esercizi`} con soluzione`),
      h("span", { class: "muted" }, "Testo e soluzione restano quelli ufficiali: Claude sceglie solo l'argomento.")) : null,
    !exam.module && solved.length ? h("div", { class: "muted" }, "Quando generi il modulo, gli esercizi con soluzione entrano nel quiz così come sono.") : null);
}

/** Slide del docente: a cosa servono, le note del relatore lette, e le figure che da un PowerPoint non si leggono. */
function slidesRow(m) {
  if (roleOf(m) !== "slide") return null;
  const fig = m.figureSlides ?? [];
  const list = fig.length > 10 ? `${fig.slice(0, 10).join(", ")}…` : fig.join(", ");
  return h("div", { class: "stack small", style: { gap: "4px" } },
    m.notesSlides || m.hiddenSlides ? h("div", { class: "row", style: { gap: "8px" } },
      m.notesSlides ? badge(`note del relatore in ${m.notesSlides} ${m.notesSlides === 1 ? "slide" : "slide"}`, "good") : null,
      m.hiddenSlides ? h("span", { class: "muted" }, `${m.hiddenSlides} ${m.hiddenSlides === 1 ? "slide nascosta" : "slide nascoste"} nella presentazione (incluse)`) : null) : null,
    fig.length ? h("div", { class: "callout warn" }, `${fig.length === 1 ? "La slide" : "Le slide"} ${list} ${fig.length === 1 ? "ha" : "hanno"} grafici o immagini che dal file PowerPoint non si leggono (i grafici disegnati con linee e frecce, le immagini senza descrizione). `,
      `Per farli vedere a Claude esporta la presentazione in PDF (File → Esporta → PDF) e carica quello${core.ai.pdf === false ? ", poi usa «Leggi formule e figure con Claude»" : ": Claude legge anche i grafici"}.`) : null,
    h("div", { class: "muted" }, "Slide del docente: l'app le usa come traccia del corso (quali argomenti e in che ordine) e per capire su cosa insiste. Sono schematiche: le spiegazioni le prende da libro, dispense, sbobine e appunti, e ti segnala gli argomenti che sono solo sulle slide."));
}

/** Elenco di domande d'esame: quante, quante ripetute, a cosa servono. */
function questionsRow(m) {
  if (roleOf(m) !== "domande") return null;
  const qs = questionsOf(m);
  const repeated = qs.filter((q) => q.count > 1).length;
  return h("div", { class: "stack small", style: { gap: "4px" } },
    h("div", { class: "row", style: { gap: "8px", alignItems: "center" } },
      badge(`${qs.length} ${qs.length === 1 ? "domanda" : "domande"}`, "brand"), repeated ? h("span", { class: "muted" }, `${repeated} chieste più volte`) : null),
    qs.length ? h("details", {}, h("summary", {}, "Le domande riconosciute"),
      h("ol", { class: "paper-items" }, qs.slice(0, 60).map((q) => h("li", {}, q.text, h("b", {}, countLabel(q, (n) => ` ×${n}`, " (spesso)")), q.when.length ? h("span", { class: "muted" }, ` — ${q.when.join("; ")}`) : null))),
      qs.length > 60 ? h("div", { class: "muted" }, `… e altre ${qs.length - 60}.`) : null)
      : h("div", { class: "callout warn" }, "Non ho riconosciuto domande: scrivile una per riga, con «-» o «1.» davanti, o terminando con «?»."),
    h("div", { class: "muted" }, "Queste invece vanno nel quiz: all'orale le domande si ripetono e conviene saperle tutte. Per ognuna l'AI scrive la risposta modello dai tuoi materiali e la domanda con cui il docente potrebbe incalzarti."));
}

/** Esami passati: quante prove, dove iniziano (modificabile), e a cosa servono. */
function papersRow(exam, m) {
  if (roleOf(m) !== "esami") return null;
  const papers = papersOf(m);
  const paged = m.numPages > 1 && m.unit !== "prove";
  const starts = paged ? h("label", { class: "small muted", style: { display: "flex", gap: "6px", alignItems: "center", fontWeight: 400, flexWrap: "wrap" } },
    `Dove inizia ogni prova (${m.imageIds ? "foto" : m.fileId || m.fromPdf ? "pagine" : "slide"})`,
    h("input", { class: "paper-starts", value: (m.paperStarts ?? [1]).join(", "), placeholder: "es. 1, 4, 7", "aria-label": `Pagine dove inizia ogni prova (${m.title})`, style: { width: "130px", padding: "4px 8px" },
      onchange: (e) => {
        const v = parseStarts(e.target.value, m.numPages);
        if (v) { m.paperStarts = v; m.paperLabels = null; } else delete m.paperStarts;
        store.save();
        rerenderSoon();
      } })) : null;
  return h("div", { class: "stack small", style: { gap: "4px" } },
    h("div", { class: "row", style: { gap: "8px", alignItems: "center" } },
      badge(`${papers.length} ${papers.length === 1 ? "prova" : "prove"}`, "brand"),
      h("span", { class: "muted" }, papers.slice(0, 4).map((p) => p.label).join(" · ") + (papers.length > 4 ? ` · … (altre ${papers.length - 4})` : "")),
      h("a", { href: `#/exam/${exam.id}/esami` }, "Simula →")),
    starts,
    h("div", { class: "muted" }, "Le prove vere non diventano flashcard né domande del quiz: le tieni intatte per le simulazioni a tempo. Il modulo ne imita lo stile con esercizi nuovi."));
}

/** Testo mandato all'AI, per verificare che le citazioni del docente ci siano davvero. */
const sentInfo = ({ materials, research }) => ({ sentText: [...materials.map((m) => m.text ?? ""), research?.notes ?? ""].join("\n"), hasPdf: materials.some((m) => m.kind === "pdf") });

/** Modalità base: le frasi del docente sull'esame, copiate dai materiali (con la lezione da cui vengono). */
function localHints(list, rangeOf) {
  return list.filter((m) => m.kind === "notes").flatMap((m) => {
    const range = parseRange(rangeOf(m), m.numPages) ?? { from: 1, to: m.numPages || 1 };
    const pages = String(m.text).split("\f");
    return pages.slice(range.from - 1, range.to).flatMap((p, k) => findExamHints(p, [m.title.replace(/ \(da PDF\)$/, ""), m.sections?.[range.from - 1 + k]].filter(Boolean).join(" · ")));
  });
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
  const examMap = new Map(); // «D12» → chiave della domanda d'esame
  for (const m of list) {
    const range = onlyNew ? unsentPages(m) : parseRange(m.pages, m.numPages) ? m.pages : null;
    const r = parseRange(range, m.numPages);
    if (m.kind === "web") research = { notes: m.text, sources: m.sources, generated: !!m.generated };
    else if (roleOf(m) === "domande" && m.kind === "notes") {
      // l'elenco arriva all'AI come voci numerate «D12. …»: ogni domanda del quiz dice quali voci riproduce
      const text = numberedQuestions(questionsOf(m, range), examMap.size + 1, examMap);
      if (text) materials.push({ kind: "notes", role: "domande", title: m.title, pages: r ? `${r.from}-${r.to}` : "", unit: m.unit ?? "pagine", year: m.year ?? "", handwritten: false, text });
    }
    else if (m.kind === "pdf") {
      let data = await store.getFile(m.fileId);
      if (r && extractPdfPages && (r.from > 1 || r.to < (m.numPages ?? Infinity))) data = await extractPdfPages(data, r.from, r.to);
      pages += r ? r.to - r.from + 1 : m.numPages ?? 0;
      bytes += data.length;
      materials.push({ kind: "pdf", role: roleOf(m), title: m.title, pages: r ? `${r.from}-${r.to}` : "", data });
    } else materials.push({ kind: "notes", role: roleOf(m), title: m.title, pages: r ? `${r.from}-${r.to}` : "", unit: m.unit ?? "pagine", year: m.year ?? "", handwritten: !!m.handwritten, text: sliceText(m.text, range) });
  }
  if (pages > MAX_SEND_PAGES || bytes > MAX_SEND_BYTES)
    throw new Error(`Troppo materiale PDF per una volta (${pages} pagine, ${kb(bytes * 0.75)}): il limite è ${MAX_SEND_PAGES} pagine e ~${kb(MAX_SEND_BYTES * 0.75)}. Nel materiale scegli le pagine (es. i capitoli del programma) e aggiungi il resto dopo con «Aggiungi al modulo».`);
  return { materials, research, examMap };
}

/**
 * Esercitazioni: gli esercizi con la soluzione ufficiale entrano nel quiz così come sono. Prima si collegano quelli che l'AI ha già
 * copiato nel quiz (prendono la soluzione ufficiale), poi Claude sceglie l'argomento e una rubrica per gli altri.
 * @returns {Promise<string|null>} frase di riepilogo, null se non c'era niente da fare
 */
async function syncOfficial(exam, onProgress = () => {}) {
  if (!exam.module) return null;
  const all = officialExercises(exam);
  const local = applyOfficial(exam.module, all);
  let rest = pendingOfficial(exam);
  let added = 0;
  if (rest.length && core.ai.ai) {
    const ids = rest.map((e, i) => ({ ...e, id: `E${i + 1}` }));
    const res = await api.runJob("/api/assign-exercises", {
      exam: examInfo(exam), topics: exam.module.topics.map(({ id, title }) => ({ id, title })),
      exercises: ids.map(({ id, label, text, solution }) => ({ id, label, text, solution })),
    }, (c, l) => onProgress(c, l ?? "Claude assegna gli esercizi delle esercitazioni agli argomenti…"));
    const byKey = new Map(res.assign.map((a) => [ids.find((e) => e.id === a.id)?.key, a]).filter(([k]) => k));
    added = applyOfficial(exam.module, rest, byKey).added;
    // se Claude pensa che una soluzione ufficiale sia sbagliata, va detto (non la corregge: decide lo studente)
    const doubts = res.assign.filter((a) => a.note).map((a) => `${ids.find((e) => e.id === a.id)?.label}: ${a.note}`);
    if (doubts.length) exam.module.gaps = [...new Set([...(exam.module.gaps ?? []), ...doubts.map((d) => `Soluzione ufficiale da controllare — ${d}`)])];
    rest = pendingOfficial(exam);
  }
  const n = local.linked + added;
  if (!n && !local.refreshed && !rest.length) return null;
  exam.plan = null;
  return [n ? `${n} ${n === 1 ? "esercizio dell'esercitazione" : "esercizi delle esercitazioni"} nel quiz con la soluzione ufficiale` : "",
    local.refreshed ? `${local.refreshed} aggiornati` : "", rest.length ? `${rest.length} senza argomento (${core.ai.ai ? "riprova" : "serve Claude"})` : ""].filter(Boolean).join(", ") + ".";
}

async function generate(exam) {
  if (hasProgress(exam) && !(await confirmDialog("Rigenerare il modulo azzera flashcard, quiz e argomenti già svolti per questo esame. Se hai solo aggiunto appunti nuovi, usa «Aggiungi al modulo». Continuare?", { ok: "Rigenera tutto", danger: true }))) return;
  await run(exam, "module", async (onProgress) => {
    const { examMap, ...sent } = await payload(exam.materials);
    const mod = remapExamRefs(await api.runJob("/api/module", { exam: examInfo(exam), ...sent }, onProgress), examMap);
    resetProgress(exam, mod);
    applyExamBoost(exam);
    const off = await syncOfficial(exam, onProgress);
    if (off) toast(`Esercitazioni: ${off}`, "ok");
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
    const { examMap, ...sent } = await payload(pending, { onlyNew: true });
    const res = await api.runJob("/api/module-extend", { exam: examInfo(exam), ...sent, existing: compactModule(exam.module) }, onProgress);
    toast(updateSummary(applyUpdate(exam, res, pending.map((m) => m.id), undefined, { ...sentInfo(sent), examRefs: examMap })), "ok");
    applyExamBoost(exam);
    pending.forEach(markSent);
    const off = await syncOfficial(exam, onProgress);
    if (off) toast(`Esercitazioni: ${off}`, "ok");
  });
}

function updateLocal(exam) {
  const pending = pendingMaterials(exam);
  const text = pending.filter((m) => m.kind === "notes" && !isPractice(m)).map((m) => sliceText(m.text, unsentPages(m))).join("\n\n");
  if (!text.trim()) return toast("La modalità base usa solo appunti testuali (non PDF).", "error");
  const delta = { ...localDelta(text, "Appunti nuovi"), examHints: localHints(pending, unsentPages) };
  toast(updateSummary(applyUpdate(exam, { delta, mode: "local" }, pending.map((m) => m.id), undefined, { sentText: pending.map((m) => m.text).join("\n") })), "ok");
  pending.forEach(markSent);
  store.save();
  core.rerender();
}

function generateLocal(exam) {
  const text = exam.materials.filter((m) => m.kind === "notes" && !isPractice(m)).map((m) => sliceText(m.text, m.pages)).join("\n\n");
  if (!text.trim()) return toast("La modalità base funziona solo con appunti testuali (non PDF).", "error");
  const mod = buildLocalModule(text, exam.name);
  if (!mod.topics.length) return toast("Non ho trovato argomenti: aggiungi titoli (#, 1., MAIUSCOLO) agli appunti.", "error");
  mod.examHints = localHints(exam.materials, (m) => m.pages).map((x) => ({ ...x, verified: true }));
  resetProgress(exam, mod);
  exam.materials.forEach(markSent);
  store.save();
  toast(`Modulo base: ${mod.topics.length} argomenti, ${mod.flashcards.length} flashcard.`, "ok");
  core.rerender();
}

/* ------------------------------ appunti scritti a mano ------------------------------ */

const MAX_PHOTOS = 40;
const SERVER_BATCH = 12; // immagini per richiesta al server (che le manda a Claude 3 alla volta)

/** Le immagini nel formato dell'API: Blob nella pagina Claude, base64 per il server. */
const imagesForApi = async (blobs) => (core.ai.artifact ? blobs : Promise.all(blobs.map(async (b) => ({ data: await blobToBase64(b), mediaType: b.type || "image/jpeg" }))));

/** Foto salvate di un materiale (nella pagina Claude solo per la sessione) → Blob, null se non ci sono più. */
async function photoBlobs(m, from, to) {
  const out = [];
  for (let p = from; p <= to; p++) {
    const v = m.imageIds?.[p - 1] ? await store.getFile(m.imageIds[p - 1]) : null;
    if (!v) return null;
    out.push(v instanceof Blob ? v : new Blob([Uint8Array.from(atob(v), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
  }
  return out;
}

/** Foto degli appunti → un materiale «Appunti a mano» (una foto = una pagina), trascritto subito da Claude. */
async function addHandwritten(exam, files) {
  if (!core.ai.ai) return toast("Per leggere gli appunti scritti a mano serve Claude (qui l'AI non è attiva).", "error");
  if (files.length > MAX_PHOTOS) return toast(`Al massimo ${MAX_PHOTOS} foto per volta: dividile in più gruppi (es. una lezione per volta).`, "error");
  files = [...files].sort(byName);
  const imageIds = [];
  toast(`Preparo ${files.length === 1 ? "la foto" : `${files.length} foto`}…`);
  for (const f of files) {
    try {
      const { blob } = await prepareImage(f);
      const id = uid();
      await store.putFile(id, core.ai.artifact ? blob : await blobToBase64(blob)); // pagina Claude: in memoria; server: nel browser
      imageIds.push(id);
    } catch (e) {
      toast(e.message, "error");
    }
  }
  if (!imageIds.length) return;
  const n = imageIds.length;
  const m = { id: uid(), kind: "notes", role: "appunti", handwritten: true, title: `Appunti a mano — ${fmtDate(today())}`, text: Array(n).fill("").join("\f"), size: 0, numPages: n, imageIds, addedAt: now() };
  exam.materials.push(m);
  store.save();
  core.rerender();
  await readPhotos(exam, m, { from: 1, to: n });
}

async function readPhotos(exam, m, r) {
  await run(exam, "transcribe", async (onProgress) => {
    const blobs = await photoBlobs(m, r.from, r.to);
    if (!blobs) throw new Error("Le foto non sono più disponibili (dopo una ricarica la pagina Claude non le conserva): caricale di nuovo.");
    const pages = [];
    const step = core.ai.artifact ? blobs.length : SERVER_BATCH;
    for (let k = 0; k < blobs.length; k += step) {
      const res = await api.runJob("/api/transcribe", { images: await imagesForApi(blobs.slice(k, k + step)), firstPage: r.from + k, title: m.title, handwritten: true },
        (c, label) => onProgress(c, label ?? `Leggo gli appunti con Claude… ${Math.min(k + step, blobs.length)}/${blobs.length} foto`));
      pages.push(...res.pages);
    }
    m.text = replacePages(m.text, r.from, pages, m.numPages);
    m.size = m.text.replace(/\f/g, "").length;
    pages.forEach((p, k) => { if (p != null) m.mathPages = addRange(m.mathPages, r.from + k, r.from + k); });
    const missing = pages.filter((p) => p == null).length;
    const unsure = uncertainCount(sliceText(m.text, `${r.from}-${r.to}`));
    toast(missing ? `${missing} foto non trascritte: riprova da «Rileggi».` : unsure ? `Appunti trascritti. ${unsure} ${unsure === 1 ? "parola incerta" : "parole incerte"}: controllale nell'anteprima, accanto alle foto.` : "Appunti trascritti: dai un'occhiata all'anteprima accanto alle foto.", missing ? "error" : "ok");
  }, { mid: m.id });
}

/** Stato degli appunti a mano: pagine lette, parole incerte, rilettura. */
function handwrittenRow(exam, m) {
  if (!m.handwritten) return null;
  const job = jobs.get(exam.id);
  if (job?.kind === "transcribe" && job.mid === m.id) return jobLine(exam, "transcribe", "Leggo gli appunti con Claude");
  const read = m.mathPages ? m.mathPages.split(",").reduce((n, x) => { const r = parseRange(x); return n + (r ? r.to - r.from + 1 : 0); }, 0) : 0;
  const unsure = uncertainCount(m.text);
  const missing = m.numPages - read;
  return h("div", { class: "row small", style: { gap: "8px", alignItems: "center" } },
    badge(`a mano · ${m.numPages} ${m.numPages === 1 ? "foto" : "foto"}`, "brand"),
    missing ? badge(`${missing} da leggere`, "warn") : null,
    unsure ? h("span", { class: "muted" }, `${unsure} ${unsure === 1 ? "parola incerta" : "parole incerte"} (in giallo nell'anteprima)`) : null,
    h("button", { class: "btn small ghost", disabled: jobs.has(exam.id), onclick: () => {
      const r = missing ? firstMissing(m) : { from: 1, to: m.numPages };
      readPhotos(exam, m, r);
    } }, missing ? "Leggi le foto mancanti" : "Rileggi con Claude"));
}

function firstMissing(m) {
  let from = 0;
  let to = 0;
  for (let p = 1; p <= m.numPages; p++) {
    if (rangesCover(m.mathPages, p, p)) { if (from) break; continue; }
    if (!from) from = p;
    to = p;
  }
  return { from: from || 1, to: to || m.numPages };
}

/** Nel testo già disegnato: «**parola**» in grassetto (sottolineature degli appunti), «[?]» e «[illeggibile]» evidenziati. */
function markUncertain(nodes) {
  for (const root of nodes) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) if (/\*\*[^*\n]+\*\*/.test(walker.currentNode.nodeValue) && !walker.currentNode.parentElement.closest(".katex")) hits.push(walker.currentNode);
    for (const t of hits) t.replaceWith(...t.nodeValue.split(/(\*\*[^*\n]+\*\*)/).filter(Boolean).map((x) => (/^\*\*[^*]+\*\*$/.test(x) ? h("strong", {}, x.slice(2, -2)) : document.createTextNode(x))));
  }
  for (const root of nodes) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) if (/\[\?\]|\[illeggibile\]/.test(walker.currentNode.nodeValue) && !walker.currentNode.parentElement.closest(".katex")) hits.push(walker.currentNode);
    for (const t of hits) {
      const parts = t.nodeValue.split(/(\S*\[\?\]|\[illeggibile\])/);
      t.replaceWith(...parts.filter(Boolean).map((x) => (/\[\?\]$|^\[illeggibile\]$/.test(x) ? h("mark", { class: "uncertain", title: "lettura incerta: controlla sulla foto" }, x) : document.createTextNode(x))));
    }
  }
  return nodes;
}

const pageNodes = (text) => markUncertain(richParas(String(text ?? "").replace(/^#{1,4}\s+/gm, ""))); // titoli Markdown della trascrizione

/**
 * Anteprima del testo usato (pagine scelte), con le formule disegnate: per controllare che sia giusto.
 * Con le foto (appunti a mano) ogni pagina è affiancata alla sua foto e si può correggere.
 */
function preview(exam, m) {
  const box = h("div", { class: "material-preview" });
  const fill = async () => {
    const r = parseRange(m.pages, m.numPages) ?? { from: 1, to: m.numPages || 1 };
    if (!m.imageIds) {
      const pages = sliceText(m.text, m.pages);
      const text = pages.length > 6000 ? `${pages.slice(0, 6000).replace(/\$[^$]*$/, "")}\n\n…` : pages;
      return box.replaceChildren(...pageNodes(text.replace(/\f/g, "\n\n")));
    }
    const all = m.text.split("\f");
    const rows = [];
    for (let p = r.from; p <= Math.min(r.to, r.from + 19); p++) {
      const photo = m.imageIds[p - 1] ? await store.getFile(m.imageIds[p - 1]) : null;
      const src = photo instanceof Blob ? URL.createObjectURL(photo) : photo ? `data:image/jpeg;base64,${photo}` : null;
      const textBox = h("div", { class: "page-text" }, ...(all[p - 1]?.trim() ? pageNodes(all[p - 1]) : [h("p", { class: "muted" }, "(non ancora trascritta)")]));
      const edit = h("button", { class: "btn small ghost", onclick: () => {
        const ta = h("textarea", { class: "page-edit", "aria-label": `Testo della pagina ${p}` });
        ta.value = all[p - 1] ?? "";
        textBox.replaceChildren(ta, h("div", { class: "row", style: { gap: "6px" } },
          h("button", { class: "btn small primary", onclick: () => {
            m.text = replacePages(m.text, p, [ta.value.trim()], m.numPages);
            m.size = m.text.replace(/\f/g, "").length;
            store.save();
            rerenderSoon();
          } }, "Salva"),
          h("button", { class: "btn small ghost", onclick: () => fill() }, "Annulla")));
        ta.focus();
      } }, "Correggi");
      rows.push(h("div", { class: "page-row" },
        src ? h("a", { href: src, target: "_blank", rel: "noopener", class: "page-photo" }, h("img", { src, alt: `Foto della pagina ${p}`, loading: "lazy" })) : h("div", { class: "page-photo muted small" }, "foto non più in memoria"),
        h("div", {}, h("div", { class: "row between small muted" }, `Pagina ${p}`, edit), textBox)));
    }
    if (r.to - r.from > 19) rows.push(h("p", { class: "muted small" }, `Mostrate le prime 20 pagine su ${r.to - r.from + 1}: scegli le pagine per vedere le altre.`));
    box.replaceChildren(...rows);
  };
  return h("details", { open: !!m.handwritten && !!m.mathPages && uncertainCount(m.text) > 0 && !m.reviewed, ontoggle: (e) => { if (e.target.open && !box.childNodes.length) fill(); } },
    h("summary", { class: "small" }, m.imageIds ? "Anteprima: foto e trascrizione (puoi correggerla)" : "Anteprima del testo"), box);
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
    const { pages } = await api.runJob("/api/transcribe", { images: await imagesForApi(images), firstPage: r.from, title: m.title.replace(/ \(da PDF\)$/, "") }, onProgress);
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
  const unit = m.unit === "lezioni" || m.unit === "prove" ? m.unit : m.imageIds ? "foto" : m.fileId || m.fromPdf || m.title.endsWith("(da PDF)") ? "pagine" : "slide";
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
    { pagine: "Pagine", slide: "Slide", foto: "Foto", lezioni: "Lezioni", prove: "Prove" }[unit], num(r?.from, "da"), "–", num(r?.to, "a"), `di ${m.numPages}`,
    h("span", {}, r ? ` · ne uso ${count}` : " · tutte"),
    m.sections ? h("span", { class: "lesson-names" }, ` (${r ? (r.from === r.to ? m.sections[r.from - 1] : `${m.sections[r.from - 1]} → ${m.sections[r.to - 1]}`) : `${m.sections[0]} → ${m.sections.at(-1)}`})`) : null,
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
    exam.materials.push(structure({ id: uid(), kind: "notes", role: pasteRole.value, title: title.value.trim() || `${ROLES[pasteRole.value].replace(/ \(.*\)$/, "")} ${exam.materials.length + 1}`, text: text.value, size: text.value.length, addedAt: now() }));
    store.save();
    core.rerender();
  } }, h("h3", {}, "Incolla appunti, esercizi, temi d'esame o parti di libro"), h("div", { class: "row", style: { gap: "8px", flexWrap: "nowrap" } }, title, pasteRole), text, h("div", {}, h("button", { class: "btn", type: "submit" }, "Aggiungi")));

  /* --- carica file --- */
  const input = h("input", { type: "file", multiple: true, accept: `${core.ai.pdf === false && !core.pdfText ? "" : ".pdf,application/pdf,"}.docx,.pptx,.txt,.md,.markdown,text/plain,image/*,.heic`, hidden: true });
  const camera = h("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, hidden: true, id: "camera-input" });
  camera.addEventListener("change", () => addFiles(exam, [...camera.files]));
  const handBox = h("div", { class: "card stack" },
    h("h3", {}, "Appunti scritti a mano"),
    h("p", { class: "muted small", style: { margin: 0 } }, ai
      ? "Fotografa le pagine del quaderno (una foto per pagina, in ordine) o caricane le foto: Claude le trascrive, formule comprese. Le parti incerte vengono segnate: controllale accanto alle foto prima di generare il modulo."
      : "Per leggere la scrittura a mano serve Claude: qui l'AI non è attiva."),
    h("div", { class: "row" },
      h("button", { class: "btn", disabled: !ai, onclick: () => camera.click() }, "Fotografa gli appunti"),
      h("button", { class: "btn ghost", disabled: !ai, onclick: () => input.click() }, "Carica foto o scansioni"), camera),
    h("details", { class: "small muted" }, h("summary", {}, "Come fare foto che si leggono bene"),
      h("ul", {}, h("li", {}, "Luce uniforme, senza ombre del telefono; foglio piatto e inquadrato tutto."), h("li", {}, "Una pagina per foto, dritta; penna scura."),
        h("li", {}, "Per le tavolette (GoodNotes, Notability): esporta in PDF e caricalo come documento."), h("li", {}, "La calligrafia molto corsiva e le formule scritte piccole sono i punti dove Claude sbaglia di più: controllali."))));
  input.addEventListener("change", () => addFiles(exam, [...input.files]));
  const drop = h("div", { class: "file-drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && input.click(),
    ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); addFiles(exam, [...e.dataTransfer.files]); } },
    h("b", {}, "Carica libro, dispense, slide, esercizi, esami passati"), h("div", { class: "small" }, core.ai.pdf === false
      ? (core.pdfText ? ".pdf, .docx, .pptx, .txt, .md: di un PDF si legge il testo (le scansioni no; le formule possono uscire male)" : ".docx, .pptx, .txt o .md (i PDF non sono supportati qui: copia il testo e incollalo)")
      : ".pdf (anche scansioni e formule: il PDF viene letto dall'AI), .docx, .pptx, .txt, .md, foto"),
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
                h("select", { class: "role-select", "aria-label": `Tipo di ${m.title}`, onchange: async (e) => { m.role = e.target.value; if (m.role === "sbobine") withLessons(m); if (m.role === "esami") { if (m.kind === "pdf") await findPdfPapers(m); else preparePapers(m); } if (m.role === "domande" && m.kind === "pdf") await pdfToQuestions(m); store.save(); rerenderSoon(); } },
                  Object.entries(ROLES).map(([k, t]) => h("option", { value: k, selected: roleOf(m) === k }, t)))),
                roleOf(m) === "sbobine" ? h("label", { class: "small muted", style: { display: "flex", gap: "6px", alignItems: "center", fontWeight: 400 } }, "Anno accademico",
                  h("input", { class: "sbobina-year", value: m.year ?? "", placeholder: "es. 2025-26", "aria-label": `Anno accademico di ${m.title}`, style: { width: "100px", padding: "4px 8px" }, onchange: (e) => { m.year = e.target.value.trim(); store.save(); } })) : null,
                m.numPages > 1 ? pagePicker(m) : null) : null,
              roleOf(m) === "sbobine" ? h("div", { class: "small muted" }, "Sbobine: le frasi del docente sull'esame finiscono nel modulo (verificate sul testo). Possono contenere errori di trascrizione su termini e formule, e se sono di un altro anno docente e programma potrebbero essere cambiati.") : null,
              papersRow(exam, m), questionsRow(m), exercisesRow(exam, m), slidesRow(m),
              roleOf(m) === "svolti" ? h("div", { class: "small muted" }, "Esercizi svolti dal docente: l'AI ne ricava il metodo in passi (come li risolve lui, con la sua notazione) e crea esercizi dello stesso tipo. Li ritrovi negli argomenti come «Esercizi guidati». Se sono scansioni o appunti a mano, controlla le formule nell'anteprima.") : null,
              m.kind === "notes" ? (m.handwritten ? handwrittenRow(exam, m) : formulaRow(exam, m)) : null),
            h("button", { class: "btn small danger", onclick: () => removeMaterial(exam, m), "aria-label": `Rimuovi ${m.title}` }, "Rimuovi")),
          m.kind === "web" ? h("details", {}, h("summary", { class: "small" }, m.generated ? "Anteprima (bozza dalla conoscenza di Claude, senza fonti)" : `Anteprima e ${m.sources.length} fonti`),
            h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: "260px", overflow: "auto", font: "inherit", fontSize: ".9rem" } }, m.text),
            h("ul", { class: "source-list" }, m.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null,
          m.kind === "notes" ? preview(exam, m) : null)))
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
    h("div", { class: "grid" }, h("div", { class: "card stack" }, paste, drop), handBox, researchBox),
    formatBox, h("h2", { style: { margin: "6px 0 0" } }, `Materiali (${exam.materials.length})`), list, gen);
}

// La dispensa usa gli stessi materiali (pagine e lezioni scelte, limiti controllati).
export { payload as materialsPayload, sentInfo };
