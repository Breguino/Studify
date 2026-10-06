// Equazioni di Word/PowerPoint (OMML, Office Math Markup Language) → LaTeX per KaTeX.
// Copre le strutture usate nei corsi: frazioni, apici/pedici, radici, sommatorie e integrali, parentesi, funzioni e limiti,
// accenti, barre, graffe sotto/sopra, matrici, sistemi di equazioni. Ciò che non conosce lo attraversa (non perde il testo).
import { kid, kids, local, val } from "./xml-lite.js";

const SYM = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ϵ: "\\epsilon", ζ: "\\zeta", η: "\\eta", θ: "\\theta", ϑ: "\\vartheta",
  ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", π: "\\pi", ρ: "\\rho", σ: "\\sigma", ς: "\\varsigma", τ: "\\tau",
  υ: "\\upsilon", φ: "\\varphi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega", Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda",
  Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "−": "-", "×": "\\times", "·": "\\cdot", "⋅": "\\cdot", "∙": "\\cdot", "÷": "\\div", "±": "\\pm", "∓": "\\mp", "≤": "\\le", "≥": "\\ge",
  "≠": "\\neq", "≈": "\\approx", "≅": "\\cong", "≡": "\\equiv", "∼": "\\sim", "∝": "\\propto", "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla",
  "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊆": "\\subseteq", "⊃": "\\supset", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap",
  "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "¬": "\\neg", "∧": "\\land", "∨": "\\lor", "→": "\\to", "←": "\\leftarrow",
  "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto", "…": "\\ldots", "⋯": "\\cdots",
  "⋮": "\\vdots", "⋱": "\\ddots", "′": "'", "″": "''", ℝ: "\\mathbb{R}", ℕ: "\\mathbb{N}", ℤ: "\\mathbb{Z}", ℚ: "\\mathbb{Q}", ℂ: "\\mathbb{C}",
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint", "√": "\\surd", "∠": "\\angle", "°": "^{\\circ}", "⊥": "\\perp",
  "∥": "\\parallel", "∣": "\\mid", "⟨": "\\langle", "⟩": "\\rangle", "‖": "\\|", "%": "\\%", "#": "\\#", "{": "\\{", "}": "\\}", "_": "\\_",
  "\\": "\\backslash", "~": "\\sim", "∗": "*", "∘": "\\circ", "ℓ": "\\ell", "ħ": "\\hbar",
};
const NARY = { "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge" };
const ACC = { "̂": "\\hat", "^": "\\hat", "̄": "\\bar", "̅": "\\bar", "¯": "\\bar", "̇": "\\dot", "̈": "\\ddot", "̃": "\\tilde", "~": "\\tilde", "⃗": "\\vec", "́": "\\acute", "̀": "\\grave", "̌": "\\check", "̆": "\\breve" };
const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg", "Pr", "liminf", "limsup"]);
const DELIM = { "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|", "⟨": "\\langle", "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "": "." };

const isWordRun = (s) => /^[A-Za-zÀ-ÿ]{2,}$/.test(s);
function mapText(s, plain) {
  if (FUNCS.has(s.trim())) return `\\${s.trim()} `; // lim, sin, log… (Word li salva come testo dritto)
  if (plain && /[A-Za-zÀ-ÿ]{2}|\s/.test(s)) return `\\text{${s.replace(/[{}\\]/g, "")}}`;
  return [...s].map((ch) => (SYM[ch] ? `${SYM[ch]}${/^\\[a-zA-Z]+$/.test(SYM[ch]) ? " " : ""}` : ch)).join("");
}

const seq = (n) => n.children.map(conv).join("");
const arg = (n, name) => { const k = kid(n, name); return k ? seq(k) : ""; };
const g = (s) => `{${s.trim()}}`;

function conv(n) {
  if (typeof n === "string") return "";
  const name = local(n);
  if (name.endsWith("Pr")) return ""; // proprietà (fPr, naryPr, rPr…)
  switch (name) {
    case "r": {
      const t = kids(n, "t").map((x) => x.children.join("")).join("");
      const rPr = kid(n, "rPr");
      const plain = !!(rPr && (kid(rPr, "nor") || val(rPr, "sty") === "p" && isWordRun(t.trim())));
      return mapText(t, plain);
    }
    case "f": {
      const type = val(kid(n, "fPr"), "type");
      if (type === "lin") return `${g(arg(n, "num"))}/${g(arg(n, "den"))}`;
      if (type === "noBar") return `\\genfrac{}{}{0pt}{}${g(arg(n, "num"))}${g(arg(n, "den"))}`;
      return `\\frac${g(arg(n, "num"))}${g(arg(n, "den"))}`;
    }
    case "sSup": return `${g(arg(n, "e"))}^${g(arg(n, "sup"))}`;
    case "sSub": return `${g(arg(n, "e"))}_${g(arg(n, "sub"))}`;
    case "sSubSup": return `${g(arg(n, "e"))}_${g(arg(n, "sub"))}^${g(arg(n, "sup"))}`;
    case "sPre": return `{}_${g(arg(n, "sub"))}^${g(arg(n, "sup"))}${g(arg(n, "e"))}`;
    case "rad": {
      const deg = arg(n, "deg").trim();
      return deg && val(kid(n, "radPr"), "degHide") !== "1" && val(kid(n, "radPr"), "degHide") !== "on" ? `\\sqrt[${deg}]${g(arg(n, "e"))}` : `\\sqrt${g(arg(n, "e"))}`;
    }
    case "nary": {
      const pr = kid(n, "naryPr");
      const ch = val(pr, "chr") ?? "∫";
      const op = NARY[ch] ?? mapText(ch);
      const sub = arg(n, "sub").trim();
      const sup = arg(n, "sup").trim();
      return `${op}${sub ? `_${g(sub)}` : ""}${sup ? `^${g(sup)}` : ""} ${arg(n, "e")}`;
    }
    case "d": {
      const pr = kid(n, "dPr");
      const beg = val(pr, "begChr") ?? "(";
      const end = val(pr, "endChr") ?? ")";
      const sep = mapText(val(pr, "sepChr") ?? "|");
      const inner = kids(n, "e").map(seq).join(` ${sep} `);
      return `\\left${DELIM[beg] ?? mapText(beg)} ${inner} \\right${DELIM[end] ?? mapText(end)}`;
    }
    case "func": {
      const fn = kid(n, "fName");
      const nameTxt = fn ? seq(fn).trim() : "";
      return `${nameTxt} ${arg(n, "e")}`;
    }
    case "limLow": {
      const e = arg(n, "e").trim();
      return `${/^\\lim\s*$/.test(e) || e === "lim" ? "\\lim" : g(e)}_${g(arg(n, "lim"))}`;
    }
    case "limUpp": return `\\overset${g(arg(n, "lim"))}${g(arg(n, "e"))}`;
    case "acc": {
      const ch = val(kid(n, "accPr"), "chr") ?? "̂";
      return `${ACC[ch] ?? "\\hat"}${g(arg(n, "e"))}`;
    }
    case "bar": return `${val(kid(n, "barPr"), "pos") === "top" ? "\\overline" : "\\underline"}${g(arg(n, "e"))}`;
    case "groupChr": {
      const pr = kid(n, "groupChrPr");
      const ch = val(pr, "chr") ?? "⏟";
      const top = (val(pr, "pos") ?? "bot") === "top";
      if (ch === "⏟" || ch === "⏞") return `${ch === "⏞" ? "\\overbrace" : "\\underbrace"}${g(arg(n, "e"))}`;
      return `${top ? "\\overset" : "\\underset"}${g(mapText(ch))}${g(arg(n, "e"))}`;
    }
    case "borderBox": return `\\boxed${g(arg(n, "e"))}`;
    case "phant": return `\\phantom${g(arg(n, "e"))}`;
    case "m": return `\\begin{matrix} ${kids(n, "mr").map((r) => kids(r, "e").map(seq).join(" & ")).join(" \\\\ ")} \\end{matrix}`;
    case "eqArr": return `\\begin{aligned} ${kids(n, "e").map(seq).join(" \\\\ ")} \\end{aligned}`;
    default: return seq(n); // oMath, e, num, den, sub, sup, deg, fName, lim, box, …
  }
}

/** Un nodo <m:oMath> (o <m:oMathPara>) → LaTeX. */
export function ommlToLatex(node) {
  const out = local(node) === "oMathPara" ? kids(node, "oMath").map(conv).join(" \\\\ ") : conv(node);
  return out.replace(/\s+/g, " ").replace(/\s*([{}^_])\s*/g, "$1").replace(/\\([a-zA-Z]+)\{/g, "\\$1{").trim();
}
