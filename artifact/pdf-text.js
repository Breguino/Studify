// Lettura di PDF nella pagina Claude: pdf.js è incorporato nel file e gira nel thread principale
// (file esterni e Worker da URL non sono consentiti lì). Sostituisce public/js/pdf-text.js in fase di build.
import * as lib from "pdfjs-dist/legacy/build/pdf.min.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
import { extractPages } from "../public/js/pdf-extract.js";

globalThis.pdfjsWorker = { WorkerMessageHandler };

export const readPdf = (data, opts) => extractPages(lib, data, opts);

/** Pagine come immagini JPEG (per l'AI su PDF scansionati). */
export async function pdfImages(data, { maxPages = 6, scale = 1.5 } = {}) {
  const bytes = (data instanceof Uint8Array ? data : new Uint8Array(data)).slice();
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false, verbosity: 0 }).promise;
  try {
    const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      out.push(await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85)));
    }
    return { images: out, truncated: doc.numPages > maxPages, numPages: doc.numPages };
  } finally {
    doc.destroy?.();
  }
}
