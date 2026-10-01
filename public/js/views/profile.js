import * as api from "../api.js";
import { core } from "../core.js";
import { FORMAT_LABEL } from "../curriculum.js";
import { today } from "../dates.js";
import { EXAM_TYPES } from "../methods.js";
import * as store from "../store.js";
import { UNIVERSITIES, resolveUniversity } from "../universities.js";
import { badge, h, toast } from "../ui.js";

let busy = null; // { el } mentre la ricerca del piano di studi è in corso

async function findCurriculum(p) {
  if (!p.university.trim() || !p.degree.trim()) return toast("Indica ateneo e corso di studio.", "error");
  busy = { el: null };
  core.rerender();
  try {
    const r = await api.runJob("/api/curriculum", { university: p.university, degree: p.degree }, (chars) => {
      if (busy?.el) busy.el.textContent = `Consulto i siti dell'ateneo… ~${Math.round(chars / 1000)}k caratteri letti`;
    });
    // mantiene gli insegnamenti inseriti a mano che l'AI non ha trovato
    const known = new Set(r.courses.map((c) => c.name.toLowerCase()));
    p.courses = [...r.courses, ...p.courses.filter((c) => c.manual && !known.has(c.name.toLowerCase()))];
    Object.assign(p, { sources: r.sources, academicYear: r.academicYear, caveats: r.caveats, degreeFound: r.degreeName, fetchedAt: today() });
    toast(`Trovati ${r.courses.length} insegnamenti.`, "ok");
  } catch (e) {
    toast(e.message, "error");
  } finally {
    busy = null;
    store.save();
    core.rerender();
  }
}

export function profileView() {
  const p = store.profile();
  const uniList = h("datalist", { id: "unis" }, UNIVERSITIES.map(([n, a]) => h("option", { value: n }, a)));
  const uni = h("input", { list: "unis", value: p.university, placeholder: "es. UNIBS, Politecnico di Milano…", autocomplete: "off" });
  const degree = h("input", { value: p.degree, placeholder: "es. Ingegneria Informatica (L-8), Economia e Management…" });
  const aliasNote = h("span", { class: "hint" }, "Puoi scrivere la sigla (UNIBS, POLIMI, UNIBO…): la riconosco.");
  const resolve = () => {
    const full = resolveUniversity(uni.value);
    if (full && full !== uni.value) { uni.value = full; aliasNote.textContent = "Sigla riconosciuta."; }
  };
  uni.addEventListener("change", resolve);
  const commit = () => { resolve(); p.university = uni.value.trim(); p.degree = degree.value.trim(); store.save(); };
  uni.addEventListener("blur", commit);
  degree.addEventListener("blur", commit);

  /* insegnamenti */
  const rows = p.courses.length
    ? h("div", { class: "card", style: { overflowX: "auto" } }, h("table", {},
        h("thead", {}, h("tr", {}, ["Insegnamento", "Anno", "CFU", "Prova d'esame", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, p.courses.map((c) => h("tr", {},
          h("td", {}, c.name, c.manual ? " " : "", c.manual ? badge("manuale") : null),
          h("td", {}, c.year || "—"),
          h("td", {}, c.cfu || "—"),
          h("td", {}, FORMAT_LABEL[c.format] ?? "—", c.url ? h("span", {}, " · ", h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", title: c.formatEvidence }, "fonte")) : null),
          h("td", {}, h("button", { class: "btn small ghost", "aria-label": `Rimuovi ${c.name}`, onclick: () => { p.courses = p.courses.filter((x) => x !== c); store.save(); core.rerender(); } }, "✕")))))))
    : h("p", { class: "muted" }, "Nessun insegnamento. Cercali con l'AI oppure aggiungili a mano.");

  const mName = h("input", { placeholder: "Nome insegnamento", "aria-label": "Nome insegnamento" });
  const mCfu = h("input", { type: "number", min: 0, max: 60, placeholder: "CFU", "aria-label": "CFU", style: { width: "90px" } });
  const mType = h("select", { "aria-label": "Prova d'esame" }, [["sconosciuto", "Non so"], ...Object.entries(EXAM_TYPES)].map(([k, t]) => h("option", { value: k }, t)));
  const addManual = h("form", { class: "row inline-form", onsubmit: (e) => {
    e.preventDefault();
    const name = mName.value.trim();
    if (!name) return;
    if (p.courses.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast("Insegnamento già presente.", "error");
    p.courses.push({ name, year: 0, cfu: Number(mCfu.value) || 0, format: mType.value, formatEvidence: mType.value === "sconosciuto" ? "" : "indicato da te", url: "", manual: true });
    store.save();
    core.rerender();
  } }, mName, mCfu, mType, h("button", { class: "btn", type: "submit" }, "Aggiungi"));

  return h("div", { class: "stack", style: { maxWidth: "820px" } },
    h("h1", {}, "Ateneo e corso di studio"),
    h("p", { class: "muted", style: { margin: 0 } }, "Servono ad affinare la ricerca dei materiali, a suggerire il formato d'esame e a precompilare i nuovi esami. Restano nel tuo browser."),
    h("div", { class: "form" },
      h("label", {}, "Ateneo", uni, aliasNote), uniList,
      h("label", {}, "Corso di studio", degree)),
    h("div", { class: "card stack" },
      h("h3", {}, "Piano di studi"),
      h("p", { class: "muted small", style: { margin: 0 } }, core.ai.ai
        ? "L'AI cerca il piano di studi sui siti ufficiali e, dove la scheda lo dichiara, la prova d'esame di ogni insegnamento (con link). Dove non lo trova, resta «Non indicato»: non lo deduce dal nome."
        : "La ricerca col piano di studi richiede l'AI. Puoi comunque inserire gli insegnamenti a mano."),
      busy ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (busy.el = h("span", {}, "Consulto i siti dell'ateneo…")), h("span", { class: "muted small" }, "può richiedere qualche minuto")) : null,
      h("div", {}, h("button", { class: "btn primary", disabled: !core.ai.ai || !!busy, onclick: () => { commit(); findCurriculum(p); } }, p.fetchedAt ? "Cerca di nuovo" : "Trova il piano di studi")),
      p.fetchedAt ? h("div", { class: "callout warn" }, h("b", {}, "Da verificare. "), `Dati trovati sul web il ${p.fetchedAt}${p.academicYear ? ` (anno accademico: ${p.academicYear})` : ""}${p.degreeFound ? ` per «${p.degreeFound}»` : ""}. Possono essere di un anno precedente o di un altro curriculum: confrontali con la tua guida dello studente.`,
        p.caveats?.length ? h("ul", {}, p.caveats.map((c) => h("li", {}, c))) : null) : null,
      rows,
      h("h3", { style: { marginBottom: 0 } }, "Aggiungi a mano"), addManual,
      p.sources?.length ? h("details", {}, h("summary", {}, `Fonti consultate (${p.sources.length})`), h("ul", { class: "source-list" }, p.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url))))) : null),
    h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/new", onclick: commit }, "Aggiungi un esame"), h("a", { class: "btn ghost", href: "#/" }, "Home")));
}
