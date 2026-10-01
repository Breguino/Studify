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
// Le pagine sono separate da «\f»: così si possono scegliere i capitoli di un libro.
core.pdfText = async (file) => {
  const { pages, numPages } = await readPdf(await file.arrayBuffer(), { maxPages: 1000 });
  return { text: hasText(pages) ? pages.map((p) => plainLines([p]).join("\n")).join("\f") : "", pages: numPages };
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
