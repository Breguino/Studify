// Esami degli anni passati: le prove trovate nei materiali, che cosa chiedono (analisi con Claude, collegata agli argomenti
// del modulo) e le simulazioni a tempo già fatte. Le prove vere non si «bruciano» nel quiz: servono per le simulazioni.
import * as api from "../api.js";
import { core } from "../core.js";
import { daysLeft } from "../domain.js";
import { fmtDate, today } from "../dates.js";
import { rich } from "../math.js";
import { extractPdfPages } from "../pdf-pages.js";
import { MIN_PAPERS, allPapers, analysisValid, applyExamBoost, attemptsOf, fmtGrade, nextPaper, paperMinutes, paperText, paperYear, topicFrequency, unanalyzed } from "../past-exams.js";
import * as store from "../store.js";
import { countLabel, examQuestionStats } from "../exam-questions.js";
import { pendingMaterials } from "../module-update.js";
import { badge, bar, h, toast } from "../ui.js";

const jobs = new Map(); // esame → { el, label }
const MAX_PDF_PAGES = 300; // pagine di prove in PDF per un'analisi (il limite dell'API è 600)

export const examInfo = (exam) => ({ name: exam.name, type: exam.type, level: exam.level, daysLeft: daysLeft(exam), language: exam.language, university: exam.university, degree: exam.degree, cfu: exam.cfu });
export const topicList = (exam) => exam.module.topics.map(({ id, title }) => ({ id, title }));

/** Una prova nel formato delle API: testo, oppure (PDF, versione con server) le sole pagine della prova. */
export async function paperForApi(exam, p) {
  const m = exam.materials.find((x) => x.id === p.materialId);
  if (m.kind === "pdf") {
    const data = await store.getFile(m.fileId);
    if (!data) throw new Error(`Il PDF «${m.title}» non è più disponibile: caricalo di nuovo.`);
    const whole = p.from === 1 && p.to === (m.numPages ?? p.to);
    return { label: p.label, data: whole || !extractPdfPages ? data : await extractPdfPages(data, p.from, p.to) };
  }
  return { label: p.label, text: paperText(m, p) };
}

async function analyze(exam) {
  if (jobs.has(exam.id)) return;
  const papers = allPapers(exam);
  const job = { el: null, label: "Preparo le prove…" };
  jobs.set(exam.id, job);
  core.rerender();
  try {
    const pdfPages = papers.filter((p) => exam.materials.find((m) => m.id === p.materialId)?.kind === "pdf").reduce((s, p) => s + p.to - p.from + 1, 0);
    if (pdfPages > MAX_PDF_PAGES) throw new Error(`Troppe pagine di PDF per un'analisi (${pdfPages}, max ${MAX_PDF_PAGES}): nei materiali scegli meno prove.`);
    const sent = [];
    for (const [i, p] of papers.entries()) sent.push({ id: `P${i + 1}`, ...(await paperForApi(exam, p)) });
    if (sent.every((p) => p.text != null && !p.text.replace(/\f/g, "").trim())) throw new Error("Le prove sono vuote: se sono foto o scansioni, falle prima leggere a Claude nei materiali.");
    const res = await api.runJob("/api/past-exams", { exam: examInfo(exam), topics: topicList(exam), papers: sent }, (chars, label) => {
      job.label = label ?? `Claude legge le prove… ~${Math.round(chars / 1000)}k caratteri`;
      if (job.el) job.el.textContent = job.label;
    });
    const keyOf = Object.fromEntries(papers.map((p, i) => [`P${i + 1}`, p.key]));
    exam.pastExams = {
      analyzedAt: new Date().toISOString(),
      moduleBuiltAt: exam.moduleBuiltAt,
      papers: Object.fromEntries(Object.entries(res.papers).map(([id, p]) => [keyOf[id], p])),
      structure: res.structure,
      recurring: res.recurring.map((r) => ({ ...r, paperKeys: r.paperIds.map((id) => keyOf[id]).filter(Boolean) })),
      uncovered: res.uncovered,
      caveats: res.caveats,
    };
    const raised = applyExamBoost(exam);
    exam.plan = null;
    const n = Object.keys(exam.pastExams.papers).length;
    const titles = raised.map((id) => exam.module.topics.find((t) => t.id === id)?.title).filter(Boolean);
    toast(`Analizzate ${n} ${n === 1 ? "prova" : "prove"}.${titles.length ? ` Diventano centrali nel piano: ${titles.join(", ")}.` : ""}`, "ok");
  } catch (e) {
    toast(e.message, "error");
  } finally {
    jobs.delete(exam.id);
    store.save();
    core.rerender();
  }
}

const KIND_LABEL = { esercizio: "esercizio", teoria: "teoria", test: "test", altro: "altro" };

function paperRow(exam, p, next) {
  const m = exam.materials.find((x) => x.id === p.materialId);
  const an = analysisValid(exam) ? exam.pastExams.papers[p.key] : null;
  const tries = attemptsOf(exam, p.key);
  const best = tries.reduce((b, s) => (s.grade != null && (b == null || s.grade > b) ? s.grade : b), null);
  const title = (id) => exam.module?.topics.find((t) => t.id === id)?.title;
  const info = [m.title.replace(/ \(da PDF\)$/, ""), p.from !== p.to || m.numPages > 1 ? `${m.unit === "prove" ? "prova" : "pagine"} ${p.from === p.to ? p.from : `${p.from}–${p.to}`}` : "",
    an ? `${an.items.length} ${an.items.length === 1 ? "esercizio" : "esercizi"}` : "", an?.durationMin ? `${an.durationMin} min` : "", an?.hasSolutions ? "con soluzioni" : ""].filter(Boolean).join(" · ");
  return h("div", { class: "card flat paper-row" },
    h("div", { class: "row between" },
      h("div", {}, h("b", {}, p.label), " ", next?.key === p.key ? badge("consigliata ora", "brand") : null, " ",
        tries.length ? badge(`fatta ${tries.length === 1 ? "" : `${tries.length} volte `}· ${fmtGrade(best)}`, best != null && best >= 18 ? "good" : "warn") : null,
        h("div", { class: "muted small" }, info)),
      h("a", { class: `btn small ${tries.length ? "" : "primary"}`, href: `#/exam/${exam.id}/sim?paper=${encodeURIComponent(p.key)}` }, tries.length ? "Rifalla" : "Simula")),
    an?.items.length ? h("details", { class: "small" }, h("summary", {}, "Che cosa chiede"),
      h("ol", { class: "paper-items" }, an.items.map((it) => h("li", { value: Number.parseInt(it.n, 10) || null },
        h("span", {}, rich(it.summary)), " ", badge(KIND_LABEL[it.kind] ?? it.kind), it.points ? h("span", { class: "muted" }, ` ${it.points} punti`) : null,
        it.topicIds.length ? h("div", { class: "muted" }, `→ ${it.topicIds.map(title).filter(Boolean).join(", ")}`) : null)))) : null);
}

function analysisCard(exam, papers) {
  const ai = core.ai.ai;
  const job = jobs.get(exam.id);
  const valid = analysisValid(exam);
  const todo = unanalyzed(exam).length;
  const { n, freq } = topicFrequency(exam);
  const btn = h("button", { class: `btn ${valid && !todo ? "ghost" : "primary"}`, disabled: !ai || !exam.module || !!job, onclick: () => analyze(exam) },
    !valid ? `Analizza ${papers.length === 1 ? "la prova" : `le ${papers.length} prove`} con Claude` : todo ? `Aggiorna l'analisi (${todo} ${todo === 1 ? "prova nuova" : "prove nuove"})` : "Rifai l'analisi");
  const why = !exam.module ? "Prima genera il modulo dai materiali: l'analisi collega ogni esercizio agli argomenti del modulo."
    : !ai ? "Per leggere le prove serve Claude (qui l'AI non è attiva). Puoi comunque fare le simulazioni e correggerti da solo."
      : exam.pastExams && !valid ? "Il modulo è stato rigenerato dopo l'analisi: rifalla per ricollegare le prove agli argomenti." : null;
  const statusLine = job ? h("div", { class: "callout row" }, h("span", { class: "spinner" }), (job.el = h("span", {}, job.label))) : null;

  const out = [h("h2", { style: { margin: 0 } }, "Che cosa chiede l'esame")];
  if (!valid) {
    out.push(h("p", { class: "muted small", style: { margin: 0 } }, "Claude legge le prove e collega ogni esercizio agli argomenti del modulo: vedi quali escono più spesso, com'è fatta la prova e quali esercizi si ripetono. Gli argomenti che escono in almeno metà delle prove diventano «centrali» nel piano."),
      why ? h("p", { class: "small", style: { margin: 0 } }, why) : null, statusLine, h("div", {}, btn));
    return h("div", { class: "card stack" }, ...out);
  }
  const pe = exam.pastExams;
  const topics = exam.module.topics;
  const hot = topics.filter((t) => freq.get(t.id)).sort((a, b) => freq.get(b.id) - freq.get(a.id) || topics.indexOf(a) - topics.indexOf(b));
  const never = topics.filter((t) => !freq.get(t.id));
  const raised = topics.filter((t) => t.boost === "esami");
  const label = (k) => papers.find((p) => p.key === k)?.label ?? "";
  out.push(
    h("p", { class: "muted small", style: { margin: 0 } }, `${n} ${n === 1 ? "prova analizzata" : "prove analizzate"} il ${fmtDate(today(new Date(pe.analyzedAt)))}.`),
    n < MIN_PAPERS ? h("div", { class: "callout warn small" }, `Con ${n === 1 ? "una sola prova" : `${n} prove`} la frequenza dice poco: un argomento può esserci o mancare per caso. Se ne trovi altre (sito del docente, rappresentanti, gruppi di studenti) aggiungile.`) : null,
    pe.structure ? h("div", {}, h("b", {}, "Com'è fatta la prova"), h("p", { style: { margin: "4px 0 0" } }, rich(pe.structure))) : null,
    hot.length ? h("div", { class: "stack", style: { gap: "6px" } }, h("b", {}, "Argomenti più chiesti"),
      hot.map((t) => h("div", { class: "progress-line freq-line" },
        h("a", { class: "small", href: `#/exam/${exam.id}/topic/${t.id}`, style: { minWidth: "40%" } }, rich(t.title)),
        bar(freq.get(t.id) / n, { tone: freq.get(t.id) / n >= 0.5 ? "bad" : "warn", label: `${t.title}: in ${freq.get(t.id)} prove su ${n}` }),
        h("span", { class: "small", style: { whiteSpace: "nowrap" } }, `${freq.get(t.id)}/${n}`)))) : null,
    raised.length ? h("p", { class: "small", style: { margin: 0 } }, h("b", {}, "Centrali nel piano per via delle prove: "), raised.map((t) => t.title).join(", "), ".") : null,
    never.length && n >= MIN_PAPERS ? h("details", { class: "small" }, h("summary", {}, `Mai usciti nelle ${n} prove (${never.length})`),
      h("p", { class: "muted", style: { margin: "4px 0" } }, "Non vuol dire che non usciranno: il programma o il docente possono cambiare, e all'orale si chiede di tutto. Non saltarli, ma dagli meno tempo."),
      h("ul", {}, never.map((t) => h("li", {}, rich(t.title))))) : null,
    pe.recurring.length ? h("div", {}, h("b", {}, "Esercizi che si ripetono"), h("ul", {}, pe.recurring.map((r) =>
      h("li", {}, rich(r.pattern), h("span", { class: "muted small" }, ` — in ${r.paperKeys.length} prove (${r.paperKeys.map(label).filter(Boolean).slice(0, 4).join(", ")})`))))) : null,
    pe.uncovered.length ? h("div", { class: "callout warn" }, h("b", {}, "Chiesti nelle prove ma assenti dal modulo"), h("ul", {}, pe.uncovered.map((u) => h("li", {}, rich(u)))),
      h("div", { class: "small" }, "Cerca questi argomenti nel libro o negli appunti e aggiungili ai materiali.")) : null,
    pe.caveats.length ? h("div", { class: "small muted" }, h("b", {}, "Attenzione: "), pe.caveats.join(" ")) : null,
    why ? h("p", { class: "small", style: { margin: 0 } }, why) : null, statusLine, h("div", {}, btn));
  return h("div", { class: "card stack" }, ...out);
}

function simsCard(exam) {
  const sims = [...(exam.simulations ?? [])].reverse();
  if (!sims.length) return null;
  return h("div", { class: "card stack" }, h("h2", { style: { margin: 0 } }, `Simulazioni fatte (${sims.length})`),
    h("div", { class: "stack", style: { gap: "6px" } }, sims.map((s) => h("div", { class: "row between sim-line" },
      h("div", {}, h("b", {}, s.label), h("div", { class: "muted small" }, `${fmtDate(s.date)} · ${s.minutes} min su ${s.durationMin}${s.by === "self" ? " · autocorretta" : " · corretta da Claude"}`)),
      h("div", { class: "row" }, badge(fmtGrade(s.grade), s.grade == null ? "" : s.grade >= 18 ? "good" : "bad"), h("a", { class: "btn small ghost", href: `#/exam/${exam.id}/sim?view=${s.id}` }, "Correzione"))))));
}

/** Elenchi di domande d'esame: le più chieste, per argomento, e quante sono già nel quiz. */
function questionsCard(exam) {
  const s = examQuestionStats(exam);
  if (!s.list.length) return null;
  const topics = exam.module?.topics ?? [];
  const pending = pendingMaterials(exam).some((m) => m.role === "domande");
  const byTopic = topics.filter((t) => s.perTopic.get(t.id)).sort((a, b) => s.perTopic.get(b.id).weight - s.perTopic.get(a.id).weight);
  const top = [...s.list].sort((a, b) => b.count - a.count).slice(0, 10);
  const linkedQ = new Map(s.inQuiz.flatMap((q) => q.examRefs.map((k) => [k, q])));
  const topicOf = (key) => topics.find((t) => t.id === linkedQ.get(key)?.topicId)?.title;
  return h("div", { class: "card stack" },
    h("h2", { style: { margin: 0 } }, `Domande d'esame raccolte (${s.list.length})`),
    h("p", { class: "muted small", style: { margin: 0 } }, `${s.total} in tutto contando le ripetizioni. Le ripetizioni vengono dall'elenco: chi lo ha scritto ricorda alcune domande più di altre, quindi i conteggi sono indicativi.`),
    !exam.module ? h("p", { class: "small", style: { margin: 0 } }, "Genera il modulo dai materiali: ogni domanda diventerà una domanda del quiz con la risposta modello.")
      : s.uncovered.length ? h("div", { class: "callout warn row between" }, h("span", {}, `${s.uncovered.length} ${s.uncovered.length === 1 ? "domanda non è ancora" : "domande non sono ancora"} nel quiz.`),
          pending ? h("a", { class: "btn small primary", href: `#/exam/${exam.id}/materials` }, "Aggiungi al modulo") : h("span", { class: "small muted" }, "Erano nei materiali ma l'AI non le ha incluse: ripeti l'aggiornamento o rigenera il modulo."))
        : h("p", { class: "small", style: { margin: 0 } }, "Tutte le domande sono nel quiz, con la risposta modello e la domanda con cui il docente potrebbe incalzarti."),
    byTopic.length ? h("div", { class: "stack", style: { gap: "6px" } }, h("b", {}, "Argomenti più chiesti"),
      byTopic.map((t) => {
        const a = s.perTopic.get(t.id);
        return h("div", { class: "progress-line freq-line" },
          h("a", { class: "small", href: `#/exam/${exam.id}/quiz?mode=exam&topics=${t.id}`, style: { minWidth: "40%" } }, rich(t.title)),
          bar(a.weight / s.total, { tone: "warn", label: `${t.title}: ${a.weight} domande su ${s.total}` }),
          h("span", { class: "small", style: { whiteSpace: "nowrap" } }, `${a.weight}`));
      })) : null,
    h("details", { class: "small" }, h("summary", {}, "Le più chieste"),
      h("ol", { class: "paper-items" }, top.map((q) => h("li", {}, rich(q.text), h("b", {}, countLabel(q, (n) => ` ×${n}`, " (spesso)")),
        h("span", { class: "muted" }, ` — ${[topicOf(q.key), linkedQ.has(q.key) ? null : "non ancora nel quiz"].filter(Boolean).join(" · ") || "senza argomento"}`))))),
    s.inQuiz.length ? h("div", { class: "row" },
      h("a", { class: "btn primary", href: `#/exam/${exam.id}/quiz?mode=exam` }, "Allenati sulle domande d'esame"),
      h("a", { class: "btn", href: `#/exam/${exam.id}/quiz?mode=exam&n=5` }, "Simulazione orale (5 domande)")) : null,
    h("p", { class: "muted small", style: { margin: 0 } }, "Sapere a memoria le risposte dell'elenco non basta: all'orale il docente incalza («perché?», «fammi un esempio», «disegnalo»). Rispondi anche alla domanda di approfondimento, e continua a spiegare gli argomenti a parole tue."));
}

export function esamiTab(exam) {
  const papers = allPapers(exam).sort((a, b) => (paperYear(a.label) ?? 0) - (paperYear(b.label) ?? 0));
  const draft = exam.simDraft;
  const qCard = questionsCard(exam);
  if (!papers.length)
    return h("div", { class: "stack", style: { maxWidth: "760px" } }, qCard,
      h("div", { class: "card stack" }, h("h2", { style: { margin: 0 } }, qCard ? "Temi d'esame scritti" : "Esami degli anni passati"),
        h("p", { style: { margin: 0 } }, "Le prove degli appelli passati sono il materiale più utile per prepararsi: dicono che cosa chiede davvero l'esame e permettono di allenarsi nelle condizioni vere, a tempo e senza appunti."),
        h("p", { class: "muted small", style: { margin: 0 } }, "Caricale nei Materiali (PDF, Word, testo o foto) e scegli il tipo «Esami passati». Un file con più appelli viene diviso in prove da solo; se non ci riesce, indichi tu dove inizia ciascuna."),
        qCard ? null : h("p", { class: "muted small", style: { margin: 0 } }, "Hai invece un elenco di domande uscite (tipico dell'orale)? Caricalo con il tipo «Domande d'esame»: ogni domanda va nel quiz."),
        h("div", {}, h("a", { class: "btn primary", href: `#/exam/${exam.id}/materials` }, "Aggiungi le prove"))));
  const next = nextPaper(exam);
  const nPapers = papers.length;
  return h("div", { class: "stack" },
    draft ? h("div", { class: "callout warn row between" }, h("span", {}, h("b", {}, "Simulazione in corso: "), draft.label), h("a", { class: "btn small primary", href: `#/exam/${exam.id}/sim` }, "Riprendi")) : null,
    h("div", { class: "callout" }, h("b", {}, "Come usarle: "),
      nPapers >= 3 ? "fanne una subito, senza prepararti, per vedere dove sei; tieni le più recenti per gli ultimi giorni, a tempo e senza appunti. " : "tienile per quando hai studiato gli argomenti: una prova vera fatta a tempo vale più di dieci esercizi letti. ",
      "Non leggere le soluzioni prima di averci provato: una prova già vista non misura più niente."),
    analysisCard(exam, papers),
    qCard,
    h("div", { class: "stack", style: { gap: "8px" } }, h("h2", { style: { margin: "6px 0 0" } }, `Le tue prove (${nPapers})`),
      h("p", { class: "muted small", style: { margin: 0 } }, `Durata della simulazione: ${paperMinutes(exam, "")} minuti, se la prova non la indica (la cambi prima di iniziare).`),
      papers.map((p) => paperRow(exam, p, next))),
    simsCard(exam));
}
