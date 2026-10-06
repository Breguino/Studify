// Figtree variabile incorporato in base64 (come nell'app): la pagina pubblicata non chiede niente a Google Fonts.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const file = require.resolve("@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2");
const data = readFileSync(file).toString("base64");
writeFileSync(new URL("../src/figtree.css", import.meta.url),
  `@font-face { font-family: "Figtree Variable"; font-style: normal; font-display: swap; font-weight: 300 900;\n  src: url(data:font/woff2;base64,${data}) format("woff2"); }\n`);
console.log(`src/figtree.css: ${Math.round(data.length / 1024)} KB`);
