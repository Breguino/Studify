// Pagina Claude e versione web: KaTeX dal bundle, caricato alla prima formula (nella versione web è un file a parte).
// Il CSS, con i font in base64, è nello <style> della pagina: vedi la build.
export const loadKatex = async () => (await import("katex")).default;
