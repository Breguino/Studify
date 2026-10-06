import { go } from "../nav.js";
import { daysLeft, dueCount, ensurePlan, isDone, statsFor, taskHref } from "../domain.js";
import { careerSummary } from "./career.js";
import { importGroupButton } from "./group.js";
import { taskRow } from "./tasks.js";
import { fmtDate, fmtDayLong, addDays, today } from "../dates.js";
import { nextExam, sessionOf, weekStrip } from "../today.js";
import { EXAM_TYPES } from "../methods.js";
import * as store from "../store.js";
import { badge, bar, confirmDialog, emptyState, h, icon, pct, toast } from "../ui.js";
import { core } from "../core.js";

async function createDemo() {
  try {
    let module = core.demoModule; // incorporato nella versione pubblicata come pagina Claude
    if (!module) {
      const res = await fetch("/demo/module.json");
      if (!res.ok) throw new Error();
      module = await res.json();
    }
    const exam = store.newExam({
      name: "Microeconomia (demo)",
      date: addDays(today(), 21),
      type: "misto",
      level: 2,
      hoursPerDay: 2,
      module,
      moduleBuiltAt: new Date().toISOString(),
    });
    go(`#/exam/${exam.id}`);
  } catch {
    toast("Impossibile caricare l'esame demo (serve il server).", "error");
  }
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const appello = (exam) => exam.appelli?.find((a) => a.date === exam.date);

function dateLine(exam) {
  const ap = appello(exam);
  return `${fmtDate(exam.date)}${exam.dateTentative ? " (provvisoria)" : ""}${ap?.time ? ` ore ${ap.time}` : ""} · ${EXAM_TYPES[exam.type]}${exam.appelli?.length > 1 ? ` · ${exam.appelli.length} appelli` : ""}`;
}

/** Preparazione stimata: barra e percentuale, o a parole finché non c'è nessun dato. */
function readinessLine(ready, cls = "") {
  return ready == null
    ? h("div", { class: `small muted ${cls}` }, "Preparazione: si misura con quiz e flashcard")
    : h("div", { class: `progress-line ${cls}` }, h("span", { class: "small muted" }, "Preparazione"), bar(ready, { label: "preparazione stimata" }), h("b", { class: "small" }, pct(ready)));
}

function examCard(exam) {
  const dl = daysLeft(exam);
  const { ready } = statsFor(exam);
  const plan = ensurePlan(exam);
  const waiting = plan?.start && plan.start > today(); // finestra di studio non ancora iniziata
  const s = plan && !waiting ? sessionOf(plan.days[0], (t) => isDone(exam, t)) : null;
  const due = dueCount(exam);
  const tone = dl >= 0 && dl <= 3 ? "bad" : dl >= 0 && dl <= 10 ? "warn" : "";
  return h(
    "a",
    { class: "card exam-card", href: `#/exam/${exam.id}` },
    h("div", { class: "exam-card-top" },
      h("div", { class: "exam-card-name" }, h("h3", {}, exam.name), h("span", { class: "muted small" }, dateLine(exam))),
      h("div", { class: `count-mini ${tone}` },
        h("b", {}, dl > 0 ? `${exam.dateTentative ? "~" : ""}${dl}` : dl === 0 ? "oggi" : "—"),
        h("span", {}, dl > 0 ? (dl === 1 ? "giorno" : "giorni") : dl === 0 ? "l'esame" : "passato"))),
    exam.module
      ? [readinessLine(ready),
          h("div", { class: "small muted" }, waiting ? `Studio dal ${fmtDate(plan.start)} (${plan.days.length} giorni)` : s?.tasks.length ? `Oggi: ${s.doneCount}/${s.tasks.length} attività, ${s.minutes} min` : "Oggi: nessuna attività", due ? ` · ${due} flashcard da ripassare` : "")]
      : [h("div", {}, badge("Modulo da creare", "warn")), h("span", { class: "small muted" }, "Carica dispense ed esami passati: il piano parte dai materiali.")],
  );
}

/** La fascia del prossimo appello: conto alla rovescia, preparazione, settimana e la sessione di oggi. */
function nextExamHero(exam) {
  const dl = daysLeft(exam);
  const plan = ensurePlan(exam);
  const { ready } = statsFor(exam);
  const waiting = !!plan?.start && plan.start > today();
  const s = plan && !waiting ? sessionOf(plan.days[0], (t) => isDone(exam, t), (t) => !!taskHref(exam, t)) : null;
  const ap = appello(exam);
  const week = plan ? weekStrip(plan, exam.date, today()) : [];
  const href = `#/exam/${exam.id}`;
  const cell = (d) => ({ today: "oggi", exam: "esame", study: `${d.minutes}′`, before: "—", free: "libero" })[d.kind];

  const main = h("div", { class: "next-main" },
    h("div", { class: "next-title" },
      h("span", { class: "kicker" }, "Prossimo appello"),
      h("h2", {}, h("a", { href }, exam.name)),
      h("span", { class: "next-meta" }, `${capital(fmtDayLong(exam.date))}${exam.date.slice(0, 4) !== today().slice(0, 4) ? ` ${exam.date.slice(0, 4)}` : ""}${exam.dateTentative ? " (data provvisoria)" : ""}${ap?.time ? `, ore ${ap.time}` : ""} · ${EXAM_TYPES[exam.type]}`)),
    h("div", { class: "next-count" },
      h("b", {}, dl === 0 ? "oggi" : `${exam.dateTentative ? "~" : ""}${dl}`),
      dl > 0 ? h("span", {}, dl === 1 ? "giorno" : "giorni", h("br"), "all'appello") : h("span", {}, "in bocca", h("br"), "al lupo")),
    exam.module
      ? h("div", { class: "next-ready" },
          h("div", { class: "row between" }, h("span", {}, "Preparazione stimata"), h("b", {}, ready == null ? "—" : pct(ready))),
          bar(ready ?? 0, { label: "preparazione stimata" }),
          h("span", { class: "next-note" }, ready == null ? "Si misura con quiz e flashcard: fai il primo e compare qui." : "Dai quiz e dalle flashcard, pesati per l'importanza degli argomenti."))
      : null,
    week.length > 1 ? h("ol", { class: "week", "aria-label": "I prossimi giorni" }, week.map((d) => h("li", { class: d.kind }, h("span", {}, d.day), h("b", {}, cell(d))))) : null);

  let side;
  if (!exam.module)
    side = [h("h3", {}, "Il piano parte dai materiali"), h("p", { class: "muted" }, "Carica dispense, slide, esami passati o appunti: ne ricaviamo argomenti, flashcard, quiz e il piano giorno per giorno."),
      h("a", { class: "btn primary next-cta", href: `${href}/materials` }, "Carica i materiali →")];
  else if (dl === 0)
    side = [h("h3", {}, "L'esame è oggi"), h("p", { class: "muted" }, "Un ultimo sguardo ai punti deboli, poi niente di nuovo."), h("a", { class: "btn next-cta", href: `${href}/progress` }, "I punti deboli")];
  else if (waiting) {
    const due = dueCount(exam);
    side = [h("h3", {}, `Lo studio inizia ${fmtDayLong(plan.start)}`), h("p", { class: "muted" }, `Ti sei dato ${plan.days.length} giorni prima dell'esame.${due ? " Intanto tieni vive le flashcard già viste." : ""}`),
      due ? h("a", { class: "btn primary next-cta", href: `${href}/flash` }, `Ripassa ${due} flashcard`) : h("a", { class: "btn next-cta", href }, "Apri il piano")];
  } else if (!s?.tasks.length)
    side = [h("h3", {}, "Oggi niente in programma"), h("p", { class: "muted" }, "Il piano non ha attività per oggi."), h("a", { class: "btn next-cta", href }, "Apri il piano")];
  else
    side = [
      h("div", { class: "row between" }, h("span", { class: "kicker" }, `Oggi · ${s.minutes} min`), h("span", { class: "small muted" }, `${s.doneCount} di ${s.tasks.length} fatte`)),
      bar(s.minutes ? s.doneMinutes / s.minutes : 0, { tone: "good", label: "sessione di oggi" }),
      h("div", { class: "stack next-tasks" }, s.tasks.map((t) => taskRow(exam, t, { compact: true }))),
      s.next
        ? h("a", { class: "btn primary next-cta", href: taskHref(exam, s.next) ?? href }, `Inizia: ${s.next.title}`)
        : h("div", { class: "callout good" }, h("b", {}, "Fatto per oggi."), " Domani il piano riparte da dove sei arrivato."),
      h("a", { class: "small next-link", href }, "Apri il piano di oggi →"),
    ];
  return h("section", { class: "next-exam", "aria-label": `Prossimo appello: ${exam.name}` }, main, h("div", { class: "next-side card" }, side));
}

function addCard() {
  return h("div", { class: "add-card" },
    h("a", { class: "add-main", href: "#/new" }, h("span", { class: "add-icon" }, icon("plus", 22)), h("b", {}, "Aggiungi un esame")),
    h("span", { class: "small muted" }, "oppure"),
    ...importGroupButton("btn ghost small"));
}

export function homeView() {
  const t = today();
  const exams = [...store.state.exams].sort((a, b) => a.date.localeCompare(b.date));
  const next = nextExam(exams, t);
  const others = exams.filter((e) => e !== next);
  const later = [...others.filter((e) => e.date >= t), ...others.filter((e) => e.date < t).reverse()];
  return h(
    "div",
    { class: "stack home" },
    h("div", { class: "row between page-head" },
      h("div", {}, h("span", { class: "page-date" }, capital(fmtDayLong(t))), h("h1", {}, "I tuoi esami")),
      h("div", { class: "row" }, h("a", { class: "btn ghost", href: "#/import" }, "Importa CSV / Excel"), h("a", { class: "btn primary", href: "#/new" }, "+ Nuovo esame"))),
    exams.length
      ? [
          next ? nextExamHero(next) : null,
          h("section", { class: "stack", "aria-labelledby": "altri-esami" },
            h("h2", { id: "altri-esami", class: "section-head" }, next ? (later.length ? "Gli altri esami" : "Aggiungi un altro esame") : "Esami già passati"),
            h("div", { class: "grid" }, later.map(examCard), addCard())),
        ]
      : h(
          "div",
          { class: "stack" },
          emptyState(
            "Inizia dal tuo primo esame",
            "Aggiungi un esame, carica i tuoi appunti (o fai cercare materiale online all'AI) e ottieni un modulo di studio con piano, flashcard e quiz.",
            h("a", { class: "btn primary", href: "#/new" }, "Aggiungi un esame"),
            h("button", { class: "btn", onclick: createDemo }, "Prova con l'esame demo"),
            ...importGroupButton("btn ghost"),
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
    careerSummary(),
    !store.state.profile?.university ? h("div", { class: "callout row between" }, h("span", {}, h("b", {}, "Indica il tuo ateneo e corso di studio "), "(es. UNIBS): affina la ricerca dei materiali e suggerisce il formato d'esame dei tuoi insegnamenti."), h("a", { class: "btn small", href: "#/profile" }, "Imposta")) : null,
    !core.ai.ai && !core.ai.offline ? h("div", { class: "callout warn" }, "AI non configurata: puoi comunque usare l'app in modalità base (flashcard dalle definizioni nei tuoi appunti). Per moduli completi, quiz e ricerca online imposta ANTHROPIC_API_KEY.") : null,
  );
}

export function settingsView() {
  const fileInput = h("input", { type: "file", accept: "application/json", hidden: true });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (!(await confirmDialog("L'importazione sostituisce tutti i dati attuali. Continuare?", { ok: "Importa", danger: true }))) return;
    try {
      await store.importAll(await f.text());
      toast("Backup importato.", "ok");
      go("#/");
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
        const json = await store.exportAll();
        const filename = `studify-backup-${today()}.json`;
        if (core.downloads) {
          try { await core.downloads({ filename, data: json }); toast("Backup salvato.", "ok"); } catch (e) { if (e?.code !== "declined") toast("Salvataggio del file non riuscito.", "error"); }
          return;
        }
        const blob = new Blob([json], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: filename });
        a.click();
        URL.revokeObjectURL(a.href);
      } }, "Esporta backup"),
      h("button", { class: "btn", onclick: () => fileInput.click() }, "Importa backup"),
      fileInput,
    ),
    h("div", { class: "callout" }, h("b", {}, "Stato salvataggio: "), store.isPersistent() ? "locale e persistente." : "NON persistente (navigazione privata?)."),
  );
}
