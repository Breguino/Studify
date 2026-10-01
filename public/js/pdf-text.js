// Lettura di PDF nel browser (versione con server): pdf.js viene caricato solo quando serve, da /vendor/pdfjs.
// La pagina Claude sostituisce questo modulo con artifact/pdf-text.js (libreria incorporata).
import { extractPages } from "./pdf-extract.js";

let lib = null;

async function load() {
  if (lib) return lib;
  try {
    lib = await import("/vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
    return lib;
  } catch {
    throw new Error("Lettura PDF non disponibile (libreria non trovata): esporta il documento in CSV o Excel.");
  }
}

export async function readPdf(data, opts) {
  return extractPages(await load(), data, opts);
}

/** Pagine come immagini, per l'AI su PDF scansionati: non serve con il server (il PDF va intero all'AI). */
export const pdfImages = null;
