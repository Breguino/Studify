// Costruisce la versione di Studify pubblicabile come pagina Claude: dist/studify.html (un solo file).
// Con --harness crea anche dist/harness.html: la stessa pagina con un `window.claude` finto in memoria,
// per provarla in un browser normale (non è un artefatto da pubblicare).
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harness = process.argv.includes("--harness");
// --web: versione per Vercel (dist-web/), con accesso e dati su Supabase; Claude tramite /api/claude.
const web = process.argv.includes("--web");
const SUPABASE_URL = process.env.STUDIFY_SUPABASE_URL || "https://ujkyjbgfrzmhowqgkyrg.supabase.co";
const SUPABASE_KEY = process.env.STUDIFY_SUPABASE_KEY || "sb_publishable_ro1LPfAb3vpvZZsWiePxAg_TmHDYLzg"; // chiave pubblica: i dati li protegge RLS

// Nella versione pagina Claude i moduli api.js e backend.js della cartella public/js vengono sostituiti.
const swap = {
  name: "swap-platform-modules",
  setup(b) {
    b.onResolve({ filter: /(^|\/)(api|backend|pdf-text|pdf-pages|math-lib)\.js$/ }, (args) => {
      if (!args.importer.includes("/public/js/")) return null;
      const name = args.path.split("/").pop();
      return { path: join(ROOT, web && name === "backend.js" ? "web" : "artifact", name) };
    });
  },
};

const entries = web ? [join(ROOT, "web/entry.js")] : harness ? [join(ROOT, "artifact/fake-claude.js"), join(ROOT, "artifact/entry.js")] : [join(ROOT, "artifact/entry.js")];
const common = {
  bundle: true,
  minify: true,
  target: "es2020",
  plugins: [swap],
  legalComments: "none",
  define: { __SUPABASE_URL__: JSON.stringify(SUPABASE_URL), __SUPABASE_KEY__: JSON.stringify(SUPABASE_KEY) },
};
let js = "";
let webEntry = "";
if (web) {
  // Versione web: moduli ES divisi in file con l'hash nel nome (cache lunga). pdf.js e KaTeX si scaricano solo quando servono.
  const JS_DIR = join(ROOT, "dist-web/js");
  await rm(JS_DIR, { recursive: true, force: true });
  const res = await build({ ...common, entryPoints: { app: entries[0] }, format: "esm", splitting: true, outdir: JS_DIR, entryNames: "[name]-[hash]", chunkNames: "c-[hash]", metafile: true });
  webEntry = `/js/${Object.entries(res.metafile.outputs).find(([, o]) => o.entryPoint).at(0).split("/").pop()}`;
} else {
  const out = await build({ ...common, stdin: { contents: entries.map((e) => `import ${JSON.stringify(e)};`).join("\n"), resolveDir: ROOT }, format: "iife", write: false });
  js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}
// CSS di KaTeX con i font WOFF2 incorporati (la pagina non può caricare font o fogli di stile esterni).
const KATEX = join(ROOT, "node_modules/katex/dist");
let katexCss = await readFile(join(KATEX, "katex.min.css"), "utf8");
katexCss = katexCss.replace(/src:url\(fonts\/([^)]+)\.woff2\) format\("woff2"\)(?:,url\([^)]+\) format\("[^"]+"\))*/g, (_, f) => `src:url(data:font/woff2;base64,${readFileSync(join(KATEX, "fonts", `${f}.woff2`)).toString("base64")}) format("woff2")`);
if (/url\(fonts\//.test(katexCss)) throw new Error("CSS di KaTeX: font non incorporati (formato cambiato?)");
// Figtree (carattere dell'interfaccia) incorporato: niente Google Fonts, che riceverebbe l'IP di chi visita.
const FIG = join(ROOT, "node_modules/@fontsource-variable/figtree/files");
const font = (file, range) => `@font-face{font-family:"Figtree Variable";font-style:normal;font-display:swap;font-weight:300 900;src:url(data:font/woff2;base64,${readFileSync(join(FIG, file)).toString("base64")}) format("woff2-variations");unicode-range:${range}}`;
const figtreeCss = font("figtree-latin-ext-wght-normal.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF")
  + font("figtree-latin-wght-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD");
const webCss = web ? `\n${await readFile(join(ROOT, "web/web.css"), "utf8")}` : "";
const css = `${figtreeCss}\n${await readFile(join(ROOT, "public/styles.css"), "utf8")}${webCss}\n${katexCss}`;
const tpl = await readFile(join(ROOT, web ? "web/template.html" : "artifact/template.html"), "utf8");
const body = web
  ? tpl.replace("/*CSS*/", () => css).replace(/<script>\s*\/\*JS\*\/\s*<\/script>/, () => `<script type="module" src="${webEntry}"></script>`)
  : tpl.replace("/*CSS*/", () => css).replace("/*JS*/", () => js);

if (web) {
  const OUT = join(ROOT, "dist-web");
  await mkdir(OUT, { recursive: true });
  // indirizzo pubblico per anteprime social, sitemap e canonical (Vercel lo fornisce durante la build)
  const SITE = (process.env.STUDIFY_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://studify-beta-dun.vercel.app")).replace(/\/$/, "");
  // Statistiche di visita: Vercel Web Analytics (senza cookie, script dallo stesso dominio). Solo nelle build su Vercel;
  // STUDIFY_ANALYTICS=off le spegne, STUDIFY_ANALYTICS=/percorso/script.js usa il percorso mostrato nella dashboard.
  const A = process.env.STUDIFY_ANALYTICS ?? (process.env.VERCEL ? "/_vercel/insights/script.js" : "off");
  const analytics = A === "off" ? [] : [
    "<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>",
    `<script defer src="${A}"></script>`,
  ];
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const head = ({ path, title, description }) => [
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    `<link rel="canonical" href="${SITE}${path}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="it_IT">',
    '<meta property="og:site_name" content="Studify">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${SITE}${path}">`,
    `<meta property="og:image" content="${SITE}/og.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Studify: prepara gli esami con i tuoi materiali. Una scheda d\'esame con la preparazione al 42% e una domanda di quiz.">',
    '<meta name="twitter:card" content="summary_large_image">',
    ...analytics,
  ].join("\n");
  const PAGES = {
    "/": { title: "Studify — prepara gli esami con i tuoi materiali", description: "Appunti, dispense, slide, esami passati e quiz del docente diventano argomenti, flashcard, quiz e un piano di studio fino all'appello. Gratis, nel browser." },
    "/app": { title: "Studify — i tuoi esami", description: "Accedi a Studify per studiare con i tuoi materiali del corso." },
    "/termini.html": { title: "Termini e condizioni — Studify", description: "Termini e condizioni d'uso di Studify." },
    "/privacy.html": { title: "Informativa privacy — Studify", description: "Informativa privacy di Studify (art. 13 GDPR)." },
  };
  const withHead = (html, path) => html.replace("<!--HEAD-->", () => head({ path, ...PAGES[path] }));
  // immagini statiche (scripts/make-assets.mjs) e file per i motori di ricerca
  for (const f of ["og.png", "favicon.svg", "favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"]) await writeFile(join(OUT, f), readFileSync(join(ROOT, "web/assets", f)));
  await writeFile(join(OUT, "site.webmanifest"), JSON.stringify({ name: "Studify", short_name: "Studify", lang: "it", start_url: "/app", display: "standalone", background_color: "#f4f5f9", theme_color: "#4338ca", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }] }, null, 2));
  await writeFile(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", "/termini.html", "/privacy.html"].map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(join(OUT, "app.html"), withHead(body, "/app")); // servita su /app (vercel.json)
  // landing su /: statica e leggera (niente JS dell'app né KaTeX), con i token e le classi di styles.css
  const landingCss = `${figtreeCss}\n${await readFile(join(ROOT, "public/styles.css"), "utf8")}\n${await readFile(join(ROOT, "web/web.css"), "utf8")}\n${await readFile(join(ROOT, "web/landing.css"), "utf8")}`;
  const landing = (await readFile(join(ROOT, "web/landing.html"), "utf8")).replace("/*CSS*/", () => landingCss);
  await writeFile(join(OUT, "index.html"), withHead(landing, "/"));
  // pagine legali: autonome, stesso stile essenziale
  for (const page of ["termini.html", "privacy.html"]) await writeFile(join(OUT, page), withHead((await readFile(join(ROOT, "web", page), "utf8")).replace("/*FONT*/", () => figtreeCss), `/${page}`));
  console.log("dist-web/app.html", (body.length / 1024).toFixed(0), "KB · index.html (landing)", (landing.length / 1024).toFixed(0), "KB");
  process.exit(0);
}
await mkdir(join(ROOT, "dist"), { recursive: true });
if (harness) {
  await writeFile(join(ROOT, "dist/harness.html"), `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`);
  console.log("dist/harness.html", (body.length / 1024).toFixed(0), "KB");
} else {
  await writeFile(join(ROOT, "dist/studify.html"), body);
  console.log("dist/studify.html", (body.length / 1024).toFixed(0), "KB");
}
