// Video promo, passo 2: disegna ogni fotogramma di promo.html con render(t) e lo passa a ffmpeg.
// Esce un MP4 H.264 1080×1920 a 30 fotogrammi al secondo, con una traccia audio muta (la musica si aggiunge nell'app,
// dove i brani hanno la licenza), più la copertina. Servono Playwright e ffmpeg: non sono dipendenze del progetto.
// Uso: `node promo/render.mjs` (i tre agganci) oppure `node promo/render.mjs b`. I file vanno in promo/out/.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const FPS = 30;
const hooks = process.argv.slice(2).length ? process.argv.slice(2) : ["a", "b", "c"];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const hook of hooks) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${pathToFileURL(join(HERE, "promo.html"))}?hook=${hook}`);
    await page.evaluate(() => window.ready);
    await page.waitForTimeout(300);
    if (errors.length) throw new Error(`promo.html: ${errors.join("; ")} (manca promo/img/? lancia prima promo/capture.mjs)`);
    const frames = Math.round((await page.evaluate(() => window.DURATION)) * FPS);
    const file = join(OUT, `studify-promo-${hook}.mp4`);
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg è uscito con ${code}`)))));
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => window.render(t), i / FPS);
      const png = await page.screenshot({ type: "png" });
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
    await page.close();
    // copertina: l'aggancio completo, a 1,9 secondi
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1.9", "-i", file, "-frames:v", "1", join(OUT, `studify-promo-${hook}-copertina.png`)]);
    console.log("fatto", file);
  }
} finally {
  await browser.close();
}
