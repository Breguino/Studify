import { addDays, today } from "../dates.js";
import { EXAM_TYPES, sessionAdvice } from "../methods.js";
import * as store from "../store.js";
import { h, toast } from "../ui.js";

const LEVELS = {
  1: "1 · Parto da zero",
  2: "2 · Ne so poco",
  3: "3 · Conosco le basi",
  4: "4 · Ci sono già dentro",
  5: "5 · Mi serve solo ripassare",
};

export function examFormView(exam) {
  const isNew = !exam;
  const v = exam ?? { name: "", university: "", date: addDays(today(), 30), type: "scritto", level: 2, hoursPerDay: 3, sessionMinutes: 25, language: "italiano" };
  const f = {};
  const field = (key, label, input, hint) => {
    f[key] = input;
    return h("label", {}, label, input, hint ? h("span", { class: "hint" }, hint) : null);
  };
  const select = (opts, cur) => h("select", {}, Object.entries(opts).map(([k, t]) => h("option", { value: k, selected: String(k) === String(cur) }, t)));

  const form = h(
    "form",
    {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        const data = {
          name: f.name.value.trim(),
          university: f.university.value.trim(),
          date: f.date.value,
          type: f.type.value,
          level: Number(f.level.value),
          hoursPerDay: Math.min(12, Math.max(0.5, Number(f.hours.value) || 2)),
          sessionMinutes: Number(f.session.value),
          language: f.language.value.trim() || "italiano",
        };
        if (!data.name) return toast("Dai un nome all'esame.", "error");
        if (!data.date || data.date <= today()) return toast("La data d'esame deve essere futura.", "error");
        if (isNew) {
          const created = store.newExam(data);
          location.hash = `#/exam/${created.id}/materials`;
        } else {
          Object.assign(exam, data);
          exam.plan = null; // il piano dipende da data, tipo e ore
          store.save();
          location.hash = `#/exam/${exam.id}`;
        }
      },
    },
    h("h1", {}, isNew ? "Nuovo esame" : "Modifica esame"),
    field("name", "Nome dell'esame", h("input", { required: true, value: v.name, placeholder: "es. Microeconomia" })),
    field("university", "Università / corso (facoltativo)", h("input", { value: v.university, placeholder: "es. Università di Bologna — Economia" }), "Aiuta l'AI a trovare materiale pertinente al tuo programma."),
    h("div", { class: "cols" },
      field("date", "Data dell'esame", h("input", { type: "date", required: true, value: v.date, min: addDays(today(), 1) })),
      field("type", "Tipo di prova", select(EXAM_TYPES, v.type), "Cambia il mix di metodi: all'orale conta spiegare, al test riconoscere."),
    ),
    field("level", "Quanto conosci già la materia?", select(LEVELS, v.level), "Non c'è una risposta giusta: serve per dosare spiegazioni e difficoltà."),
    h("div", { class: "cols" },
      field("hours", "Ore di studio al giorno", h("input", { type: "number", min: 0.5, max: 12, step: 0.5, value: v.hoursPerDay })),
      field("session", "Durata di un blocco di studio", select({ 25: "25 min", 45: "45 min", 60: "60 min", 90: "90 min" }, v.sessionMinutes), sessionAdvice(v.sessionMinutes)),
    ),
    field("language", "Lingua del materiale", h("input", { value: v.language })),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, isNew ? "Continua: aggiungi i materiali" : "Salva"), h("a", { class: "btn ghost", href: isNew ? "#/" : `#/exam/${exam.id}` }, "Annulla")),
  );
  if (!isNew)
    form.append(
      h("hr", { style: { width: "100%", border: 0, borderTop: "1px solid var(--line)" } }),
      h("button", {
        class: "btn danger", type: "button", onclick: async () => {
          if (!confirm(`Eliminare «${exam.name}» con tutti i materiali e i progressi?`)) return;
          await store.deleteExam(exam.id);
          location.hash = "#/";
        },
      }, "Elimina esame"),
    );
  return form;
}
