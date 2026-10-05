// Libri consigliati: dalla scheda dell'insegnamento o a mano; l'indice (incollato o fotografato) collega i capitoli agli argomenti
// del modulo. Anche con il libro cartaceo l'app sa che cosa leggere per ogni argomento e quali capitoli del programma mancano.
import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { blobToBase64, byName, isImage, prepareImage } from "../images.js";
import { rich } from "../math.js";
import { findOffset, linksValid, parseProgram, parseToc, programChapters, programPdfRange, uncoveredChapters } from "../books.js";
import { roleOf } from "../material-roles.js";
import { pdfPageTexts } from "../pdf-page-texts.js";
import * as store from "../store.js";
import { badge, confirmDialog, h, toast, uid } from "../ui.js";

const jobs = new Map(); // esame → { el, label }
const examInfo = (exam) => ({ name: exam.name, type: exam.type, level: exam.level, daysLeft: daysLeft(exam), language: exam.language, university: exam.university, degree: exam.degree, cfu: exam.cfu });
const OWN = { pdf: "Ce l'ho in PDF (tra i materiali)", carta: "Cartaceo", no: "Non ce l'ho" };

async function busy(exam, label, fn) {
  if (jobs.has(exam.id)) return;
  const job = { el: null, label };
  jobs.set(exam.id, job);
  core.rerender();
  try {
    await fn((c, l) => { job.label = l ?? label; if (job.el) job.el.textContent = job.label; });
  } catch (e) {
    toast(e.message, "error");
  } finally {
    jobs.delete(exam.id);
    store.save();
    core.rerender();
  }
}

/**
 * Collega i capitoli dei libri (con indice) agli argomenti del modulo. Si rifà quando il modulo cambia (argomenti nuovi).
 * @returns {Promise<string|null>} riepilogo, null se non c'era niente da collegare
 */
export async function syncChapterLinks(exam, onProgress = () => {}, { force = false } = {}) {
  const books = (exam.books ?? []).filter((b) => b.toc?.length);
  if (!exam.module || !books.length || !core.ai.ai) return null;
  if (!force && books.every((b) => linksValid(exam, b) && b.linkedUpdatedAt === (exam.moduleUpdatedAt ?? ""))) return null;
  const chapters = books.flatMap((b, bi) => b.toc.map((c) => ({ id: `L${bi + 1}-${c.n}`, title: c.title, sections: c.sections })));
  onProgress(0, "Claude collega i capitoli dei libri agli argomenti…");
  const res = await api.runJob("/api/link-chapters", { exam: examInfo(exam), topics: exam.module.topics.map(({ id, title }) => ({ id, title })), chapters }, onProgress);
  books.forEach((b) => { b.links = {}; b.moduleBuiltAt = exam.moduleBuiltAt; b.linkedUpdatedAt = exam.moduleUpdatedAt ?? ""; });
  for (const l of res.links) for (const id of l.chapterIds) {
    const [, bi, n] = id.match(/^L(\d+)-(\d+)$/) ?? [];
    const b = books[Number(bi) - 1];
    if (b) (b.links[l.topicId] ??= []).push(n);
  }
  exam.plan = null;
  const missing = uncoveredChapters(exam).length;
  return `capitoli dei libri collegati agli argomenti${missing ? `; ${missing} ${missing === 1 ? "capitolo del programma non è coperto" : "capitoli del programma non sono coperti"} dai tuoi materiali` : ""}.`;
}

/** Il PDF del libro tra i materiali: dove sono i capitoli nelle sue pagine (le pagine stampate di solito non coincidono). */
async function locatePdf(exam, book) {
  const m = exam.materials.find((x) => x.id === book.materialId);
  if (!m || !book.toc?.length) return;
  try {
    const texts = m.kind === "pdf" ? await pdfPageTexts(await store.getFile(m.fileId), 1200) : String(m.text ?? "").split("\f");
    book.offset = findOffset(texts, book.toc);
  } catch {
    book.offset = null;
  }
}

async function readTocPhotos(exam, book, files) {
  files = files.filter(isImage).sort(byName);
  if (!files.length) return;
  if (files.length > 8) return toast("L'indice in al massimo 8 foto.", "error");
  await busy(exam, "Claude legge l'indice…", async (onProgress) => {
    const blobs = [];
    for (const f of files) blobs.push((await prepareImage(f)).blob);
    const images = core.ai.artifact ? blobs : await Promise.all(blobs.map(async (b) => ({ data: await blobToBase64(b), mediaType: b.type || "image/jpeg" })));
    const res = await api.runJob("/api/transcribe", { images, firstPage: 1, title: `Indice di ${book.title}`, handwritten: false }, onProgress);
    await setToc(exam, book, res.pages.filter(Boolean).join("\n"), onProgress);
  });
}

async function setToc(exam, book, text, onProgress = () => {}) {
  const toc = parseToc(text);
  if (!toc.length) return toast("Nell'indice non trovo capitoli con il numero di pagina (es. «5 L'elasticità … 89»).", "error");
  book.toc = toc;
  book.links = null;
  if (book.own === "pdf") await locatePdf(exam, book);
  const prog = programChapters(book).length;
  toast(`Indice: ${toc.length} capitoli${parseProgram(book.program).size ? `, ${prog} nel programma` : ""}.`, "ok");
  store.save();
  core.rerender(); // l'indice si vede subito; il collegamento agli argomenti continua sotto
  const linked = await syncChapterLinks(exam, onProgress, { force: true }).catch((e) => { toast(e.message, "error"); return null; });
  if (linked) toast(`Libri: ${linked}`, "ok");
}

/** «Nel PDF i capitoli iniziano 2 pagine dopo il numero stampato.» */
const offsetText = (o) => {
  if (o === 0) return "Le pagine del PDF coincidono con i numeri stampati.";
  const n = Math.abs(o);
  return `Nel PDF i capitoli iniziano ${n} ${n === 1 ? "pagina" : "pagine"} ${o > 0 ? "dopo il" : "prima del"} numero stampato.`;
};

function bookCard(exam, b) {
  const working = jobs.has(exam.id);
  const save = () => { store.save(); core.rerender(); };
  const prog = h("input", { value: b.program ?? "", placeholder: "es. 1-10, 12", style: { width: "120px", padding: "4px 8px" }, "aria-label": `Capitoli del programma di ${b.title}`,
    onchange: (e) => { b.program = e.target.value.trim(); exam.plan = null; save(); } });
  const own = h("select", { "aria-label": `Ce l'hai? ${b.title}`, onchange: async (e) => { b.own = e.target.value; if (b.own !== "pdf") b.materialId = null; exam.plan = null; save(); } },
    Object.entries(OWN).map(([k, t]) => h("option", { value: k, selected: (b.own ?? "carta") === k }, t)));
  const pdfs = exam.materials.filter((m) => roleOf(m) === "libro" && (m.kind === "pdf" || m.fromPdf));
  const pick = b.own === "pdf" ? h("select", { "aria-label": `PDF di ${b.title}`, onchange: async (e) => { b.materialId = e.target.value || null; await locatePdf(exam, b); save(); } },
    h("option", { value: "" }, pdfs.length ? "Quale PDF?" : "Carica il PDF tra i materiali (tipo «Libro»)"), pdfs.map((m) => h("option", { value: m.id, selected: b.materialId === m.id }, m.title))) : null;
  const pdfMat = exam.materials.find((m) => m.id === b.materialId);
  const range = pdfMat && b.toc?.length ? programPdfRange(b, pdfMat.numPages ?? Infinity) : null;
  const tocText = h("textarea", { placeholder: "Incolla qui l'indice del libro (dal sito dell'editore, da una scansione…): una riga per capitolo con il numero di pagina", style: { minHeight: "80px" } });
  const cam = h("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, hidden: true, onchange: (e) => readTocPhotos(exam, b, [...e.target.files]) });
  const chs = b.toc ?? [];
  const inProg = new Set(programChapters(b).map((c) => c.n));
  return h("div", { class: "card flat stack book-card", style: { gap: "6px" } },
    h("div", { class: "row between" },
      h("div", {}, h("b", {}, b.title), b.authors ? h("span", { class: "muted small" }, ` — ${b.authors}${b.edition ? `, ${b.edition}` : ""}`) : null, " ", b.main ? badge("testo principale", "brand") : badge("facoltativo")),
      h("button", { class: "btn small danger", "aria-label": `Rimuovi ${b.title}`, onclick: async () => { if (await confirmDialog(`Togliere «${b.title}» dai libri?`, { ok: "Togli", danger: true })) { exam.books = exam.books.filter((x) => x !== b); exam.plan = null; save(); } } }, "Rimuovi")),
    h("div", { class: "row small", style: { gap: "10px" } },
      h("label", { class: "row", style: { gap: "6px", fontWeight: 400 } }, "Capitoli del programma", prog),
      h("label", { class: "row", style: { gap: "6px", fontWeight: 400 } }, own), pick,
      h("label", { class: "row", style: { gap: "6px", fontWeight: 400 } }, h("input", { type: "checkbox", checked: !!b.main, onchange: (e) => { b.main = e.target.checked; exam.plan = null; save(); } }), "testo principale")),
    pdfMat && chs.length ? (b.offset != null
      ? h("div", { class: "row small", style: { gap: "8px" } }, h("span", { class: "muted" }, offsetText(b.offset)),
          range ? h("button", { class: "btn small", onclick: () => { pdfMat.pages = `${range.from}-${range.to}`; store.save(); toast(`«${pdfMat.title}»: uso le pagine ${range.from}–${range.to} del PDF (i capitoli del programma).`, "ok"); core.rerender(); } }, `Usa solo i capitoli del programma (pagine ${range.from}–${range.to} del PDF)`) : null)
      : h("div", { class: "small muted" }, "Non trovo i titoli dei capitoli nelle pagine del PDF (forse è una scansione): scegli le pagine a mano nella scheda del PDF.")) : null,
    chs.length
      ? h("details", { class: "small" }, h("summary", {}, `Indice: ${chs.length} capitoli${inProg.size < chs.length ? `, ${inProg.size} nel programma` : ""}${linksValid(exam, b) ? " · collegati agli argomenti" : ""}`),
          h("ol", { class: "paper-items" }, chs.map((c) => h("li", { value: Number(c.n) || null, class: inProg.has(c.n) ? "" : "muted" }, rich(c.title), h("span", { class: "muted" }, ` · p. ${c.page}`), inProg.has(c.n) ? null : h("span", { class: "muted" }, " (fuori programma)")))),
          h("button", { class: "btn small ghost", onclick: () => { b.toc = null; b.links = null; save(); } }, "Cambia indice"))
      : h("div", { class: "stack", style: { gap: "6px" } }, tocText,
          h("div", { class: "row" },
            h("button", { class: "btn small", disabled: working, onclick: () => (tocText.value.trim() ? busy(exam, "Leggo l'indice…", (p) => setToc(exam, b, tocText.value, p)) : toast("Incolla l'indice.", "error")) }, "Leggi l'indice"),
            core.ai.ai ? h("button", { class: "btn small ghost", disabled: working, onclick: () => cam.click() }, "Fotografa l'indice") : null, cam)));
}

export function booksCard(exam) {
  exam.books ??= [];
  const ai = core.ai.ai;
  const job = jobs.get(exam.id);
  const title = h("input", { placeholder: "Titolo", "aria-label": "Titolo del libro" });
  const authors = h("input", { placeholder: "Autori (facoltativo)", "aria-label": "Autori del libro" });
  const program = h("input", { placeholder: "Capitoli (es. 1-10)", "aria-label": "Capitoli del programma", style: { width: "140px" } });
  const add = (b) => {
    if (exam.books.some((x) => x.title.toLowerCase() === b.title.toLowerCase())) return false;
    exam.books.push({ id: uid(), own: "carta", toc: null, links: null, offset: null, materialId: null, main: !exam.books.length, ...b });
    exam.plan = null;
    return true;
  };
  const scheda = h("textarea", { placeholder: "Incolla i «Testi di riferimento» (o tutta la scheda dell'insegnamento)…", style: { minHeight: "80px" } });
  const missing = uncoveredChapters(exam);
  return h("div", { class: "card stack" },
    h("h3", { style: { margin: 0 } }, `Libri consigliati${exam.books.length ? ` (${exam.books.length})` : ""}`),
    h("p", { class: "muted small", style: { margin: 0 } }, "I testi di riferimento della scheda dell'insegnamento. Anche se il libro è cartaceo, con l'indice l'app ti dice che cosa leggere per ogni argomento, quali capitoli del programma i tuoi materiali non coprono e quanto tempo serve."),
    job ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (job.el = h("span", {}, job.label))) : null,
    ...exam.books.map((b) => bookCard(exam, b)),
    missing.length ? h("div", { class: "callout warn small" }, h("b", {}, "Capitoli del programma che i tuoi materiali non coprono: "),
      missing.map((x) => `${x.book.title} cap. ${x.chapter.n} «${x.chapter.title}»`).join("; "), ". Studiali sul libro, o aggiungi appunti e slide di quelle lezioni.") : null,
    h("details", {}, h("summary", { class: "small" }, "Aggiungi un libro"),
      h("div", { class: "row", style: { gap: "6px", marginTop: "6px" } }, title, authors, program,
        h("button", { class: "btn small", onclick: () => { if (!title.value.trim()) return toast("Scrivi il titolo.", "error"); add({ title: title.value.trim(), authors: authors.value.trim(), program: program.value.trim() }); store.save(); core.rerender(); } }, "Aggiungi"))),
    ai ? h("details", {}, h("summary", { class: "small" }, "Ricava i libri dalla scheda dell'insegnamento"),
      h("div", { class: "stack", style: { gap: "6px", marginTop: "6px" } }, scheda,
        h("div", {}, h("button", { class: "btn small", disabled: !!job, onclick: () => {
          if (scheda.value.trim().length < 20) return toast("Incolla i testi di riferimento.", "error");
          busy(exam, "Claude legge i testi di riferimento…", async (p) => {
            const r = await api.runJob("/api/books-from-text", { text: scheda.value }, p);
            const n = r.books.filter((b) => add({ title: b.title, authors: b.authors, edition: b.edition || b.publisher, program: b.program, main: b.main })).length;
            toast(r.books.length ? `${n} ${n === 1 ? "libro aggiunto" : "libri aggiunti"}: ora incolla o fotografa l'indice di quelli che usi.` : "Nella scheda non trovo libri di testo.", r.books.length ? "ok" : "error");
          });
        } }, "Trova i libri")))) : null);
}
