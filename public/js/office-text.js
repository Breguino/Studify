// Testo da documenti Word (.docx) e PowerPoint (.pptx): sono zip di XML, letti con lo stesso lettore dei file Excel.
// Le equazioni (OMML) diventano LaTeX: $…$ nel testo, $$…$$ se stanno su una riga a sé. Le tabelle diventano righe «a | b».
// Le slide sono separate da «\f» come le pagine dei PDF, così si può scegliere quali usare.
import { readZip } from "./tabular.js";
import { kid, kids, local, parseXml, textOf } from "./xml-lite.js";
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

/* ------------------------------------ PowerPoint ------------------------------------ */

const findAll = (n, name, out = []) => {
  for (const c of n.children ?? []) {
    if (typeof c === "string") continue;
    if (local(c) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
};
/** L'id di relazione di un nodo («r:id», «r:embed»…): l'attributo con prefisso, non l'«id» numerico che sta accanto. */
const rid = (n) => n?.attrs?.[Object.keys(n.attrs ?? {}).find((k) => /^[a-z]+:id$/i.test(k))];

/** «ppt/slides» + «../charts/chart1.xml» → «ppt/charts/chart1.xml» */
function joinPath(dir, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dir.split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Relazioni di una parte del pacchetto: id → {type, target} (percorso completo). */
async function relsOf(files, part) {
  const dir = part.slice(0, part.lastIndexOf("/"));
  const name = `${dir}/_rels/${part.slice(dir.length + 1)}.rels`;
  const out = new Map();
  if (!files.has(name)) return out;
  for (const r of findAll(await xmlOf(files, name), "Relationship"))
    out.set(r.attrs.Id, { type: String(r.attrs.Type ?? "").split("/").pop(), target: joinPath(dir, r.attrs.Target ?? "") });
  return out;
}

/** Le slide nell'ordine della presentazione (non dei nomi dei file: le slide spostate hanno nomi «fuori posto»). */
async function slideOrder(files) {
  const byName = [...files.keys()].map((k) => k.match(/^ppt\/slides\/slide(\d+)\.xml$/)).filter(Boolean).sort((a, b) => a[1] - b[1]).map((m) => m[0]);
  if (!files.has("ppt/presentation.xml")) return byName;
  try {
    const rels = await relsOf(files, "ppt/presentation.xml");
    const order = findAll(await xmlOf(files, "ppt/presentation.xml"), "sldId").map((s) => rels.get(rid(s))?.target).filter((t) => t && files.has(t));
    return order.length ? [...order, ...byName.filter((n) => !order.includes(n))] : byName;
  } catch {
    return byName;
  }
}

const CHART_KIND = { barChart: "a barre", bar3DChart: "a barre", lineChart: "a linee", line3DChart: "a linee", pieChart: "a torta", pie3DChart: "a torta", doughnutChart: "ad anello", scatterChart: "a dispersione", areaChart: "ad area", area3DChart: "ad area" };

/** Punti di una serie (c:pt con c:v), nell'ordine degli indici. */
const points = (n) => (n ? findAll(n, "pt").map((p) => [Number(p.attrs.idx) || 0, textOf(findAll(p, "v")[0] ?? { children: [] })]).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : []);

/** Un grafico di PowerPoint (con i suoi dati) → righe di tabella leggibili. */
export function chartText(xml) {
  const root = typeof xml === "string" ? parseXml(xml) : xml;
  const title = findAll(findAll(root, "title")[0] ?? { children: [] }, "t").map(textOf).join(" ").trim();
  const plot = findAll(root, "plotArea")[0];
  const type = plot ? kids(plot).find((c) => CHART_KIND[local(c)]) : null;
  const sers = findAll(plot ?? root, "ser");
  if (!sers.length) return "";
  const cols = sers.map((s) => ({ name: textOf(findAll(kid(s, "tx") ?? { children: [] }, "v")[0] ?? { children: [] }).trim(), cat: points(kid(s, "cat") ?? kid(s, "xVal")), val: points(kid(s, "val") ?? kid(s, "yVal")) }));
  const cats = cols.find((c) => c.cat.length)?.cat ?? cols[0].val.map((_, i) => String(i + 1));
  const lines = [`[Grafico ${type ? CHART_KIND[local(type)] : ""}${title ? `: ${title}` : ""}]`.replace(" ]", "]").replace(" :", ":"),
    [type && local(type) === "scatterChart" ? "x" : "categoria", ...cols.map((c, i) => c.name || `serie ${i + 1}`)].join(" | "),
    ...cats.slice(0, 40).map((c, i) => [c, ...cols.map((col) => col.val[i] ?? "")].join(" | "))];
  return lines.join("\n");
}

/** Testo del titolo della slide (segnaposto «title» o «ctrTitle»). */
function slideTitle(xml) {
  const sp = findAll(xml, "sp").find((s) => findAll(s, "ph").some((ph) => ["title", "ctrTitle"].includes(ph.attrs.type)));
  return sp ? tidy(blocks(sp, [])).replace(/\s+/g, " ").slice(0, 80) : "";
}

/**
 * Una slide: testo, tabelle e formule; i grafici con i dati; il testo alternativo delle immagini; le note del relatore.
 * `figure` = la slide ha immagini senza descrizione o grafici disegnati con linee e forme, che dal file non si possono leggere.
 */
async function readSlide(files, part) {
  const xml = await xmlOf(files, part);
  const rels = await relsOf(files, part);
  const parts = [tidy(blocks(xml, []))];
  for (const gf of findAll(xml, "graphicFrame")) {
    const ch = findAll(gf, "chart")[0];
    const t = ch && rels.get(rid(ch))?.target;
    if (t && files.has(t)) { const c = chartText(await xmlOf(files, t)); if (c) parts.push(c); }
  }
  let undescribed = 0;
  for (const pic of findAll(xml, "pic")) {
    const d = String(findAll(pic, "cNvPr")[0]?.attrs.descr ?? "").trim();
    if (d) parts.push(`[Immagine: ${d.slice(0, 300)}]`);
    else undescribed++;
  }
  const drawn = findAll(xml, "cxnSp").length + findAll(xml, "prstGeom").filter((g) => /line|arrow|curve|arc/i.test(g.attrs.prst ?? "")).length;
  const notesRel = [...rels.values()].find((r) => r.type === "notesSlide");
  let notes = "";
  if (notesRel && files.has(notesRel.target)) {
    const nx = await xmlOf(files, notesRel.target);
    notes = findAll(nx, "sp").filter((s) => findAll(s, "ph").some((ph) => ph.attrs.type === "body")).map((s) => tidy(blocks(s, []))).join("\n").trim();
    if (notes) parts.push(`Note del docente: ${notes}`);
  }
  const hidden = kids(xml).some((c) => local(c) === "sld" && c.attrs.show === "0") || findAll(xml, "sld")[0]?.attrs.show === "0";
  return { text: tidy(parts.filter(Boolean)), title: slideTitle(xml), notes: !!notes, figure: undescribed > 0 || drawn >= 3, hidden };
}

/**
 * @returns {Promise<{text: string, pages: number, sections?: string[], figureSlides?: number[], notesSlides?: number, hiddenSlides?: number}>}
 *   per le presentazioni: titoli delle slide, slide con figure non leggibili, slide con note del relatore, slide nascoste
 */
export async function officeText(buf, fileName) {
  const files = readZip(buf);
  if (/\.docx$/i.test(fileName) || files.has("word/document.xml")) {
    if (!files.has("word/document.xml")) throw new Error("Documento Word non valido.");
    return { text: tidy(blocks(await xmlOf(files, "word/document.xml"), [])), pages: 0 };
  }
  const order = await slideOrder(files);
  if (!order.length) throw new Error("Presentazione PowerPoint non valida o senza slide.");
  const slides = [];
  for (const part of order) slides.push(await readSlide(files, part));
  return {
    text: slides.map((s) => s.text).join("\f"),
    pages: slides.length,
    sections: slides.map((s, i) => s.title || s.text.split("\n")[0]?.slice(0, 60) || `Slide ${i + 1}`),
    figureSlides: slides.map((s, i) => (s.figure ? i + 1 : 0)).filter(Boolean),
    notesSlides: slides.filter((s) => s.notes).length,
    hiddenSlides: slides.filter((s) => s.hidden).length,
  };
}
