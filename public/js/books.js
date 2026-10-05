// Libri consigliati (i «testi di riferimento» della scheda dell'insegnamento): spesso cartacei, quindi l'app non li legge, ma ne usa
// l'indice: quali capitoli sono nel programma, quale capitolo leggere per ogni argomento del modulo (con le pagine), quali capitoli
// del programma i materiali dello studente non coprono, e quanto tempo serve a leggerli.
// Le dispense del docente (kind «dispense», indice ricavato dal PDF: vedi dispense.js) si usano allo stesso modo e vengono prima:
// sono il testo di chi fa l'esame.

const ROMAN = /^(?:[ivxlc]+)$/i;
// «Capitolo 5 L'elasticità e le sue applicazioni ...... 89», «5. L'elasticità 89», «5.2 La domanda 93», «Chapter 5 Elasticity 89»
const TOC_LINE = /^\s*(?:cap(?:itolo|\.)?\s*|chapter\s*|ch\.\s*)?(\d{1,2})(?:\.(\d{1,2}))?\.?\s+(.+?)\s*(?:\.{2,}|…+|\s{2,}|\s)\s*(\d{1,4})\s*$/i;

/**
 * Indice di un libro (incollato o trascritto da foto) → capitoli con titolo, pagina d'inizio e titoli dei paragrafi.
 * Righe senza numero di pagina, parti («Parte II») e pagine in numeri romani si ignorano.
 * @returns {{n: string, title: string, page: number, sections: string[]}[]}
 */
export function parseToc(text) {
  const chapters = [];
  for (const raw of String(text ?? "").replace(/\r/g, "").replace(/\f/g, "\n").split("\n")) {
    const line = raw.replace(/\t/g, " ").replace(/\s+$/, "");
    if (!line.trim() || /^\s*parte\b/i.test(line)) continue;
    const m = line.match(TOC_LINE);
    if (!m || ROMAN.test(m[4])) continue;
    const title = m[3].replace(/[.…\s]+$/, "").replace(/^[—–-]\s*/, "").trim();
    if (title.length < 2) continue;
    const page = Number(m[4]);
    if (m[2]) {
      const ch = chapters.find((c) => c.n === m[1]);
      if (ch) ch.sections.push(title);
      continue;
    }
    if (chapters.some((c) => c.n === m[1])) continue;
    chapters.push({ n: m[1], title, page, sections: [] });
  }
  // un indice ha le pagine crescenti: un numero fuori ordine è quasi sempre una riga letta male
  return chapters.filter((c, i) => i === 0 || c.page >= chapters[i - 1].page);
}

/** «capp. 1-5, 7 e 9-10» → {1,2,3,4,5,7,9,10}; vuoto = nessuna indicazione. */
export function parseProgram(s) {
  const out = new Set();
  for (const m of String(s ?? "").matchAll(/(\d{1,2})\s*(?:[-–—]|a|al)\s*(\d{1,2})|(\d{1,2})/g)) {
    if (m[3]) out.add(Number(m[3]));
    else for (let k = Math.min(+m[1], +m[2]); k <= Math.max(+m[1], +m[2]); k++) out.add(k);
  }
  return out;
}

/** Capitoli del programma (tutti se il programma non li indica). */
export function programChapters(book) {
  const prog = parseProgram(book.program);
  return (book.toc ?? []).filter((c) => !prog.size || prog.has(Number(c.n)));
}

/** Pagine di un capitolo nel libro: dalla sua pagina alla pagina prima del capitolo successivo (null se è l'ultimo). */
export function chapterPages(book, n) {
  const toc = book.toc ?? [];
  const i = toc.findIndex((c) => c.n === String(n));
  if (i < 0) return null;
  const next = toc[i + 1];
  return { from: toc[i].page, to: next ? Math.max(toc[i].page, next.page - 1) : null };
}

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();

/**
 * Di quanto sono spostate le pagine del PDF rispetto ai numeri stampati (copertina, indice in romani…): si cerca il titolo di ogni
 * capitolo nelle prime righe delle pagine del PDF. Vale solo se almeno 2 capitoli danno lo stesso spostamento.
 * @returns {number|null} pagina del PDF = pagina del libro + spostamento
 */
export function findOffset(pageTexts, toc) {
  const counts = new Map();
  for (const c of toc ?? []) {
    const t = norm(c.title);
    if (t.length < 6) continue;
    pageTexts.forEach((p, i) => {
      const head = norm(String(p ?? "").split("\n").slice(0, 6).join(" "));
      if (head.includes(t)) counts.set(i + 1 - c.page, (counts.get(i + 1 - c.page) ?? 0) + 1);
    });
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

/** Le pagine del PDF dei capitoli del programma (dal primo all'ultimo), con lo spostamento trovato. */
export function programPdfRange(book, numPages) {
  if (book.offset == null) return null;
  const chs = programChapters(book);
  if (!chs.length) return null;
  const first = chapterPages(book, chs[0].n);
  const last = chapterPages(book, chs.at(-1).n);
  const from = first.from + book.offset;
  const to = (last.to ?? numPages - book.offset) + book.offset;
  return from >= 1 && from <= to ? { from, to: Math.min(to, numPages) } : null;
}

/** I collegamenti capitoli-argomenti valgono finché il modulo non viene rigenerato (gli id cambiano significato). */
export const linksValid = (exam, book) => !!book.links && !!exam.module && book.moduleBuiltAt === exam.moduleBuiltAt;

/** Prima le dispense del docente, poi il testo principale, poi gli altri. */
const byRank = (books) => [...(books ?? [])].sort((x, y) => rank(y) - rank(x));
const rank = (b) => (b.kind === "dispense" ? 2 : b.main ? 1 : 0);

/** Che cosa leggere per un argomento: capitoli dei libri e delle dispense collegati, con le pagine. Prima le dispense del docente. */
export function topicReading(exam, topicId) {
  const out = [];
  for (const b of byRank(exam.books)) {
    if (!linksValid(exam, b)) continue;
    for (const n of b.links[topicId] ?? []) {
      const c = b.toc.find((x) => x.n === n);
      if (!c) continue;
      const p = chapterPages(b, n);
      out.push({ book: b, chapter: c, pages: p, count: p?.to ? p.to - p.from + 1 : null });
    }
  }
  return out;
}

/** Il materiale è nel modulo? E fino a quali pagine (null = non ancora; «all» = tutte). */
export function sentRange(exam, m) {
  if (!exam.module) return null;
  const ids = exam.module.materialIds;
  const inModule = ids ? ids.includes(m.id) : !!m.addedAt && m.addedAt <= (exam.moduleBuiltAt ?? "");
  if (!inModule) return null;
  if (m.sentPages === undefined || m.sentPages === "all") return "all";
  const r = String(m.sentPages).match(/^(\d+)-(\d+)$/);
  return r ? { from: +r[1], to: +r[2] } : "all";
}

/** Capitoli delle dispense le cui pagine sono già state mandate all'AI (gli altri non possono essere nel modulo). */
export function sentChapters(exam, book) {
  const m = exam.materials.find((x) => x.id === book.materialId);
  const r = m ? sentRange(exam, m) : null;
  if (!r) return [];
  if (r === "all") return book.toc ?? [];
  return (book.toc ?? []).filter((c) => c.page + (book.offset ?? 0) >= r.from && c.page + (book.offset ?? 0) <= r.to);
}

/**
 * Capitoli che nessun argomento del modulo copre. Libri: capitoli del programma, probabilmente mancano nei materiali.
 * Dispense: capitoli le cui pagine l'AI ha ricevuto ma di cui non ha fatto un argomento (accorpati a un altro, o saltati).
 */
export function uncoveredChapters(exam) {
  const out = [];
  for (const b of exam.books ?? []) {
    if (!linksValid(exam, b)) continue;
    const linked = new Set(Object.values(b.links).flat());
    for (const c of b.kind === "dispense" ? sentChapters(exam, b) : programChapters(b)) if (!linked.has(c.n)) out.push({ book: b, chapter: c });
  }
  return out;
}

/** Minuti di lettura per studiare (non per sfogliare): circa 4 minuti a pagina partendo da zero, 3 con basi già solide. */
export const readingMinutes = (pages, level) => Math.round(((pages ?? 0) * (level <= 2 ? 4 : 3)) / 5) * 5;

/** Il nome breve: il cognome del primo autore, o il titolo; per le dispense «Dispense …». */
export const shortName = (b) => (b.kind === "dispense" ? (/dispens/i.test(b.title) ? b.title : `Dispense ${b.title}`)
  : b.authors ? b.authors.split(/[,;]| e /)[0].trim().split(/\s+/).at(-1) : b.title);

/** «pp. 89–112»; «del PDF» quando l'indice viene dai titoli nelle pagine del PDF, non dai numeri stampati. */
export const pagesLabel = (b, p) => (p ? `pp. ${p.from}${p.to ? `–${p.to}` : ""}${b.pdfPages ? " del PDF" : ""}` : "");

/** «Mankiw cap. 5, pp. 89–112» */
export function readingLabel(r) {
  return `${shortName(r.book)} cap. ${r.chapter.n}${r.pages ? `, ${pagesLabel(r.book, r.pages)}` : ""}`;
}

/* ------------------------- solo per la modalità demo e le prove ------------------------- */

/** Collegamenti finti (modalità demo): capitolo ↔ argomento se condividono una parola lunga del titolo. */
export function demoChapterLinks(chapters, topics) {
  const w = (s) => norm(s).split(/[^a-z0-9]+/).filter((x) => x.length > 5).map((x) => x.slice(0, 7));
  return topics.map((t) => ({ topicId: t.id, chapterIds: chapters.filter((c) => w(`${c.title} ${(c.sections ?? []).join(" ")}`).some((x) => w(t.title).includes(x))).map((c) => c.id) })).filter((l) => l.chapterIds.length);
}

/** Libri finti (modalità demo) da una scheda: righe «Autori, Titolo, Editore, anno», capitoli da «capp. …». */
export function demoBooks(text) {
  return String(text ?? "").split("\n").filter((l) => /,/.test(l) && /\b(19|20)\d{2}\b|\bed\./i.test(l)).map((l) => {
    const parts = l.replace(/^[-•*\s]+/, "").split(",").map((x) => x.trim());
    const cap = l.match(/capp?\.?\s*([\d\s,e–-]+)/i);
    return { title: parts[1] ?? parts[0], authors: parts[0], edition: "", publisher: parts[2] ?? "", chapters: cap ? cap[1].trim().replace(/[,\s]+$/, "") : "", main: /principale|riferimento|adottato/i.test(l), quote: l.trim().slice(0, 300) };
  });
}

/**
 * Per il piano: per ogni argomento le pagine da leggere e l'etichetta («Mankiw cap. 5, pp. 89–112»), dai libri che lo studente ha
 * (PDF o cartaceo). Si legge una fonte sola: prima le dispense del docente, poi il testo principale (gli altri sono nella scheda
 * dell'argomento). Un capitolo collegato a più argomenti divide le pagine tra loro.
 * @returns {Map<string, {pages: number, label: string}>}
 */
export function readingByTopic(exam) {
  const out = new Map();
  const books = byRank(exam.books).filter((b) => b.own !== "no" && linksValid(exam, b));
  for (const b of books) {
    const share = new Map();
    for (const ns of Object.values(b.links)) for (const n of ns) share.set(n, (share.get(n) ?? 0) + 1);
    for (const [tid, ns] of Object.entries(b.links)) {
      if (out.has(tid)) continue;
      let pages = 0;
      const labels = [];
      for (const n of ns) {
        const c = b.toc.find((x) => x.n === n);
        if (!c) continue;
        const p = chapterPages(b, n);
        if (p?.to) pages += (p.to - p.from + 1) / share.get(n);
        labels.push(readingLabel({ book: b, chapter: c, pages: p }));
      }
      if (labels.length) out.set(tid, { pages: Math.round(pages), label: labels.join("; ") });
    }
  }
  return out;
}
