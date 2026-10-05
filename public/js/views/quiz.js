import { clipRich, rich, richParas } from "../math.js";
import * as api from "../api.js";
import { core } from "../core.js";
import { weakTopics, pickQuestions, recordScore } from "../progress.js";
import { statsFor } from "../domain.js";
import { examQuestionStats } from "../exam-questions.js";
import { keepOrder } from "../moodle.js";
import * as store from "../store.js";
import { badge, bar, emptyState, h, pct, shuffle, toast } from "../ui.js";

const KIND = { mcq: "Scelta multipla", open: "Domanda aperta", problem: "Esercizio" };

/** Lista di punti da spuntare. `ratio()` = frazione spuntata. */
function checklist(items, label) {
  const boxes = items.map((t) => h("input", { type: "checkbox" }));
  const el = h("div", { class: "stack", style: { gap: "6px" } }, h("b", { class: "small" }, label),
    h("ul", { class: "checklist" }, items.map((t, i) => h("li", {}, h("label", {}, boxes[i], h("span", {}, rich(t)))))));
  return { el, ratio: () => (boxes.length ? boxes.filter((b) => b.checked).length / boxes.length : 0), setFromText: (covered) => {
    const low = covered.map((c) => c.toLowerCase());
    items.forEach((t, i) => { boxes[i].checked = low.some((c) => c.includes(t.toLowerCase().slice(0, 18)) || t.toLowerCase().includes(c.slice(0, 18))); });
  } };
}

/**
 * Valutazione di una risposta libera: spunta autonoma dei punti + correzione AI facoltativa.
 * Restituisce { el, score() }.
 */
export function openReview({ question, reference, rubric, answer, language, referenceLabel = "Risposta di riferimento" }) {
  const points = rubric.length ? rubric : ["La mia risposta era corretta e completa"];
  const list = checklist(points, "Spunta i punti che la tua risposta copriva:");
  let ai = null;
  const out = h("div", { class: "stack", style: { gap: "10px" } });
  const aiBtn = h("button", { class: "btn small", type: "button", disabled: !core.ai.ai || !answer.trim() }, "Correggi con l'AI");
  const aiBox = h("div", {});
  aiBtn.addEventListener("click", async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = "Correzione in corso…";
    try {
      ai = await api.grade({ question, reference, rubric, answer, language });
      list.setFromText(ai.covered);
      aiBox.replaceChildren(h("div", { class: `callout ${ai.verdict === "corretta" ? "good" : ai.verdict === "errata" ? "bad" : "warn"}` },
        h("b", {}, `${ai.verdict[0].toUpperCase()}${ai.verdict.slice(1)} · ${pct(ai.score)}`), h("p", { style: { margin: "4px 0" } }, rich(ai.feedback)),
        ai.missing.length ? h("div", {}, h("b", { class: "small" }, "Mancava: "), rich(ai.missing.join("; "))) : null));
      aiBtn.remove();
    } catch (e) {
      toast(e.message, "error");
      aiBtn.disabled = false;
      aiBtn.textContent = "Correggi con l'AI";
    }
  });
  out.append(h("div", { class: "callout" }, h("b", {}, referenceLabel), ...richParas(reference)), list.el,
    h("div", { class: "row" }, aiBtn, !core.ai.ai ? h("span", { class: "muted small" }, "Correzione AI non disponibile: valuta tu stesso, con onestà.") : !answer.trim() ? h("span", { class: "muted small" }, "Scrivi una risposta per ottenere la correzione AI.") : null), aiBox);
  return { el: out, score: () => (ai ? ai.score : list.ratio()) };
}

/* ================================== QUIZ ================================== */

function pickSet(exam, query) {
  const mod = exam.module;
  const mode = query.get("mode") ?? "mixed";
  const topicIds = query.get("topics")?.split(",").filter(Boolean);
  const kind = query.get("kind") || undefined;
  const q = exam.qstats;
  if (mode === "mock") return pickQuestions(mod.questions, q, exam.type === "test" ? 20 : 10, {});
  if (mode === "official") {
    // esercizi delle esercitazioni con la soluzione ufficiale; di un'esercitazione sola, tutti e nell'ordine
    const set = query.get("set");
    const num = (x) => Number.parseInt(x.official.key.split("#")[1], 10) || 0;
    const pool = mod.questions.filter((x) => x.official && (!set || x.official.key.startsWith(`${set}#`)) && (!topicIds || topicIds.includes(x.topicId)));
    return set ? pool.sort((a, b) => num(a) - num(b)).slice(0, 40) : pickQuestions(pool, q, 8, { kind });
  }
  if (mode === "exam") {
    const { inQuiz, weight } = examQuestionStats(exam);
    return pickQuestions(inQuiz, q, Number(query.get("n")) || 10, { topicIds, bonus: (x) => (weight(x) - 1) * 0.1 });
  }
  if (mode === "weak") {
    let set = pickQuestions(mod.questions, q, 10, { weakOnly: true });
    if (!set.length) set = pickQuestions(mod.questions, q, 8, { topicIds: weakTopics(mod, statsFor(exam).stats, 3).map((t) => t.id) });
    return set;
  }
  if (mode === "topics") return pickQuestions(mod.questions, q, 8, { topicIds, kind });
  return pickQuestions(mod.questions, q, 10, { kind });
}

export function quizView(exam, query) {
  const mod = exam.module;
  if (!mod?.questions.length)
    return emptyState("Nessuna domanda disponibile", mod?.local ? "Il modulo in modalità base non include quiz: con l'AI vengono generati automaticamente." : "Crea il modulo per ottenere domande.", h("a", { class: "btn", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  const mode = query.get("mode") ?? "mixed";
  const mock = mode === "mock";
  const taskId = query.get("task");
  let set = pickSet(exam, query);
  if (!set.length && mode === "official") return emptyState("Nessun esercizio delle esercitazioni nel quiz", "Carica le esercitazioni con le soluzioni nei materiali (tipo «Esercizi») e mettile nel quiz: testo e soluzione restano quelli ufficiali.", h("a", { class: "btn", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  if (!set.length && mode === "exam") return emptyState("Nessuna domanda d'esame nel quiz", "Carica un elenco di domande d'esame nei materiali (tipo «Domande d'esame») e aggiungilo al modulo: ogni domanda diventa una domanda del quiz con la risposta modello.", h("a", { class: "btn", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  if (!set.length) return emptyState("Niente da ripassare qui", "Nessuna domanda corrisponde ai filtri o non hai ancora errori da rivedere.", h("a", { class: "btn", href: `#/exam/${exam.id}/quiz?mode=mixed` }, "Quiz misto"));
  const examStats = examQuestionStats(exam);
  if (mode !== "mock") set = [...set]; // già interleaved da pickQuestions

  const items = set.map((q) => ({ q, answer: q.kind === "mcq" ? null : "", score: null }));
  let i = 0;
  let phase = "answer"; // answer | review | done
  const started = Date.now();
  const root = h("div", { class: "session" });
  const clock = h("span", { class: "muted small" }, "0:00");
  if (mock) {
    const t = setInterval(() => {
      if (!clock.isConnected && phase !== "done") return clearInterval(t);
      const s = Math.floor((Date.now() - started) / 1000);
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (phase === "done") clearInterval(t);
    }, 1000);
  }

  const head = () => h("div", { class: "session-head" },
    h("a", { class: "muted", href: `#/exam/${exam.id}/today` }, "← Esci"),
    h("div", { class: "row" }, mock ? badge(phase === "review" ? "correzione" : "simulazione", "warn") : null, mock && phase === "answer" ? clock : null,
      h("span", { class: "muted small" }, `${i + 1}/${items.length} · ${mod.topics.find((t) => t.id === items[i].q.topicId)?.title ?? ""}`)));

  const commit = (it) => {
    exam.qstats = recordScore(exam.qstats, it.q.id, it.score);
    store.logActivity(exam);
    store.save();
  };

  function advanceAnswer() {
    if (!mock) { phase = "review"; return render(); }
    if (i < items.length - 1) { i++; return render(); }
    phase = "review"; i = 0; render();
  }

  function advanceReview(score) {
    const it = items[i];
    it.score = score;
    commit(it);
    if (i < items.length - 1) { i++; phase = mock ? "review" : "answer"; return render(); }
    phase = "done";
    render();
  }

  function mcqScreen(it, reveal) {
    const q = it.q;
    // le domande del docente si ripetono: alternative in ordine diverso ogni volta, per ricordare il concetto e non la lettera
    // (non se una alternativa dipende dalla posizione, come «tutte le precedenti»)
    it.order ??= q.official && !keepOrder(q.options) ? shuffle(q.options.map((_, k) => k)) : q.options.map((_, k) => k);
    const opts = h("div", { class: "options" }, it.order.map((k, pos) => {
      const o = q.options[k];
      const cls = reveal ? (k === q.correctIndex ? "correct" : k === it.answer ? "wrong" : "") : it.answer === k ? "correct" : "";
      return h("button", { class: `btn option ${cls}`, disabled: reveal, "aria-pressed": !reveal && it.answer === k ? "true" : null, onclick: () => {
        it.answer = k;
        if (!mock) { phase = "review"; render(); } else render();
      } }, `${String.fromCharCode(65 + pos)}. `, rich(o));
    }));
    return opts;
  }

  function render() {
    const it = items[i];
    if (phase === "done") return summary();
    const q = it?.q;
    const w = examStats.weight(q);
    const examBadge = w ? badge(`domanda d'esame vera${w > 1 ? ` · chiesta ${w} volte` : ""}`, "bad") : q.official ? badge(`${q.official.source} · ${q.official.quiz ? "risposta del docente" : "soluzione ufficiale"}`, "good") : null;
    const body = [head(), bar(i / items.length, { label: "avanzamento" }), h("div", { class: "card stack", style: { marginTop: "14px" } }, h("div", { class: "row" }, badge(KIND[q.kind]), examBadge), h("div", { class: "q-prompt" }, richParas(q.prompt)))];
    const card = body.at(-1);

    if (phase === "answer") {
      if (q.kind === "mcq") {
        card.append(mcqScreen(it, false));
        if (mock) card.append(h("div", {}, h("button", { class: "btn primary", disabled: it.answer == null, onclick: advanceAnswer }, i < items.length - 1 ? "Conferma e avanti" : "Consegna e correggi")));
      } else {
        const ta = h("textarea", { placeholder: "Scrivi la tua risposta, senza guardare gli appunti…", "aria-label": "La tua risposta" });
        ta.value = it.answer;
        ta.addEventListener("input", () => (it.answer = ta.value));
        card.append(ta, h("div", {}, h("button", { class: "btn primary", onclick: advanceAnswer }, mock ? (i < items.length - 1 ? "Avanti" : "Consegna e correggi") : "Controlla")));
        setTimeout(() => ta.focus());
      }
    } else {
      // review
      if (q.kind === "mcq") {
        const ok = it.answer === q.correctIndex;
        card.append(mcqScreen(it, true), h("div", { class: `callout ${ok ? "good" : "bad"}` }, h("b", {}, it.answer == null ? "Nessuna risposta." : ok ? "Corretto." : "Non proprio."), " ", rich(q.explanation)),
          h("div", {}, h("button", { class: "btn primary", onclick: () => advanceReview(ok ? 1 : 0) }, i < items.length - 1 ? "Avanti" : "Vedi il risultato")));
      } else {
        card.append(h("div", { class: "callout", style: { background: "var(--surface-2)" } }, h("b", { class: "small" }, "La tua risposta"), h("p", { style: { margin: "4px 0 0", whiteSpace: "pre-wrap" } }, it.answer.trim() || "(vuota)")));
        const rv = openReview({ question: q.prompt, reference: q.modelAnswer, rubric: q.rubric, answer: it.answer, language: exam.language, referenceLabel: q.official ? "Soluzione ufficiale" : undefined });
        // append() del DOM scrive «null» come testo: i pezzi facoltativi si filtrano
        card.append(...[rv.el, q.explanation && !q.official ? h("div", { class: "muted small" }, richParas(q.explanation)) : null,
          q.official ? h("p", { class: "muted small", style: { margin: 0 } }, "Se la tua strada è diversa ma arriva allo stesso risultato, non è per forza sbagliata; e anche le soluzioni ufficiali a volte hanno errori: nel dubbio chiedi la correzione a Claude.") : null,
          q.followUp && w ? h("div", { class: "callout follow-up" }, h("b", {}, "Il docente potrebbe incalzare: "), rich(q.followUp),
            h("div", { class: "small muted" }, "Rispondi a voce, senza guardare: all'orale conta saper andare oltre la prima risposta.")) : null,
          h("div", {}, h("button", { class: "btn primary", onclick: () => advanceReview(rv.score()) }, i < items.length - 1 ? "Conferma e avanti" : "Conferma e vedi il risultato"))].filter(Boolean));
      }
    }
    root.replaceChildren(...body);
  }

  function summary() {
    if (taskId) { exam.done[taskId] = true; store.save(); }
    const total = items.reduce((s, it) => s + it.score, 0) / items.length;
    const byTopic = new Map();
    for (const it of items) { const a = byTopic.get(it.q.topicId) ?? []; a.push(it.score); byTopic.set(it.q.topicId, a); }
    const missed = items.filter((it) => it.score < 0.7);
    const mins = Math.max(1, Math.round((Date.now() - started) / 60000));
    root.replaceChildren(h("div", { class: "stack" },
      h("div", { class: "card stack" },
        h("div", { class: "row between" }, h("div", {}, h("div", { class: "muted small" }, mock ? `Simulazione · ${mins} min` : mode === "exam" ? "Domande d'esame vere" : mode === "official" ? (items.every((x) => x.q.official?.quiz) ? "Quiz del docente" : "Esercitazione") : "Risultato"), h("div", { class: "score-big" }, pct(total))), h("div", { class: "muted" }, `${items.length - missed.length}/${items.length} solide`)),
        bar(total, { tone: total >= 0.75 ? "good" : total >= 0.5 ? "warn" : "bad", label: "punteggio" }),
        h("div", { class: "stack", style: { gap: "6px" } }, [...byTopic].map(([tid, sc]) => h("div", { class: "progress-line" }, h("span", { class: "small", style: { minWidth: "40%" } }, mod.topics.find((t) => t.id === tid)?.title), bar(sc.reduce((a, b) => a + b, 0) / sc.length), h("span", { class: "small" }, pct(sc.reduce((a, b) => a + b, 0) / sc.length))))),
        h("p", { class: "muted small", style: { margin: 0 } }, total >= 0.8 ? "Buon livello. Rifallo tra qualche giorno: ricordare a distanza è ciò che fissa." : "Gli errori sono utili: tornano nei prossimi quiz finché non li superi.")),
      missed.length ? h("div", { class: "card stack" }, h("h3", {}, "Da rivedere"), missed.map((it) => h("details", {}, h("summary", {}, rich(clipRich(it.q.prompt, 160))), h("div", { class: "callout", style: { marginTop: "6px" } }, it.q.kind === "mcq" ? [rich(it.q.options[it.q.correctIndex]), " — ", rich(it.q.explanation)] : richParas(it.q.modelAnswer))))) : null,
      h("div", { class: "row" }, missed.length ? h("a", { class: "btn primary", href: `#/exam/${exam.id}/quiz?mode=weak` }, "Rifai gli errori") : null, h("a", { class: missed.length ? "btn" : "btn primary", href: `#/exam/${exam.id}/today` }, "Torna al piano"), h("a", { class: "btn ghost", href: `#/exam/${exam.id}/progress` }, "Vedi i progressi"))));
  }
  render();
  return root;
}

/* ================================ SPIEGAZIONE ================================ */

function pickOral(mod, n = 3) {
  const pool = [...mod.topics];
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, t) => s + t.importance, 0);
    let r = Math.random() * total;
    const idx = pool.findIndex((t) => (r -= t.importance) < 0);
    out.push(...pool.splice(idx < 0 ? 0 : idx, 1));
  }
  return out;
}

export function explainView(exam, tid, query) {
  const mod = exam.module;
  if (!mod) return emptyState("Nessun modulo", "Crea prima il modulo.");
  const oral = tid === "oral";
  const topics = oral ? pickOral(mod) : [mod.topics.find((t) => t.id === tid)].filter(Boolean);
  if (!topics.length) return emptyState("Argomento non trovato", "", h("a", { class: "btn", href: `#/exam/${exam.id}/module` }, "Modulo"));
  const taskId = query.get("task");
  const root = h("div", { class: "session" });
  const scores = [];
  let i = 0;

  function step() {
    const t = topics[i];
    const ta = h("textarea", { placeholder: oral ? "Puoi parlare ad alta voce e lasciare vuoto, oppure scrivere i punti principali…" : "Scrivi la tua spiegazione…", style: { minHeight: "200px" }, "aria-label": "La tua spiegazione" });
    const card = h("div", { class: "card stack", style: { marginTop: "14px" } },
      h("h2", { style: { margin: 0 } }, rich(t.title)),
      h("p", { class: "muted", style: { margin: 0 } }, oral ? "Immagina di essere all'orale: il docente ti chiede questo argomento. Spiegalo in modo chiaro, senza appunti, in 2-3 minuti." : "Spiega l'argomento con parole tue, come se lo insegnassi a un compagno. Niente appunti: se ti blocchi, quel punto è da ripassare."),
      ta, h("div", {}, h("button", { class: "btn primary", onclick: () => review(t, ta.value) }, "Ho finito: controlla")));
    root.replaceChildren(
      h("div", { class: "session-head" }, h("a", { class: "muted", href: `#/exam/${exam.id}/today` }, "← Esci"), h("span", { class: "muted small" }, oral ? `Argomento ${i + 1}/${topics.length}` : "Spiegazione")),
      card);
    setTimeout(() => ta.focus());
  }

  function review(t, answer) {
    const points = t.mustKnow.length ? t.mustKnow : t.keyConcepts.map((k) => `Saper spiegare: ${k.term}`);
    const reference = [t.summary, ...t.keyConcepts.map((k) => `${k.term}: ${k.definition}`)].join("\n");
    const rv = openReview({ question: `Spiega: ${t.title}`, reference, rubric: points, answer, language: exam.language });
    const last = i === topics.length - 1;
    root.replaceChildren(
      h("div", { class: "session-head" }, h("a", { class: "muted", href: `#/exam/${exam.id}/today` }, "← Esci"), h("span", { class: "muted small" }, t.title)),
      h("div", { class: "card stack" }, h("h2", { style: { margin: 0 } }, "Confronta con i punti chiave"),
        answer.trim() ? h("div", { class: "callout", style: { background: "var(--surface-2)" } }, h("b", { class: "small" }, "La tua spiegazione"), h("p", { style: { margin: "4px 0 0", whiteSpace: "pre-wrap" } }, answer)) : null,
        rv.el,
        h("div", {}, h("button", { class: "btn primary", onclick: () => {
          const s = rv.score();
          scores.push(s);
          exam.qstats = recordScore(exam.qstats, `x:${t.id}`, s);
          store.logActivity(exam);
          store.save();
          if (!last) { i++; return step(); }
          if (taskId) { exam.done[taskId] = true; store.save(); }
          done();
        } }, last ? "Concludi" : "Prossimo argomento"))));
  }

  function done() {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    root.replaceChildren(h("div", { class: "card stack", style: { textAlign: "center" } },
      h("h2", {}, "Fatto"), h("div", { class: "score-big" }, pct(avg)), h("p", { class: "muted" }, avg >= 0.75 ? "Spieghi bene questi argomenti." : "I punti non spuntati sono quelli da rivedere: rileggi l'argomento e riprova domani."),
      h("div", { class: "row", style: { justifyContent: "center" } }, h("a", { class: "btn primary", href: `#/exam/${exam.id}/today` }, "Torna al piano"), h("a", { class: "btn", href: `#/exam/${exam.id}/progress` }, "Progressi"))));
  }
  step();
  return root;
}
