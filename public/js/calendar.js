// Il piano di un esame nel calendario del telefono o del computer (file .ics, RFC 5545): una sessione per giorno di
// studio, all'ora scelta e con un avviso, più il giorno dell'appello. È il promemoria che arriva anche ad app chiusa,
// senza server: lo manda il calendario. Funzioni pure, testate.
// Le ore sono «fluttuanti» (senza fuso): la sessione delle 18 resta alle 18 anche se viaggi.

const pad = (n) => String(n).padStart(2, "0");
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const day = (iso) => iso.replace(/-/g, "");
const nextDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
};

/** Testo di un campo: si proteggono \ ; , e gli a capo. */
export const escapeText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Righe di al massimo 75 byte (UTF-8), le successive iniziano con uno spazio; non si spezza mai un carattere. */
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // lo spazio iniziale delle righe di continuazione conta
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** «18:00» → [18, 0]; un orario non valido diventa le 18. */
export function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return [18, 0];
  return [+m[1], +m[2]];
}

/**
 * Il calendario di un esame.
 * `days`: i giorni del piano ({ date, minutes, tasks }); si tengono quelli da `today` in poi con minuti di studio.
 * `time`: ora di inizio delle sessioni; `alarm`: minuti di anticipo dell'avviso (0 = all'inizio).
 */
export function planToIcs({ exam, days, today, time = "18:00", alarm = 0, url = "", now = new Date(), sequence = 0, cancel = [] }) {
  const [hh, mm] = parseTime(time);
  const start = `T${pad(hh)}${pad(mm)}00`;
  const stamp = utcStamp(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Studify//Piano di studio//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Studify · ${exam.name}`)}`];
  const sessions = studyDays(days, today, exam.date);
  // SEQUENCE: chi riscarica aggiorna gli eventi con lo stesso UID invece di duplicarli (nei calendari che lo rispettano)
  const seqLine = `SEQUENCE:${Math.max(0, Math.round(sequence))}`;
  for (const d of sessions) {
    const tasks = (d.tasks ?? []).filter((t) => t.kind !== "rest" && t.minutes > 0);
    const desc = [...tasks.map((t) => `• ${t.title} (${t.minutes} min)`), url ? `Apri il piano: ${url}` : ""].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT",
      `UID:${exam.id}-${d.date}@studify`, // stesso giorno, stesso UID: riscaricando, i calendari che lo supportano aggiornano l'evento
      `DTSTAMP:${stamp}`,
      seqLine,
      `DTSTART:${day(d.date)}${start}`,
      `DURATION:PT${Math.round(d.minutes)}M`,
      `SUMMARY:${escapeText(`Studify · ${exam.name}: ${Math.round(d.minutes)} min`)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      ...(url ? [`URL:${url}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(`È ora di studiare ${exam.name}`)}`, `TRIGGER:-PT${Math.max(0, Math.round(alarm))}M`, "END:VALARM",
      "END:VEVENT");
  }
  // giorni scaricati la volta prima che nel piano non ci sono più: annullati, così non restano nel calendario
  for (const date of cancel.filter((x) => x >= today && !sessions.some((d) => d.date === x))) {
    lines.push("BEGIN:VEVENT", `UID:${exam.id}-${date}@studify`, `DTSTAMP:${stamp}`, seqLine, `DTSTART:${day(date)}${start}`, "DURATION:PT30M",
      `SUMMARY:${escapeText(`Studify · ${exam.name}: niente studio`)}`, "STATUS:CANCELLED", "END:VEVENT");
  }
  if (exam.date >= today) {
    lines.push("BEGIN:VEVENT", `UID:${exam.id}-appello@studify`, `DTSTAMP:${stamp}`, seqLine,
      `DTSTART;VALUE=DATE:${day(exam.date)}`, `DTEND;VALUE=DATE:${nextDay(exam.date)}`,
      `SUMMARY:${escapeText(`Esame: ${exam.name}`)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.map(foldLine).join("\r\n") + "\r\n", sessions: sessions.length };
}

/** Giorni con studio da `today` al giorno prima dell'esame. */
const studyDays = (days, today, examDate) => (days ?? []).filter((d) => d.date >= today && d.date < examDate && d.minutes > 0);

/** Che cosa c'era nel file scaricato: serve a capire più avanti se il piano è cambiato. */
export function calendarSnapshot({ exam, days, today, time, sequence = 0, at = new Date().toISOString() }) {
  const [hh, mm] = parseTime(time);
  return { at, sequence, examDate: exam.date, time: `${pad(hh)}:${pad(mm)}`, days: Object.fromEntries(studyDays(days, today, exam.date).map((d) => [d.date, Math.round(d.minutes)])) };
}

/**
 * Il calendario scaricato non corrisponde più al piano? Si guardano solo i giorni da oggi in poi
 * (quelli passati escono dal piano ogni giorno e non contano), più data dell'esame e ora.
 */
export function calendarStale(snap, { exam, days, today, time }) {
  if (!snap) return false;
  const now = calendarSnapshot({ exam, days, today, time });
  if (now.examDate !== snap.examDate || now.time !== snap.time) return true;
  const future = (o) => Object.entries(o).filter(([d]) => d >= today);
  const was = new Map(future(snap.days));
  const is = new Map(future(now.days));
  return was.size !== is.size || [...is].some(([d, m]) => was.get(d) !== m);
}

/** Nome del file: «studify-microeconomia.ics». */
export const icsFilename = (name) => `studify-${String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "esame"}.ics`;
