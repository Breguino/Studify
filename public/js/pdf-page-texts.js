// Testo di ogni pagina di un PDF salvato (base64), riga per riga: per trovare dove iniziano prove e capitoli.
import { readPdf } from "./pdf-text.js";

export async function pdfPageTexts(base64, maxPages = 300) {
  const { pages } = await readPdf(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), { maxPages });
  return pages.map((p) => {
    const lines = new Map();
    for (const it of p.items) { const y = Math.round(it.y / 3); lines.set(y, [...(lines.get(y) ?? []), it]); }
    return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")).join("\n");
  });
}
