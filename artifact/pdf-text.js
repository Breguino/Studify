// Lettura di PDF nella pagina Claude: pdf.js è incorporato nel file e gira nel thread principale
// (file esterni e Worker da URL non sono consentiti lì). Sostituisce public/js/pdf-text.js in fase di build.
// pdf.js (1,7 MB) si carica al primo PDF: nella versione web è un file a parte, nella pagina Claude resta incorporato.
import { extractPages } from "../public/js/pdf-extract.js";

let loading = null;
const pdfjs = () => (loading ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.min.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs")]).then(([lib, worker]) => {
  globalThis.pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
  return lib;
}));

export const readPdf = async (data, opts) => extractPages(await pdfjs(), data, opts);

/** Pagine come immagini JPEG (per l'AI su PDF scansionati o con formule): da `from` a `to`, al massimo `maxPages`. */
export async function pdfImages(data, { maxPages = 6, scale = 1.5, from = 1, to = Infinity } = {}) {
  const bytes = new Uint8Array(data);
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false, verbosity: 0 }).promise;
  try {
    const out = [];
    const last = Math.min(doc.numPages, to, from + maxPages - 1);
    for (let i = Math.max(1, from); i <= last; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      out.push(await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85)));
    }
    return { images: out, truncated: Math.min(doc.numPages, to) > last, numPages: doc.numPages };
  } finally {
    doc.destroy?.();
  }
}
