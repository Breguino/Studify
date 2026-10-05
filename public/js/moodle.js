// Quiz del docente su Moodle: la pagina di revisione di un tentativo (copiata, salvata come pagina web o stampata in PDF) ha le
// domande, le alternative e, se il docente la mostra, la risposta corretta. L'app le divide e le mette nel quiz così come sono,
// come gli esercizi delle esercitazioni (vedi exercises.js); a Claude si chiede solo l'argomento.

const HEAD = /^(?:domanda|question)\s+(\d{1,3})\s*$/i;
const INFO = /^(?:informazione|information)\s*$/i;
const NOISE = /^(?:punteggio ottenuto|punteggio max|punteggio massimo|mark\s|marked out of|not graded|senza valutazione)\b|^(?:contrassegna domanda|rimuovi contrassegno|flag question|remove flag|modifica domanda|edit question|testo della domanda|question text|domanda contrassegnata|termina revisione|finish review|navigazione del quiz|quiz navigation|mostra una pagina alla volta|show one page at a time|mostra tutte le domande in una pagina|show all questions on one page)$/i;
const STATE = /^(?:risposta (?:corretta|errata|non data|parzialmente corretta|salvata)|corretta|errata|parzialmente corretta|non risposto|completo|non completata|correct|incorrect|partially correct|not answered|answer saved|complete|incomplete|not complete)\.?$/i;
const CHOOSE = /^(?:scegli un['’]alternativa|scegli una o più alternative|seleziona una o più alternative|select one|select one or more)\s*:?\s*$/i;
const ANSWER_LINE = /^(?:risposta|answer)\s*:\s*(.*)$/i;
const RIGHT = /^(?:la risposta corretta è|le risposte corrette sono|the correct answer is|the correct answers are)\s*:?\s*(.*)$/i;
const FEEDBACK = /^(?:feedback|commento|spiegazione)\s*:\s*(.*)$/i;
const LETTER = /^([a-z])[.)]\s*(.*)$/;

const tex = (s) => String(s ?? "").replace(/\\\((.+?)\\\)/g, (_, x) => `$${x.trim()}$`).replace(/\\\[(.+?)\\\]/g, (_, x) => `$$${x.trim()}$$`);
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFC").replace(/[’‘`´]/g, "'").replace(/^['"“«]+|['"”».;:\s]+$/g, "").replace(/[\s$]+/g, " ").trim();

/** Le alternative indicate come corrette: uguali alla risposta corretta, o (con più risposte) contenute in essa. */
function matchCorrect(options, answer, multi) {
  const a = norm(answer);
  if (!a) return [];
  const eq = options.map((o, i) => (norm(o) === a ? i : -1)).filter((i) => i >= 0);
  if (eq.length === 1) return eq;
  if (!multi) {
    const inside = options.map((o, i) => (norm(o).length > 2 && (a.includes(norm(o)) || norm(o).includes(a)) ? i : -1)).filter((i) => i >= 0);
    return inside.length === 1 ? inside : [];
  }
  return options.map((o, i) => (norm(o).length > 0 && a.includes(norm(o)) ? i : -1)).filter((i) => i >= 0);
}

/** Le righe delle alternative → alternative: «a. testo» (o «a.» e il testo sotto, su più righe), oppure una per riga (Vero/Falso). */
function splitOptions(lines) {
  if (!lines.some((l) => LETTER.test(l))) return lines;
  const out = [];
  for (const l of lines) {
    const m = l.match(LETTER);
    if (m) out.push(m[2]);
    else if (out.length) out[out.length - 1] = out.at(-1) ? `${out.at(-1)} ${l}` : l;
  }
  return out;
}

/** Una domanda della pagina di revisione (le righe dopo «Domanda n»). */
function parseBlock(n, lines) {
  const ls = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !NOISE.test(l));
  const part = { text: [], options: [], feedback: [], right: [] };
  let multi = false;
  let phase = "text"; // text → options → feedback → right
  for (const l of ls) {
    const r = l.match(RIGHT);
    const f = l.match(FEEDBACK);
    if (r) { phase = "right"; if (r[1]) part.right.push(r[1]); continue; }
    if (f) { phase = "feedback"; if (f[1]) part.feedback.push(f[1]); continue; }
    if (STATE.test(l)) { if (phase === "options") phase = "feedback"; continue; } // lo stato in cima, o «Risposta errata.» dopo le alternative
    if (phase === "text" && CHOOSE.test(l)) { phase = "options"; multi = /più|more/i.test(l); continue; }
    if (phase === "text" && ANSWER_LINE.test(l) && part.text.length) { phase = "feedback"; continue; } // risposta breve: «Risposta: …» (quella data)
    part[phase].push(l);
  }
  const answer = tex(part.right.join(" ").replace(/^['"“«]+|['"”»]+\.?$/g, "").replace(/\.$/, "").trim());
  const options = splitOptions(part.options).map((o) => tex(o.trim())).filter(Boolean);
  const kind = options.length >= 2 ? (multi ? "multi" : "mcq") : "short";
  return { n: String(n), text: tex(part.text.join("\n")), options, correct: kind === "short" ? [] : matchCorrect(options, answer, multi), answer, kind, feedback: tex(part.feedback.join(" ")) };
}

/**
 * La pagina di revisione di un quiz Moodle → domande. Riconosciuta se ha almeno 2 «Domanda n» e i segni di Moodle
 * («Scegli un'alternativa», «La risposta corretta è», «Punteggio ottenuto»…).
 * @returns {null | {n: string, text: string, options: string[], correct: number[], answer: string, kind: "mcq"|"multi"|"short", feedback: string}[]}
 */
export function parseMoodleQuiz(raw) {
  const lines = String(raw ?? "").replace(/\r/g, "").replace(/\f/g, "\n").split("\n");
  if (!lines.some((l) => CHOOSE.test(l.trim()) || RIGHT.test(l.trim()) || /^(punteggio ottenuto|mark \d)/i.test(l.trim()))) return null;
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    const h = l.trim().match(HEAD);
    if (h) { cur = { n: h[1], lines: [] }; blocks.push(cur); continue; }
    if (INFO.test(l.trim())) { cur = null; continue; } // descrizione, non una domanda
    if (cur) cur.lines.push(l);
  }
  if (blocks.length < 2) return null;
  const seen = new Set();
  return blocks.map((b) => parseBlock(b.n, b.lines)).filter((q) => q.text && !seen.has(q.n) && seen.add(q.n));
}

/** Pronta per il quiz: una sola risposta giusta tra le alternative, o una risposta breve con la soluzione. */
export const usable = (q) => (q.kind === "mcq" ? q.correct.length === 1 : !!q.answer);

/** Ordine delle alternative fisso se dipende dalla posizione («tutte le precedenti», «a e b») e per Vero/Falso. */
export const keepOrder = (options) => options.every((o) => /^(vero|falso|true|false)$/i.test(o.trim())) || options.some((o) => /precedent|tutte le|nessuna delle|entramb|\bsia [a-d]\b|\b[a-d] e [a-d]\b|above|all of|none of|both/i.test(o));

/**
 * Pagina di revisione salvata da Moodle (.html) → testo come quello copiato dalla pagina, che parseMoodleQuiz legge.
 * Solo nel browser (serve DOMParser). null se non è una pagina di quiz.
 */
export function moodleHtmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const ques = [...doc.querySelectorAll(".que")];
  if (!ques.length) return null;
  const text = (el) => {
    if (!el) return "";
    const c = el.cloneNode(true);
    c.querySelectorAll("script[type^='math/tex']").forEach((s) => s.replaceWith(`\\(${s.textContent}\\)`));
    c.querySelectorAll(".MathJax_Preview, .MathJax, .MathJax_Display, .accesshide, .sr-only, .visually-hidden, input").forEach((x) => x.remove());
    c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    c.querySelectorAll("p, div, li, tr").forEach((b) => b.append("\n"));
    return c.textContent.replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  };
  const out = [];
  ques.forEach((q, i) => {
    if (q.classList.contains("description")) return;
    const n = q.querySelector(".qno")?.textContent.trim() || String(i + 1);
    out.push(`Domanda ${n}`, text(q.querySelector(".qtext")));
    const rows = [...q.querySelectorAll(".answer > div, .answer > tr, .answer .r0, .answer .r1")].filter((r, k, all) => !all.some((o) => o !== r && o.contains(r)));
    if (rows.length) {
      out.push(q.querySelector(".answer input[type='checkbox']") ? "Scegli una o più alternative:" : "Scegli un'alternativa:");
      rows.forEach((r, k) => {
        const letter = r.querySelector(".answernumber")?.textContent.trim().replace(/[.)]$/, "");
        r.querySelector(".answernumber")?.remove();
        out.push(`${letter || String.fromCharCode(97 + k)}. ${text(r).replace(/\n/g, " ")}`);
      });
    }
    const fb = text(q.querySelector(".generalfeedback"));
    if (fb) out.push(`Feedback: ${fb.replace(/\n/g, " ")}`);
    const right = text(q.querySelector(".rightanswer"));
    if (right) out.push(right.replace(/\n/g, " "));
  });
  return out.join("\n");
}

/* ------------------------- solo per le prove ------------------------- */
export { matchCorrect };
