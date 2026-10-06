// Markdown semplice (quello che chiediamo all'AI per la dispensa) con formule KaTeX.
// Le formule si tolgono prima e si rimettono alla fine: «*» e «_» dentro una formula non diventano corsivo.
// Si costruisce il DOM con h(): nessun HTML del testo viene interpretato.
import { mathEl, splitMath } from "./math.js";
import { h } from "./ui.js";

const PH = /\u0000([MD])(\d+)\u0000/;

function inline(s, maths) {
  const out = [];
  let rest = s;
  const RULES = [
    [/\u0000M(\d+)\u0000/, (m) => mathEl(maths[+m[1]].value, false)],
    [/\*\*([^*\n]+?)\*\*/, (m) => h("strong", {}, inline(m[1], maths))],
    [/(?<![\w*])\*([^*\n]+?)\*(?![\w*])/, (m) => h("em", {}, inline(m[1], maths))],
    [/`([^`\n]+)`/, (m) => h("code", {}, m[1])],
  ];
  while (rest) {
    let best = null;
    for (const [re, fn] of RULES) {
      const m = rest.match(re);
      if (m && (!best || m.index < best.m.index)) best = { m, fn };
    }
    if (!best) { out.push(rest); break; }
    if (best.m.index) out.push(rest.slice(0, best.m.index));
    out.push(best.fn(best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isTableLine = (line) => (line.match(/\|/g) ?? []).length >= 1 && cells(line).length >= 2;
const START = /^(#{1,6}\s|>|[-*•]\s|\d+[.)]\s|(-{3,}|\*{3,})\s*$)/;

/** Testo Markdown con formule → nodi. `headingOffset` sposta i livelli dei titoli (### → h4 con offset 1). */
export function renderMarkdown(text, { headingOffset = 0 } = {}) {
  const maths = [];
  let src = "";
  for (const p of splitMath(text)) {
    if (p.type !== "math") src += p.value;
    else if (p.display) src += `\n\u0000D${maths.push(p) - 1}\u0000\n`;
    else src += `\u0000M${maths.push(p) - 1}\u0000`;
  }
  return blocks(src.replace(/\r/g, "").split("\n"), maths, headingOffset);
}

function blocks(lines, maths, off) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    const d = t.match(/^\u0000D(\d+)\u0000$/);
    if (d) { out.push(mathEl(maths[+d[1]].value, true)); i++; continue; }
    const hd = t.match(/^(#{1,6})\s+(.*)$/);
    if (hd) { out.push(h(`h${Math.min(6, hd[1].length + off)}`, {}, inline(hd[2], maths))); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { out.push(h("hr", {})); i++; continue; }
    if (t.startsWith(">")) {
      const q = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      out.push(h("blockquote", {}, blocks(q, maths, off)));
      continue;
    }
    const ul = /^[-*•]\s+/;
    const ol = /^(\d+)[.)]\s+/;
    if (ul.test(t) || ol.test(t)) {
      const ordered = ol.test(t);
      const re = ordered ? ol : ul;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (re.test(l.trim())) items.push([l.trim().replace(re, "")]);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items.at(-1).push(l.trim()); // continuazione rientrata
        else if (l.trim() && items.length && !START.test(l.trim()) && !PH.test(l.trim()) && !isTableLine(l)) items.at(-1).push(l.trim());
        else break;
        i++;
      }
      const start = ordered ? Number(t.match(ol)[1]) : null;
      out.push(h(ordered ? "ol" : "ul", start && start !== 1 ? { start } : {}, items.map((it) => h("li", {}, inline(it.join(" "), maths)))));
      continue;
    }
    if (isTableLine(t) && i + 1 < lines.length && (isSep(lines[i + 1]) || isTableLine(lines[i + 1]))) {
      const rows = [];
      let header = null;
      if (isSep(lines[i + 1])) { header = cells(t); i += 2; }
      while (i < lines.length && lines[i].trim() && isTableLine(lines[i])) { if (!isSep(lines[i])) rows.push(cells(lines[i])); i++; }
      out.push(h("div", { class: "table-wrap" }, h("table", {},
        header ? h("thead", {}, h("tr", {}, header.map((c) => h("th", {}, inline(c, maths))))) : null,
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, inline(c, maths)))))))));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || (!START.test(lines[i].trim()) && !/^\u0000D/.test(lines[i].trim())))) para.push(lines[i++].trim());
    out.push(h("p", {}, inline(para.join(" "), maths)));
  }
  return out;
}
