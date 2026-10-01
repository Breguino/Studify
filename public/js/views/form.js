import { go } from "../nav.js";
import { examDefaultsFromCourse, FORMAT_LABEL, findCourse } from "../curriculum.js";
import { addDays, today } from "../dates.js";
import { suggestExamType } from "../exam-type.js";
import { EXAM_TYPES, sessionAdvice } from "../methods.js";
import * as store from "../store.js";
import { confirmDialog, h, toast } from "../ui.js";

const LEVELS = {
  1: "1 · Parto da zero",
  2: "2 · Ne so poco",
  3: "3 · Conosco le basi",
  4: "4 · Ci sono già dentro",
  5: "5 · Mi serve solo ripassare",
};
const GENERIC_HINT = "Cambia il mix di metodi: all'orale conta spiegare, al test riconoscere.";

export function examFormView(exam) {
  const isNew = !exam;
  const prof = store.state.profile;
  const courses = prof?.courses ?? [];
  const v = exam ?? { name: "", date: addDays(today(), 30), type: "scritto", level: 2, hoursPerDay: 3, sessionMinutes: 25, language: "italiano", cfu: 0 };
  const university = exam ? exam.university : prof?.university ?? "";
  const degree = exam ? exam.degree : prof?.degree ?? "";
  const f = {};
  const field = (key, label, input, hint) => {
    f[key] = input;
    return h("label", {}, label, input, hint ? h("span", { class: "hint" }, hint) : null);
  };
  const select = (opts, cur) => h("select", {}, Object.entries(opts).map(([k, t]) => h("option", { value: k, selected: String(k) === String(cur) }, t)));
  let formatSource = exam?.formatSource ?? null;

  const where = h("div", { class: "callout row between" },
    university || degree
      ? h("span", {}, h("b", {}, university || "—"), degree ? ` · ${degree}` : "")
      : h("span", {}, "Non hai ancora indicato ateneo e corso di studio: aiutano a trovare materiali e a suggerire il formato d'esame."),
    h("a", { href: "#/profile" }, university || degree ? "Cambia" : "Imposta"));

  const courseList = h("datalist", { id: "courses" }, courses.map((c) => h("option", { value: c.name })));
  const nameInput = h("input", { required: true, value: v.name, placeholder: "es. Microeconomia", list: "courses", autocomplete: "off" });

  const form = h(
    "form",
    {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        const data = {
          name: f.name.value.trim(),
          university,
          degree,
          cfu: Math.min(60, Math.max(0, Number(f.cfu.value) || 0)),
          date: f.date.value,
          type: f.type.value,
          level: Number(f.level.value),
          hoursPerDay: Math.min(12, Math.max(0.5, Number(f.hours.value) || 2)),
          sessionMinutes: Number(f.session.value),
          language: f.language.value.trim() || "italiano",
          formatSource: typeTouched ? null : formatSource,
        };
        if (!data.name) return toast("Dai un nome all'esame.", "error");
        if (!data.date || data.date <= today()) return toast("La data d'esame deve essere futura.", "error");
        if (isNew) {
          const created = store.newExam(data);
          go(`#/exam/${created.id}/materials`);
        } else {
          Object.assign(exam, data);
          exam.plan = null; // il piano dipende da data, tipo e ore
          store.save();
          go(`#/exam/${exam.id}`);
        }
      },
    },
    h("h1", {}, isNew ? "Nuovo esame" : "Modifica esame"),
    where,
    field("name", "Insegnamento / esame", nameInput, courses.length ? "Scegli dal tuo piano di studi per precompilare CFU e tipo di prova." : null),
    courseList,
    h("div", { class: "cols" },
      field("date", "Data dell'esame", h("input", { type: "date", required: true, value: v.date, min: addDays(today(), 1) })),
      field("type", "Tipo di prova", select(EXAM_TYPES, v.type)),
    ),
    h("div", { class: "cols" },
      field("level", "Quanto conosci già la materia?", select(LEVELS, v.level), "Non c'è una risposta giusta: serve per dosare spiegazioni e difficoltà."),
      field("cfu", "CFU (facoltativo)", h("input", { type: "number", min: 0, max: 60, value: v.cfu || "" }), "Indicano l'ampiezza del programma."),
    ),
    h("div", { class: "cols" },
      field("hours", "Ore di studio al giorno", h("input", { type: "number", min: 0.5, max: 12, step: 0.5, value: v.hoursPerDay })),
      field("session", "Durata di un blocco di studio", select({ 25: "25 min", 45: "45 min", 60: "60 min", 90: "90 min" }, v.sessionMinutes), sessionAdvice(v.sessionMinutes)),
    ),
    field("language", "Lingua del materiale", h("input", { value: v.language })),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, isNew ? "Continua: aggiungi i materiali" : "Salva"), h("a", { class: "btn ghost", href: isNew ? "#/" : `#/exam/${exam.id}` }, "Annulla")),
  );

  /* Tipo di prova e CFU si precompilano finché l'utente non li sceglie a mano.
     Priorità: piano di studi (dichiarato da scheda o da te) > euristica sulla materia. */
  const hint = h("span", { class: "hint" }, GENERIC_HINT);
  f.type.parentElement.append(hint);
  let typeTouched = !isNew;
  let cfuTouched = !isNew;
  f.type.addEventListener("change", () => { typeTouched = true; formatSource = null; refresh(); });
  f.cfu.addEventListener("input", () => (cfuTouched = true));

  function refresh() {
    hint.replaceChildren(GENERIC_HINT);
    if (typeTouched) return;
    const name = f.name.value;
    if (!name.trim()) return;
    const course = findCourse(courses, name);
    const d = examDefaultsFromCourse(course);
    if (d && !cfuTouched && d.cfu) f.cfu.value = d.cfu;
    if (d?.type) {
      f.type.value = d.type;
      formatSource = { text: d.evidence, url: d.url };
      hint.replaceChildren(...[`Dal tuo piano di studi: ${FORMAT_LABEL[d.type]}${d.evidence && d.evidence !== "demo" ? ` (${d.evidence})` : ""}. `, d.url ? h("a", { href: d.url, target: "_blank", rel: "noopener noreferrer" }, "fonte") : null, d.url ? " · " : null, "Verifica con il tuo docente."].filter(Boolean));
      return;
    }
    formatSource = null;
    const sg = suggestExamType(name);
    f.type.value = sg.type;
    hint.replaceChildren(sg.match
      ? `Suggerito dalla materia («${sg.match}»): ${sg.label}. Dipende dal docente: correggilo se il tuo è diverso.`
      : "Materia non riconosciuta: ho messo «scritto + orale». Scegli quello del tuo esame.");
  }
  f.name.addEventListener("input", refresh);
  if (isNew) refresh();

  if (!isNew)
    form.append(
      h("hr", { style: { width: "100%", border: 0, borderTop: "1px solid var(--line)" } }),
      h("button", {
        class: "btn danger", type: "button", onclick: async () => {
          if (!(await confirmDialog(`Eliminare «${exam.name}» con tutti i materiali e i progressi?`, { ok: "Elimina", danger: true }))) return;
          await store.deleteExam(exam.id);
          go("#/");
        },
      }, "Elimina esame"),
    );
  return form;
}
