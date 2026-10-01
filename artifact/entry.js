// Punto d'ingresso della pagina pubblicata su Claude.
import demo from "../public/demo/module.json";
import { core } from "../public/js/core.js";
import { boot } from "../public/js/app.js";
import { enableInternalRouting } from "../public/js/nav.js";
import { hasText, plainLines } from "../public/js/pdf-table.js";
import { pdfImages, readPdf } from "./pdf-text.js";

enableInternalRouting();
core.demoModule = demo;
// PDF: il testo si estrae qui nel browser (nella pagina Claude non si può mandare il PDF a Claude).
core.pdfText = async (file) => {
  const { pages } = await readPdf(await file.arrayBuffer());
  return hasText(pages) ? plainLines(pages).join("\n") : "";
};
core.pdfImages = async (file) => pdfImages(await file.arrayBuffer());

(async () => {
  try {
    const dl = await window.claude?.use?.("downloads");
    if (dl) core.downloads = (req) => dl.save(req);
  } catch {
    /* senza `downloads` il backup si può solo importare */
  }
  boot();
})();
