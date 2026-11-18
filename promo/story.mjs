// Video promo «storia» da circa un minuto, con voce narrante: Luca, uno studente inventato, prepara un esame con Studify.
// La voce (sintetica, Piper) decide i tempi: ogni frase si sintetizza a parte, se ne misura la durata, e da lì vengono
// i tagli delle riprese, i sottotitoli e le schermate dell'app nel telefono (promo/story.html).
//
// Uso: `npm run promo:story` (prima serve `node promo/capture.mjs`, per le schermate in promo/img/).
// Servono, oltre a Playwright e ffmpeg, Piper e una voce italiana, che non sono dipendenze del progetto:
//   python3 -m venv .piper && .piper/bin/pip install piper-tts
//   e la voce it_IT-paola-medium (.onnx e .onnx.json) da https://huggingface.co/rhasspy/piper-voices (it/it_IT/paola/medium).
// Percorsi: PIPER (predefinito: piper) e PIPER_MODEL (predefinito: promo/voice/it_IT-paola-medium.onnx).
// La voce Paola è addestrata su un insieme di registrazioni con licenza CC0. Le riprese sono le stesse clip di Mixkit
// (licenza gratuita che permette la pubblicità) di promo/cinema.mjs, quasi tutte dello stesso servizio fotografico:
// così il protagonista resta lo stesso ragazzo. Luca è un personaggio: niente voti né risultati promessi.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const STOCK = join(HERE, "stock");
const OUT = join(HERE, "out");
const VOICE = join(OUT, "story-voice");
const FPS = 24;
const PIPER = process.env.PIPER ?? "piper";
const MODEL = process.env.PIPER_MODEL ?? join(HERE, "voice", "it_IT-paola-medium.onnx");
mkdirSync(VOICE, { recursive: true });

// Il testo, una frase per riga. `pause`: silenzio dopo la frase (s); `scene`: la ripresa o la schermata che l'accompagna,
// che parte con la frase e dura fino alla scena successiva. `app`: la frase si vede con il telefono e la schermata indicata.
const LINES = [
  { text: "Questo è Luca.", scene: "luca" },
  { text: "Tra ventun giorni ha l'esame di Microeconomia.", pause: 0.9 },
  { text: "Ha il libro, le slide del corso e un quaderno pieno di appunti.", scene: "desk" },
  { text: "Per due giorni rilegge e sottolinea tutto.", scene: "pens" },
  { text: "E il giorno dopo, non ricorda quasi niente.", scene: "tired", pause: 0.8 },
  { text: "Il problema non è quanto studia. È come.", scene: "think", pause: 0.8 },
  { text: "Allora cambia metodo.", scene: "start", pause: 0.4 },
  { text: "Carica i suoi materiali su Studify.", scene: "app", app: "materials" },
  { text: "Ne escono gli argomenti, dal più importante, con flashcard e quiz fatti sui suoi appunti.", app: "module" },
  { text: "E un piano, giorno per giorno: ogni giorno sa cosa studiare, e per quanto.", app: "home" },
  { text: "Ripassa le flashcard proprio quando sta per dimenticarle.", app: "flash" },
  { text: "Con i quiz scopre dove sbaglia, e perché.", app: "quiz", pause: 0.9 },
  { text: "L'ultima settimana si mette alla prova con gli esami degli anni passati, a tempo.", scene: "focus", pause: 0.8 },
  { text: "Il giorno dell'esame, non rilegge più niente.", scene: "campus" },
  { text: "Sa cosa sa.", pause: 1.2 },
  { text: "Studify. Prepara l'esame con i tuoi appunti.", scene: "cta", pause: 0.3 },
  { text: "Link in bio." },
];
const LEAD = 0.7; // silenzio prima della prima frase (il video entra dal nero)
const TAIL = 1.6; // dopo l'ultima frase, la chiusura resta in vista
const GAP = 0.5; // pausa tra frasi, se la riga non ne dice un'altra

// Le riprese delle scene. `from`: secondo d'inizio nella clip; `x`: inizio del ritaglio verticale (608 su 1920 px);
// `slow`: rallentata; `blur`: sfocata, dietro il telefono. Una scena più lunga della sua clip la rallenta da sola.
const SHOTS = {
  luca: { id: 50128, from: 0.4, x: 656 },  // sfoglia il libro, stanco
  desk: { id: 50111, from: 1.0, x: 656 },  // la scrivania dall'alto
  pens: { id: 50112, from: 0.2, x: 656 },  // evidenziatori
  tired: { id: 50113, from: 3.6, x: 700 }, // chino sul quaderno
  think: { id: 50128, from: 4.6, x: 656 }, // la mano tra i capelli
  start: { id: 50126, from: 0.4, x: 656 }, // si rimette al lavoro
  app: { id: 50126, from: 2.0, x: 656, blur: true },
  focus: { id: 50116, from: 0.2, x: 600 }, // disegna il grafico, concentrato
  campus: { id: 4519, from: 1.0, x: 656, slow: 1.25 }, // verso l'università
  cta: { id: 4519, from: 7.0, x: 656, slow: 1.25, blur: true },
};
const PAGES = { // pagine di Mixkit (https://mixkit.co/free-stock-video/<pagina>/), dove si controlla la licenza
  50128: "a-young-student-turns-the-page-of-a-book-and-50128", 50111: "student-makes-a-note-over-wooden-desk-filled-with-mathematical-50111",
  50112: "student-hand-takes-a-stiky-note-to-paste-it-on-50112", 50113: "a-young-student-with-a-black-pen-draws-a-mathematical-50113",
  50126: "a-young-student-wearing-a-hoodie-hilight-texts-on-a-50126", 50116: "a-young-student-is-drawing-a-mathematical-chart-in-the-50116",
  4519: "students-walking-in-a-university-4519",
};
const GRADE = "eq=contrast=1.06:saturation=0.9:brightness=0.03:gamma=1.06,colorbalance=rs=-0.04:bs=0.05:rh=0.03:bh=-0.04,unsharp=5:5:0.5,vignette=PI/6";

const ff = (args) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" }); if (r.status !== 0) throw new Error("ffmpeg non è riuscito"); };
const probe = (file) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout.toString().trim());

// 1 · la voce, una frase alla volta
if (!existsSync(MODEL)) throw new Error(`manca la voce: ${MODEL} (vedi le istruzioni in cima a questo file)`);
let t = LEAD;
const lines = LINES.map((l, i) => {
  const wav = join(VOICE, `${String(i + 1).padStart(2, "0")}.wav`);
  const r = spawnSync(PIPER, ["-m", MODEL, "--length-scale", "1.12", "--sentence-silence", "0.25", "-f", wav], { input: l.text });
  if (r.status !== 0) throw new Error(`Piper non è riuscito sulla frase ${i + 1}: ${r.stderr}`);
  const start = t, end = t + probe(wav);
  t = end + (l.pause ?? GAP);
  return { ...l, wav, start, end };
});
const DURATION = Math.ceil((lines.at(-1).end + TAIL) * FPS) / FPS;

// scene: ognuna parte con la sua frase (la prima da zero) e finisce dove comincia la successiva; il taglio cade 0,15 s prima della voce
const scenes = [];
lines.forEach((l, i) => { if (l.scene) scenes.push({ key: l.scene, start: i === 0 ? 0 : Math.max(0, l.start - 0.15) }); });
scenes.forEach((s, i) => (s.end = scenes[i + 1]?.start ?? DURATION));
for (const s of scenes) { s.f0 = Math.round(s.start * FPS); s.f1 = Math.round(s.end * FPS); }
writeFileSync(join(HERE, "img", "story.js"), `window.STORY = ${JSON.stringify({ duration: DURATION, lines: lines.map(({ text, start, end, app, scene }) => ({ text, start, end, app, scene })), scenes: scenes.map(({ key, start, end }) => ({ key, start, end })) }, null, 1)};\n`);
console.log(`voce: ${lines.length} frasi, video di ${DURATION.toFixed(2)} s`);

// 2 · le clip
for (const id of new Set(Object.values(SHOTS).map((s) => s.id))) {
  if (!PAGES[id]) throw new Error(`clip ${id}: manca la pagina in PAGES, quindi la licenza non è stata controllata`);
  const file = join(STOCK, `${id}.mp4`);
  if (existsSync(file)) continue;
  mkdirSync(STOCK, { recursive: true });
  const r = await fetch(`https://assets.mixkit.co/videos/${id}/${id}-1080.mp4`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`clip ${id}: Mixkit risponde ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// 3 · le riprese montate sui tempi della voce
const bg = join(OUT, "story-riprese.mp4");
const chains = scenes.map((s, i) => {
  const shot = SHOTS[s.key];
  const frames = s.f1 - s.f0;
  const avail = probe(join(STOCK, `${shot.id}.mp4`)) - shot.from - 0.1;
  const slow = Math.max(shot.slow ?? 1, frames / FPS / avail); // se la clip non basta, rallenta
  return `[${i}:v]trim=start=${shot.from},setpts=${slow.toFixed(4)}*(PTS-STARTPTS),fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,` +
    `crop=608:1080:${shot.x}:0,scale=1080:1920:flags=lanczos,${GRADE}${shot.blur ? ",gblur=sigma=24,eq=brightness=-0.06" : ""},setsar=1[v${i}]`;
});
ff([...scenes.flatMap((s) => ["-i", join(STOCK, `${SHOTS[s.key].id}.mp4`)]),
  "-filter_complex", `${chains.join(";")};${scenes.map((_, i) => `[v${i}]`).join("")}concat=n=${scenes.length}:v=1:a=0,noise=alls=4:allf=t[v]`,
  "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", "-r", String(FPS), bg]);

// 4 · la voce su un'unica traccia, con il volume consigliato per i social (-14 LUFS)
const voice = join(OUT, "story-voce.wav");
ff([...lines.flatMap((l) => ["-i", l.wav]),
  "-filter_complex", `${lines.map((l, i) => `[${i}:a]aresample=48000,adelay=${Math.round(l.start * 1000)}:all=1[a${i}]`).join(";")};` +
    `${lines.map((_, i) => `[a${i}]`).join("")}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${DURATION},` +
    "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-14:TP=-1.5:LRA=7[a]",
  "-map", "[a]", "-ar", "48000", "-ac", "2", voice]);

// 5 · il livello grafico, fotogramma per fotogramma, sopra le riprese, e la voce
const browser = await chromium.launch();
const file = join(OUT, "studify-promo-storia.mp4");
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(String(pathToFileURL(join(HERE, "story.html"))));
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(300);
  if (errors.length) throw new Error(`story.html: ${errors.join("; ")} (manca promo/img/? lancia prima promo/capture.mjs)`);
  const frames = Math.round(DURATION * FPS);
  const enc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", bg,
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-", "-i", voice,
    "-filter_complex", "[0:v][1:v]overlay=format=auto:shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-level", "4.2",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => enc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg è uscito con ${code}`)))));
  for (let i = 0; i < frames; i++) {
    await page.evaluate((s) => window.render(s), i / FPS);
    const png = await page.screenshot({ type: "png", omitBackground: true });
    if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once("drain", r));
  }
  enc.stdin.end();
  await done;
} finally {
  await browser.close();
}
ff(["-ss", "1.6", "-i", file, "-frames:v", "1", join(OUT, "studify-promo-storia-copertina.png")]);
console.log("fatto", file);
