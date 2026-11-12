// Video promo «con riprese»: persone vere in apertura e in chiusura, l'app al centro. Uso: `npm run promo:cinema`
// (prima serve `node promo/capture.mjs`, per le schermate dell'app in promo/img/).
//
// Le riprese sono clip di archivio di Mixkit con la «Mixkit Stock Video Free License», che permette post sui social e
// pubblicità senza attribuzione (https://mixkit.co/license/#videoFree). ATTENZIONE: su Mixkit molte clip hanno invece la
// «Restricted License», solo per uso personale: prima di aggiungerne una, controlla sulla sua pagina quale licenza ha.
// Le clip si scaricano in promo/stock/ e non entrano nel repository. Niente frasi messe in bocca alle persone riprese:
// sono comparse, non utenti di Studify.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const STOCK = join(HERE, "stock");
const OUT = join(HERE, "out");
const FPS = 24; // come le riprese
mkdirSync(STOCK, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Le riprese, nell'ordine del montaggio. `from`: secondo d'inizio nella clip; `frames`: durata nel video; `x`: da dove
// parte il ritaglio verticale (608 px su 1920); `slow`: rallentata (clip a 30 fotogrammi); `blur`: sfondo del telefono.
// I tagli che ne risultano (3 · 4,5 · 6 · 17,5 · 19,5 s) sono gli stessi di T in cinema.html.
const CUTS = [
  { id: 50128, page: "a-young-student-turns-the-page-of-a-book-and-50128", from: 1.4, frames: 72, x: 656 },   // lo studente sfoglia, stanco
  { id: 50111, page: "student-makes-a-note-over-wooden-desk-filled-with-mathematical-50111", from: 3.4, frames: 36, x: 656 }, // scrivania dall'alto
  { id: 50112, page: "student-hand-takes-a-stiky-note-to-paste-it-on-50112", from: 0.2, frames: 36, x: 656 },   // evidenziatori
  { id: 50126, page: "a-young-student-wearing-a-hoodie-hilight-texts-on-a-50126", from: 0.5, frames: 276, x: 656, blur: true }, // dietro il telefono
  { id: 50126, page: "a-young-student-wearing-a-hoodie-hilight-texts-on-a-50126", from: 3.8, frames: 48, x: 656 }, // lo studente al lavoro
  { id: 4519, page: "students-walking-in-a-university-4519", from: 1.0, frames: 108, x: 656, slow: 1.25 },        // verso l'università
];
const GRADE = "eq=contrast=1.06:saturation=0.9:brightness=0.03:gamma=1.06,colorbalance=rs=-0.04:bs=0.05:rh=0.03:bh=-0.04,unsharp=5:5:0.5,vignette=PI/6";

const run = (args) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" }); if (r.status !== 0) throw new Error("ffmpeg non è riuscito"); };

// 1 · le clip
for (const id of new Set(CUTS.map((c) => c.id))) {
  const file = join(STOCK, `${id}.mp4`);
  if (existsSync(file)) continue;
  const r = await fetch(`https://assets.mixkit.co/videos/${id}/${id}-1080.mp4`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`clip ${id}: Mixkit risponde ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log("scaricata", id);
}

// 2 · il montaggio delle riprese: ritaglio verticale, stessa resa di colore, grana leggera
const bg = join(OUT, "cinema-riprese.mp4");
const chains = CUTS.map((c, i) =>
  `[${i}:v]trim=start=${c.from},setpts=${c.slow ?? 1}*(PTS-STARTPTS),fps=${FPS},trim=end_frame=${c.frames},setpts=PTS-STARTPTS,` +
  `crop=608:1080:${c.x}:0,scale=1080:1920:flags=lanczos,${GRADE}${c.blur ? ",gblur=sigma=24,eq=brightness=-0.06" : ""},setsar=1[v${i}]`);
run([...CUTS.flatMap((c) => ["-i", join(STOCK, `${c.id}.mp4`)]),
  "-filter_complex", `${chains.join(";")};${CUTS.map((_, i) => `[v${i}]`).join("")}concat=n=${CUTS.length}:v=1:a=0,noise=alls=4:allf=t[v]`,
  "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", "-r", String(FPS), bg]);

// 3 · il livello grafico, fotogramma per fotogramma, sopra le riprese
const browser = await chromium.launch();
const file = join(OUT, "studify-promo-cinema.mp4");
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(String(pathToFileURL(join(HERE, "cinema.html"))));
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(300);
  if (errors.length) throw new Error(`cinema.html: ${errors.join("; ")} (manca promo/img/? lancia prima promo/capture.mjs)`);
  const frames = Math.round((await page.evaluate(() => window.DURATION)) * FPS);
  if (frames !== CUTS.reduce((n, c) => n + c.frames, 0)) throw new Error("la durata di cinema.html e quella delle riprese non coincidono");
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", bg,
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", "[0:v][1:v]overlay=format=auto:shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-level", "4.2",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg è uscito con ${code}`)))));
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    const png = await page.screenshot({ type: "png", omitBackground: true });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
} finally {
  await browser.close();
}
run(["-ss", "2.2", "-i", file, "-frames:v", "1", join(OUT, "studify-promo-cinema-copertina.png")]);
console.log("fatto", file);
