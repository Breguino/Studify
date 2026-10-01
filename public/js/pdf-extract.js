// Estrazione del testo posizionato da un PDF con pdf.js (la libreria è passata dal chiamante: nel browser viene
// da /vendor/pdfjs, nella pagina Claude è incorporata, nei test viene da node_modules).
// Solo testo vero: i PDF scansionati (immagini) non hanno elementi di testo.

const toBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/**
 * @returns {Promise<{pages: {num:number, width:number, height:number, items:{str:string,x:number,y:number,w:number,h:number}[]}[], numPages:number, truncated:boolean}>}
 */
export async function extractPages(lib, data, { maxPages = 60 } = {}) {
  const task = lib.getDocument({
    data: toBytes(data).slice(), // pdf.js può "staccare" il buffer
    isEvalSupported: false, // mitiga CVE-2024-4367 (esecuzione di codice da font PDF malevoli)
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const n = Math.min(doc.numPages, maxPages);
    const pages = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items
        .filter((it) => typeof it.str === "string" && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }));
      pages.push({ num: i, width: vp.width, height: vp.height, items });
    }
    return { pages, numPages: doc.numPages, truncated: doc.numPages > maxPages };
  } finally {
    doc.destroy?.();
  }
}
