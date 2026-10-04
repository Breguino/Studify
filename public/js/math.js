// Formule: il testo del modulo usa LaTeX tra $…$ (in linea) e $$…$$ (a sé), come chiesto nei prompt.
// Qui si separano testo e formule e si disegnano con KaTeX. KaTeX arriva da ./math-lib.js
// (versione con server: /vendor/katex; pagina Claude: incorporato nel file).
import { core } from "./core.js";
import { loadKatex } from "./math-lib.js";

let katex = null;
let pending = false; // qualcosa è stato mostrato come sorgente in attesa di KaTeX

export const setKatex = (k) => { katex = k; };

/** Carica KaTeX (all'avvio, in parallelo) e ridisegna se nel frattempo qualche formula è uscita come sorgente. */
export async function loadMath() {
  try {
    katex = await loadKatex();
    if (pending) core.rerender();
  } catch {
    /* senza KaTeX le formule restano leggibili come sorgente LaTeX */
  }
}

/**
 * Testo → segmenti [{type: "text"|"math", value, display}]. Delimitatori: $$…$$, \[…\], \(…\), $…$.
 * Un «$» in linea apre solo se non è seguito da spazio e chiude solo se non è preceduto da spazio né seguito da una cifra
 * (regola di Pandoc): così «costa 5$ e 10$» non diventa una formula.
 */
export function splitMath(text) {
  const s = String(text ?? "");
  const out = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) out.push({ type: "text", value: buf }); buf = ""; };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "$") { buf += "$"; i += 2; continue; } // \$ = dollaro
    let open = null, close = null, display = false;
    if (s.startsWith("$$", i)) [open, close, display] = ["$$", "$$", true];
    else if (s.startsWith("\\[", i)) [open, close, display] = ["\\[", "\\]", true];
    else if (s.startsWith("\\(", i)) [open, close] = ["\\(", "\\)"];
    else if (c === "$" && s[i + 1] && !/\s/.test(s[i + 1])) [open, close] = ["$", "$"];
    if (open) {
      let j = i + open.length;
      let end = -1;
      while (j < s.length) {
        const k = s.indexOf(close, j);
        if (k < 0) break;
        if (s[k - 1] === "\\" && close === "$") { j = k + 1; continue; } // \$ dentro la formula
        if (close === "$" && (/\s/.test(s[k - 1]) || /\d/.test(s[k + 1] ?? "") || s[k + 1] === "$")) { j = k + 1; continue; }
        end = k;
        break;
      }
      const tex = end >= 0 ? s.slice(i + open.length, end) : "";
      if (end >= 0 && tex.trim() && (close !== "$" || !tex.includes("\n\n"))) {
        flush();
        out.push({ type: "math", value: tex.trim(), display });
        i = end + close.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

export const hasMath = (text) => splitMath(text).some((p) => p.type === "math");

const OPTS = { throwOnError: false, strict: "ignore", trust: false, maxSize: 20, maxExpand: 1000, output: "htmlAndMathml" };

export const mathEl = (tex, display = false) => mathNode(tex, display);

function mathNode(tex, display) {
  const el = document.createElement(display ? "div" : "span");
  el.className = display ? "math math-display" : "math";
  if (katex) {
    try {
      katex.render(tex, el, { ...OPTS, displayMode: display });
      return el;
    } catch {
      /* sotto: sorgente */
    }
  } else pending = true;
  el.classList.add("math-source");
  el.textContent = display ? `$$${tex}$$` : `$${tex}$`;
  return el;
}

/** Testo con formule → nodi (in linea). Le righe vuote restano spazi; per i paragrafi usa richParas. */
export function rich(text) {
  return splitMath(text).map((p) => (p.type === "math" ? mathNode(p.value, p.display) : document.createTextNode(p.value)));
}

/** Testo con formule → paragrafi <p>; le formule $$…$$ stanno su un blocco a sé. */
export function richParas(text) {
  const blocks = [];
  let cur = [];
  const close = () => {
    if (cur.some((n) => n.nodeType !== 3 || n.textContent.trim())) {
      const p = document.createElement("p");
      if (cur[0]?.nodeType === 3) cur[0].textContent = cur[0].textContent.replace(/^\s+/, "");
      p.append(...cur);
      blocks.push(p);
    }
    cur = [];
  };
  for (const part of splitMath(text)) {
    if (part.type === "math" && part.display) { close(); blocks.push(mathNode(part.value, true)); continue; }
    if (part.type === "math") { cur.push(mathNode(part.value, false)); continue; }
    const chunks = part.value.split(/\n{2,}/);
    chunks.forEach((c, k) => {
      if (k > 0) close();
      if (c) cur.push(document.createTextNode(c));
    });
  }
  close();
  return blocks;
}

/** Anteprima accorciata senza spezzare una formula a metà. */
export function clipRich(text, n) {
  const parts = splitMath(text);
  let len = 0;
  let out = "";
  for (const p of parts) {
    const piece = p.type === "math" ? (p.display ? `$$${p.value}$$` : `$${p.value}$`) : p.value;
    const visible = p.type === "math" ? Math.min(20, p.value.length) : p.value.length;
    if (len + visible > n) {
      if (p.type === "text") out += p.value.slice(0, Math.max(0, n - len)).replace(/\s+\S*$/, "");
      return `${out}…`;
    }
    out += piece;
    len += visible;
  }
  return out;
}
