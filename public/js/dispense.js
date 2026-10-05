// Dispense del docente: il corso scritto per esteso da chi fa l'esame. L'app ne ricava l'indice (dalla pagina «Indice» o dai titoli
// dei capitoli) e lo usa come quello di un libro: per ogni argomento le pagine da leggere, e i capitoli a cui il modulo non ha dato
// un argomento. Un PDF chiamato «Lezione 3» con poche parole per pagina invece sono slide.
import { findOffset, parseToc } from "./books.js";

const words = (p) => (String(p ?? "").match(/\p{L}{2,}/gu) ?? []).length;

/**
 * Slide esportate in PDF: almeno 8 pagine (un formulario di 4 pagine non è una lezione), quasi tutte con testo, e poche parole per
 * pagina (mediana sotto 90; una pagina di dispense ne ha di solito 300-500). Le scansioni (niente testo) non contano.
 */
export function looksLikeSlides(pages) {
  const counts = (pages ?? []).slice(0, 60).map(words);
  const withText = counts.filter((n) => n >= 5).sort((a, b) => a - b);
  if (counts.length < 8 || withText.length < counts.length * 0.6) return false;
  return withText[Math.floor(withText.length / 2)] < 90;
}

const INDEX_HEAD = /^(indice|indice generale|sommario|contents|table of contents)$/i;
// «Capitolo 3 – Il monopolio», «Lezione 3: Il monopolio», «Capitolo 3» con il titolo alla riga dopo
// (con la maiuscola e il titolo maiuscolo: «capitolo 3 vedremo che…» a inizio riga, nel testo, non è un titolo)
const STRONG = /^(?:Capitolo|CAPITOLO|Cap\.|CAP\.|Chapter|CHAPTER|Lezione|LEZIONE|Unità|UNITÀ)\s+(\d{1,2})\b\s*[.:—–-]?\s*(.*)$/u;
const TITLE_START = /^[\p{Lu}«"“(\d]/u;
// «3. Il monopolio» in cima a una pagina (solo con la numerazione consecutiva: un elenco numerato non diventa un indice)
const WEAK = /^(\d{1,2})[.)]?\s+(\p{Lu}.{2,78})$/u;
const SECTION = /^(\d{1,2})\.(\d{1,2})\.?\s+(\p{Lu}.{2,78})$/u;
const TOC_ROW = /(?:\.{2,}|…)\s*\d{1,4}$|\s\d{1,4}$/; // riga d'indice: finisce con il numero di pagina

const linesOf = (p) => String(p ?? "").split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const cleanTitle = (s) => s.replace(/[.:\s]+$/, "").trim();

/** Indice dai titoli dei capitoli nelle pagine; pagina = pagina del PDF. Le intestazioni ripetute in cima alle pagine si ignorano. */
function tocFromHeadings(pages, skip) {
  const pick = (strong) => {
    const toc = [];
    let next = null;
    pages.forEach((p, i) => {
      if (skip.has(i)) return;
      const ls = linesOf(p);
      ls.forEach((l, j) => {
        if (!strong && j > 1) return;
        if (TOC_ROW.test(l) && !STRONG.test(l)) return;
        const m = l.match(strong ? STRONG : WEAK);
        if (!m) return;
        const n = Number(m[1]);
        if (toc.some((c) => c.n === String(n))) return; // intestazione ripetuta
        if (next !== null && n !== next) return;
        let title = cleanTitle(m[2] ?? "");
        if (strong && !title && ls[j + 1] && !STRONG.test(ls[j + 1]) && ls[j + 1].length <= 90) title = cleanTitle(ls[j + 1]);
        if (title.length < 3 || title.length > 90 || !TITLE_START.test(title) || (TOC_ROW.test(title) && /\d$/.test(title))) return;
        toc.push({ n: String(n), title, page: i + 1, sections: [] });
        next = n + 1;
      });
    });
    return toc;
  };
  let toc = pick(true);
  if (toc.length < 2) {
    toc = pick(false); // senza «Capitolo»: almeno 3 titoli numerati di seguito
    if (toc.length < 3) return [];
  }
  // paragrafi «3.1 La curva di domanda»: servono a collegare meglio i capitoli agli argomenti
  pages.forEach((p, i) => {
    if (skip.has(i)) return;
    for (const l of linesOf(p)) {
      const s = l.match(SECTION);
      const ch = s && toc.find((c) => c.n === String(Number(s[1])));
      if (ch && ch.sections.length < 12 && !ch.sections.includes(cleanTitle(s[3]))) ch.sections.push(cleanTitle(s[3]));
    }
  });
  return toc;
}

/**
 * L'indice delle dispense dal testo delle pagine: prima la pagina «Indice» (nelle prime 12; i numeri sono quelli stampati),
 * altrimenti i titoli dei capitoli nelle pagine (i numeri sono le pagine del PDF).
 * @returns {null | {toc: {n: string, title: string, page: number, sections: string[]}[], offset: number|null, from: "indice"|"titoli", indexPage?: number}}
 */
export function dispenseToc(pages) {
  pages = (pages ?? []).map((p) => String(p ?? ""));
  const index = new Set();
  for (let i = 0; i < Math.min(12, pages.length); i++) if (linesOf(pages[i]).slice(0, 3).some((l) => INDEX_HEAD.test(l))) index.add(i);
  for (const i of index) {
    // l'indice può continuare nella pagina dopo
    const one = parseToc(pages[i]);
    const two = parseToc(`${pages[i]}\n${pages[i + 1] ?? ""}`);
    const toc = two.length > one.length ? two : one;
    if (toc.length >= 2) return { toc, offset: findOffset(pages, toc), from: "indice", indexPage: i + 1 };
  }
  const toc = tocFromHeadings(pages, index);
  return toc.length ? { toc, offset: 0, from: "titoli" } : null;
}
