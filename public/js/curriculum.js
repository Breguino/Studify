// Piano di studi dell'utente (inserito a mano o trovato dall'AI) e abbinamento con gli esami.
import { EXAM_TYPES } from "./methods.js";

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(demo\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Trova l'insegnamento che corrisponde al nome digitato (esatto, oppure uno contenuto nell'altro con ≥ 6 caratteri). */
export function findCourse(courses, name) {
  const n = norm(name ?? "");
  if (!n) return null;
  const exact = courses.find((c) => norm(c.name) === n);
  if (exact) return exact;
  if (n.length < 6) return null;
  const partial = courses.filter((c) => {
    const m = norm(c.name);
    return m.length >= 6 && (m.includes(n) || n.includes(m));
  });
  return partial.length === 1 ? partial[0] : null; // se è ambiguo meglio non scegliere
}

export const FORMAT_LABEL = { ...EXAM_TYPES, sconosciuto: "Non indicato" };

/** Dal piano di studi allo spunto per il form dell'esame. */
export function examDefaultsFromCourse(course) {
  if (!course) return null;
  return {
    cfu: course.cfu || 0,
    type: course.format && course.format !== "sconosciuto" ? course.format : null,
    evidence: course.formatEvidence || "",
    url: course.url || "",
  };
}
