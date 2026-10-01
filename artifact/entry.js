// Punto d'ingresso della pagina pubblicata su Claude.
import demo from "../public/demo/module.json";
import { core } from "../public/js/core.js";
import { boot } from "../public/js/app.js";
import { enableInternalRouting } from "../public/js/nav.js";

enableInternalRouting();
core.demoModule = demo;

(async () => {
  try {
    const dl = await window.claude?.use?.("downloads");
    if (dl) core.downloads = (req) => dl.save(req);
  } catch {
    /* senza `downloads` il backup si può solo importare */
  }
  boot();
})();
