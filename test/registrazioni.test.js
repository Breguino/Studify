import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clock, parseTranscript, timeOfQuote } from "../public/js/transcripts.js";
import { DISPENSA_SYSTEM, MODULE_PRINCIPLES, materialText } from "../shared/prompts.js";

const FX = new URL("./fixtures/", import.meta.url);

test("sottotitoli .srt: via numeri e tempi, righe unite in paragrafi, il minuto davanti a ogni paragrafo", () => {
  const srt = "1\n00:00:00,000 --> 00:00:04,000\nBuongiorno, oggi parliamo\ndi elasticità.\n\n2\n00:00:04,500 --> 00:00:08,000\nSi calcola con le variazioni percentuali.\n\n3\n00:00:12,000 --> 00:00:15,000\nDopo la pausa: un esempio.\n";
  const r = parseTranscript(srt);
  assert.deepEqual([r.cues, r.duration], [3, 15]);
  assert.equal(r.text, "[0:00]\n\nBuongiorno, oggi parliamo di elasticità. Si calcola con le variazioni percentuali.\n\n[0:12]\n\nDopo la pausa: un esempio.", "una pausa di 3 secondi apre un paragrafo");
  const long = parseTranscript(readFileSync(new URL("Lezione 5 - registrazione.srt", FX), "utf8"));
  assert.equal(long.cues, 49);
  assert.ok(!/-->|^\d+$/m.test(long.text), "nessun tempo o numero di battuta nel testo");
  assert.equal(timeOfQuote(long.text, "questo all'esame lo chiedo sempre"), "2:00", "la frase del docente è nel paragrafo che inizia al minuto 2");
  assert.equal(timeOfQuote(long.text, "una frase che non c'è da nessuna parte"), null);
  assert.equal(clock(3725), "1:02:05");
  assert.equal(clock(65), "1:05");
});

test("sottotitoli .vtt: impostazioni e tempi dentro le righe tolti, righe ripetute dei sottotitoli a scorrimento una volta sola", () => {
  const r = parseTranscript(readFileSync(new URL("Lezione 6 (sottotitoli).vtt", FX), "utf8"));
  assert.ok(!/align:|position:|<c>|WEBVTT|Kind:/.test(r.text));
  assert.equal(r.text.match(/Buongiorno a tutti/g).length, 1, "la riga ripetuta compare una volta");
  assert.match(r.text, /^\[0:00\]\n\nBuongiorno a tutti, oggi parliamo di elasticità della domanda\. L'elasticità misura quanto cambia/);
  // Teams: le voci
  const teams = parseTranscript("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Mario Rossi>Questo all'esame lo chiedo.</v>\n\n00:00:03.200 --> 00:00:05.000\n<v Mario Rossi>Sempre.</v>\n\n00:00:05.100 --> 00:00:07.000\n<v Giulia Bianchi>Anche la dimostrazione?</v>\n");
  assert.equal(teams.text, "[0:01]\n\nMario Rossi: Questo all'esame lo chiedo. Sempre.\n\n[0:05]\n\nGiulia Bianchi: Anche la dimostrazione?");
  // Whisper: tempi tra parentesi quadre e testo sulla stessa riga
  const w = parseTranscript("[00:00.000 --> 00:04.000]  Buongiorno a tutti.\n[00:04.000 --> 00:08.000]  Oggi l'elasticità.\n[00:08.000 --> 00:11.000]  Cominciamo.");
  assert.equal(w.text, "[0:00]\n\nBuongiorno a tutti. Oggi l'elasticità. Cominciamo.");
  assert.equal(parseTranscript("Appunti normali.\nLa domanda è decrescente.\nOre 10:30 lezione"), null, "un testo senza battute con i tempi resta un testo");
});

test("regole per l'AI: trascrizione automatica (termini storpiati, formule a parole, minuti da non copiare)", () => {
  assert.equal(materialText({ role: "sbobine", auto: true, title: "Lezione 5", text: "x" }), '<sbobina titolo="Lezione 5" trascrizione_automatica="sì">\nx\n</sbobina>');
  assert.match(MODULE_PRINCIPLES, /trascrizione_automatica="sì"[\s\S]*termini tecnici possono essere storpiati[\s\S]*formule\s+sono dette a parole[\s\S]*\[12:30\]» sono i minuti della registrazione: non copiarli/);
  assert.match(DISPENSA_SYSTEM, /SBOBINE:[^\n]*«\[12:30\]» non vanno copiati/);
});
