import { loadMath } from "./math.js";
import * as api from "./api.js";
import { core } from "./core.js";
import { backend } from "./backend.js";
import * as store from "./store.js";
import { currentHash } from "./nav.js";
import { clear, h, toast } from "./ui.js";
import { homeView, settingsView } from "./views/home.js";
import { examFormView } from "./views/form.js";
import { importView } from "./views/import.js";
import { profileView } from "./views/profile.js";
import { careerView } from "./views/career.js";
import { hubView, topicView } from "./views/hub.js";
import { flashView } from "./views/flash.js";
import { explainView, quizView } from "./views/quiz.js";
import { simView } from "./views/sim.js";
import { guidedView } from "./views/guided.js";
import { interrogaView } from "./views/group.js";

const main = document.getElementById("main");

function parse() {
  const [path, qs = ""] = currentHash().replace(/^#\/?/, "").split("?");
  return { seg: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

function route() {
  const { seg, query } = parse();
  const [a, id, b, c] = seg;
  if (!a) return homeView();
  if (a === "new") return examFormView(null, { name: query.get("course") ?? "" });
  if (a === "libretto") return careerView();
  if (a === "settings") return settingsView();
  if (a === "profile") return profileView();
  if (a === "import") return importView();
  if (a === "exam") {
    const exam = store.getExam(id);
    if (!exam) return h("div", { class: "empty" }, h("h3", {}, "Esame non trovato"), h("a", { class: "btn", href: "#/" }, "Torna alla home"));
    switch (b) {
      case "flash": return flashView(exam, query);
      case "quiz": return quizView(exam, query);
      case "explain": return explainView(exam, c, query);
      case "topic": return topicView(exam, c, query);
      case "sim": return simView(exam, query);
      case "guided": return guidedView(exam, c, query);
      case "interroga": return interrogaView(exam);
      case "edit": return examFormView(exam);
      default: return hubView(exam, b || "today");
    }
  }
  return h("div", { class: "empty" }, h("h3", {}, "Pagina non trovata"), h("a", { class: "btn", href: "#/" }, "Home"));
}

function render() {
  clear(main);
  try {
    main.append(route());
  } catch (e) {
    console.error(e);
    main.append(h("div", { class: "callout bad" }, `Errore: ${e.message}`));
  }
  window.scrollTo(0, 0);
  main.focus?.();
}

function renderAiPill() {
  const pill = document.getElementById("ai-pill");
  const s = core.ai;
  pill.className = `pill ${s.ai ? "on" : ""}`;
  pill.textContent = s.label ?? (s.mock ? "AI: demo" : s.ai ? "AI attiva" : "Modalità base");
  pill.title = s.ai
    ? `Modello: ${s.model}`
    : s.offline
      ? "Server non raggiungibile: avvia l'app con «npm start»"
      : "Imposta ANTHROPIC_API_KEY per generare moduli, quiz e ricerche online con l'AI";
}

core.rerender = render;
addEventListener("hashchange", render);

let lastSaveToast = 0;
store.setSaveErrorHandler(() => {
  if (Date.now() - lastSaveToast < 60000) return;
  lastSaveToast = Date.now();
  toast("Non riesco a salvare le ultime modifiche: esporta un backup da «Dati» per non perderle.", "error");
});

export async function boot() {
  const math = loadMath(); // KaTeX in parallelo: se arriva dopo il primo disegno, le formule si ridisegnano
  await store.init();
  core.ai = await api.status();
  renderAiPill();
  if (!store.isPersistent()) toast(backend.noPersistMessage ?? "Salvataggio locale non disponibile (navigazione privata?): i dati andranno persi alla chiusura.", "error");
  render();
  await math;
}
