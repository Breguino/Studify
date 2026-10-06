// Dal testo posizionato di un PDF a righe/celle di tabella, testo semplice o «layout» a colonne allineate.
// Funzioni pure: lavorano su {str, x, y, w, h} (coordinate PDF: y cresce verso l'alto).

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Larghezza media di un carattere (mediana su elementi con almeno 2 caratteri). */
export function charWidth(items) {
  const m = median(items.filter((i) => i.str.length >= 2 && i.w > 0).map((i) => i.w / i.str.length));
  return m > 1 ? m : 5;
}

/** Raggruppa gli elementi in righe visive (dall'alto in basso), ciascuna ordinata per x. */
export function clusterRows(items) {
  if (!items.length) return [];
  const tol = Math.max(2, 0.45 * median(items.map((i) => i.h).filter((h) => h > 0)) || 3);
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= tol) { row.items.push(it); row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length; }
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => ({ y: r.y, items: r.items.sort((a, b) => a.x - b.x) }));
}

/** Celle di una riga: un nuovo elemento a destra di uno spazio più largo di ~1,4 caratteri inizia una nuova cella. */
export function cellsOfRow(items, cw) {
  const cells = [];
  let prevEnd = -Infinity;
  for (const it of items) {
    const gap = it.x - prevEnd;
    if (!cells.length || gap > Math.max(cw * 1.4, 6)) cells.push(it.str.trim());
    else cells[cells.length - 1] += (gap > cw * 0.25 ? " " : "") + it.str.trim();
    prevEnd = it.x + it.w;
  }
  return cells.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const isPageNumber = (cells) => cells.length <= 2 && /^(?:pag(?:ina|\.)?\s*)?\d+(?:\s*(?:di|\/)\s*\d+)?$/i.test(cells.join(" ").trim());

/** Righe del documento con, per ciascuna, se è preceduta da uno spazio verticale insolitamente grande (≈ riga vuota). */
function collect(pages) {
  const all = [];
  let first = null;
  for (const p of pages) {
    const cw = charWidth(p.items);
    const clustered = clusterRows(p.items);
    const gaps = clustered.slice(1).map((r, i) => clustered[i].y - r.y);
    const pitch = median(gaps);
    for (const [i, r] of clustered.entries()) {
      const cells = cellsOfRow(r.items, cw);
      if (!cells.length || isPageNumber(cells)) continue;
      if (first && p.num > 1 && i < 4 && cells.join("\u0001") === first.join("\u0001")) continue;
      first ??= cells.length >= 3 ? cells : null; // l'intestazione è la prima riga con almeno 3 celle
      all.push({ cells, blankBefore: i > 0 && pitch > 0 && clustered[i - 1].y - r.y > pitch * 1.7 });
    }
  }
  return all;
}

/**
 * Righe di tabella di tutto il documento. Toglie i numeri di pagina e le intestazioni ripetute a ogni pagina.
 * Con `blanks: true` uno spazio verticale insolitamente grande diventa una riga vuota ([]), utile a chiudere i gruppi.
 */
export function pagesToRows(pages, { blanks = false } = {}) {
  return collect(pages).flatMap((r) => [...(blanks && r.blankBefore ? [[]] : []), r.cells]);
}

/** Righe come testo semplice (celle separate da due spazi). Uno spazio verticale grande diventa una riga vuota. */
export function plainLines(pages) {
  return collect(pages).flatMap((r) => [...(r.blankBefore ? [""] : []), r.cells.join("  ")]);
}

/**
 * Testo con le colonne allineate come nella pagina (simile a `pdftotext -layout`): serve a leggere orari a griglia,
 * dove la posizione di una cella dice a quale giorno appartiene.
 * @returns {{text: string, chars: number}}
 */
export function layoutText(pages, { maxWidth = 200 } = {}) {
  const out = [];
  for (const p of pages) {
    let cw = charWidth(p.items);
    const maxX = Math.max(0, ...p.items.map((i) => i.x + i.w));
    if (maxX / cw > maxWidth) cw = maxX / maxWidth;
    out.push(`=== Pagina ${p.num} ===`);
    for (const r of clusterRows(p.items)) {
      let line = "";
      for (const it of r.items) {
        const col = Math.round(it.x / cw);
        line = line.padEnd(Math.max(col, line.length + (line ? 1 : 0)), " ") + it.str.trim();
      }
      if (line.trim()) out.push(line.trimEnd());
    }
  }
  const text = out.join("\n");
  return { text, chars: text.length };
}

/** Il PDF ha un livello di testo utile? (un documento scansionato ha pagine ma nessun testo) */
export const hasText = (pages) => pages.reduce((n, p) => n + p.items.reduce((m, i) => m + i.str.trim().length, 0), 0) >= 40;
