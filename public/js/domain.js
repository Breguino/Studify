// Logica "di dominio" che lega stato (store) e funzioni pure.
import { daysBetween, today } from "./dates.js";
import { buildPlan } from "./planner.js";
import { recommendMethods } from "./methods.js";
import { readiness, topicStats } from "./progress.js";
import { buildQueue, dailyNewLimit } from "./srs.js";
import { busyMinutes, lessonsOn } from "./timetable.js";
import * as store from "./store.js";
import { studyStart, windowDays } from "./workload.js";
import { allPapers, attemptsOf, paperMinutes } from "./past-exams.js";
import { examQuestionStats } from "./exam-questions.js";
import { readingByTopic } from "./books.js";
import { save } from "./store.js";

export const daysLeft = (exam) => daysBetween(today(), exam.date);

export function ensurePlan(exam, force = false) {
  if (!exam.module) return null;
  const tt = store.state.profile?.timetable ?? null;
  const papers = allPapers(exam);
  const asked = examQuestionStats(exam).inQuiz.length;
  const official = new Map();
  for (const q of exam.module.questions) if (q.official) official.set(q.topicId, (official.get(q.topicId) ?? 0) + 1);
  const reading = readingByTopic(exam);
  const stamp = `${exam.moduleBuiltAt}|${exam.moduleUpdatedAt ?? ""}|${tt?.importedAt ?? ""}|${tt?.until ?? ""}|${exam.date}|${exam.studyDays ?? 0}|${papers.length}|${exam.pastExams?.analyzedAt ?? ""}|${asked}|${[...official.values()].reduce((a, b) => a + b, 0)}|${[...reading].map(([k, r]) => `${k}:${r.pages}`).join(",")}`;
  if (force || !exam.plan || exam.plan.builtOn !== today() || exam.plan.stamp !== stamp) {
    exam.plan = {
      ...buildPlan({
        examDate: exam.date,
        examType: exam.type,
        level: exam.level,
        hoursPerDay: exam.hoursPerDay,
        topics: exam.module.topics.map((t) => (official.get(t.id) || reading.get(t.id)
          ? { ...t, officialCount: official.get(t.id) ?? 0, readPages: reading.get(t.id)?.pages ?? 0, readLabel: reading.get(t.id)?.label ?? "" } : t)),
        learned: exam.learned,
        today: today(),
        start: studyStart(exam, today()),
        busy: (d) => busyMinutes(tt, d),
        lessons: (d) => lessonsOn(tt, d),
      }),
      stamp,
    };
    useRealExams(exam.plan, exam, papers, asked);
    save();
  }
  return exam.plan;
}

/**
 * Con le prove d'esame passate, le simulazioni del piano si fanno su prove vere (finché ce ne sono di mai fatte):
 * a tempo, con la durata della prova. Con le domande d'esame vere nel quiz (almeno 5): la simulazione orale le usa, e nei giorni
 * di consolidamento c'è un giro sulle domande d'esame (prima le sbagliate, poi le più chieste).
 */
function useRealExams(plan, exam, papers, asked) {
  let fresh = papers.filter((p) => !attemptsOf(exam, p.key).length).length;
  for (const d of plan.days) {
    for (const t of d.tasks) {
      if (t.kind === "mock" && fresh > 0) {
        Object.assign(t, { kind: "sim", title: "Simulazione con un tema d'esame vero (a tempo, senza appunti)", minutes: Math.min(240, paperMinutes(exam, "") + 20) });
        fresh--;
      }
      if (t.kind === "explain" && t.mode === "oral" && asked >= 5)
        Object.assign(t, { kind: "quiz", mode: "exam", n: 5, title: "Simulazione orale con le domande d'esame vere (5 a sorpresa)", method: "practice" });
    }
    if (d.phase === "consolidate" && asked >= 5)
      d.tasks.push({ kind: "quiz", key: "examq", mode: "exam", title: "Domande d'esame vere: le sbagliate e le più chieste", minutes: 20, method: "retrieval", id: `${d.date}|quiz|examq`, date: d.date });
  }
  for (const d of plan.days) {
    d.minutes = d.tasks.reduce((s, t) => s + t.minutes, 0);
    d.overload = d.minutes > d.usable * 1.15;
  }
}

export const isDone = (exam, task) => (task.kind === "learn" ? !!exam.learned[task.topicId] : !!exam.done[task.id]);

export function setDone(exam, task, value = true) {
  if (task.kind === "learn") exam.learned[task.topicId] = value;
  else exam.done[task.id] = value;
  save();
}

export function methodsFor(exam) {
  return recommendMethods({
    examType: exam.type,
    daysLeft: windowDays(exam, today()), // i giorni che lo studente si dà, non quelli che mancano
    level: exam.level,
    hoursPerDay: exam.hoursPerDay,
    topicCount: exam.module?.topics.length ?? 0,
  });
}

export function statsFor(exam) {
  if (!exam.module) return { stats: {}, ready: null };
  const stats = topicStats(exam.module, exam.srs, exam.qstats, exam.learned);
  return { stats, ready: readiness(exam.module, stats) };
}

/** Coda flashcard di oggi. Le carte nuove sono limitate ai soli argomenti già studiati. */
export function flashQueue(exam, { topicId, includeAll = false, extra = 0 } = {}) {
  const mod = exam.module;
  const anyLearned = mod.topics.some((t) => exam.learned[t.id]);
  const eligible = (c) => (topicId ? c.topicId === topicId : includeAll || !anyLearned || exam.learned[c.topicId]);
  const importance = Object.fromEntries(mod.topics.map((t) => [t.id, t.importance]));
  // le carte già in circolo (scadute) restano sempre; filtriamo solo l'introduzione di nuove
  const all = topicId ? mod.flashcards.filter((c) => c.topicId === topicId) : mod.flashcards;
  const freshPool = all.filter((c) => eligible(c));
  const newCount = freshPool.filter((c) => !exam.srs[c.id]?.due).length;
  const limit = dailyNewLimit(newCount, Math.max(1, windowDays(exam, today()))) + extra;
  const withNew = buildQueue(all, exam.srs, today(), { newLimit: 0, topicImportance: importance });
  const fresh = buildQueue(freshPool, exam.srs, today(), { newLimit: limit, topicImportance: importance }).fresh;
  const excluded = all.filter((c) => !eligible(c) && !exam.srs[c.id]?.due).length;
  return { due: withNew.due, fresh, queue: [...withNew.due, ...fresh], excluded, newLimit: limit };
}

export function dueCount(exam) {
  if (!exam.module) return 0;
  const t = today();
  return exam.module.flashcards.filter((c) => exam.srs[c.id]?.due && exam.srs[c.id].due <= t).length;
}

/** Href della sessione di studio associata a un task del piano. */
export function taskHref(exam, task) {
  const base = `#/exam/${exam.id}`;
  const q = new URLSearchParams({ task: task.id });
  switch (task.kind) {
    case "flash":
      return `${base}/flash?${q}`;
    case "learn":
      return `${base}/topic/${task.topicId}?${q}`;
    case "explain":
      return `${base}/explain/${task.mode === "oral" ? "oral" : task.topicId}?${q}`;
    case "sim":
      return `${base}/sim?${q}`;
    case "guided":
      q.set("m", task.methodIndex ?? 0);
      return `${base}/guided/${task.topicId}?${q}`;
    case "quiz":
    case "mock":
      q.set("mode", task.mode ?? "mixed");
      if (task.topicIds) q.set("topics", task.topicIds.join(","));
      if (task.questionKind) q.set("kind", task.questionKind);
      if (task.n) q.set("n", task.n);
      return `${base}/quiz?${q}`;
    default:
      return null;
  }
}
