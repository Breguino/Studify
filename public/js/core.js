// Stato condiviso tra le viste (evita import circolari con app.js).
export const core = {
  // ai: AI disponibile · web: ricerca web disponibile · pdf: lettura PDF · label: nome mostrato nell'intestazione
  ai: { ai: false, offline: true, web: true, pdf: true },
  demoModule: null, // modulo demo incorporato (solo nella pagina Claude)
  pdfText: null, // pagina Claude: (file) => testo del PDF (altrimenti i PDF vanno al server)
  pdfImages: null, // pagina Claude: (file) => {images} pagine come immagini (PDF scansionati)
  downloads: null, // funzione di salvataggio file (solo nella pagina Claude)
  credit: null, // versione web: () => Promise<{ spent, limit }>, credito di Claude del mese (public/js/credit.js)
  creditChanged: null, // versione web: da chiamare dopo una richiesta a Claude (il consumo è cambiato)
  rerender: () => {},
  onRender: new Set(), // funzioni chiamate dopo ogni disegno di pagina (es. togliere ascoltatori delle sessioni lasciate)
};
