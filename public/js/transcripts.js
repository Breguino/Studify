// Trascrizioni automatiche delle registrazioni (Whisper, sottotitoli di Teams, Zoom, YouTube…): file .srt e .vtt, o testo con i tempi
// («[00:01.000 --> 00:04.000] …»). L'app toglie numeri e tempi, unisce le righe in paragrafi (circa un minuto di parlato) e mette
// davanti a ognuno un segno «[12:30]»: serve a ritrovare una frase nella registrazione e riascoltarla.

const T = "(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?";
const CUE = new RegExp(`^\\s*\\[?\\s*(${T})\\s*-->\\s*(${T})\\s*\\]?(.*)$`);
const MARK = /^\[(\d{1,2}(?::\d{2}){1,2})\]$/;

const seconds = (s) => s.replace(",", ".").split(":").reduce((a, x) => a * 60 + Number(x), 0);
export const clock = (sec) => {
  const s = Math.floor(sec);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(hh ? 2 : 1, "0");
  return `${hh ? `${hh}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
};
const clean = (s) => s.replace(/<\/?(?:c|i|b|u|lang)[^>]*>|<\d{1,2}:\d{2}[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/**
 * Testo di una trascrizione con i tempi → paragrafi con i segni dei minuti. Le righe ripetute dei sottotitoli «a scorrimento»
 * (YouTube) si tolgono; con più voci (Teams: «<v Mario Rossi>») ogni cambio di voce apre un paragrafo con il nome.
 * @returns {null | {text: string, cues: number, duration: number}} null se non è una trascrizione con i tempi (meno di 3 battute)
 */
export function parseTranscript(raw) {
  const lines = String(raw ?? "").replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  const cues = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(CUE);
    if (m) {
      cur = { start: seconds(m[1]), end: seconds(m[2]), parts: [] };
      cues.push(cur);
      // Whisper: il testo sulla stessa riga; .vtt: dopo i tempi ci sono le impostazioni («align:start position:0%»), non testo
      if (m[3].trim() && !/^(?:\s*[\w-]+:\S+)+\s*$/.test(m[3])) cur.parts.push(m[3]);
      continue;
    }
    if (!line.trim()) { cur = null; continue; } // fine della battuta (o numero/intestazione prima della successiva)
    if (cur) cur.parts.push(line);
  }
  if (cues.length < 3) return null;
  const out = [];
  let para = [];
  let words = 0;
  let lastEnd = 0;
  let lastLine = "";
  let voice = null;
  const flush = () => { if (para.length) out.push(para.join(" ")); para = []; words = 0; };
  for (const c of cues) {
    const raw = c.parts.join(" ");
    const v = raw.match(/<v(?:\.[^ >]*)?\s+([^>]+)>/)?.[1]?.trim() ?? null;
    let text = clean(raw.replace(/<\/?v[^>]*>/g, ""));
    // sottotitoli a scorrimento: la battuta ripete la riga precedente e aggiunge le parole nuove
    if (lastLine && text.startsWith(lastLine)) text = text.slice(lastLine.length).trim();
    if (!text) continue;
    lastLine = clean(c.parts.at(-1)?.replace(/<\/?v[^>]*>/g, "") ?? "");
    const pause = c.start - lastEnd >= 3;
    const speaker = v && v !== voice;
    if (para.length && (speaker || pause || words >= 180 || (words >= 100 && /[.?!]$/.test(para.at(-1))))) flush();
    if (!para.length) out.push(`[${clock(c.start)}]`);
    if (speaker) { voice = v; text = `${v}: ${text}`; }
    para.push(text);
    words += text.split(/\s+/).length;
    lastEnd = c.end;
  }
  flush();
  return { text: out.join("\n\n"), cues: cues.length, duration: Math.round(cues.at(-1).end) };
}

const flat = (s) => String(s ?? "").toLowerCase().normalize("NFC").replace(/[’‘`´]/g, "'").replace(/[“”«»"]/g, "").replace(/\s+/g, " ").replace(/^[\s'.…,;:]+|[\s'.…,;:]+$/g, "").trim();

/** Il minuto della registrazione in cui c'è una frase (dal segno «[12:30]» che la precede), o null. */
export function timeOfQuote(text, quote) {
  const q = flat(quote).slice(0, 60);
  if (q.length < 8) return null;
  let mark = null;
  for (const block of String(text ?? "").split(/\n\s*\n/)) {
    const m = block.trim().match(MARK);
    if (m) { mark = m[1]; continue; }
    if (mark && flat(block).includes(q)) return mark;
  }
  return null;
}
