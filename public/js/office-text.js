// Testo da documenti Word (.docx) e PowerPoint (.pptx): sono zip di XML, letti con lo stesso lettore dei file Excel.
// Le equazioni (OMML) diventano LaTeX: $…$ nel testo, $$…$$ se stanno su una riga a sé. Le tabelle diventano righe «a | b».
// Le slide sono separate da «\f» come le pagine dei PDF, così si può scegliere quali usare.
import { readZip } from "./tabular.js";
import { kid, kids, local, parseXml } from "./xml-lite.js";
import { ommlToLatex } from "./omml.js";

const xmlOf = async (files, name) => parseXml(new TextDecoder().decode(await files.get(name)()));
const SKIP = new Set(["del", "delText", "instrText", "fld", "rPr", "pPr", "sectPr", "tblPr", "tcPr", "trPr", "bodyPr", "lstStyle", "endParaRPr", "Fallback"]);

/** Testo di un paragrafo (w:p o a:p), con le equazioni in LaTeX. */
function inline(node, out) {
  for (const c of node.children) {
    if (typeof c === "string") continue;
    const name = local(c);
    if (SKIP.has(name)) continue;
    if (name === "t") out.push(c.children.join(""));
    else if (name === "tab") out.push("\t");
    else if (name === "br" || name === "cr") out.push("\n");
    else if (name === "oMath") out.push(` $${ommlToLatex(c)}$ `);
    else if (name === "oMathPara") out.push(`\n$$${ommlToLatex(c)}$$\n`);
    else if (name === "AlternateContent") { const ch = kid(c, "Choice"); if (ch) inline(ch, out); }
    else if (name === "p") { out.push("\n"); inline(c, out); out.push("\n"); } // casella di testo dentro il paragrafo
    else inline(c, out);
  }
  return out;
}

const tidyLine = (s) => s.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/ {2,}/g, " ").replace(/^ +| +$/g, "").replace(/ ([,.;:)])/g, "$1");

/** Paragrafi e tabelle in ordine. */
function blocks(node, lines) {
  for (const c of node.children) {
    if (typeof c === "string") continue;
    const name = local(c);
    if (SKIP.has(name)) continue;
    if (name === "p") lines.push(tidyLine(inline(c, []).join("")));
    else if (name === "tbl") for (const tr of kids(c, "tr")) lines.push(kids(tr, "tc").map((tc) => blocks(tc, []).filter(Boolean).join(" ")).join(" | "));
    else if (name === "AlternateContent") { const ch = kid(c, "Choice"); if (ch) blocks(ch, lines); }
    else blocks(c, lines);
  }
  return lines;
}

const tidy = (lines) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** @returns {Promise<{text: string, pages: number}>} */
export async function officeText(buf, fileName) {
  const files = readZip(buf);
  if (/\.docx$/i.test(fileName) || files.has("word/document.xml")) {
    if (!files.has("word/document.xml")) throw new Error("Documento Word non valido.");
    return { text: tidy(blocks(await xmlOf(files, "word/document.xml"), [])), pages: 0 };
  }
  const slides = [...files.keys()]
    .map((k) => k.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .sort((a, b) => a[1] - b[1]);
  if (!slides.length) throw new Error("Presentazione PowerPoint non valida o senza slide.");
  const out = [];
  for (const m of slides) out.push(tidy(blocks(await xmlOf(files, m[0]), [])));
  return { text: out.join("\f"), pages: out.length };
}
