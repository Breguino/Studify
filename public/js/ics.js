// Lettura di calendari iCalendar (.ics): lezioni o appelli esportati da Esse3/CINECA, Google Calendar, Outlook…
// Pura: nessun accesso al DOM. Gli orari con «Z» (UTC) vengono convertiti nel fuso dell'ateneo (Europe/Rome per default,
// con l'ora legale), quelli con TZID o «flottanti» sono già ora locale.

export const DEFAULT_ZONE = "Europe/Rome";

export const isIcsText = (text) => /^\s*(?:﻿)?BEGIN:VCALENDAR/i.test(String(text ?? "").slice(0, 200));

const pad = (n) => String(n).padStart(2, "0");

/* ------------------------------------ fusi orari ------------------------------------ */

const fmtCache = new Map();
function parts(utcMs, zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    fmtCache.set(zone, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(utcMs))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

/** Istante UTC (ms) → data e ora locali nel fuso indicato. */
export function utcToLocal(utcMs, zone = DEFAULT_ZONE) {
  const p = parts(utcMs, zone);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

const offsetMs = (utcMs, zone) => { const p = parts(utcMs, zone); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000; };

/** Ora «a muro» in un fuso → istante UTC (ms). Corretto anche a cavallo del cambio d'ora. */
export function wallToUtc(y, mo, d, h, mi, zone = DEFAULT_ZONE) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(guess, zone);
  return guess - offsetMs(first, zone);
}

const validZone = (z) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };

/* ------------------------------------- testo ICS ------------------------------------- */

/** Le righe lunghe sono «ripiegate»: la continuazione inizia con uno spazio o un tab. */
export const unfold = (text) => String(text).replace(/\r?\n[ \t]/g, "");

const unescape = (v) => v.replace(/\\([nN])/g, "\n").replace(/\\([,;\\])/g, "$1");

function readProps(block) {
  const props = [];
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const [name, ...ps] = line.slice(0, i).split(";");
    const params = {};
    for (const p of ps) { const [k, v] = p.split("="); if (k) params[k.toUpperCase()] = (v ?? "").replace(/^"|"$/g, ""); }
    props.push({ name: name.toUpperCase(), params, value: line.slice(i + 1) });
  }
  return props;
}

/** @returns {{allDay: boolean, date: string, time: string|null, ms: number|null}|null} */
function readDate(prop, zone) {
  if (!prop) return null;
  const v = prop.value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}`, time: null, ms: null };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  let ms;
  if (m[7]) ms = Date.UTC(y, mo - 1, d, h, mi);
  else {
    const tz = prop.params.TZID && validZone(prop.params.TZID) ? prop.params.TZID : zone;
    ms = wallToUtc(y, mo, d, h, mi, tz);
  }
  return { allDay: false, ...utcToLocal(ms, zone), ms };
}

function readDuration(v) {
  const m = String(v).match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  return m ? ((+m[1] || 0) * 7 * 1440 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 60000 : 0;
}

/* ----------------------------- nomi e luoghi leggibili ----------------------------- */

const ROMAN = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
/** «ECONOMIA POLITICA II» → «Economia politica II». I testi già in minuscolo/maiuscolo misto restano invariati. */
export function titleCase(s) {
  const t = String(s ?? "").trim();
  if (!t || /[a-zà-ÿ]/.test(t)) return t;
  const words = t.toLowerCase().split(/(\s+)/).map((w) => (ROMAN.test(w) ? w.toUpperCase() : /^\(?[a-z]\d\)?$/.test(w) ? w.toUpperCase() : w));
  const out = words.join("");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** «Aula 'Livia Dancelli' - C.da S. Chiara 50 - Brescia» → «Aula 'Livia Dancelli'» */
export const shortRoom = (loc) => String(loc ?? "").split(/\s+-\s+/)[0].replace(/\s+/g, " ").trim();

/* ------------------------------------ ricorrenze ------------------------------------ */

const DAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const ymd = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const isoOf = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const isoWeekday = (iso) => ((new Date(ymd(iso)).getUTCDay() + 6) % 7) + 1;
const MAX_OCCURRENCES = 400;

/** Date locali (ISO) delle occorrenze di una regola RRULE a partire da `startDate`. Supporta DAILY e WEEKLY (INTERVAL, BYDAY, COUNT, UNTIL). */
export function expandRule(rule, startDate, zone = DEFAULT_ZONE) {
  const r = Object.fromEntries(String(rule).split(";").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  const interval = Math.max(1, +r.INTERVAL || 1);
  const count = +r.COUNT || Infinity;
  let until = Infinity;
  if (r.UNTIL) {
    const d = readDate({ value: r.UNTIL, params: {} }, zone);
    until = d ? (d.allDay ? ymd(d.date) : ymd(d.date)) : Infinity;
  }
  const limit = ymd(startDate) + 731 * 86400000; // al massimo due anni: i calendari didattici sono più brevi
  const out = [];
  const add = (ms) => { if (ms >= ymd(startDate) && ms <= until && ms <= limit && out.length < Math.min(count, MAX_OCCURRENCES)) out.push(isoOf(ms)); };
  if (r.FREQ === "DAILY") {
    for (let ms = ymd(startDate); ms <= Math.min(until, limit) && out.length < Math.min(count, MAX_OCCURRENCES); ms += interval * 86400000) add(ms);
  } else if (r.FREQ === "WEEKLY") {
    const days = (r.BYDAY ? r.BYDAY.split(",").map((d) => DAYS[d.replace(/^[-+\d]+/, "")]).filter(Boolean) : [isoWeekday(startDate)]).sort((a, b) => a - b);
    const monday = ymd(startDate) - (isoWeekday(startDate) - 1) * 86400000;
    for (let w = 0; out.length < Math.min(count, MAX_OCCURRENCES); w++) {
      const base = monday + w * interval * 7 * 86400000;
      if (base > Math.min(until, limit)) break;
      for (const d of days) add(base + (d - 1) * 86400000);
    }
  } else add(ymd(startDate)); // MONTHLY/YEARLY non supportate: solo la prima occorrenza
  return out;
}

/* ------------------------------------- eventi ------------------------------------- */

/**
 * @returns {{events: {summary:string, title:string, date:string, start:string, end:string, room:string, location:string, description:string}[],
 *            stats: {total:number, cancelled:number, allDay:number, noEnd:number, recurring:number}}}
 */
export function parseIcs(text, { zone = DEFAULT_ZONE } = {}) {
  const body = unfold(text);
  const blocks = [...body.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/gi)].map((m) => readProps(m[1]));
  const stats = { total: blocks.length, cancelled: 0, allDay: 0, noEnd: 0, recurring: 0 };
  const overridden = new Set(); // «uid|data»: occorrenze sostituite da una modifica singola (RECURRENCE-ID)
  for (const p of blocks) {
    const uid = p.find((x) => x.name === "UID")?.value;
    const rid = readDate(p.find((x) => x.name === "RECURRENCE-ID"), zone);
    if (uid && rid) overridden.add(`${uid}|${rid.date}`);
  }
  const events = [];
  for (const props of blocks) {
    const get = (n) => props.find((x) => x.name === n);
    if (/cancel/i.test(get("STATUS")?.value ?? "")) { stats.cancelled++; continue; }
    const s = readDate(get("DTSTART"), zone);
    if (!s) continue;
    if (s.allDay) { stats.allDay++; continue; }
    let e = readDate(get("DTEND"), zone);
    const dur = get("DURATION") ? readDuration(get("DURATION").value) : 0;
    const endMs = e?.ms ?? (dur ? s.ms + dur : null);
    if (endMs == null) { stats.noEnd++; continue; }
    e = utcToLocal(endMs, zone);
    const summary = unescape(get("SUMMARY")?.value ?? "").trim();
    const location = unescape(get("LOCATION")?.value ?? "").trim();
    const description = unescape(get("DESCRIPTION")?.value ?? "").trim();
    const base = { summary, title: titleCase(summary), start: s.time, end: e.time, room: shortRoom(location), location, description };
    const durMin = Math.round((endMs - s.ms) / 60000);
    const rrule = get("RRULE")?.value;
    if (rrule) {
      stats.recurring++;
      const uid = get("UID")?.value;
      const ex = new Set(props.filter((x) => x.name === "EXDATE").flatMap((x) => x.value.split(",").map((v) => readDate({ value: v.trim(), params: x.params }, zone)?.date)));
      for (const date of expandRule(rrule, s.date, zone)) {
        if (ex.has(date) || overridden.has(`${uid}|${date}`)) continue;
        // stessa ora locale, stessa durata (l'ora legale non sposta una lezione)
        const endLocal = (() => { const [hh, mm] = s.time.split(":").map(Number); const t = hh * 60 + mm + durMin; return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; })();
        events.push({ ...base, date, end: endLocal });
      }
    } else events.push({ ...base, date: s.date });
  }
  events.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { events, stats };
}

/** Intuisce se il calendario contiene lezioni (default) o appelli d'esame. */
export function guessIcsKind(events) {
  if (!events.length) return "orari";
  const exam = events.filter((e) => /\b(esame|appello|prova|scritto|orale|test)\b/i.test(e.summary)).length;
  return exam / events.length >= 0.5 && events.length <= 120 ? "esami" : "orari";
}

const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Eventi → righe con le intestazioni canoniche del tipo di importazione, così passano dagli stessi importatori dei CSV. */
export function icsRows(events, kind, headers) {
  const seen = new Set();
  const rows = [];
  for (const e of events) {
    const r =
      kind === "esami" ? [e.title, dmy(e.date), e.start, e.room, "", "", ""]
      : kind === "insegnamenti" ? [e.title, "", "", "", "", ""]
      : [e.title, dmy(e.date), e.start, e.end, e.room];
    const key = r.join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  return [headers, ...rows];
}
