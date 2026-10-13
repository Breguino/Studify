// File dell'utente (PDF, foto): restano solo nel browser dove sono stati caricati (nella pagina Claude, solo finché resta
// aperta). Gli esami invece si sincronizzano: su un altro dispositivo un materiale c'è, ma il suo file no. Testi puri, testati.

/** Che cosa dire quando serve un file che in questo browser non c'è. */
export const missingFileMessage = (title) =>
  `«${title || "Questo file"}» non è in questo browser: PDF e foto restano solo dove li hai caricati. ` +
  "Continua dal dispositivo dove l'hai aggiunto, oppure caricalo di nuovo qui con «Carica di nuovo» nei materiali.";

export class MissingFileError extends Error {
  constructor(title) {
    super(missingFileMessage(title));
    this.name = "MissingFileError";
  }
}

/** Il file da cercare nel browser per un materiale (oggi solo i PDF), o null. */
export const fileIdOf = (m) => (m?.kind === "pdf" && m.fileId ? m.fileId : null);
