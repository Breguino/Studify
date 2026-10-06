// In gruppo: condividere l'esame con i compagni (senza i propri progressi), importare quello di un compagno, e interrogarsi a turno:
// chi chiede vede la traccia di risposta e spunta i punti, chi risponde parla senza appunti.
import { core } from "../core.js";
import { go } from "../nav.js";
import { today } from "../dates.js";
import { renderMarkdown } from "../markdown.js";
import { rich, richParas } from "../math.js";
import { exportExam, groupQuestions, importExam } from "../share.js";
import * as store from "../store.js";
import { badge, emptyState, h, toast } from "../ui.js";

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function download(filename, json) {
  if (core.downloads) {
    try { await core.downloads({ filename, data: json }); toast("File salvato: mandalo al gruppo (chat, mail, Drive).", "ok"); } catch (e) { if (e?.code !== "declined") toast("Salvataggio del file non riuscito.", "error"); }
    return;
  }
  const a = h("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: filename });
  a.click();
  URL.revokeObjectURL(a.href);
  toast("File scaricato: mandalo al gruppo (chat, mail, Drive).", "ok");
}

/** Riquadro nel modulo: interrogatevi a turno, e condividete l'esame. */
export function groupCard(exam) {
  if (!exam.module) return null;
  const withMaterials = h("input", { type: "checkbox", checked: true, "aria-label": "Con il testo dei materiali" });
  return h("div", { class: "card stack" },
    h("h3", { style: { margin: 0 } }, "Studiate in gruppo?"),
    h("p", { class: "muted small", style: { margin: 0 } }, "In gruppo funziona interrogarsi, non rileggere insieme: rispondere a voce, senza appunti, a una domanda di un compagno è richiamo attivo, e spiegare costringe a capire."),
    h("div", { class: "row" },
      h("a", { class: "btn primary", href: `#/exam/${exam.id}/interroga` }, "Interrogatevi a turno"),
      h("button", { class: "btn", onclick: () => download(`studify-${slug(exam.name)}-${today()}.json`, exportExam(exam, { materials: withMaterials.checked })) }, "Condividi l'esame con il gruppo")),
    h("label", { class: "small muted", style: { display: "flex", gap: "6px", alignItems: "center", fontWeight: 400 } }, withMaterials,
      "con il testo dei materiali (non i PDF e le foto). Togli la spunta per mandare solo il modulo: flashcard, quiz, argomenti."),
    h("p", { class: "muted small", style: { margin: 0 } }, "Chi lo riceve lo importa dalla home («Importa un esame dal gruppo»): ha un esame suo, con il modulo pronto e i progressi a zero. I tuoi progressi, il piano e le simulazioni non partono."));
}

/** Pulsante in home: importa l'esame di un compagno. */
export function importGroupButton(cls = "btn") {
  const input = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const fields = importExam(await file.text(), store.state.exams.map((x) => x.name));
      const exam = store.newExam(fields);
      toast(`«${exam.name}» importato: modulo pronto, progressi a zero. Controlla data e ore di studio.`, "ok");
      go(`#/exam/${exam.id}/edit`);
    } catch (err) {
      toast(err.message, "error");
    }
    input.value = "";
  } });
  return [h("button", { class: cls, onclick: () => input.click() }, "Importa un esame dal gruppo"), input];
}

let round = null; // { examId, items, i, show, ok, review }

/** Interrogazione a turno: una domanda alla volta; la traccia si apre solo per chi interroga. */
export function interrogaView(exam) {
  if (!exam.module) return emptyState("Prima il modulo", "Le domande vengono dal modulo: generalo dalla scheda Materiali.", h("a", { class: "btn", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  if (!round || round.examId !== exam.id) round = { examId: exam.id, items: groupQuestions(exam, 10), i: 0, show: false, ok: 0, review: [] };
  const back = h("a", { class: "muted", href: `#/exam/${exam.id}/module` }, "← Modulo");
  if (!round.items.length) return h("div", { class: "session" }, back, emptyState("Nessuna domanda aperta", "Per interrogarsi servono domande con una risposta modello: rigenera o aggiorna il modulo.", null));
  const restart = () => { round = null; core.rerender(); };
  if (round.i >= round.items.length) {
    return h("div", { class: "session stack" }, back,
      h("div", { class: "card stack" }, h("h2", { style: { margin: 0 } }, `Giro finito: ${round.ok}/${round.items.length} sapute`),
        round.review.length ? h("div", {}, h("b", {}, "Da rivedere:"), h("ul", {}, round.review.map((q) => h("li", {}, rich(q.prompt.split("\n")[0]))))) : h("p", {}, "Tutte sapute: domani un giro sugli argomenti meno sicuri."),
        h("p", { class: "muted small", style: { margin: 0 } }, "Questi risultati non entrano nei tuoi progressi: chi ha risposto poteva essere un compagno. Le domande da rivedere fatele anche nel quiz, ognuno per conto suo."),
        h("div", {}, h("button", { class: "btn primary", onclick: restart }, "Un altro giro"))));
  }
  const q = round.items[round.i];
  const topic = exam.module.topics.find((t) => t.id === q.topicId);
  const checks = (q.rubric ?? []).map((r) => h("label", { style: { display: "flex", gap: "8px", alignItems: "flex-start", fontWeight: 400 } }, h("input", { type: "checkbox" }), h("span", {}, rich(r))));
  const next = (known) => { if (known) round.ok++; else round.review.push(q); round.i++; round.show = false; core.rerender(); };
  return h("div", { class: "session stack" },
    h("div", { class: "session-head" }, back, h("div", { class: "row" }, badge("interrogazione a turno", "brand"), h("span", { class: "muted small" }, `${round.i + 1}/${round.items.length}${topic ? ` · ${topic.title}` : ""}`))),
    h("div", { class: "card stack" },
      q.examRefs?.length ? badge("domanda d'esame vera", "bad") : null,
      h("div", { class: "q-prompt" }, richParas(q.prompt)),
      round.show
        ? h("div", { class: "stack" },
            checks.length ? h("div", { class: "callout stack", style: { gap: "6px" } }, h("b", {}, "Punti da sentire nella risposta"), ...checks) : null,
            q.modelAnswer ? h("details", { class: "small" }, h("summary", {}, "Risposta modello"), ...renderMarkdown(q.modelAnswer)) : null,
            q.followUp ? h("div", { class: "callout" }, h("b", {}, "Incalza: "), rich(q.followUp)) : null,
            h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => next(true) }, "Sapeva rispondere"), h("button", { class: "btn", onclick: () => next(false) }, "Da rivedere")))
        : h("div", { class: "stack" },
            h("p", { class: "muted", style: { margin: 0 } }, "Leggi la domanda ad alta voce. Chi risponde parla senza appunti; chi interroga apre la traccia e spunta i punti che sente."),
            h("div", {}, h("button", { class: "btn primary", onclick: () => { round.show = true; core.rerender(); } }, "Mostra la traccia (solo chi interroga)")))),
    h("p", { class: "muted small" }, "Poi scambiatevi: chi ha risposto interroga."));
}
