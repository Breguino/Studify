// Date "calendario" (YYYY-MM-DD, fuso locale): niente orari, così i giorni non slittano con l'ora legale.
const pad = (n) => String(n).padStart(2, "0");

export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const toUTC = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

export function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESI[m - 1]} ${y}`;
}

export function fmtDay(iso) {
  const dow = new Date(toUTC(iso)).getUTCDay();
  const [, m, d] = iso.split("-").map(Number);
  return `${GIORNI[dow]} ${d} ${MESI[m - 1]}`;
}
