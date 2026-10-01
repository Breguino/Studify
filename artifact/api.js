// Sostituisce public/js/api.js nella versione pubblicata come pagina Claude: stessa interfaccia,
// ma le chiamate vanno a Claude (capability `sample`) invece che al server.
import { examFormatFromText, extendModule, transcribePages, generateModule, generateNotes, getSample, gradeAnswer, importRows, parseCurriculum } from "./generate.js";

export async function status() {
  const sample = await getSample();
  return sample
    ? { ai: true, label: "Claude", model: "Claude (tuo account)", web: false, pdf: false, artifact: true }
    : { ai: false, label: "Modalità base", web: false, pdf: false, artifact: true };
}

export async function runJob(path, body, onProgress = () => {}) {
  if (path === "/api/module") return generateModule(body, onProgress);
  if (path === "/api/module-extend") return extendModule(body, onProgress);
  if (path === "/api/exam-format-text") return examFormatFromText(body, onProgress);
  if (path === "/api/transcribe") return transcribePages(body, onProgress);
  if (path === "/api/research") return generateNotes(body, onProgress);
  if (path === "/api/parse-curriculum") return parseCurriculum(body, onProgress);
  if (path === "/api/import-rows") return importRows(body, onProgress);
  throw new Error("Funzione non disponibile in questa versione.");
}

export const grade = (body) => gradeAnswer(body);
