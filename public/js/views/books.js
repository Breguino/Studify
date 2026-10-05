// Libri consigliati: dalla scheda dell'insegnamento o a mano; l'indice (incollato o fotografato) collega i capitoli agli argomenti
// del modulo. Anche con il libro cartaceo l'app sa che cosa leggere per ogni argomento e quali capitoli del programma mancano.
// Le dispense del docente caricate in PDF entrano qui da sole, con l'indice ricavato dalle loro pagine.
import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { blobToBase64, byName, isImage, prepareImage } from "../images.js";
import { rich } from "../math.js";
import { findOffset, linksValid, parseProgram, parseToc, programChapters, programPdfRange, shortName, uncoveredChapters } from "../books.js";
import { dispenseToc } from "../dispense.js";
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
  const u = uncoveredChapters(exam);
  const missing = u.filter((x) => x.book.kind !== "dispense").length;
  const skipped = u.length - missing;
  const what = books.some((b) => b.kind === "dispense") ? (books.every((b) => b.kind === "dispense") ? "capitoli delle dispense" : "capitoli di libri e dispense") : "capitoli dei libri";
  return `${what} collegati agli argomenti${missing ? `; ${missing} ${missing === 1 ? "capitolo del programma non è coperto" : "capitoli del programma non sono coperti"} dai tuoi materiali` : ""}${skipped ? `; ${skipped} ${skipped === 1 ? "capitolo delle dispense non ha" : "capitoli delle dispense non hanno"} un argomento nel modulo` : ""}.`;
}

/** Testo di ogni pagina di un PDF tra i materiali (salvato, o già estratto nella pagina Claude). */
const pageTextsOf = async (m) => (m.kind === "pdf" ? pdfPageTexts(await store.getFile(m.fileId), 1200) : String(m.text ?? "").split("\f"));

/**
 * Le dispense del docente in PDF diventano un testo di riferimento: indice dalla pagina «Indice» o dai titoli dei capitoli.
 * Si cerca una volta per materiale; via le voci dei materiali tolti o diventati di un altro tipo.
 * @returns {Promise<{title: string, chapters: number, from: string}[]>} le dispense con l'indice appena trovato
 */
export async function syncDispense(exam) {
  exam.books ??= [];
  const isDisp = (m) => roleOf(m) === "dispense" && (m.kind === "pdf" || m.fromPdf) && !m.noReading && !m.tutor; // dispense del tutor: non vengono prima del libro
  const keep = new Set(exam.materials.filter(isDisp).map((m) => m.id));
  const before = exam.books.length;
  // tornando dispense, l'indice si cerca di nuovo
  for (const b of exam.books) if (b.kind === "dispense" && !keep.has(b.materialId)) { const m = exam.materials.find((x) => x.id === b.materialId); if (m && !m.noReading) delete m.tocChecked; }
  exam.books = exam.books.filter((b) => b.kind !== "dispense" || keep.has(b.materialId));
  const found = [];
  for (const m of exam.materials.filter(isDisp)) {
    if (m.tocChecked || exam.books.some((b) => b.materialId === m.id)) continue;
    let r = null;
    try {
      r = dispenseToc(await pageTextsOf(m));
    } catch {
      /* PDF illeggibile: niente indice */
    }
    m.tocChecked = true;
    if (!r) continue;
    const title = String(m.title).replace(/ \(da PDF\)$/, "");
    exam.books.unshift({ id: uid(), kind: "dispense", title, authors: "", own: "pdf", materialId: m.id, toc: r.toc, offset: r.offset, pdfPages: r.from === "titoli", indexPage: r.indexPage ?? null, links: null, main: false, program: "" });
    found.push({ title, chapters: r.toc.length, from: r.from });
  }
  if (found.length || exam.books.length !== before) exam.plan = null;
  return found;
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

const removeButton = (exam, b) => h("button", { class: "btn small danger", "aria-label": `Rimuovi ${b.title}`, onclick: async () => {
  const disp = b.kind === "dispense";
  if (!(await confirmDialog(disp ? `Non usare l'indice di «${b.title}»? Le dispense restano tra i materiali, ma l'app non ti dirà più quali pagine leggere.` : `Togliere «${b.title}» dai libri?`, { ok: "Togli", danger: true }))) return;
  exam.books = exam.books.filter((x) => x !== b);
  if (disp) { const m = exam.materials.find((x) => x.id === b.materialId); if (m) m.noReading = true; }
  exam.plan = null;
  store.save();
  core.rerender();
} }, "Rimuovi");

/** Elenco dei capitoli (con quelli fuori programma in grigio). */
const tocList = (exam, b, inProg) => h("ol", { class: "paper-items" }, b.toc.map((c) => h("li", { value: Number(c.n) || null, class: inProg.has(c.n) ? "" : "muted" }, rich(c.title),
  h("span", { class: "muted" }, ` · p. ${c.page}${b.pdfPages ? " del PDF" : ""}`), inProg.has(c.n) ? null : h("span", { class: "muted" }, " (fuori programma)"))));

/** Le dispense del docente: l'indice viene dal PDF, il resto come un libro. */
function dispenseCard(exam, b) {
  const all = new Set(b.toc.map((c) => c.n));
  return h("div", { class: "card flat stack book-card", style: { gap: "6px" } },
    h("div", { class: "row between" },
      h("div", {}, h("b", {}, b.title), " ", badge("dispense del docente", "brand")),
      removeButton(exam, b)),
    h("div", { class: "small muted" }, b.indexPage ? `Indice letto dalla pagina ${b.indexPage} del PDF.` : "Indice ricavato dai titoli dei capitoli nelle pagine del PDF: controllalo.",
      " Per ogni argomento ti dico quali pagine leggere, prima di quelle del libro: sono il testo di chi fa l'esame."),
    h("details", { class: "small" }, h("summary", {}, `Indice: ${b.toc.length} capitoli${linksValid(exam, b) ? " · collegati agli argomenti" : exam.module ? " · si collegano agli argomenti con «Aggiungi al modulo»" : ""}`),
      tocList(exam, b, all)));
}

function bookCard(exam, b) {
  if (b.kind === "dispense") return dispenseCard(exam, b);
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
      removeButton(exam, b)),
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
          tocList(exam, b, inProg),
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
    exam.books.push({ id: uid(), own: "carta", toc: null, links: null, offset: null, materialId: null, main: !exam.books.some((x) => x.kind !== "dispense"), ...b });
    exam.plan = null;
    return true;
  };
  const scheda = h("textarea", { placeholder: "Incolla i «Testi di riferimento» (o tutta la scheda dell'insegnamento)…", style: { minHeight: "80px" } });
  const u = uncoveredChapters(exam);
  const missing = u.filter((x) => x.book.kind !== "dispense");
  const skipped = u.filter((x) => x.book.kind === "dispense");
  const nBooks = exam.books.filter((b) => b.kind !== "dispense").length;
  return h("div", { class: "card stack" },
    h("h3", { style: { margin: 0 } }, `Libri consigliati${nBooks ? ` (${nBooks})` : ""}${nBooks < exam.books.length ? " e dispense" : ""}`),
    h("p", { class: "muted small", style: { margin: 0 } }, "I testi di riferimento della scheda dell'insegnamento. Anche se il libro è cartaceo, con l'indice l'app ti dice che cosa leggere per ogni argomento, quali capitoli del programma i tuoi materiali non coprono e quanto tempo serve. Le dispense del docente in PDF entrano qui da sole, con il loro indice."),
    job ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (job.el = h("span", {}, job.label))) : null,
    ...exam.books.map((b) => bookCard(exam, b)),
    missing.length ? h("div", { class: "callout warn small" }, h("b", {}, "Capitoli del programma che i tuoi materiali non coprono: "),
      missing.map((x) => `${x.book.title} cap. ${x.chapter.n} «${x.chapter.title}»`).join("; "), ". Studiali sul libro, o aggiungi appunti e slide di quelle lezioni.") : null,
    skipped.length ? h("div", { class: "callout warn small" }, h("b", {}, "Capitoli delle dispense senza un argomento nel modulo: "),
      skipped.map((x) => `${shortName(x.book)} cap. ${x.chapter.n} «${x.chapter.title}»`).join("; "), ". L'AI ha ricevuto quelle pagine ma non ne ha fatto un argomento: forse le ha accorpate a un altro (controlla l'elenco), o le ha saltate. In quel caso studiale sulle dispense.") : null,
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
