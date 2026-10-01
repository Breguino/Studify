// Costruisce la versione di Studify pubblicabile come pagina Claude: dist/studify.html (un solo file).
// Con --harness crea anche dist/harness.html: la stessa pagina con un `window.claude` finto in memoria,
// per provarla in un browser normale (non è un artefatto da pubblicare).
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harness = process.argv.includes("--harness");

// Nella versione pagina Claude i moduli api.js e backend.js della cartella public/js vengono sostituiti.
const swap = {
  name: "swap-platform-modules",
  setup(b) {
    b.onResolve({ filter: /(^|\/)(api|backend|pdf-text|pdf-pages)\.js$/ }, (args) => {
      if (!args.importer.includes("/public/js/")) return null;
      return { path: join(ROOT, "artifact", args.path.split("/").pop()) };
    });
  },
};

const entries = harness ? [join(ROOT, "artifact/fake-claude.js"), join(ROOT, "artifact/entry.js")] : [join(ROOT, "artifact/entry.js")];
const out = await build({
  stdin: { contents: entries.map((e) => `import ${JSON.stringify(e)};`).join("\n"), resolveDir: ROOT },
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  write: false,
  plugins: [swap],
  legalComments: "none",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile(join(ROOT, "public/styles.css"), "utf8");
const tpl = await readFile(join(ROOT, "artifact/template.html"), "utf8");
const body = tpl.replace("/*CSS*/", () => css).replace("/*JS*/", () => js);

await mkdir(join(ROOT, "dist"), { recursive: true });
if (harness) {
  await writeFile(join(ROOT, "dist/harness.html"), `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`);
  console.log("dist/harness.html", (body.length / 1024).toFixed(0), "KB");
} else {
  await writeFile(join(ROOT, "dist/studify.html"), body);
  console.log("dist/studify.html", (body.length / 1024).toFixed(0), "KB");
}
