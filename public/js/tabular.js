// Lettura di tabelle (CSV/TSV e Excel .xlsx) e interpretazione di date, orari e giorni in italiano.
// Nessuna dipendenza: l'.xlsx è uno zip di XML, letto con DecompressionStream (browser moderni e Node ≥ 18).
// Tutto il modulo è puro (testabile con `node --test`).

/* ----------------------------------------------------------------------------- */
/* Testo e CSV                                                                    */
/* ----------------------------------------------------------------------------- */

/** Decodifica un file di testo: UTF-8 se valido, altrimenti Windows-1252 (tipico degli export Excel italiani). */
export function decodeText(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function splitRecords(text, delim) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Sceglie il delimitatore guardando le prime righe: tra quelli che danno lo stesso numero di colonne (≥ 2) su tutte le righe
 * vince il primo in ordine di affidabilità (tab, «;», «,», «|»): negli export italiani «;» è la norma e la virgola può essere decimale.
 */
export function detectDelimiter(text) {
  let fallback = { d: ",", score: -1 };
  for (const d of ["\t", ";", ",", "|"]) {
    const rows = splitRecords(text.slice(0, 20000), d).filter((r) => r.some((c) => c.trim())).slice(0, 12);
    if (!rows.length) continue;
    const counts = rows.map((r) => r.length);
    const modal = [...counts].sort((x, y) => counts.filter((c) => c === y).length - counts.filter((c) => c === x).length)[0];
    const consistent = counts.filter((c) => c === modal).length;
    if (modal > 1 && consistent === rows.length) return d;
    const score = modal > 1 ? consistent * 100 + modal : 0;
    if (score > fallback.score) fallback = { d, score };
  }
  return fallback.d;
}

/** Toglie le righe vuote iniziali e finali (quelle interne restano, così i numeri di riga corrispondono al foglio). */
export function trimRows(rows) {
  const blank = (r) => !r || r.every((c) => c === "");
  let a = 0;
  let b = rows.length;
  while (a < b && blank(rows[a])) a++;
  while (b > a && blank(rows[b - 1])) b--;
  return { rows: rows.slice(a, b).map((r) => (blank(r) ? [] : r)), offset: a };
}

/** @returns {{rows: string[][], delimiter: string, offset: number}} offset = righe vuote iniziali tolte */
export function parseDelimited(text) {
  const t = String(text ?? "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(t);
  const { rows, offset } = trimRows(splitRecords(t, delimiter).map((r) => r.map((c) => c.trim())));
  return { rows, delimiter, offset };
}

/* ----------------------------------------------------------------------------- */
/* Excel (.xlsx)                                                                  */
/* ----------------------------------------------------------------------------- */

const MAX_PART = 40 * 1024 * 1024;

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") throw new Error("Questo browser non legge i file Excel: salva il foglio come CSV e riprova.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Legge i file di uno zip (store e deflate). Restituisce Map nome → () => Promise<Uint8Array>. */
export function readZip(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Il file non sembra un .xlsx valido.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Archivio .xlsx danneggiato.");
    const method = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (comp === 0xffffffff || size === 0xffffffff) throw new Error("File Excel troppo grande o in formato non supportato.");
    files.set(name, async () => {
      if (size > MAX_PART) throw new Error("Il foglio Excel è troppo grande: esportalo in CSV.");
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + comp);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error("Compressione del file Excel non supportata.");
    });
  }
  return files;
}

const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
  });

const text = (u8) => new TextDecoder().decode(u8);
const attr = (s, name) => decodeXml((s.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1] ?? "");

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, ...Array.from({ length: 10 }, (_, i) => 27 + i), ...Array.from({ length: 9 }, (_, i) => 50 + i)]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 45, 46, 47]);

/** Per ogni indice di stile: "date" | "time" | null. */
function styleKinds(xml) {
  if (!xml) return [];
  const custom = new Map([...xml.matchAll(/<numFmt\b([^>]*)\/?>/g)].map((m) => [Number(attr(m[1], "numFmtId")), attr(m[1], "formatCode")]));
  const block = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) ?? [])[1] ?? "";
  return [...block.matchAll(/<xf\b([^>]*)>/g)].map((m) => {
    const id = Number(attr(m[1], "numFmtId"));
    if (BUILTIN_DATE.has(id)) return "date";
    if (BUILTIN_TIME.has(id)) return "time";
    const code = custom.get(id);
    if (!code) return null;
    const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
    if (/[dy]/i.test(c)) return "date";
    if (/[hs]/i.test(c)) return "time";
    return null;
  });
}

const pad = (n) => String(n).padStart(2, "0");

/** Numero di serie Excel → { date: 'YYYY-MM-DD', time: 'HH:MM' | null } (epoca 1900, o 1904 se `date1904`). */
export function excelSerial(serial, date1904 = false) {
  const whole = Math.floor(serial);
  const frac = serial - whole;
  const ms = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + whole * 86400000;
  const d = new Date(ms);
  const mins = Math.round(frac * 1440);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: frac > 0 ? `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}` : null,
  };
}

const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function sheetRows(xml, shared, kinds, date1904) {
  const out = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      const t = attr(cm[1], "t");
      const s = attr(cm[1], "s");
      const v = (cm[2]?.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      let value = "";
      if (t === "s") value = shared[Number(v)] ?? "";
      else if (t === "inlineStr") value = decodeXml([...(cm[2] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "str") value = decodeXml(v ?? "");
      else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (t === "e" || v === undefined) value = "";
      else {
        const num = parseFloat(v);
        const kind = kinds[Number(s)];
        if (kind === "date") { const e = excelSerial(num, date1904); value = e.time ? `${e.date} ${e.time}` : e.date; }
        else if (kind === "time") value = excelSerial(num - Math.floor(num), date1904).time ?? "00:00";
        else value = String(+num.toPrecision(12));
      }
      row[ref ? colIndex(ref) : row.length] = value.trim();
    }
    for (let i = 0; i < row.length; i++) row[i] ??= "";
    const rn = Number(attr(rm[0].slice(0, rm[0].indexOf(">") + 1), "r")) || out.length + 1;
    out[rn - 1] = row;
  }
  for (let i = 0; i < out.length; i++) out[i] ??= [];
  return trimRows(out);
}

/** @returns {Promise<{sheets: {name: string, rows: string[][], offset: number}[]}>} */
export async function readXlsx(buf) {
  const zip = readZip(buf);
  const get = async (name) => (zip.has(name) ? text(await zip.get(name)()) : null);
  const wb = await get("xl/workbook.xml");
  if (!wb) throw new Error("Il file non sembra un foglio Excel (.xlsx).");
  const rels = await get("xl/_rels/workbook.xml.rels");
  const target = new Map([...(rels ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [attr(m[1], "Id"), attr(m[1], "Target")]));
  const shared = sharedStrings(await get("xl/sharedStrings.xml"));
  const kinds = styleKinds(await get("xl/styles.xml"));
  const date1904 = /<workbookPr\b[^>]*date1904="(?:1|true)"/i.test(wb);
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const t = target.get(attr(m[1], "r:id"));
    if (!t) continue;
    const path = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
    const xml = await get(path);
    if (xml) sheets.push({ name: attr(m[1], "name"), ...sheetRows(xml, shared, kinds, date1904) });
  }
  if (!sheets.length) throw new Error("Nel file Excel non ci sono fogli leggibili.");
  return { sheets };
}

/** Legge un file scelto dall'utente (File/Blob). @returns {Promise<{sheets: {name: string, rows: string[][]}[]}>} */
export async function readSpreadsheet(file) {
  const name = (file.name ?? "").toLowerCase();
  const buf = await file.arrayBuffer();
  if (/\.xls$/.test(name)) throw new Error("Il vecchio formato .xls non è supportato: in Excel scegli «Salva con nome» → .xlsx oppure CSV.");
  if (/\.(xlsx|xlsm)$/.test(name) || (buf.byteLength > 4 && new Uint8Array(buf)[0] === 0x50 && new Uint8Array(buf)[1] === 0x4b)) return readXlsx(buf);
  const { rows, offset } = parseDelimited(decodeText(buf));
  return { sheets: [{ name: "CSV", rows, offset }] };
}

/* ----------------------------------------------------------------------------- */
/* Date, orari, giorni (italiano)                                                 */
/* ----------------------------------------------------------------------------- */

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const MONTHS = { gen: 1, gennaio: 1, feb: 2, febbraio: 2, mar: 3, marzo: 3, apr: 4, aprile: 4, mag: 5, maggio: 5, giu: 6, giugno: 6, lug: 7, luglio: 7, ago: 8, agosto: 8, set: 9, sett: 9, settembre: 9, ott: 10, ottobre: 10, nov: 11, novembre: 11, dic: 12, dicembre: 12 };
const validYMD = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const fullYear = (y) => (y < 100 ? 2000 + y : y);

/** Riconosce un orario HH:MM (anche «9», «9.30», «09:00:00», frazione di giorno Excel). */
export function parseTime(value) {
  const s = norm(value).replace(/\s*(?:h|ore)\s*$/, "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})(?:[:.,h](\d{2}))?(?::\d{2})?$/);
  if (m) {
    const h = +m[1], mi = m[2] ? +m[2] : 0;
    return h <= 24 && mi < 60 ? `${pad(h % 24)}:${pad(mi)}` : null;
  }
  m = s.match(/^0?\.\d+$|^0$/);
  if (m) return excelSerial(parseFloat(s)).time;
  return null;
}

/** «09:00-11:00», «9.00 – 11.00», «dalle 9 alle 11» → { start, end } */
export function parseTimeRange(value) {
  const s = norm(value).replace(/\bdalle?\b|\balle?\b|\bore\b/g, " ").replace(/\s+/g, " ").trim();
  const parts = s.split(/\s*(?:-|–|—|\bto\b|\ba\b)\s*|\s+(?=\d)/).filter(Boolean);
  if (parts.length < 2) return null;
  const start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  return start && end ? { start, end } : null;
}

/**
 * Data in vari formati italiani/ISO/Excel. Giorno prima del mese (15/01/2027).
 * Senza anno («15 gen») sceglie la prossima occorrenza a partire da `today`.
 * @returns {{date: string, time: string|null} | null}
 */
export function parseDate(value, { today } = {}) {
  let s = norm(value);
  if (!s) return null;
  let time = null;
  s = s.replace(/^(\d{4}-\d{1,2}-\d{1,2})t/, "$1 ");
  const tm = s.match(/^(.*\S)\s+(\d{1,2}[:.]\d{2})(?::\d{2})?\s*(?:h|ore)?$/);
  if (tm) { time = parseTime(tm[2]); s = tm[1].trim(); }
  s = s.replace(/^(?:lun|mar|mer|gio|ven|sab|dom)[a-z]*\.?,?\s+/, "");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYMD(+m[1], +m[2], +m[3]) ? { date: iso(+m[1], +m[2], +m[3]), time } : null;
  m = s.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2,4})$/);
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // formato americano
    const y = fullYear(+m[3]);
    return validYMD(y, mo, d) ? { date: iso(y, mo, d), time } : null;
  }
  m = s.match(/^(\d{1,2})\s*(?:°|º)?\s+([a-z]+)\.?(?:\s+(\d{2,4}))?$/);
  if (m && MONTHS[m[2]]) {
    const d = +m[1], mo = MONTHS[m[2]];
    if (m[3]) { const y = fullYear(+m[3]); return validYMD(y, mo, d) ? { date: iso(y, mo, d), time } : null; }
    if (!today) return null;
    const ty = +today.slice(0, 4);
    const cand = [ty, ty + 1].find((y) => validYMD(y, mo, d) && iso(y, mo, d) >= today);
    return cand ? { date: iso(cand, mo, d), time } : null;
  }
  m = s.match(/^\d{5}(?:\.\d+)?$/);
  if (m) { const e = excelSerial(parseFloat(s)); return { date: e.date, time: time ?? e.time }; }
  return null;
}

const WEEKDAYS = {
  lun: 1, lunedi: 1, mon: 1, monday: 1, mar: 2, martedi: 2, tue: 2, tuesday: 2, mer: 3, mercoledi: 3, wed: 3, wednesday: 3,
  gio: 4, giovedi: 4, thu: 4, thursday: 4, ven: 5, venerdi: 5, fri: 5, friday: 5, sab: 6, sabato: 6, sat: 6, saturday: 6,
  dom: 7, domenica: 7, sun: 7, sunday: 7,
};
/** «Lunedì», «lun», «Mon», «1» → 1..7 (lunedì = 1). I nomi dei mesi (marzo) non sono giorni. */
export function parseWeekday(value) {
  const s = norm(value).replace(/\.$/, "");
  if (/^[1-7]$/.test(s)) return +s;
  return WEEKDAYS[s] ?? null;
}

export const weekdayOf = (isoDate) => ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const minutesBetween = (a, b) => (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
