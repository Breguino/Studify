// Dispensa: un documento da studiare (e stampare in PDF) che integra tutti i materiali, un capitolo per argomento del modulo.
// Ogni capitolo finisce con domande; le soluzioni stanno in appendice, così leggerla non resta rilettura passiva.
import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { fmtDate, today } from "../dates.js";
import { renderMarkdown } from "../markdown.js";
import { rich } from "../math.js";
import { roleOf, ROLES } from "../material-roles.js";
import { parseRange } from "../module-update.js";
import * as store from "../store.js";
import { badge, confirmDialog, emptyState, h, toast } from "../ui.js";
import { materialsPayload } from "./materials.js";

const jobs = new Map(); // esame → { el, label }

/** Stato di un capitolo rispetto all'argomento del modulo. */
function chapterState(exam, t) {
  const c = exam.dispensa?.chapters?.[t.id];
  if (!c || c.error && !c.body) return "missing";
  if (c.title !== t.title || (t.updatedAt && t.updatedAt > c.generatedAt) || (t.addedAt && t.addedAt > c.generatedAt)) return "stale";
  return "ok";
}

const STATE = { ok: ["pronto", "good"], stale: ["da aggiornare", "warn"], missing: ["da scrivere", ""] };

async function write(exam, topics) {
  if (jobs.has(exam.id)) return;
  const d = (exam.dispensa ??= { chapters: {}, length: "completa", solutions: true });
  const mod = exam.module;
  const hintsOf = (id) => (mod.examHints ?? []).filter((x) => x.topicId === id).map(({ quote, source }) => ({ quote, source }));
  const job = { el: null, label: "Preparo i materiali…" };
  jobs.set(exam.id, job);
  core.rerender();
  const save = (chapters) => {
    for (const c of chapters ?? []) {
      if (!c?.topicId) continue;
      const prev = d.chapters[c.topicId];
      if (c.error && prev?.body) { prev.error = c.error; continue; } // un errore non cancella un capitolo già scritto
      d.chapters[c.topicId] = { title: c.title, body: c.body, solutions: c.solutions, error: c.error ?? null, generatedAt: new Date().toISOString() };
    }
    store.save();
  };
  let saved = 0;
  try {
    const { examMap, ...sent } = await materialsPayload(exam.materials);
    const res = await api.runJob("/api/dispensa", {
      exam: { name: exam.name, type: exam.type, level: exam.level, daysLeft: daysLeft(exam), language: exam.language, university: exam.university, degree: exam.degree, cfu: exam.cfu },
      ...sent,
      outline: mod.topics.map(({ id, title, importance }) => ({ id, title, importance })),
      topics: topics.map((t) => ({ id: t.id, title: t.title, importance: t.importance, summary: t.summary, hints: hintsOf(t.id),
        examQuestions: mod.questions.filter((q) => q.topicId === t.id && q.examRefs?.length).map((q) => q.prompt) })),
      length: d.length, solutions: d.solutions,
    }, (chars, label, partial) => {
      if (label) job.label = label;
      else if (partial?.total) job.label = `Capitoli pronti: ${partial.done}/${partial.total}`;
      if (job.el) job.el.textContent = job.label;
      if (partial?.chapters?.length > saved) { save(partial.chapters); saved = partial.chapters.length; core.rerender(); }
    });
    save(res.chapters);
    const failed = res.chapters.filter((c) => c.error).length;
    toast(failed ? `Dispensa: ${res.chapters.length - failed} capitoli scritti, ${failed} non riusciti (riprova).` : `Dispensa: ${res.chapters.length} ${res.chapters.length === 1 ? "capitolo scritto" : "capitoli scritti"}.`, failed ? "error" : "ok");
    d.builtAt = new Date().toISOString();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    jobs.delete(exam.id);
    store.save();
    core.rerender();
  }
}

/* --------------------------------- stampa e file --------------------------------- */

async function inlineKatexCss() {
  const own = [...document.querySelectorAll("style")].map((s) => s.textContent).find((t) => t.includes(".katex"));
  if (own) return own; // pagina Claude: CSS dell'app e di KaTeX (font compresi) sono già nella pagina
  const [app, katex] = await Promise.all([fetch("/styles.css").then((r) => r.text()), fetch("/vendor/katex/katex.min.css").then((r) => r.text())]);
  const fonts = new Map();
  for (const m of katex.matchAll(/url\(fonts\/([^)]+)\.woff2\)/g)) fonts.set(m[1], null);
  await Promise.all([...fonts.keys()].map(async (f) => {
    const buf = new Uint8Array(await (await fetch(`/vendor/katex/fonts/${f}.woff2`)).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    fonts.set(f, btoa(s));
  }));
  const k = katex.replace(/src:url\(fonts\/([^)]+)\.woff2\) format\("woff2"\)(?:,url\([^)]+\) format\("[^"]+"\))*/g, (_, f) => `src:url(data:font/woff2;base64,${fonts.get(f)}) format("woff2")`);
  return `${app}\n${k}`;
}

/** La dispensa come file HTML autonomo (formule e font compresi): si apre nel browser e si stampa in PDF. */
async function download(exam, doc) {
  const clone = doc.cloneNode(true);
  clone.querySelectorAll(".no-print").forEach((n) => n.remove());
  const css = await inlineKatexCss();
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${exam.name.replace(/[<&]/g, "")} — dispensa</title><style>${css}</style>
<style>body{background:#fff;color:#1b1f2a}.dispensa-doc{max-width:820px;margin:24px auto;padding:0 16px}.print-tip{font:14px system-ui;color:#5d6578;max-width:820px;margin:16px auto 0;padding:0 16px}@media print{.print-tip{display:none}}</style></head>
<body><p class="print-tip">Per averla in PDF: menu Stampa → «Salva come PDF».</p>${clone.outerHTML}</body></html>`;
  const filename = `Dispensa - ${exam.name.replace(/[\\/:*?"<>|]+/g, " ").trim()}.html`;
  if (core.downloads) {
    try { await core.downloads({ filename, data: html }); toast("Dispensa salvata: aprila e stampala in PDF.", "ok"); } catch (e) { if (e?.code !== "declined") toast("Salvataggio del file non riuscito.", "error"); }
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function printDoc() {
  try {
    window.print();
  } catch {
    toast("Qui la stampa non è disponibile: usa «Scarica il file» e stampalo dal browser.", "error");
  }
}

/* ------------------------------------- vista ------------------------------------- */

const sourceLine = (m) => {
  const r = parseRange(m.pages, m.numPages);
  const unit = m.unit === "lezioni" || m.unit === "prove" ? m.unit : m.imageIds ? "foto" : m.numPages && !m.fileId && !m.fromPdf && !m.title.endsWith("(da PDF)") ? "slide" : "pagine";
  return `${m.title.replace(/ \(da PDF\)$/, "")} (${(ROLES[roleOf(m)] ?? "").replace(/ \(.*\)$/, "").toLowerCase()}${r ? `, ${unit} ${r.from}–${r.to}` : ""}${m.year ? `, a.a. ${m.year}` : ""})`;
};

export function dispensaTab(exam) {
  const mod = exam.module;
  if (!mod) return emptyState("Prima il modulo", "La dispensa segue gli argomenti del modulo: generalo dalla scheda Materiali.", h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Vai ai materiali"));
  const ai = core.ai.ai;
  const d = (exam.dispensa ??= { chapters: {}, length: "completa", solutions: true });
  const states = mod.topics.map((t) => [t, chapterState(exam, t)]);
  const todo = states.filter(([, s]) => s !== "ok").map(([t]) => t);
  const ready = states.filter(([, s]) => s !== "missing").length;
  const job = jobs.get(exam.id);
  const hasMaterials = exam.materials.length > 0; // la dispensa si scrive dai materiali, non da ciò che sa l'AI

  const length = h("select", { id: "dispensa-length", onchange: (e) => { d.length = e.target.value; store.save(); } },
    h("option", { value: "completa", selected: d.length !== "sintetica" }, "Completa (per studiare)"), h("option", { value: "sintetica", selected: d.length === "sintetica" }, "Sintetica (per ripassare)"));
  const sol = h("input", { type: "checkbox", id: "dispensa-solutions", checked: d.solutions !== false, onchange: (e) => { d.solutions = e.target.checked; store.save(); } });

  const controls = h("div", { class: "card stack no-print" },
    h("h2", { style: { margin: 0 } }, "Dispensa"),
    h("p", { style: { margin: 0 } }, "Un unico documento da studiare: per ogni argomento del modulo integra appunti, sbobine, slide, libro ed esercizi, con le fonti tra parentesi, le formule e le frasi del docente sull'esame. Si stampa o si salva in PDF."),
    h("div", { class: "callout" }, h("b", {}, "Leggerla non basta. "), "Rileggere dà l'impressione di sapere senza farti ricordare: ogni capitolo finisce con «Mettiti alla prova». Rispondi senza guardare, poi controlla le soluzioni in fondo. Usala per capire la prima volta e per consultare; per ricordare ci sono flashcard e quiz."),
    exam.materials.some((m) => roleOf(m) === "dispense") ? h("div", { class: "callout" }, h("b", {}, "Hai le dispense del docente. "),
      "Il testo di riferimento restano quelle: questa dispensa, scritta dall'AI, le integra con gli altri materiali e può sbagliare. Per la teoria parti dalle sue pagine (in ogni argomento trovi quali leggere); usa questa per collegare le fonti e per metterti alla prova.") : null,
    h("div", { class: "row", style: { gap: "14px", alignItems: "end" } },
      h("label", {}, "Lunghezza", length),
      h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontWeight: 400 } }, sol, "Soluzioni in appendice")),
    job ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (job.el = h("span", {}, job.label)), h("span", { class: "muted small" }, "un capitolo alla volta; puoi cambiare pagina")) : null,
    h("div", { class: "row" },
      h("button", { class: "btn primary", disabled: !ai || !!job || !todo.length || !hasMaterials, onclick: () => write(exam, todo) },
        !todo.length ? "Tutti i capitoli sono pronti" : ready ? (todo.length === 1 ? "Scrivi il capitolo mancante o da aggiornare" : `Scrivi i ${todo.length} capitoli mancanti o da aggiornare`) : `Scrivi la dispensa (${todo.length} ${todo.length === 1 ? "capitolo" : "capitoli"})`),
      ready ? h("button", { class: "btn ghost", disabled: !ai || !!job || !hasMaterials, onclick: async () => { if (await confirmDialog("Riscrivere tutti i capitoli? Quelli attuali verranno sostituiti.", { ok: "Riscrivi" })) write(exam, mod.topics); } }, "Riscrivi tutto") : null,
      ready ? h("button", { class: "btn", onclick: printDoc }, "Stampa o salva in PDF") : null,
      ready ? h("button", { class: "btn", onclick: () => download(exam, document.querySelector(".dispensa-doc")) }, "Scarica il file") : null),
    !ai ? h("p", { class: "muted small", style: { margin: 0 } }, "Per scrivere la dispensa serve l'AI.") : null,
    ai && !hasMaterials ? h("div", { class: "callout warn" }, "La dispensa si scrive dai tuoi materiali (appunti, sbobine, slide, libro), non da ciò che sa l'AI: ",
      h("a", { href: `#/exam/${exam.id}/materials` }, "aggiungili"), " e poi torna qui.") : null,
    h("p", { class: "muted small", style: { margin: 0 } }, `${ready}/${mod.topics.length} capitoli. Un capitolo «da aggiornare» è stato scritto prima che l'argomento cambiasse con i materiali nuovi.`));

  // ---- il documento
  const hints = mod.examHints ?? [];
  const n = (i) => `${i + 1}.`;
  const chapters = mod.topics.map((t, i) => {
    const c = d.chapters[t.id];
    const st = STATE[chapterState(exam, t)];
    return h("section", { class: "dispensa-chapter", id: `cap-${i + 1}` },
      h("h2", {}, `${n(i)} `, rich(t.title), " ", h("span", { class: "no-print" }, badge(st[0], st[1]),
        h("button", { class: "btn small ghost", disabled: !ai || !!job, onclick: () => write(exam, [t]) }, c?.body ? "Riscrivi" : "Scrivi"))),
      c?.body ? renderMarkdown(c.body, { headingOffset: 0 }) : h("p", { class: "muted no-print" }, c?.error ? `Non riuscito: ${c.error}` : "Capitolo non ancora scritto."),
      c?.error && c?.body ? h("p", { class: "muted small no-print" }, `Ultimo tentativo non riuscito: ${c.error}`) : null);
  });
  const solutions = mod.topics.map((t, i) => [t, i, d.chapters[t.id]]).filter(([, , c]) => c?.solutions);
  const jump = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); };

  const doc = h("article", { class: "dispensa-doc" },
    h("header", { class: "dispensa-cover" },
      h("h1", {}, exam.name),
      h("p", { class: "muted" }, [exam.university, exam.degree, exam.cfu ? `${exam.cfu} CFU` : ""].filter(Boolean).join(" · ")),
      h("p", {}, `Esame: ${fmtDate(exam.date)}${exam.dateTentative ? " (data provvisoria)" : ""} · dispensa del ${fmtDate(today())}`),
      h("p", { class: "small muted" }, "Fonti: ", exam.materials.filter((m) => m.kind !== "web").map(sourceLine).join("; ") || "—"),
      h("p", { class: "small muted" }, "Scritta con l'AI dai tuoi materiali: le parti «Integrazione» non vengono dai materiali; formule e numeri vanno controllati sulle fonti indicate tra parentesi.")),
    h("nav", { class: "dispensa-toc" }, h("h2", {}, "Indice"),
      h("ol", {}, mod.topics.map((t, i) => h("li", {}, h("a", { href: `#cap-${i + 1}`, onclick: jump(`cap-${i + 1}`) }, rich(t.title)))),
        solutions.length ? h("li", { class: "toc-extra" }, h("a", { href: "#soluzioni", onclick: jump("soluzioni") }, "Soluzioni")) : null)),
    hints.length ? h("section", { class: "dispensa-hints" }, h("h2", {}, "Cosa ha detto il docente sull'esame"),
      h("ul", {}, hints.map((x) => h("li", {}, h("q", {}, rich(x.quote)), h("span", { class: "muted small" }, ` — ${x.source}`))))) : null,
    chapters,
    solutions.length ? h("section", { class: "dispensa-chapter dispensa-solutions", id: "soluzioni" }, h("h2", {}, "Soluzioni"),
      solutions.map(([t, i, c]) => h("div", {}, h("h3", {}, `${n(i)} `, rich(t.title)), renderMarkdown(c.solutions)))) : null);

  return h("div", { class: "stack" }, controls, doc);
}
