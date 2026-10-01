// Importazione da tabelle (CSV/Excel): appelli d'esame, piano di studi, orari delle lezioni.
// Riconoscimento delle colonne per intestazione (sinonimi italiani/inglesi) con possibilità di correggere a mano.
import { findCourse } from "./curriculum.js";
import { suggestExamType } from "./exam-type.js";
import { minutesBetween, parseDate, parseTime, parseTimeRange, parseWeekday } from "./tabular.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** key, label, required, sinonimi (dal più specifico). L'ordine dei campi è l'ordine di assegnazione delle colonne. */
export const SCHEMAS = {
  esami: {
    label: "Appelli d'esame",
    hint: "Insegnamento, data (anche più appelli per lo stesso insegnamento), ora, aula, tipo di prova, CFU, anno.",
    fields: [
      { key: "name", label: "Insegnamento", required: true, syn: ["insegnamento", "nome esame", "nome insegnamento", "attivita didattica", "attivita formativa", "denominazione", "esame", "corso", "materia", "disciplina"] },
      { key: "date", label: "Data", required: true, syn: ["data appello", "data esame", "data prova", "data", "appello", "giorno"] },
      { key: "time", label: "Ora", syn: ["ora esame", "ora inizio", "orario", "ora", "inizio"] },
      { key: "room", label: "Aula", syn: ["aula", "luogo", "sede"] },
      { key: "type", label: "Tipo di prova", syn: ["tipo prova", "tipo esame", "modalita esame", "modalita", "prova", "tipo"] },
      { key: "cfu", label: "CFU", syn: ["cfu", "crediti", "n cfu"] },
      { key: "year", label: "Anno", syn: ["anno di corso", "anno corso", "anno"] },
    ],
  },
  insegnamenti: {
    label: "Piano di studi (insegnamenti)",
    hint: "Insegnamento, anno, CFU, tipo (obbligatorio / a scelta), prova d'esame, gruppo.",
    fields: [
      { key: "name", label: "Insegnamento", required: true, syn: ["insegnamento", "nome insegnamento", "attivita didattica", "attivita formativa", "denominazione", "esame", "corso", "materia", "disciplina"] },
      { key: "year", label: "Anno", syn: ["anno di corso", "anno corso", "anno"] },
      { key: "cfu", label: "CFU", syn: ["cfu", "crediti", "n cfu"] },
      { key: "format", label: "Prova d'esame", syn: ["tipo prova", "tipo esame", "modalita esame", "modalita", "prova"] },
      { key: "group", label: "Gruppo a scelta", syn: ["gruppo", "gruppo opzionale", "gruppo a scelta"] },
      { key: "kind", label: "Tipo (obbligatorio / a scelta)", syn: ["tipologia", "tipo attivita", "tipo insegnamento", "obbligatorio", "ambito", "tipo"] },
    ],
  },
  orari: {
    label: "Orari delle lezioni",
    hint: "Insegnamento, giorno (lunedì… oppure una data), orario di inizio e fine, aula.",
    fields: [
      { key: "name", label: "Insegnamento", required: true, syn: ["insegnamento", "nome insegnamento", "attivita didattica", "denominazione", "esame", "corso", "materia", "disciplina"] },
      { key: "day", label: "Giorno o data", required: true, syn: ["giorno settimana", "giorno lezione", "giorno", "data lezione", "data"] },
      { key: "start", label: "Inizio", syn: ["ora inizio", "inizio lezione", "inizio", "dalle", "da"] },
      { key: "end", label: "Fine", syn: ["ora fine", "fine lezione", "fine", "alle", "a"] },
      { key: "range", label: "Orario (es. 09:00-11:00)", syn: ["fascia oraria", "orario lezione", "orario"] },
      { key: "room", label: "Aula", syn: ["aula", "luogo", "sede"] },
    ],
  },
};

const score = (header, syn) => {
  const h = norm(header);
  if (!h) return 0;
  const i = syn.findIndex((s) => h === s);
  if (i >= 0) return 100 - i;
  const words = ` ${h} `;
  const j = syn.findIndex((s) => s.length >= 3 && words.includes(` ${s} `));
  if (j >= 0) return 50 - j;
  return 0;
};

/** @returns {Record<string, number>} campo → indice di colonna (-1 se assente) */
export function autoMap(kind, headers) {
  const used = new Set();
  const map = {};
  for (const f of SCHEMAS[kind].fields) {
    let best = -1;
    let bestScore = 0;
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      const sc = score(h, f.syn);
      if (sc > bestScore) { best = i; bestScore = sc; }
    });
    map[f.key] = best;
    if (best >= 0) used.add(best);
  }
  return map;
}

/**
 * Tipo di tabella più probabile dalle intestazioni e dai valori. «Data + Ora + Aula» può essere un appello o una lezione:
 * è un orario solo se ci sono inizio e fine (o una fascia «09:00-11:00»), o se il giorno è un nome di giorno della settimana.
 */
export function detectKind(headers, sampleRows = []) {
  const res = Object.keys(SCHEMAS).map((kind) => {
    const map = autoMap(kind, headers);
    const required = SCHEMAS[kind].fields.filter((f) => f.required).every((f) => map[f.key] >= 0);
    const mapped = Object.values(map).filter((i) => i >= 0).length;
    let bonus = 0;
    if (kind === "orari") {
      if (map.start >= 0 && map.end >= 0) bonus += 3;
      if (map.range >= 0 && sampleRows.some((r) => parseTimeRange(r[map.range]))) bonus += 3;
      if (map.day >= 0 && sampleRows.some((r) => parseWeekday(r[map.day]))) bonus += 3;
    }
    if (kind === "esami" && map.date >= 0) {
      bonus += 1;
      if (sampleRows.some((r) => parseDate(r[map.date], { today: "2000-01-01" }))) bonus += 2;
      if (map.time >= 0 && sampleRows.some((r) => parseTimeRange(r[map.time]))) bonus -= 4; // una fascia «09:00-11:00» è una lezione
    }
    if (kind === "insegnamenti" && (map.year >= 0 || map.cfu >= 0)) bonus += 1;
    return { kind, required, mapped, total: required ? mapped + bonus : -1 };
  });
  res.sort((a, b) => b.total - a.total);
  return res[0].total >= 0 ? { kind: res[0].kind, scores: res } : { kind: null, scores: res };
}

/** La prima riga è un'intestazione? (nessuna cella numerica/data e almeno una corrisponde a un sinonimo noto) */
export function looksLikeHeader(row) {
  if (!row?.length) return false;
  if (row.some((c) => /^\d+([.,]\d+)?$/.test(c.trim()) || parseDate(c, { today: "2000-01-01" }))) return false;
  return Object.keys(SCHEMAS).some((k) => SCHEMAS[k].fields.some((f) => row.some((c) => score(c, f.syn) > 0)));
}

export const colName = (i) => { let n = i + 1, s = ""; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Intestazioni e righe di dati; senza intestazione le colonne si chiamano «Colonna A»… */
export function tableFrom(rows, hasHeader, offset = 0) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const norm_ = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  const headers = hasHeader && norm_.length ? norm_[0].map((h, i) => h || `Colonna ${colName(i)}`) : Array.from({ length: width }, (_, i) => `Colonna ${colName(i)}`);
  return { headers, data: hasHeader ? norm_.slice(1) : norm_, firstRow: offset + (hasHeader ? 2 : 1) };
}

/* ------------------------------ interpretazione valori ------------------------------ */

const cell = (row, map, key) => (map[key] >= 0 ? (row[map[key]] ?? "").trim() : "");

export function parseExamType(v) {
  const s = norm(v);
  if (!s) return null;
  const scritto = /scritt/.test(s), orale = /oral|colloqui/.test(s);
  if (scritto && orale) return "misto";
  if (orale) return "orale";
  if (/test|quiz|multipl|crocett/.test(s)) return "test";
  if (/eserciz|problem/.test(s)) return "problemi";
  if (scritto) return "scritto";
  return null;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
const ORD = { primo: 1, secondo: 2, terzo: 3, quarto: 4, quinto: 5, sesto: 6 };
export function parseYear(v) {
  const s = norm(v);
  if (!s) return 0;
  const m = s.match(/^(\d)\b/) ?? s.match(/\b([1-6])\b/);
  if (m) return +m[1] <= 6 ? +m[1] : 0;
  const w = s.split(" ")[0];
  return ROMAN[w] ?? ORD[w] ?? 0;
}

export function parseKind(v) {
  const s = norm(v);
  if (!s) return "sconosciuto";
  if (/scelt|opzion|libero|facolt|elettiv/.test(s)) return "a_scelta";
  if (/obblig|caratterizz|base|affin|comun|fondament|^si$/.test(s)) return "obbligatorio";
  return "sconosciuto";
}

const parseNum = (v) => { const n = parseFloat(String(v).replace(",", ".").replace(/[^\d.]/g, "")); return Number.isFinite(n) ? Math.min(60, Math.round(n)) : 0; };

/* ------------------------------------- costruttori ------------------------------------- */

/**
 * Appelli d'esame → un elemento per insegnamento (più date = più appelli). Date passate scartate.
 * @param ctx {today, courses (piano di studi), exams (esami esistenti)}
 */
export function buildExams(data, map, ctx, firstRow = 2) {
  const errors = [];
  const groups = new Map();
  let past = 0;
  data.forEach((row, i) => {
    const n = firstRow + i;
    const name = cell(row, map, "name");
    const rawDate = cell(row, map, "date");
    if (!name && !rawDate) return;
    if (!name) return errors.push({ row: n, message: "insegnamento mancante" });
    const d = parseDate(rawDate, { today: ctx.today });
    if (!d) return errors.push({ row: n, message: `data non riconosciuta «${rawDate}»` });
    if (d.date < ctx.today) { past++; return; }
    const time = parseTime(cell(row, map, "time")) ?? d.time;
    const key = norm(name);
    const g = groups.get(key) ?? { name, appelli: [], types: [], cfu: 0, year: 0 };
    if (!g.appelli.some((a) => a.date === d.date && a.time === time)) g.appelli.push({ date: d.date, time: time ?? null, room: cell(row, map, "room") });
    const t = parseExamType(cell(row, map, "type"));
    if (t) g.types.push(t);
    g.cfu ||= parseNum(cell(row, map, "cfu"));
    g.year ||= parseYear(cell(row, map, "year"));
    groups.set(key, g);
  });
  const items = [...groups.values()].map((g) => {
    g.appelli.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
    const course = findCourse(ctx.courses ?? [], g.name);
    let type = g.types[0] ?? null;
    let typeSource = "file";
    if (!type && course?.format && course.format !== "sconosciuto") { type = course.format; typeSource = "piano"; }
    if (!type) { type = suggestExamType(g.name).type; typeSource = "materia"; }
    const existing = (ctx.exams ?? []).find((e) => norm(e.name) === norm(g.name));
    return {
      name: g.name, appelli: g.appelli, date: g.appelli[0].date, type, typeSource,
      cfu: g.cfu || course?.cfu || 0, year: g.year || course?.year || 0,
      status: existing ? "aggiornato" : "nuovo", existingId: existing?.id ?? null,
    };
  });
  return { items, errors, past };
}

export function buildCourses(data, map, ctx = {}, firstRow = 2) {
  const errors = [];
  const seen = new Set();
  const items = [];
  data.forEach((row, i) => {
    const name = cell(row, map, "name");
    if (!name) return row.some((c) => c.trim()) && errors.push({ row: firstRow + i, message: "insegnamento mancante" });
    const year = parseYear(cell(row, map, "year"));
    const key = `${norm(name)}|${year}`;
    if (seen.has(key)) return;
    seen.add(key);
    const format = parseExamType(cell(row, map, "format")) ?? "sconosciuto";
    const group = cell(row, map, "group");
    let kind = parseKind(cell(row, map, "kind"));
    if (kind === "sconosciuto" && group) kind = "a_scelta";
    const existing = (ctx.courses ?? []).find((c) => norm(c.name) === norm(name) && (c.year || 0) === year);
    items.push({
      name, year, cfu: parseNum(cell(row, map, "cfu")), kind, group, format,
      formatEvidence: format === "sconosciuto" ? "" : "importato da file", url: "", manual: true,
      status: existing ? "aggiornato" : "nuovo",
    });
  });
  return { items, errors };
}

/** Lezioni → voci settimanali o in data precisa. */
export function buildTimetable(data, map, ctx = {}, firstRow = 2) {
  const errors = [];
  const items = [];
  data.forEach((row, i) => {
    const n = firstRow + i;
    const course = cell(row, map, "name");
    const day = cell(row, map, "day");
    if (!course && !day) return;
    if (!course) return errors.push({ row: n, message: "insegnamento mancante" });
    let start = parseTime(cell(row, map, "start"));
    let end = parseTime(cell(row, map, "end"));
    if (!start || !end) {
      const r = parseTimeRange(cell(row, map, "range")) ?? parseTimeRange(cell(row, map, "start"));
      if (r) ({ start, end } = r);
    }
    if (!start || !end) return errors.push({ row: n, message: "orario di inizio/fine non riconosciuto" });
    if (minutesBetween(start, end) <= 0 || minutesBetween(start, end) > 720) return errors.push({ row: n, message: `orario non valido (${start}–${end})` });
    const wd = parseWeekday(day);
    const dd = wd ? null : parseDate(day, { today: ctx.today });
    if (!wd && !dd) return errors.push({ row: n, message: `giorno non riconosciuto «${day}»` });
    items.push({ course, ...(wd ? { weekday: wd } : { date: dd.date }), start, end, room: cell(row, map, "room") });
  });
  const counts = new Map();
  for (const l of items) counts.set(l.course, (counts.get(l.course) ?? 0) + 1);
  return { items, errors, courses: [...counts].map(([name, count]) => ({ name, count })) };
}

export const BUILDERS = { esami: buildExams, insegnamenti: buildCourses, orari: buildTimetable };

/** Modelli CSV da scaricare. */
export const TEMPLATES = {
  esami: "Insegnamento;Data;Ora;Aula;Tipo prova;CFU;Anno\nAnalisi matematica 1;14/01/2027;09:00;Aula 3;Scritto;9;1\nAnalisi matematica 1;04/02/2027;09:00;Aula 3;Scritto;9;1\nDiritto privato;21/01/2027;14:30;Aula Magna;Orale;6;2\n",
  insegnamenti: "Insegnamento;Anno;CFU;Tipo;Prova\nAnalisi matematica 1;1;9;Obbligatorio;Scritto\nDiritto privato;2;6;Obbligatorio;Orale\nTeoria dei giochi;3;6;A scelta;\n",
  orari: "Insegnamento;Giorno;Inizio;Fine;Aula\nAnalisi matematica 1;Lunedì;09:00;11:00;Aula 3\nAnalisi matematica 1;Giovedì;14:00;16:00;Aula 3\nDiritto privato;Martedì;11:00;13:00;Aula Magna\n",
};
