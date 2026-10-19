// Landing: la scheda in cima è un piano vero. Scegli fra quanti giorni c'è l'esame e quante ore al giorno:
// fasi, settimana e sessione di oggi vengono da buildPlan (lo stesso dell'app) con gli argomenti dell'esame demo.
// La build (scripts/build-artifact.mjs) lo incorpora nella landing con gli argomenti già ridotti all'essenziale.
import { buildPlan, PHASES } from "../public/js/planner.js";
import { addDays, fmtDay, fmtDayLong, today, weekdayShort } from "../public/js/dates.js";

export const HOURS = [1, 1.5, 2, 3];
const ORDER = [["learn", "learn"], ["consolidate", "consolidate"], ["simulate", "sim"], ["light", "light"]];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const hoursLabel = (h) => `${String(h).replace(".", ",")} ${h === 1 ? "ora" : "ore"}`;

/** Il piano mostrato nella scheda (puro, testato): data dell'esame, fasi, i prossimi giorni, la sessione di oggi. */
export function heroPlan({ days, hours, topics, start }) {
  const examDate = addDays(start, days);
  const plan = buildPlan({ examDate, examType: "misto", level: 2, hoursPerDay: hours, topics, today: start });
  const ph = plan.phases; // quelle vere: i giorni di comprensione non superano gli argomenti da studiare
  const byDate = new Map(plan.days.map((d) => [d.date, d]));
  const week = [];
  for (let i = 0; i < 6; i++) {
    const date = addDays(start, i);
    const d = byDate.get(date);
    week.push({ date, label: i === 0 ? "oggi" : weekdayShort(date), exam: date === examDate, minutes: d?.minutes ?? 0, phase: d?.phase ?? null });
    if (date === examDate) break;
  }
  const first = plan.days[0];
  return {
    examDate,
    examLabel: fmtDayLong(examDate),
    examShort: fmtDay(examDate),
    phases: ORDER.map(([phase, k]) => ({ phase, label: PHASES[phase], days: ph[k] })).filter((p) => p.days > 0),
    week,
    today: { minutes: first?.minutes ?? 0, tasks: (first?.tasks ?? []).filter((t) => t.kind !== "rest").slice(0, 3) },
  };
}

/** Frase per i lettori di schermo: quello che la scheda mostra a colpo d'occhio. */
export function planSummary(p, days, hours) {
  const fasi = p.phases.map((x) => `${x.label.toLowerCase()} ${plural(x.days, "giorno", "giorni")}`).join(", ");
  return `Esame ${p.examLabel}, tra ${plural(days, "giorno", "giorni")}, ${hoursLabel(hours)} al giorno: ${fasi}. Oggi ${p.today.minutes} minuti.`;
}

/* ------------------------------- nella pagina ------------------------------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function mountHeroPlan(root, topics) {
  const $ = (k) => root.querySelector(`[data-hp="${k}"]`);
  const range = $("days-in");
  const state = { days: Number(range.value) || 21, hours: Number(root.querySelector("input[name=hp-hours]:checked")?.value) || 2 };
  $("controls").hidden = false;

  function draw({ announce = true } = {}) {
    const p = heroPlan({ ...state, topics, start: today() });
    $("days").textContent = String(state.days);
    range.style.setProperty("--p", `${((state.days - range.min) / (range.max - range.min)) * 100}%`);
    $("days-out").textContent = plural(state.days, "giorno", "giorni");
    $("date").textContent = p.examShort;
    $("phases").replaceChildren(
      el("div", "phase-bar"),
      el("ul", "cd-legend"));
    for (const x of p.phases) {
      const seg = el("span"); seg.dataset.phase = x.phase; seg.style.flexGrow = String(x.days);
      $("phases").firstChild.append(seg);
      const li = el("li", null); li.dataset.phase = x.phase;
      li.style.setProperty("--n", String($("phases").lastChild.children.length));
      li.append(el("span", null, x.label), el("b", null, `${x.days} g`));
      $("phases").lastChild.append(li);
    }
    $("week").replaceChildren(...p.week.map((d, i) => {
      const c = el("span", `cd-day${d.label === "oggi" ? " today" : ""}${d.exam ? " exam" : ""}`);
      c.style.setProperty("--n", String(i));
      if (d.phase && !d.exam && d.label !== "oggi") c.dataset.phase = d.phase;
      c.append(el("small", null, d.label), el("b", null, d.exam ? "esame" : `${d.minutes}′`));
      return c;
    }));
    $("today-label").textContent = `Oggi · ${p.today.minutes} minuti`;
    $("tasks").replaceChildren(...p.today.tasks.map((t, i) => {
      const r = el("div", "cd-task");
      r.style.setProperty("--n", String(i));
      r.append(el("b", null, t.title), el("span", null, `${t.minutes}′`));
      return r;
    }));
    if (announce) $("summary").textContent = planSummary(p, state.days, state.hours);
  }

  // trascinando si ridisegna e basta; la frase per i lettori di schermo arriva quando lasci il cursore
  range.addEventListener("input", () => { state.days = Number(range.value); draw({ announce: false }); });
  range.addEventListener("change", () => draw());
  for (const r of root.querySelectorAll("input[name=hp-hours]")) r.addEventListener("change", () => { state.hours = Number(r.value); draw(); });
  draw({ announce: false });
  intro(root, $("days"), state);
}

/**
 * Apertura della scheda: il piano si compone (CSS .intro in landing.css) e i giorni contano fino al valore.
 * Solo una volta e senza «movimento ridotto»; poi .intro va via, così i ridisegni dal cursore non si rianimano.
 */
function intro(root, num, state) {
  if (!globalThis.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("intro");
  setTimeout(() => root.classList.remove("intro"), 2400);
  const days = state.days, t0 = performance.now(), ms = 900;
  const tick = (t) => {
    if (state.days !== days) return; // hai già mosso il cursore: vale il tuo valore
    const k = Math.min(1, Math.max(0, (t - t0) / ms));
    num.textContent = String(Math.round(days * ease(k)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const ease = (k) => 1 - (1 - k) ** 3;
