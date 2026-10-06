// Data, tipo di prova e note di un esame: nell'intestazione della sua pagina e nel passo 2 del primo esame.
import { daysLeft } from "../domain.js";
import { fmtDate, today } from "../dates.js";
import { EXAM_TYPES } from "../methods.js";
import { studyStart, windowDays } from "../workload.js";
import { badge, h } from "../ui.js";

export function examMeta(exam) {
  const dl = daysLeft(exam);
  const apHere = exam.appelli?.find((a) => a.date === exam.date);
  const others = (exam.appelli ?? []).filter((a) => a.date !== exam.date && a.date >= today());
  const tone = dl >= 0 && dl <= 3 ? "bad" : dl >= 0 && dl <= 10 ? "warn" : "";
  return [
    h("div", { class: "row hub-meta" },
      h("span", { class: "muted" }, `${fmtDate(exam.date)}${exam.dateTentative ? " (data provvisoria)" : ""}${apHere?.time ? ` ore ${apHere.time}` : ""}${apHere?.room ? ` · ${apHere.room}` : ""} · ${EXAM_TYPES[exam.type]}${exam.cfu ? ` · ${exam.cfu} CFU` : ""}`,
        exam.formatSource?.url ? h("span", {}, " (", h("a", { href: exam.formatSource.url, target: "_blank", rel: "noopener noreferrer" }, "fonte del formato"), ")") : null),
      badge(dl > 0 ? `tra ${exam.dateTentative ? "circa " : ""}${dl} giorni` : dl === 0 ? "oggi" : "già passato", tone)),
    exam.dateTentative ? h("div", { class: "muted small" }, "Gli appelli non sono ancora usciti: quando escono ", h("a", { href: "#/import" }, "importali"), " (o cambia la data da «Modifica») e il piano si ricalcola.") : null,
    exam.studyDays ? h("div", { class: "muted small" }, `Studio ${studyStart(exam, today()) > today() ? `dal ${fmtDate(studyStart(exam, today()))}` : "in corso"}: ${windowDays(exam, today())} giorni prima dell'esame, ${exam.hoursPerDay} h al giorno.`) : null,
    others.length ? h("div", { class: "muted small" }, `Altri appelli: ${others.map((a) => fmtDate(a.date)).join(", ")} (cambia da «Modifica»)`) : null,
    exam.university ? h("div", { class: "muted small" }, [exam.university, exam.degree, exam.year ? `${exam.year}° anno` : ""].filter(Boolean).join(" · ")) : null,
  ];
}
