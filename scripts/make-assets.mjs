// Genera le immagini statiche della versione web in web/assets/: anteprima per i social (og.png, 1200×630),
// icone (favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png).
// Da rilanciare solo se cambiano marchio o colori. Serve Playwright con Chromium (non è una dipendenza del progetto):
//   node scripts/make-assets.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "web/assets");
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = createRequire("/opt/node22/lib/node_modules/")("playwright");
}

// Marchio: quadrato indaco con il triangolo (lo stesso della favicon in data URI)
const MARK = (size, radius = 8) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><rect width="32" height="32" rx="${radius}" fill="#4338ca"/><path d="M9 21l7-12 7 12z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>`;

const font = (await readFile(join(ROOT, "node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2"))).toString("base64");
const FONT_CSS = `@font-face{font-family:Figtree;font-weight:300 900;src:url(data:font/woff2;base64,${font}) format("woff2")}`;

const OG = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;font-family:Figtree,sans-serif;background:#f4f5f9;color:#171a23;display:flex;overflow:hidden}
.l{flex:1.15;padding:0 0 0 80px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:14px;font-size:34px;font-weight:800;letter-spacing:-.02em}
h1{font-size:64px;line-height:1.04;letter-spacing:-.035em;font-weight:800;margin:44px 0 22px}
p{font-size:27px;line-height:1.4;color:#5b6275;margin:0;max-width:560px}
.r{flex:1;position:relative;padding:0 64px 0 8px;display:flex;flex-direction:column;justify-content:center}
.glow{position:absolute;inset:40px 0 0 -40px;background:radial-gradient(60% 55% at 60% 40%,#e3e5ff,transparent 70%)}
.card{position:relative;background:#fff;border:1px solid #e2e5ee;border-radius:24px;padding:28px;box-shadow:0 2px 4px rgba(20,24,40,.05),0 12px 32px rgba(20,24,40,.08)}
.row{display:flex;justify-content:space-between;align-items:center}
.t{font-size:32px;font-weight:800;letter-spacing:-.01em}.b{font-size:18px;font-weight:700;padding:5px 14px;border-radius:999px}
.m{font-size:19px;color:#5b6275;margin:10px 0 18px}.bar{height:12px;border-radius:999px;background:#eef0f5;margin-top:10px}.bar i{display:block;width:42%;height:12px;border-radius:999px;background:#4338ca}
.q{margin:22px 0 0 40px}.o{font-size:20px;border:2px solid #15803d;background:#e8f6ee;color:#14532d;border-radius:16px;padding:14px 18px;font-weight:600}
</style></head><body>
<div class="l"><div class="brand">${MARK(48, 9)}Studify</div>
<h1>Prepara gli esami con i tuoi materiali.</h1>
<p>Appunti, dispense ed esami passati diventano flashcard, quiz e un piano fino all'appello.</p></div>
<div class="r"><div class="glow"></div>
<div class="card"><div class="row"><span class="t">Microeconomia</span><span class="b" style="background:#fef3e2;color:#92400e">tra 21 g</span></div>
<div class="m">Scritto + orale · Preparazione 42%</div><div class="bar"><i></i></div></div>
<div class="card q"><div class="m" style="margin-top:0;color:#171a23;font-weight:700">Il monopolista massimizza il profitto dove:</div><div class="o">B. il ricavo marginale è uguale al costo marginale</div></div>
</div></body></html>`;

/** ICO con un'immagine PNG dentro (formato accettato da tutti i browser moderni). */
function ico(png, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // riservato
  head.writeUInt16LE(1, 2); // tipo: icona
  head.writeUInt16LE(1, 4); // una immagine
  head.writeUInt8(size, 6);
  head.writeUInt8(size, 7);
  head.writeUInt8(0, 8); // tavolozza
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); // piani
  head.writeUInt16LE(32, 12); // bit per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // posizione dei dati
  return Buffer.concat([head, png]);
}

await mkdir(OUT, { recursive: true });
const browser = await playwright.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(OG, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await writeFile(join(OUT, "og.png"), await page.screenshot({ type: "png" }));

const shot = async (size, { padded = false } = {}) => {
  // apple-touch e icone del manifest: niente angoli trasparenti (iOS e Android li riempiono di nero)
  const svg = padded
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><rect width="32" height="32" fill="#4338ca"/><path d="M9 21l7-12 7 12z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>`
    : MARK(size);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
const png32 = await shot(32);
await writeFile(join(OUT, "favicon-32.png"), png32);
await writeFile(join(OUT, "favicon.ico"), ico(png32, 32));
await writeFile(join(OUT, "apple-touch-icon.png"), await shot(180, { padded: true }));
await writeFile(join(OUT, "icon-192.png"), await shot(192, { padded: true }));
await writeFile(join(OUT, "icon-512.png"), await shot(512, { padded: true }));
await writeFile(join(OUT, "favicon.svg"), MARK(32));
await browser.close();
console.log("web/assets: og.png, favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png");
