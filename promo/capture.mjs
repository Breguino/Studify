// Video promo, passo 1: le schermate vere dell'app, a misura di telefono, e le posizioni dei pulsanti da toccare.
// Avvia il server con l'AI simulata (come `npm run demo`), crea l'esame demo e salva tutto in promo/img/ (fuori dal repository).
// Servono Playwright con Chromium: non sono dipendenze del progetto. Uso: `npm run promo`.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const IMG = join(HERE, "img");
const PORT = process.env.PROMO_PORT ?? "3131";
const BASE = `http://localhost:${PORT}`;
const BAR = 65; // altezza della barra in alto dell'app, in punti (uguale in promo.html)
mkdirSync(IMG, { recursive: true });

const server = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, STUDIFY_MOCK: "1", PORT }, stdio: "ignore" });
const browser = await chromium.launch();
try {
  for (let i = 0; ; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break;
    if (i > 60) throw new Error(`il server non risponde su ${BASE}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 3, colorScheme: "light", reducedMotion: "reduce", locale: "it-IT" });
  const p = await ctx.newPage();
  // l'etichetta «AI: demo» è del server di prova; i tasti suggeriti («spazio», «Invio») sono per la tastiera del computer
  await p.addInitScript(() => addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: ".pill,.kbd{display:none!important}" }))));
  const meta = {};
  const shot = async (name, opts = {}) => { await p.waitForTimeout(450); await p.screenshot({ path: join(IMG, `${name}.png`), ...opts }); };
  /** Pagina intera, tagliata a `height` punti: basta per lo scorrimento del video. */
  const page = (name, height) => shot(name, { fullPage: true, clip: { x: 0, y: 0, width: 390, height } });
  const center = async (name, loc) => { const r = await loc.boundingBox(); meta[name] = { x: r.x + r.width / 2, y: r.y + r.height / 2 + (await p.evaluate(() => scrollY)) }; };
  const go = async (hash) => { await p.goto(`${BASE}/#${hash}`); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(400); };

  await p.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Prova con l'esame demo" }).click();
  await p.waitForURL(/#\/exam\//);
  const id = p.url().match(/#\/exam\/([^/]+)/)[1];
  await p.waitForTimeout(800);
  // nome dell'esame senza «(demo)»: il contenuto resta quello dell'esame demo dell'app
  await p.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open("studify");
    r.onsuccess = () => {
      const t = r.result.transaction("kv", "readwrite");
      const s = t.objectStore("kv");
      const g = s.get("state");
      g.onsuccess = () => { g.result.exams[0].name = "Microeconomia"; s.put(g.result, "state"); };
      t.oncomplete = res;
      t.onerror = rej;
    };
  }));

  await go("/");
  await page("home", 1000);
  await shot("header", { clip: { x: 0, y: 0, width: 390, height: BAR } });
  await go(`/exam/${id}/materials`);
  await center("pickFiles", p.getByText("Scegli i file", { exact: true }));
  await page("materials", 900);
  await go(`/exam/${id}/module`);
  meta.moduleTopicY = await p.evaluate(() => { const e = [...document.querySelectorAll("main h2, main h3")].find((x) => /Domanda, offerta ed equilibrio/.test(x.textContent)); return e.getBoundingClientRect().top + scrollY; });
  await page("module", Math.ceil(meta.moduleTopicY) + 1350);

  // flashcard: domanda → risposta → voto → carta dopo
  await go(`/exam/${id}/flash`);
  await shot("flash-a");
  const show = p.getByRole("button", { name: /Mostra risposta/ });
  await center("flashShow", show);
  await show.click();
  await shot("flash-b");
  const good = p.getByRole("button", { name: /^Bene/ });
  await center("flashGood", good);
  await good.click();
  await shot("flash-c");

  // quiz: la prima domanda a scelta multipla, con la risposta giusta letta dall'esame demo
  // (l'ordine delle domande è casuale: si ricarica finché la prima ha le alternative)
  const demo = JSON.parse(readFileSync(join(ROOT, "public/demo/module.json"), "utf8"));
  let q = null;
  for (let i = 0; i < 12 && !q; i++) {
    await go(`/exam/${id}/quiz`);
    const text = await p.locator("main").innerText();
    if (await p.locator(".option").count()) q = demo.questions.find((x) => x.options && text.includes(x.prompt.slice(0, 40)));
  }
  if (!q) throw new Error("nessuna domanda a scelta multipla in cima al quiz dopo 12 tentativi");
  await shot("quiz-a");
  const right = p.locator(".option", { hasText: q.options[q.correctIndex] }).first();
  await center("quizRight", right);
  await right.click();
  await p.waitForTimeout(300);
  meta.quizVerdictY = await p.evaluate(() => document.querySelector(".q-why").getBoundingClientRect().top + scrollY);
  await page("quiz-c", Math.ceil(meta.quizVerdictY) + 500);

  writeFileSync(join(IMG, "meta.js"), `window.META = ${JSON.stringify(meta, null, 1)};\n`);
  console.log("schermate in promo/img/:", JSON.stringify(meta));
} finally {
  await browser.close();
  server.kill();
}
