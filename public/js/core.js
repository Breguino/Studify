// Stato condiviso tra le viste (evita import circolari con app.js).
export const core = {
  // ai: AI disponibile · web: ricerca web disponibile · pdf: lettura PDF · label: nome mostrato nell'intestazione
  ai: { ai: false, offline: true, web: true, pdf: true },
  demoModule: null, // modulo demo incorporato (solo nella pagina Claude)
  downloads: null, // funzione di salvataggio file (solo nella pagina Claude)
  rerender: () => {},
};
