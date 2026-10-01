// Navigazione. Di norma usa l'hash dell'URL (#/exam/...). Dentro una pagina Claude l'hash non è
// affidabile, quindi la versione pubblicata attiva la modalità "interna": stato in memoria e click
// sui link «#/...» intercettati.
import { core } from "./core.js";

export const nav = { internal: false, current: "#/" };

export const currentHash = () => (nav.internal ? nav.current : location.hash);

export function go(hash) {
  if (nav.internal) {
    nav.current = hash;
    core.rerender();
  } else location.hash = hash;
}

export function enableInternalRouting() {
  nav.internal = true;
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href^='#/']");
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(a.getAttribute("href"));
  });
}
