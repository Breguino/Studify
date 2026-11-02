// File dell'utente (PDF, foto): restano nel browser dove sono stati caricati (nella pagina Claude, solo finché resta
// aperta; nella versione web con un piano a pagamento anche online, web/files.js). Gli esami invece si sincronizzano:
// su un altro dispositivo un materiale c'è, ma il suo file può mancare. Testi puri, testati.

/** Che cosa dire quando serve un file che in questo browser non c'è. */
export const missingFileMessage = (title) =>
  `«${title || "Questo file"}» non è in questo browser: PDF e foto restano solo dove li hai caricati. ` +
  "Continua dal dispositivo dove l'hai aggiunto, oppure caricalo di nuovo qui con «Carica di nuovo» nei materiali.";

export class MissingFileError extends Error {
  /** `message`: il testo della piattaforma, se ne ha uno suo (versione web con i file online). */
  constructor(title, message = null) {
    super(message || missingFileMessage(title));
    this.name = "MissingFileError";
  }
}

/** Il file da cercare nel browser per un materiale (oggi solo i PDF), o null. */
export const fileIdOf = (m) => (m?.kind === "pdf" && m.fileId ? m.fileId : null);
