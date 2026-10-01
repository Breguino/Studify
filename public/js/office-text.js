// Testo da documenti Word (.docx) e PowerPoint (.pptx): sono zip di XML, letti con lo stesso lettore dei file Excel.
// Le slide sono separate da «\f» come le pagine dei PDF, così si può scegliere quali usare.
import { decodeXml, readZip } from "./tabular.js";

const xmlText = async (files, name) => new TextDecoder().decode(await files.get(name)());

/** Paragrafi di un XML Office: «</w:p>» o «</a:p>» chiudono un paragrafo, il testo sta in <w:t>/<a:t>. */
function paragraphs(xml, ns) {
  // tabulazioni, a capo e paragrafi vuoti diventano testo, altrimenti si perdono con i tag
  return xml
    .replace(new RegExp(`<${ns}:tab\\b[^>]*/>`, "g"), `<${ns}:t>\t</${ns}:t>`)
    .replace(new RegExp(`<${ns}:br\\b[^>]*/>`, "g"), `<${ns}:t>\n</${ns}:t>`)
    .replace(new RegExp(`<${ns}:p\\b[^>]*/>`, "g"), `<${ns}:p></${ns}:p>`)
    .split(new RegExp(`</${ns}:p>`))
    .map((p) => [...p.matchAll(new RegExp(`<${ns}:t\\b[^>]*>([^<]*)</${ns}:t>`, "g"))].map((m) => decodeXml(m[1])).join(""))
    .map((p) => p.replace(/[ \t]+$/g, ""));
}

const tidy = (lines) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** @returns {Promise<{text: string, pages: number}>} */
export async function officeText(buf, fileName) {
  const files = readZip(buf);
  if (/\.docx$/i.test(fileName) || files.has("word/document.xml")) {
    if (!files.has("word/document.xml")) throw new Error("Documento Word non valido.");
    return { text: tidy(paragraphs(await xmlText(files, "word/document.xml"), "w")), pages: 0 };
  }
  const slides = [...files.keys()]
    .map((k) => k.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .sort((a, b) => a[1] - b[1]);
  if (!slides.length) throw new Error("Presentazione PowerPoint non valida o senza slide.");
  const out = [];
  for (const m of slides) out.push(tidy(paragraphs(await xmlText(files, m[0]), "a")));
  return { text: out.join("\f"), pages: out.length };
}
