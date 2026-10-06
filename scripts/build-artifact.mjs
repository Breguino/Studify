// Costruisce la versione di Studify pubblicabile come pagina Claude: dist/studify.html (un solo file).
// Con --harness crea anche dist/harness.html: la stessa pagina con un `window.claude` finto in memoria,
// per provarla in un browser normale (non è un artefatto da pubblicare).
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const out = await build({
  stdin: { contents: entries.map((e) => `import ${JSON.stringify(e)};`).join("\n"), resolveDir: ROOT },
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  write: false,
  plugins: [swap],
  legalComments: "none",
  define: { __SUPABASE_URL__: JSON.stringify(SUPABASE_URL), __SUPABASE_KEY__: JSON.stringify(SUPABASE_KEY) },
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
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
const body = tpl.replace("/*CSS*/", () => css).replace("/*JS*/", () => js);

if (web) {
  const OUT = join(ROOT, "dist-web");
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "index.html"), body);
  // pagine legali: autonome, stesso stile essenziale
  for (const page of ["termini.html", "privacy.html"]) await writeFile(join(OUT, page), (await readFile(join(ROOT, "web", page), "utf8")).replace("/*FONT*/", () => figtreeCss));
  console.log("dist-web/index.html", (body.length / 1024).toFixed(0), "KB");
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
