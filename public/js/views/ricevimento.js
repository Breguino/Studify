// Scheda «Ricevimento»: le domande da fare al docente (proposte dall'app, più le tue), l'elenco da portare, e dopo il ricevimento
// le risposte, che diventano un materiale da aggiungere al modulo.
import { core } from "../core.js";
import { fmtDate, today } from "../dates.js";
import { rich } from "../math.js";
import { questionsToAsk, ricevimentoText } from "../ricevimento.js";
import * as store from "../store.js";
import { badge, h, toast, uid } from "../ui.js";

const KIND = { formato: "esame", contrasto: "fonti in contrasto", soluzione: "soluzione ufficiale", programma: "programma", quiz: "quiz", fonte: "manca la spiegazione", dubbio: "esercizio", mia: "tua" };

export function ricevimentoTab(exam) {
  const r = (exam.ricevimento ??= { picked: {}, own: [], answers: {} });
  const save = () => store.save();
  const suggested = questionsToAsk(exam);
  const all = [...suggested, ...r.own.map((q) => ({ key: q.key, kind: "mia", text: q.text, why: "", on: true }))];
  const isOn = (q) => r.picked[q.key] ?? q.on;
  const chosen = all.filter(isOn);
  const listText = chosen.map((q, i) => `${i + 1}. ${q.text}`).join("\n");

  const own = h("input", { placeholder: "Una domanda tua (es. «Nell'esercizio 3 dell'esercitazione 2 perché si usa il costo medio?»)", "aria-label": "Una domanda tua" });
  const addOwn = (e) => {
    e.preventDefault();
    if (!own.value.trim()) return;
    r.own.push({ key: `mia-${uid()}`, text: own.value.trim() });
    save();
    core.rerender();
  };
  const listBox = h("textarea", { readonly: true, "aria-label": "Elenco delle domande da portare", style: { minHeight: "120px" } });
  listBox.value = listText;
  const date = h("input", { type: "date", value: today(), "aria-label": "Data del ricevimento", style: { width: "170px" } });

  return h("div", { class: "stack" },
    h("div", { class: "card stack" },
      h("h2", { style: { margin: 0 } }, "Ricevimento"),
      h("p", { style: { margin: 0 } }, "Al ricevimento il docente risponde a ciò che nessun materiale può dirti: com'è fatto l'esame, quale di due versioni vuole, che cosa è nel programma. Arriva con domande precise: queste le ha raccolte l'app da ciò che ha trovato nei tuoi materiali; scegli quali fare e aggiungi le tue."),
      all.length ? h("ul", { class: "career-list" }, all.map((q) => h("li", { class: "career-row row between", style: { gap: "8px", flexWrap: "nowrap", alignItems: "flex-start" } },
        h("label", { style: { display: "flex", gap: "8px", alignItems: "flex-start", fontWeight: 400 } },
          h("input", { type: "checkbox", checked: isOn(q), "aria-label": `Chiedi: ${q.text.slice(0, 60)}`, onchange: (e) => { r.picked[q.key] = e.target.checked; save(); core.rerender(); } }),
          h("span", {}, badge(KIND[q.kind] ?? q.kind, q.kind === "mia" ? "brand" : ""), " ", rich(q.text), q.why ? h("div", { class: "muted small" }, q.why) : null)),
        q.kind === "mia" ? h("button", { class: "btn small ghost", "aria-label": "Togli la domanda", onclick: () => { r.own = r.own.filter((x) => x.key !== q.key); delete r.answers[q.key]; save(); core.rerender(); } }, "Togli") : null)))
        : h("p", { class: "muted", style: { margin: 0 } }, "Per ora l'app non ha dubbi da proporti: nessun contrasto tra le fonti, nessuna soluzione sospetta. Scrivi le tue domande qui sotto."),
      h("form", { class: "row", style: { gap: "6px", flexWrap: "nowrap" }, onsubmit: addOwn }, own, h("button", { class: "btn", type: "submit" }, "Aggiungi"))),
    chosen.length ? h("div", { class: "card stack" },
      h("h3", { style: { margin: 0 } }, `Da portare (${chosen.length} ${chosen.length === 1 ? "domanda" : "domande"})`),
      listBox,
      h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => {
        try { await navigator.clipboard.writeText(listText); toast("Elenco copiato: incollalo in una mail al docente o nelle note del telefono.", "ok"); }
        catch { listBox.select(); toast("Elenco selezionato: copialo con Ctrl+C (o tieni premuto sul telefono)."); }
      } }, "Copia l'elenco")),
      h("p", { class: "muted small", style: { margin: 0 } }, "Se il ricevimento è su prenotazione o per mail, mandale prima: il docente può prepararsi.")) : null,
    chosen.length ? h("div", { class: "card stack" },
      h("h3", { style: { margin: 0 } }, "Dopo il ricevimento: che cosa ha risposto"),
      h("p", { class: "muted small", style: { margin: 0 } }, "Scrivilo subito, con le sue parole quando le ricordi: tra una settimana non le ricorderai più così. Le risposte entrano nel modulo come indicazioni del docente."),
      ...chosen.map((q) => {
        const ta = h("textarea", { "aria-label": `Risposta: ${q.text.slice(0, 60)}`, placeholder: "La sua risposta…", style: { minHeight: "60px" } });
        ta.value = r.answers[q.key] ?? "";
        ta.addEventListener("input", () => { r.answers[q.key] = ta.value; save(); });
        return h("label", { class: "stack", style: { gap: "4px", fontWeight: 400 } }, h("span", { class: "small" }, rich(q.text)), ta);
      }),
      h("div", { class: "row", style: { gap: "8px" } }, h("label", { class: "row small", style: { gap: "6px", fontWeight: 400 } }, "Data", date),
        h("button", { class: "btn primary", onclick: () => {
          const pairs = chosen.map((q) => ({ question: q.text, answer: r.answers[q.key] ?? "" })).filter((p) => p.answer.trim());
          if (!pairs.length) return toast("Scrivi almeno una risposta.", "error");
          const text = ricevimentoText(fmtDate(date.value), pairs);
          exam.materials.push({ id: uid(), kind: "notes", role: "appunti", ricevimento: true, title: `Ricevimento del ${fmtDate(date.value)}`, text, size: text.length, addedAt: new Date().toISOString() });
          for (const q of chosen) if (r.answers[q.key]?.trim()) { delete r.answers[q.key]; r.picked[q.key] = false; }
          save();
          toast(`Salvato tra i materiali: «Ricevimento del ${fmtDate(date.value)}». ${exam.module ? "Ora «Aggiungi al modulo»: le risposte del docente correggono le lacune e i dubbi." : "Entrerà nel modulo quando lo generi."}`, "ok");
          core.rerender();
        } }, "Salva le risposte tra i materiali"))) : null,
    pastBox(exam));
}

function pastBox(exam) {
  const past = exam.materials.filter((m) => m.ricevimento);
  if (!past.length) return null;
  return h("div", { class: "card stack" }, h("h3", { style: { margin: 0 } }, "Ricevimenti salvati"),
    h("ul", {}, past.map((m) => h("li", {}, h("a", { href: `#/exam/${exam.id}/materials` }, m.title), h("span", { class: "muted small" }, ` · ${(m.text.match(/^Domanda:/gm) ?? []).length} risposte`)))));
}
