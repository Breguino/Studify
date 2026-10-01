// Stato condiviso tra le viste (evita import circolari con app.js).
export const core = {
  ai: { ai: false, offline: true },
  rerender: () => {},
};
