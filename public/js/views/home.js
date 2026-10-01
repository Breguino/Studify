import { daysLeft, dueCount, ensurePlan, isDone, statsFor } from "../domain.js";
import { fmtDate, addDays, today } from "../dates.js";
import { EXAM_TYPES } from "../methods.js";
import * as store from "../store.js";
import { badge, bar, emptyState, h, pct, toast } from "../ui.js";
import { core } from "../core.js";

async function createDemo() {
  try {
    const res = await fetch("/demo/module.json");
    if (!res.ok) throw new Error();
    const module = await res.json();
    const exam = store.newExam({
      name: "Microeconomia (demo)",
      date: addDays(today(), 21),
      type: "misto",
      level: 2,
      hoursPerDay: 2,
      module,
      moduleBuiltAt: new Date().toISOString(),
    });
    location.hash = `#/exam/${exam.id}`;
  } catch {
    toast("Impossibile caricare l'esame demo (serve il server).", "error");
  }
}

function examCard(exam) {
  const dl = daysLeft(exam);
  const { ready } = statsFor(exam);
  const plan = ensurePlan(exam);
  const todayTasks = plan?.days[0]?.tasks.filter((t) => t.kind !== "rest") ?? [];
  const doneCount = todayTasks.filter((t) => isDone(exam, t)).length;
  const due = dueCount(exam);
  return h(
    "a",
    { class: "card stack", href: `#/exam/${exam.id}` },
    h("div", { class: "row between" }, h("h3", {}, exam.name), badge(dl > 0 ? `tra ${dl} g` : dl === 0 ? "oggi" : "passato", dl <= 3 && dl >= 0 ? "bad" : dl <= 10 ? "warn" : "")),
    h("div", { class: "muted small" }, `${fmtDate(exam.date)} · ${EXAM_TYPES[exam.type]}`),
    exam.module
      ? h(
          "div",
          { class: "stack", style: { gap: "8px" } },
          h("div", { class: "progress-line" }, h("span", { class: "small muted" }, "Preparazione"), bar(ready ?? 0, { label: "preparazione stimata" }), h("b", { class: "small" }, pct(ready))),
          h("div", { class: "small muted" }, todayTasks.length ? `Oggi: ${doneCount}/${todayTasks.length} attività` : "Oggi: nessuna attività", due ? ` · ${due} flashcard da ripassare` : ""),
        )
      : badge("Modulo da creare", "warn"),
  );
}

export function homeView() {
  const exams = [...store.state.exams].sort((a, b) => a.date.localeCompare(b.date));
  return h(
    "div",
    { class: "stack" },
    h("div", { class: "row between" }, h("h1", {}, "I tuoi esami"), h("a", { class: "btn primary", href: "#/new" }, "+ Nuovo esame")),
    exams.length
      ? h("div", { class: "grid" }, exams.map(examCard))
      : h(
          "div",
          { class: "stack" },
          emptyState(
            "Inizia dal tuo primo esame",
            "Aggiungi un esame, carica i tuoi appunti (o fai cercare materiale online all'AI) e ottieni un modulo di studio con piano, flashcard e quiz.",
            h("a", { class: "btn primary", href: "#/new" }, "Aggiungi un esame"),
            h("button", { class: "btn", onclick: createDemo }, "Prova con l'esame demo"),
          ),
          h(
            "div",
            { class: "grid" },
            [
              ["1 · Descrivi l'esame", "Data, tipo di prova (scritto, orale, test…), il tuo livello di partenza e le ore che puoi dedicare."],
              ["2 · Porta i materiali", "Incolla o carica appunti e PDF, oppure chiedi all'AI di cercare dispense affidabili sul programma."],
              ["3 · Studia con metodo", "Piano a ritroso dalla data, flashcard a ripasso dilazionato, quiz, spiegazioni a parole tue."],
            ].map(([t, p]) => h("div", { class: "card flat" }, h("h3", {}, t), h("p", { class: "muted" }, p))),
          ),
        ),
    !store.state.profile?.university ? h("div", { class: "callout row between" }, h("span", {}, h("b", {}, "Indica il tuo ateneo e corso di studio "), "(es. UNIBS): affina la ricerca dei materiali e suggerisce il formato d'esame dei tuoi insegnamenti."), h("a", { class: "btn small", href: "#/profile" }, "Imposta")) : null,
    !core.ai.ai && !core.ai.offline ? h("div", { class: "callout warn" }, "AI non configurata: puoi comunque usare l'app in modalità base (flashcard dalle definizioni nei tuoi appunti). Per moduli completi, quiz e ricerca online imposta ANTHROPIC_API_KEY.") : null,
  );
}

export function settingsView() {
  const fileInput = h("input", { type: "file", accept: "application/json", hidden: true });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (!confirm("L'importazione sostituisce tutti i dati attuali. Continuare?")) return;
    try {
      await store.importAll(await f.text());
      toast("Backup importato.", "ok");
      location.hash = "#/";
      core.rerender();
    } catch (e) {
      toast(e.message, "error");
    }
  });
  return h(
    "div",
    { class: "stack", style: { maxWidth: "640px" } },
    h("h1", {}, "I tuoi dati"),
    h("p", { class: "muted" }, "Tutto resta nel tuo browser (IndexedDB). Nessun account: solo il testo dei materiali viene inviato al server locale quando generi un modulo."),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: async () => {
        const blob = new Blob([await store.exportAll()], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: `studify-backup-${today()}.json` });
        a.click();
        URL.revokeObjectURL(a.href);
      } }, "Esporta backup"),
      h("button", { class: "btn", onclick: () => fileInput.click() }, "Importa backup"),
      fileInput,
    ),
    h("div", { class: "callout" }, h("b", {}, "Stato salvataggio: "), store.isPersistent() ? "locale e persistente." : "NON persistente (navigazione privata?)."),
  );
}
