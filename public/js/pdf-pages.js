// Estrae alcune pagine di un PDF in un nuovo PDF (versione con server): a Claude arriva solo il capitolo scelto,
// non il libro intero (limiti: 600 pagine e 32 MB per richiesta; ogni pagina costa ~1.500-3.000 token).
// pdf-lib si carica solo quando serve, da /vendor/pdf-lib. La pagina Claude lo sostituisce con artifact/pdf-pages.js.
let lib = null;
export const setPdfLib = (l) => { lib = l; }; // per i test (in Node il percorso /vendor non esiste)

/** @returns {Promise<string>} il PDF con le pagine from..to (1-based, incluse), in base64 */
export async function extractPdfPages(base64, from, to) {
  lib ??= await import("/vendor/pdf-lib/pdf-lib.esm.min.js").catch(() => {
    throw new Error("Estrazione delle pagine non disponibile (pdf-lib non installato: npm install).");
  });
  const src = await lib.PDFDocument.load(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), { ignoreEncryption: true, updateMetadata: false });
  const n = src.getPageCount();
  const idx = [];
  for (let i = Math.max(1, from); i <= Math.min(n, to); i++) idx.push(i - 1);
  const out = await lib.PDFDocument.create();
  for (const p of await out.copyPages(src, idx)) out.addPage(p);
  return out.saveAsBase64();
}
