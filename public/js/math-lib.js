// KaTeX nella versione con server: da /vendor/katex (node_modules). La pagina Claude usa artifact/math-lib.js.
export async function loadKatex() {
  if (!document.querySelector("link[data-katex]")) {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/vendor/katex/katex.min.css" });
    link.dataset.katex = "1";
    document.head.append(link);
  }
  return (await import("/vendor/katex/katex.mjs")).default;
}
