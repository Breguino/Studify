// Parser XML minimo per i documenti Office (ben formati): nodi {name, attrs, children}, testo come stringhe.
// Niente DOMParser: deve funzionare anche in Node (test) e senza dipendenze.
import { decodeXml } from "./tabular.js";

export function parseXml(xml) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeXml(a[2] ?? a[3]);
      const node = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined && top !== root) top.children.push(decodeXml(m[6]));
  }
  return root;
}

export const local = (n) => (typeof n === "string" ? "#text" : n.name.slice(n.name.indexOf(":") + 1));
export const kids = (n, name) => n.children.filter((c) => typeof c !== "string" && (!name || local(c) === name));
export const kid = (n, name) => kids(n, name)[0];
/** Valore di <x:qualcosa x:val="…"/> dentro una proprietà (es. m:chr). */
export const val = (n, name) => {
  const k = n && kid(n, name);
  if (!k) return undefined;
  const key = Object.keys(k.attrs).find((a) => a.endsWith(":val") || a === "val");
  return key ? k.attrs[key] : "";
};
export const textOf = (n) => (typeof n === "string" ? n : n.children.map(textOf).join(""));
