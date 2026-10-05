// Punto d'ingresso della versione web (Vercel + Supabase): come la pagina Claude, ma con accesso,
// dati sincronizzati su Supabase e Claude tramite /api/claude.
import demo from "../public/demo/module.json";
import { core } from "../public/js/core.js";
import { boot } from "../public/js/app.js";
import { flush } from "../public/js/store.js";
import { hasText, plainLines } from "../public/js/pdf-table.js";
import { pdfImages, readPdf } from "../artifact/pdf-text.js";
import { createAuth } from "./auth.js";
import { installClaude } from "./claude.js";
import { createGate } from "./gate.js";

/* global __SUPABASE_URL__, __SUPABASE_KEY__ */
const url = __SUPABASE_URL__;
const key = __SUPABASE_KEY__;

// Il link delle email di Supabase porta la sessione nel frammento (#access_token=…): va tolto prima che il router lo legga.
const initialHash = /access_token=|error_code=|error=/.test(location.hash) ? location.hash : "";
if (initialHash) history.replaceState(null, "", `${location.pathname}#/`);
// link incollato nella scheda già aperta: cambia solo il frammento, quindi si ricarica per leggerlo all'avvio
addEventListener("hashchange", () => /access_token=|error_code=/.test(location.hash) && location.reload());

const auth = createAuth({ url, key });
let claude = null;
const gate = createGate({
  auth, url, key,
  beforeLeave: async ({ save, undo }) => {
    if (undo) return claude?.reopen(); // eliminazione non riuscita: si torna a salvare
    if (save) await flush().catch(() => {}); // uscita entro il secondo e mezzo da una modifica: la si salva prima
    claude?.close();
  },
});
claude = installClaude({ ready: gate.ready, auth, url, key });

core.demoModule = demo;
core.pdfText = async (file) => {
  const { pages, numPages } = await readPdf(await file.arrayBuffer(), { maxPages: 1000 });
  return { text: hasText(pages) ? pages.map((p) => plainLines([p]).join("\n")).join("\f") : "", pages: numPages };
};
core.pdfImages = async (file) => pdfImages(await file.arrayBuffer());
core.pdfPageImages = (data, from, to) => pdfImages(data, { from, to, maxPages: 1000, scale: 2 });

document.getElementById("account-btn")?.addEventListener("click", () => gate.account());
if (new URLSearchParams(location.search).has("eliminato")) {
  history.replaceState(null, "", location.pathname);
  queueMicrotask(() => document.getElementById("toasts")?.append(Object.assign(document.createElement("div"), { className: "toast ok", role: "status", textContent: "Account eliminato, con tutti i dati salvati online." })));
}
gate.start(initialHash);
boot();
