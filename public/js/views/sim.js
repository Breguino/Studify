// Simulazione d'esame con una prova vera degli anni passati: a tempo, senza appunti, poi la correzione (Claude o da soli).
// La simulazione in corso è salvata nell'esame (exam.simDraft): si può uscire e riprenderla, il tempo continua a scorrere.
import * as api from "../api.js";
import { core } from "../core.js";
import { fmtDate, today } from "../dates.js";
import { blobToBase64, byName, isImage, prepareImage } from "../images.js";
import { renderMarkdown } from "../markdown.js";
import { rich, richParas } from "../math.js";
import { go } from "../nav.js";
import { extractPdfPages } from "../pdf-pages.js";
import { allPapers, analysisValid, attemptsOf, fmtGrade, minutesSince, nextPaper, paperMinutes, paperText, simScore } from "../past-exams.js";
import { recordScore } from "../progress.js";
import { uncertainCount } from "../../../shared/prompts.js";
import * as store from "../store.js";
import { badge, confirmDialog, emptyState, h, toast, uid } from "../ui.js";
import { examInfo, paperForApi, topicList } from "./esami.js";

const jobs = new Map(); // esame → { el, label }
const SERVER_BATCH = 12; // foto per richiesta al server
const VERDICT_TONE = { corretto: "good", parziale: "warn", errato: "bad", "non svolto": "bad" };

const back = (exam) => h("a", { class: "muted", href: `#/exam/${exam.id}/esami` }, "← Esami passati");
const paperOf = (exam, key) => allPapers(exam).find((p) => p.key === key);
const clock = (sec) => {
  const s = Math.abs(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

async function busy(exam, label, fn) {
  if (jobs.has(exam.id)) return;
  const job = { el: null, label };
  jobs.set(exam.id, job);
  core.rerender();
  try {
    await fn((chars, l) => {
      job.label = l ?? `${label} ~${Math.round(chars / 1000)}k caratteri`;
      if (job.el) job.el.textContent = job.label;
    });
  } catch (e) {
    toast(e.message, "error");
  } finally {
    jobs.delete(exam.id);
    store.save();
    core.rerender();
  }
}

function jobLine(exam) {
  const job = jobs.get(exam.id);
  if (!job) return null;
  job.el = h("span", {}, job.label);
  return h("div", { class: "callout row" }, h("span", { class: "spinner" }), job.el);
}

/** Il testo della prova (o il PDF, nella versione con server), con formule. */
function paperBox(exam, p) {
  const m = exam.materials.find((x) => x.id === p.materialId);
  const box = h("div", { class: "paper-box" });
  if (!m) return h("p", { class: "callout warn" }, "Il materiale con questa prova è stato rimosso.");
  if (m.kind === "pdf") {
    box.append(h("p", { class: "muted small" }, "Apro il PDF della prova…"));
    (async () => {
      try {
        const data = await store.getFile(m.fileId);
        if (!data) throw new Error("il file non c'è più");
        const whole = p.from === 1 && p.to === (m.numPages ?? p.to);
        const b64 = whole || !extractPdfPages ? data : await extractPdfPages(data, p.from, p.to);
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "application/pdf" }));
        box.replaceChildren(h("iframe", { src: url, title: `Testo della prova: ${p.label}`, class: "paper-pdf" }),
          h("a", { href: url, target: "_blank", rel: "noopener", class: "small" }, "Apri il PDF della prova in un'altra scheda"));
      } catch (e) {
        box.replaceChildren(h("p", { class: "callout bad" }, `Non riesco ad aprire il PDF: ${e.message}.`));
      }
    })();
    return box;
  }
  const text = paperText(m, p).replace(/\f/g, "\n\n");
  box.append(...(text.trim() ? renderMarkdown(keepLines(text)) : [h("p", { class: "muted" }, "La prova è vuota: se è una foto o una scansione, falla leggere a Claude nei materiali.")]));
  return box;
}

/** In una prova ogni riga conta («Durata: 2 ore» non va attaccata al titolo): una riga = un paragrafo, gli elenchi restano elenchi. */
function keepLines(text) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((l, i) => {
    out.push(l);
    const next = lines[i + 1];
    if (l.trim() && next?.trim() && !/^\s*(\d+[a-z]?[.)]|[-*•])\s/.test(next) && !/^\s*\$\$/.test(next) && !/\|/.test(next)) out.push("");
  });
  return out.join("\n");
}

export function simView(exam, query) {
  const viewId = query.get("view");
  if (viewId) {
    const s = (exam.simulations ?? []).find((x) => x.id === viewId);
    return s ? savedView(exam, s) : emptyState("Simulazione non trovata", "", h("a", { class: "btn", href: `#/exam/${exam.id}/esami` }, "Esami passati"));
  }
  const want = query.get("paper");
  const draft = exam.simDraft;
  if (draft && !paperOf(exam, draft.key)) { delete exam.simDraft; store.save(); } // la prova non c'è più tra i materiali
  else if (draft) return want && want !== draft.key ? conflictView(exam, draft, want) : draft.result ? resultView(exam, draft) : draft.submittedAt ? handedInView(exam, draft) : runningView(exam, draft);
  const papers = allPapers(exam);
  if (!papers.length) return emptyState("Nessuna prova d'esame", "Carica nei materiali i temi d'esame degli anni passati, con il tipo «Esami passati».", h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Materiali"));
  const paper = (want && paperOf(exam, want)) || nextPaper(exam);
  if (!paper) return h("div", { class: "stack", style: { maxWidth: "760px" } }, back(exam),
    h("div", { class: "callout" }, "Hai già fatto tutte le prove. Rifarne una conta meno (ricordi gli esercizi): conviene a distanza di settimane, o cercare prove nuove."),
    h("a", { class: "btn", href: `#/exam/${exam.id}/esami` }, "Scegli quale rifare"));
  return setupView(exam, paper, query.get("task"));
}

/* --------------------------------- prima di iniziare --------------------------------- */

function setupView(exam, p, taskId) {
  const tries = attemptsOf(exam, p.key);
  const an = analysisValid(exam) ? exam.pastExams.papers[p.key] : null;
  const minutes = paperMinutes(exam, p.key);
  const dur = h("input", { type: "number", id: "sim-duration", min: 10, max: 480, step: 5, value: minutes, style: { width: "90px" } });
  const ai = core.ai.ai;
  const preferText = exam.type === "test" || !ai;
  const radio = (value, checked) => h("input", { type: "radio", name: "sim-mode", value, checked });
  const onPaper = radio("paper", !preferText);
  const onScreen = radio("text", preferText);
  const start = () => {
    exam.simDraft = { key: p.key, label: p.label, materialId: p.materialId, durationMin: Math.min(480, Math.max(10, Math.round(Number(dur.value)) || minutes)), mode: onPaper.checked ? "paper" : "text",
      startedAt: new Date().toISOString(), answer: "", taskId: taskId ?? null };
    store.save();
    core.rerender();
  };
  return h("div", { class: "stack", style: { maxWidth: "760px" } }, back(exam),
    h("h1", { style: { marginBottom: 0 } }, "Simulazione d'esame"),
    h("div", { class: "card stack" },
      h("h2", { style: { margin: 0 } }, p.label),
      an ? h("div", { class: "muted small" }, [`${an.items.length} ${an.items.length === 1 ? "esercizio" : "esercizi"}`, an.hasSolutions ? "con soluzioni (non guardarle prima)" : ""].filter(Boolean).join(" · ")) : null,
      tries.length ? h("div", { class: "callout warn small" }, `L'hai già fatta il ${fmtDate(tries.at(-1).date)} (${fmtGrade(tries.at(-1).grade)}): la seconda volta conta meno, perché ricordi gli esercizi. Se puoi, scegline una nuova.`) : null,
      h("label", { class: "row", style: { gap: "8px", alignItems: "center", fontWeight: 400 } }, "Durata", dur, "minuti",
        h("span", { class: "muted small" }, an?.durationMin ? "(indicata nella prova)" : "(la prova non la indica: metti quella del tuo esame)")),
      h("fieldset", { class: "stack sim-mode", style: { gap: "6px" } }, h("legend", { class: "small" }, "Come rispondi"),
        h("label", { class: "row", style: { gap: "8px", fontWeight: 400, flexWrap: "nowrap" } }, onPaper, h("span", {}, h("b", {}, "Su carta, come all'esame"), ai ? " — alla consegna fotografi i fogli e Claude li trascrive" : " — alla consegna ti correggi da solo")),
        h("label", { class: "row", style: { gap: "8px", fontWeight: 400, flexWrap: "nowrap" } }, onScreen, h("span", {}, h("b", {}, "Scrivo qui"), " — comodo per test e domande aperte, meno per esercizi con formule"))),
      h("ul", { class: "small", style: { margin: 0 } },
        h("li", {}, "Niente appunti, libro o internet; la calcolatrice solo se all'esame è ammessa."),
        h("li", {}, "Il testo compare quando premi «Inizia»: il tempo parte subito e continua anche se esci dalla pagina."),
        h("li", {}, "Allo scadere consegna quello che hai: quello che manca è l'informazione più utile.")),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: start }, "Inizia la prova"), h("a", { class: "btn ghost", href: `#/exam/${exam.id}/esami` }, "Scegli un'altra prova"))));
}

function conflictView(exam, d, want) {
  const p = paperOf(exam, want);
  return h("div", { class: "stack", style: { maxWidth: "760px" } }, back(exam),
    h("div", { class: "callout warn" }, h("b", {}, "Hai già una simulazione in corso: "), `«${d.label}», iniziata ${minutesSince(d.startedAt)} minuti fa.`),
    h("div", { class: "row" },
      h("a", { class: "btn primary", href: `#/exam/${exam.id}/sim` }, "Riprendila"),
      p ? h("button", { class: "btn danger", onclick: async () => {
        if (!(await confirmDialog(`Abbandonare «${d.label}»? Lo svolgimento non viene salvato.`, { ok: "Abbandona", danger: true }))) return;
        delete exam.simDraft;
        store.save();
        core.rerender();
      } }, `Abbandonala e inizia «${p.label}»`) : null));
}

/* --------------------------------- durante la prova --------------------------------- */

function runningView(exam, d) {
  const p = paperOf(exam, d.key);
  const timer = h("span", { class: "sim-timer", role: "timer" });
  const late = h("div", { class: "callout bad", hidden: true }, "Tempo scaduto: all'esame consegneresti adesso. Consegna e guarda che cosa è mancato.");
  const tick = () => {
    const left = d.durationMin * 60 - Math.floor((Date.now() - Date.parse(d.startedAt)) / 1000);
    timer.textContent = left >= 0 ? `${clock(left)} rimasti` : `Tempo scaduto da ${clock(left)}`;
    timer.classList.toggle("soon", left >= 0 && left <= 300);
    timer.classList.toggle("late", left < 0);
    late.hidden = left >= 0;
  };
  tick();
  const iv = setInterval(() => (timer.isConnected ? tick() : clearInterval(iv)), 1000);
  const hand = async () => {
    const left = d.durationMin * 60 - (Date.now() - Date.parse(d.startedAt)) / 1000;
    if (left > 60 && !(await confirmDialog(`Ti restano ${clock(Math.floor(left))}. Consegnare adesso?`, { ok: "Consegna" }))) return;
    d.submittedAt = new Date().toISOString();
    d.minutes = minutesSince(d.startedAt);
    store.save();
    core.rerender();
  };
  let answer = null;
  if (d.mode === "text") {
    answer = h("textarea", { class: "sim-answer", placeholder: "Scrivi qui le risposte, numerate come nella prova (1., 2a., …). Le formule anche come $x^2$.", "aria-label": "Il tuo svolgimento" });
    answer.value = d.answer;
    answer.addEventListener("input", () => { d.answer = answer.value; store.save(); });
  }
  return h("div", { class: "stack sim" },
    h("div", { class: "session-head sim-head" },
      h("a", { class: "muted", href: `#/exam/${exam.id}/esami`, title: "La prova resta in corso: il tempo continua a scorrere" }, "← Esci (resta in corso)"),
      h("div", { class: "row" }, badge("simulazione", "warn"), timer)),
    h("h2", { style: { margin: 0 } }, p.label), late,
    h("div", { class: "card" }, paperBox(exam, p)),
    d.mode === "text" ? h("div", { class: "card stack" }, h("b", {}, "Il tuo svolgimento"), answer)
      : h("div", { class: "callout" }, "Svolgi la prova su carta, come all'esame. Quando consegni fotografi i fogli: Claude li trascrive e li corregge."),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: hand }, "Consegna"),
      h("button", { class: "btn ghost", onclick: async () => {
        if (!(await confirmDialog("Abbandonare la simulazione? Non viene salvata.", { ok: "Abbandona", danger: true }))) return;
        delete exam.simDraft;
        store.save();
        go(`#/exam/${exam.id}/esami`);
      } }, "Abbandona")));
}

/* ------------------------------------ consegna ------------------------------------ */

const imagesForApi = async (blobs) => (core.ai.artifact ? blobs : Promise.all(blobs.map(async (b) => ({ data: await blobToBase64(b), mediaType: b.type || "image/jpeg" }))));

/** Foto dei fogli → testo (scrittura a mano, formule in LaTeX), aggiunto allo svolgimento. */
function readSheets(exam, d, files) {
  files = files.filter(isImage).sort(byName);
  if (!files.length) return;
  if (files.length > 30) return toast("Al massimo 30 fogli per volta.", "error");
  busy(exam, "Claude legge i tuoi fogli…", async (onProgress) => {
    const blobs = [];
    for (const f of files) {
      try { blobs.push((await prepareImage(f)).blob); } catch (e) { toast(e.message, "error"); }
    }
    if (!blobs.length) return;
    const pages = [];
    const step = core.ai.artifact ? blobs.length : SERVER_BATCH;
    for (let k = 0; k < blobs.length; k += step) {
      const res = await api.runJob("/api/transcribe", { images: await imagesForApi(blobs.slice(k, k + step)), firstPage: (d.sheets ?? 0) + k + 1, title: `Svolgimento della prova «${d.label}»`, handwritten: true },
        (c, label) => onProgress(c, label ?? `Claude legge i tuoi fogli… ${Math.min(k + step, blobs.length)}/${blobs.length}`));
      pages.push(...res.pages);
    }
    const text = pages.map((t, i) => t ?? `[foglio ${(d.sheets ?? 0) + i + 1} non letto: riprova o scrivilo a mano]`).join("\n\n");
    d.answer = d.answer.trim() ? `${d.answer.trim()}\n\n${text}` : text;
    d.sheets = (d.sheets ?? 0) + blobs.length;
    const unsure = uncertainCount(text);
    toast(`Fogli trascritti${unsure ? `: ${unsure} ${unsure === 1 ? "parola incerta" : "parole incerte"} segnate con [?], controllale` : ""}.`, "ok");
  });
}

function selfItems(exam, d) {
  const an = analysisValid(exam) ? exam.pastExams.papers[d.key] : null;
  if (!an?.items.length) return [{ n: "—", task: "Tutta la prova", maxPoints: 30, points: 0, verdict: "", feedback: "", topicId: "" }];
  const share = Math.round((30 / an.items.length) * 10) / 10;
  return an.items.map((it) => ({ n: it.n, task: it.summary, maxPoints: it.points || share, points: 0, verdict: "", feedback: "", topicId: it.topicIds[0] ?? "" }));
}

function handedInView(exam, d) {
  const p = paperOf(exam, d.key);
  const ai = core.ai.ai;
  const working = jobs.has(exam.id);
  const ta = h("textarea", { class: "sim-answer", "aria-label": "Il tuo svolgimento", placeholder: d.mode === "paper" ? "Qui compare il testo dei tuoi fogli. Puoi anche scriverlo o correggerlo a mano." : "Il tuo svolgimento" });
  ta.value = d.answer;
  const camera = h("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, hidden: true, id: "sheet-camera", onchange: (e) => readSheets(exam, d, [...e.target.files]) });
  const files = h("input", { type: "file", accept: "image/*,.heic", multiple: true, hidden: true, id: "sheet-files", onchange: (e) => readSheets(exam, d, [...e.target.files]) });
  const unsure = uncertainCount(d.answer);
  const gradeAi = () => busy(exam, "Claude corregge la prova…", async (onProgress) => {
    if (!d.answer.trim()) throw new Error("Lo svolgimento è vuoto.");
    const paper = { ...(await paperForApi(exam, p)), durationMin: d.durationMin };
    const res = await api.runJob("/api/grade-exam", { exam: examInfo(exam), topics: exam.module ? topicList(exam) : [], paper, answer: d.answer, minutes: d.minutes }, onProgress);
    d.result = { ...res, by: "ai" };
  });
  const over = d.minutes - d.durationMin;
  const aiBtn = ai ? h("button", { class: "btn primary", disabled: working || !d.answer.trim(), onclick: gradeAi }, "Correggi con Claude") : null;
  const empty = ai ? h("p", { class: "muted small", style: { margin: 0 }, hidden: !!d.answer.trim() }, d.mode === "paper" ? "Per la correzione con Claude fotografa prima i fogli (o scrivi lo svolgimento)." : "Lo svolgimento è vuoto.") : null;
  ta.addEventListener("input", () => {
    d.answer = ta.value;
    store.save();
    if (aiBtn) aiBtn.disabled = working || !d.answer.trim();
    if (empty) empty.hidden = !!d.answer.trim();
  });
  return h("div", { class: "stack", style: { maxWidth: "820px" } }, back(exam),
    h("h1", { style: { marginBottom: 0 } }, "Prova consegnata"),
    h("p", { class: "muted", style: { margin: 0 } }, `${p.label} · ${d.minutes} minuti su ${d.durationMin}${over > 0 ? ` (${over} oltre il tempo)` : ""}.`),
    d.mode === "paper" && ai ? h("div", { class: "card stack" },
      h("h3", { style: { margin: 0 } }, d.sheets ? `Fogli letti: ${d.sheets}` : "Fotografa i tuoi fogli"),
      h("p", { class: "muted small", style: { margin: 0 } }, "Una foto per foglio, in ordine, dritta e con buona luce. Claude trascrive anche le formule; le parole incerte sono segnate con [?]."),
      h("div", { class: "row" }, h("button", { class: "btn", disabled: working, onclick: () => camera.click() }, "Fotografa i fogli"), h("button", { class: "btn ghost", disabled: working, onclick: () => files.click() }, d.sheets ? "Aggiungi altre foto" : "Carica le foto"), camera, files)) : null,
    jobLine(exam),
    h("div", { class: "card stack" }, h("b", {}, d.mode === "paper" ? "Lo svolgimento trascritto (controllalo)" : "Il tuo svolgimento"),
      unsure ? h("div", { class: "small callout warn" }, `${unsure} ${unsure === 1 ? "parola incerta" : "parole incerte"} [?]: correggile qui sotto prima della correzione, così Claude non valuta una lettura sbagliata.`) : null,
      ta),
    h("details", {}, h("summary", {}, "Testo della prova"), h("div", { class: "card", style: { marginTop: "8px" } }, paperBox(exam, p))),
    h("div", { class: "row" }, aiBtn,
      h("button", { class: `btn ${ai ? "" : "primary"}`, disabled: working, onclick: () => { d.result = { items: selfItems(exam, d), overall: "", priorities: [], readingIssues: [], by: "self" }; store.save(); core.rerender(); } }, "Mi correggo da solo")),
    empty);
}

/* ------------------------------------ correzione ------------------------------------ */

/** Giudizio coerente con i punti (quando lo studente li cambia). */
const verdictOf = (it) => (it.points >= it.maxPoints ? "corretto" : it.points > 0 ? "parziale" : it.verdict === "non svolto" ? "non svolto" : "errato");

function itemsList(items, { editable = false, onChange = () => {} } = {}) {
  return h("div", { class: "stack", style: { gap: "8px" } }, items.map((it) => {
    const tag = h("span", {});
    const showVerdict = () => tag.replaceChildren(...(it.verdict ? [badge(it.verdict, VERDICT_TONE[it.verdict])] : []), ...(it.edited ? [" ", badge("punti tuoi")] : []));
    showVerdict();
    const pts = editable
      ? h("input", { type: "number", class: "sim-points", min: 0, max: it.maxPoints, step: 0.5, value: it.points, "aria-label": `Punti dell'esercizio ${it.n}`,
          oninput: (e) => {
            it.points = Math.min(it.maxPoints, Math.max(0, Number(e.target.value) || 0));
            it.verdict = verdictOf(it);
            it.edited = true;
            showVerdict();
            onChange();
          } })
      : h("b", {}, String(it.points).replace(".", ","));
    return h("div", { class: "card flat stack sim-item", style: { gap: "4px" } },
      h("div", { class: "row between", style: { flexWrap: "nowrap", alignItems: "flex-start" } },
        h("div", {}, h("b", {}, it.n === "—" ? "Tutta la prova" : `Esercizio ${it.n}`), it.task && it.n !== "—" ? h("span", { class: "muted small" }, " — ", rich(it.task)) : null),
        h("div", { class: "row", style: { gap: "6px", flexWrap: "nowrap", alignItems: "center" } }, tag, pts, h("span", { class: "muted small", style: { whiteSpace: "nowrap" } }, `/ ${String(it.maxPoints).replace(".", ",")}`))),
      it.feedback ? h("div", { class: "small" }, ...richParas(it.feedback)) : null);
  }));
}

function scoreHead(items, { by, minutes, durationMin }) {
  const big = h("div", { class: "score-big" });
  const sub = h("div", { class: "muted small" });
  const upd = () => {
    const s = simScore(items);
    big.textContent = fmtGrade(s.grade);
    big.className = `score-big ${s.grade == null ? "" : s.grade >= 18 ? "good-text" : "bad-text"}`;
    sub.textContent = `${String(s.points).replace(".", ",")} punti su ${String(s.max).replace(".", ",")}${s.grade != null ? (s.grade >= 18 ? " · sufficiente" : " · insufficiente") : ""} · ${minutes} min su ${durationMin}`;
  };
  upd();
  return { el: h("div", {}, h("div", { class: "muted small" }, by === "ai" ? "Voto stimato (correzione di Claude)" : "Voto stimato (autocorrezione)"), big, sub), upd };
}

function resultView(exam, d) {
  const r = d.result;
  const p = paperOf(exam, d.key);
  const head = scoreHead(r.items, { by: r.by, minutes: d.minutes, durationMin: d.durationMin });
  const save = () => {
    const s = simScore(r.items);
    const sim = { id: uid(), paperKey: d.key, label: d.label, materialId: d.materialId, date: today(), startedAt: d.startedAt, minutes: d.minutes, durationMin: d.durationMin, mode: d.mode,
      answer: d.answer, by: r.by, items: r.items, overall: r.overall, priorities: r.priorities, readingIssues: r.readingIssues, points: s.points, max: s.max, grade: s.grade };
    (exam.simulations ??= []).push(sim);
    const byTopic = new Map();
    for (const it of r.items) {
      if (!it.topicId) continue;
      const a = byTopic.get(it.topicId) ?? { p: 0, m: 0 };
      byTopic.set(it.topicId, { p: a.p + it.points, m: a.m + it.maxPoints });
    }
    for (const [tid, a] of byTopic) if (a.m) exam.qstats = recordScore(exam.qstats, `s:${tid}`, a.p / a.m);
    if (d.taskId) exam.done[d.taskId] = true;
    store.logActivity(exam, Math.max(1, r.items.length));
    delete exam.simDraft;
    store.save();
    toast("Simulazione salvata nei progressi.", "ok");
    go(`#/exam/${exam.id}/sim?view=${sim.id}`);
  };
  return h("div", { class: "stack", style: { maxWidth: "820px" } }, back(exam),
    h("h1", { style: { marginBottom: 0 } }, "Correzione"),
    h("div", { class: "card stack" }, h("div", { class: "row between" }, head.el, h("div", { class: "muted small", style: { maxWidth: "320px" } }, h("b", {}, p.label))),
      h("p", { class: "small muted", style: { margin: 0 } }, r.by === "ai"
        ? "È una stima: dipende da come corregge il tuo docente. Se non sei d'accordo con un punteggio cambialo, ma chiediti prima se il docente sarebbe d'accordo con te."
        : "Dai a ogni esercizio i punti che ti darebbe il docente: confronta con le soluzioni (se la prova le ha), con il libro e con gli esercizi svolti. Sii severo: all'esame nessuno regala punti.")),
    r.overall ? h("div", { class: "card" }, ...richParas(r.overall)) : null,
    r.readingIssues?.length ? h("div", { class: "callout warn" }, h("b", {}, "Parti che Claude non è riuscito a leggere bene"), h("ul", {}, r.readingIssues.map((x) => h("li", {}, rich(x))))) : null,
    itemsList(r.items, { editable: true, onChange: () => { head.upd(); store.save(); } }),
    r.priorities?.length ? h("div", { class: "callout" }, h("b", {}, "Prima della prossima simulazione"), h("ol", {}, r.priorities.map((x) => h("li", {}, rich(x))))) : null,
    h("details", {}, h("summary", {}, "Il tuo svolgimento"), h("div", { class: "card", style: { marginTop: "8px" } }, ...(d.answer.trim() ? richParas(d.answer) : [h("p", { class: "muted" }, "(su carta, non trascritto)")]))),
    h("details", { open: r.by === "self" }, h("summary", {}, "Testo della prova"), h("div", { class: "card", style: { marginTop: "8px" } }, paperBox(exam, p))),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: save }, "Salva il risultato"),
      h("button", { class: "btn ghost", onclick: () => { delete d.result; store.save(); core.rerender(); } }, "Rifai la correzione")));
}

function savedView(exam, s) {
  const weak = [...new Set(s.items.filter((it) => it.topicId && it.maxPoints && it.points / it.maxPoints < 0.6).map((it) => it.topicId))].filter((id) => exam.module?.topics.some((t) => t.id === id));
  const p = paperOf(exam, s.paperKey);
  const head = scoreHead(s.items, s);
  return h("div", { class: "stack", style: { maxWidth: "820px" } }, back(exam),
    h("h1", { style: { marginBottom: 0 } }, "Simulazione"),
    h("p", { class: "muted", style: { margin: 0 } }, `${s.label} · ${fmtDate(s.date)}`),
    h("div", { class: "card stack" }, head.el),
    s.overall ? h("div", { class: "card" }, ...richParas(s.overall)) : null,
    itemsList(s.items),
    s.priorities?.length ? h("div", { class: "callout" }, h("b", {}, "Da sistemare"), h("ol", {}, s.priorities.map((x) => h("li", {}, rich(x))))) : null,
    s.answer?.trim() ? h("details", {}, h("summary", {}, "Il tuo svolgimento"), h("div", { class: "card", style: { marginTop: "8px" } }, ...richParas(s.answer))) : null,
    h("div", { class: "row" },
      weak.length ? h("a", { class: "btn primary", href: `#/exam/${exam.id}/quiz?mode=topics&topics=${weak.join(",")}` }, "Quiz sugli argomenti dove hai perso punti") : null,
      nextPaper(exam) ? h("a", { class: "btn", href: `#/exam/${exam.id}/sim` }, "Prossima prova") : null,
      p ? h("a", { class: "btn ghost", href: `#/exam/${exam.id}/sim?paper=${encodeURIComponent(p.key)}` }, "Rifai questa prova") : null,
      h("button", { class: "btn ghost danger", onclick: async () => {
        if (!(await confirmDialog("Eliminare questa simulazione dall'elenco?", { ok: "Elimina", danger: true }))) return;
        exam.simulations = exam.simulations.filter((x) => x.id !== s.id);
        store.save();
        go(`#/exam/${exam.id}/esami`);
      } }, "Elimina")));
}
