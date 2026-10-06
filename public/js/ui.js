// Mini helper per costruire il DOM. Il testo è SEMPRE inserito come text node:
// il contenuto generato dall'AI o incollato dall'utente non viene mai interpretato come HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected" || k === "open") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => el.replaceChildren();

/** Testo su più righe → paragrafi. */
export function paras(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => h("p", {}, p.trim()))
    .filter((p) => p.textContent);
}

export function toast(msg, kind = "info") {
  const box = document.getElementById("toasts");
  const t = h("div", { class: `toast ${kind}`, role: "status" }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === "error" ? 7000 : 3500);
}

export const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function bar(value, { label, tone } = {}) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return h(
    "div",
    { class: `bar ${tone ?? ""}`, role: "progressbar", "aria-valuenow": Math.round(v * 100), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label ?? "avanzamento" },
    h("div", { style: { width: `${v * 100}%` } }),
  );
}

export const badge = (text, tone = "") => h("span", { class: `badge ${tone}` }, text);

/* Icone a tratto (seguono il colore del testo e il tema). h() crea solo elementi HTML: gli SVG vogliono createElementNS. */
const ICONS = {
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  image: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM21 16l-5-5-8 8M10.6 10a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  web: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
};
export function icon(name, size = 20) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const attrs = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

/** Indicatore dei passi del primo esame (1 descrivi, 2 materiali, 3 modulo). */
export function stepper(current) {
  const steps = ["Descrivi l'esame", "Porta i materiali", "Controlla il modulo"];
  return h("ol", { class: "stepper", "aria-label": "Passi" }, steps.map((t, i) => {
    const n = i + 1;
    const state = n < current ? "done" : n === current ? "current" : "";
    return h("li", { class: state, "aria-current": n === current ? "step" : null },
      h("span", { class: "step-dot" }, n < current ? icon("check", 16) : String(n)), h("span", { class: "stepper-text" }, t),
      n < current ? h("span", { class: "visually-hidden" }, " (fatto)") : null);
  }));
}

export function emptyState(title, text, ...actions) {
  return h("div", { class: "empty" }, h("h3", {}, title), h("p", {}, text), h("div", { class: "row" }, ...actions));
}

export function link(href, text, cls = "btn") {
  return h("a", { href, class: cls }, text);
}

export async function readFileAs(file, as) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result);
    if (as === "text") r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export const shuffle = (arr, rng = Math.random) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Conferma dentro la pagina (nelle pagine Claude `confirm()` è bloccato e risponde sempre «no»). */
export function confirmDialog(message, { ok = "Continua", cancel = "Annulla", danger = false } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const done = (v) => { overlay.remove(); previous?.focus?.(); resolve(v); };
    const okBtn = h("button", { class: `btn ${danger ? "danger" : "primary"}`, onclick: () => done(true) }, ok);
    const overlay = h("div", { class: "modal-backdrop", role: "presentation", onclick: (e) => e.target === overlay && done(false), onkeydown: (e) => e.key === "Escape" && done(false) },
      h("div", { class: "modal card", role: "alertdialog", "aria-modal": "true", "aria-label": message }, h("p", {}, message), h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", onclick: () => done(false) }, cancel), okBtn)));
    document.body.append(overlay);
    okBtn.focus();
  });
}
