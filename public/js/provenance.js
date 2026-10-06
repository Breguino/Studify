// Da quale materiale viene una frase o un esercizio che l'AI ha copiato: serve a dire «al tutorato» invece di «il docente».
// Il tutor (spesso un dottorando o uno studente più avanti) non è chi fa l'esame: le sue frasi sull'esame e il suo procedimento
// valgono come indicazione, non come parola del docente.

const flat = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'").replace(/[“”«»"]/g, "").replace(/\s+/g, " ").trim();
const words = (s) => flat(s).replace(/\\[a-z]+/g, " ").match(/[a-z]{5,}/g) ?? [];

/** Materiali preparati dal tutor (segnati a mano o dal nome del file). */
export const tutorMaterials = (exam) => (exam.materials ?? []).filter((m) => m.tutor && m.text);

/** La frase compare in un materiale del tutor? (per le frasi sull'esame: copiate alla lettera) */
export function saidByTutor(exam, quote) {
  const q = flat(quote).slice(0, 60);
  if (q.length < 8) return null;
  return tutorMaterials(exam).find((m) => flat(m.text).includes(q)) ?? null;
}

/** L'esercizio svolto di un metodo viene da un materiale del tutor? (la maggior parte delle sue parole è lì) */
export function methodByTutor(exam, method) {
  const w = words(`${method?.problem ?? ""} ${method?.solution ?? ""}`);
  if (w.length < 4) return null;
  return tutorMaterials(exam).find((m) => { const hay = new Set(words(m.text)); return w.filter((x) => hay.has(x)).length / w.length >= 0.7; }) ?? null;
}
