// Logica "di dominio" che lega stato (store) e funzioni pure.
import { daysBetween, today } from "./dates.js";
import { buildPlan } from "./planner.js";
import { recommendMethods } from "./methods.js";
import { readiness, topicStats } from "./progress.js";
import { buildQueue, dailyNewLimit } from "./srs.js";
import { busyMinutes, lessonsOn } from "./timetable.js";
import * as store from "./store.js";
import { save } from "./store.js";

export const daysLeft = (exam) => daysBetween(today(), exam.date);

export function ensurePlan(exam, force = false) {
  if (!exam.module) return null;
  const tt = store.state.profile?.timetable ?? null;
  const stamp = `${exam.moduleBuiltAt}|${tt?.importedAt ?? ""}|${tt?.until ?? ""}`;
  if (force || !exam.plan || exam.plan.builtOn !== today() || exam.plan.stamp !== stamp) {
    exam.plan = {
      ...buildPlan({
        examDate: exam.date,
        examType: exam.type,
        level: exam.level,
        hoursPerDay: exam.hoursPerDay,
        topics: exam.module.topics,
        learned: exam.learned,
        today: today(),
        busy: (d) => busyMinutes(tt, d),
        lessons: (d) => lessonsOn(tt, d),
      }),
      stamp,
    };
    save();
  }
  return exam.plan;
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
    daysLeft: daysLeft(exam),
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
  const limit = dailyNewLimit(newCount, Math.max(1, daysLeft(exam))) + extra;
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
    case "quiz":
    case "mock":
      q.set("mode", task.mode ?? "mixed");
      if (task.topicIds) q.set("topics", task.topicIds.join(","));
      if (task.questionKind) q.set("kind", task.questionKind);
      return `${base}/quiz?${q}`;
    default:
      return null;
  }
}
