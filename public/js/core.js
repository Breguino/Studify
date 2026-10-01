// Stato condiviso tra le viste (evita import circolari con app.js).
export const core = {
  // ai: AI disponibile · web: ricerca web disponibile · pdf: lettura PDF · label: nome mostrato nell'intestazione
  ai: { ai: false, offline: true, web: true, pdf: true },
  demoModule: null, // modulo demo incorporato (solo nella pagina Claude)
  pdfText: null, // pagina Claude: (file) => testo del PDF (altrimenti i PDF vanno al server)
  pdfImages: null, // pagina Claude: (file) => {images} pagine come immagini (PDF scansionati)
  downloads: null, // funzione di salvataggio file (solo nella pagina Claude)
  rerender: () => {},
};
