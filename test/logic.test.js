import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, today } from "../public/js/dates.js";
import { recommendMethods } from "../public/js/methods.js";
import { GRADES, buildQueue, capDue, dailyNewLimit, newState, nextInterval, review } from "../public/js/srs.js";
import { buildPlan, splitPhases } from "../public/js/planner.js";
import { pickQuestions, readiness, recordScore, topicStats, weakTopics } from "../public/js/progress.js";
import { buildLocalModule } from "../public/js/local-builder.js";
import { normalizeModule } from "../server/schema.js";
import { weekdayOf } from "../public/js/tabular.js";
import { findExamFormat, suggestExamType } from "../public/js/exam-type.js";
import { UNIVERSITIES, resolveUniversity } from "../public/js/universities.js";
import { coursesForYear, examDefaultsFromCourse, findCourse, groupByYear, parseCurriculumText } from "../public/js/curriculum.js";

test("date: aritmetica sui giorni e cambio ora legale", () => {
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // attraversa il cambio d'ora
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(today(new Date(2026, 9, 1, 23, 59)), "2026-10-01");
});

test("metodi: l'orale privilegia la spiegazione, il test le prove", () => {
  const base = { daysLeft: 20, level: 3, hoursPerDay: 3 };
  assert.equal(recommendMethods({ ...base, examType: "orale" }).methods[0].id, "feynman");
  assert.equal(recommendMethods({ ...base, examType: "test" }).methods[0].id, "practice");
  const prob = recommendMethods({ ...base, examType: "problemi" }).methods.map((m) => m.id);
  assert.ok(prob.indexOf("worked") < 3);
});

test("metodi: poco tempo → niente ripasso dilazionato, modalità emergenza", () => {
  const r = recommendMethods({ examType: "scritto", daysLeft: 2, level: 3, hoursPerDay: 4, topicCount: 5 });
  assert.equal(r.mode, "emergenza");
  assert.ok(!r.methods.some((m) => m.id === "spaced"));
  assert.ok(r.warnings.length > 0);
});

test("metodi: principianti → prima lettura; esperti → saltata", () => {
  const p = { examType: "scritto", daysLeft: 20, hoursPerDay: 3 };
  assert.ok(recommendMethods({ ...p, level: 1 }).methods.some((m) => m.id === "firstpass"));
  assert.ok(!recommendMethods({ ...p, level: 5 }).methods.some((m) => m.id === "firstpass"));
});

test("srs: intervalli crescenti e ricaduta", () => {
  let s = newState();
  s = review(s, GRADES.GOOD, "2026-01-01", "2026-03-01");
  assert.equal(s.due, "2026-01-02");
  s = review(s, GRADES.GOOD, "2026-01-02", "2026-03-01");
  assert.equal(s.due, "2026-01-05");
  s = review(s, GRADES.GOOD, "2026-01-05", "2026-03-01");
  assert.ok(s.interval >= 7);
  const lapsed = review(s, GRADES.AGAIN, "2026-01-12", "2026-03-01");
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due, "2026-01-13");
  assert.ok(nextInterval(s, GRADES.EASY) > nextInterval(s, GRADES.GOOD));
});

test("srs: nessuna scadenza oltre il giorno prima dell'esame", () => {
  assert.equal(capDue("2026-02-20", "2026-01-01", "2026-01-10"), "2026-01-09");
  assert.equal(capDue("2026-01-02", "2026-01-01", "2026-01-02"), "2026-01-01"); // esame domani → sempre in coda oggi
  const s = review({ ease: 2.5, interval: 30, reps: 5, lapses: 0, due: "2026-01-01" }, GRADES.EASY, "2026-01-01", "2026-01-12");
  assert.equal(s.due, "2026-01-11");
});

test("srs: coda — scadute prima, nuove limitate per importanza", () => {
  const cards = [
    { id: "a", topicId: "t1" }, { id: "b", topicId: "t2" }, { id: "c", topicId: "t2" }, { id: "d", topicId: "t1" },
  ];
  const states = { a: { ...newState(), due: "2026-01-01", reps: 1 } };
  const { queue, due, fresh } = buildQueue(cards, states, "2026-01-05", { newLimit: 2, topicImportance: { t1: 1, t2: 3 } });
  assert.deepEqual(due.map((c) => c.id), ["a"]);
  assert.deepEqual(fresh.map((c) => c.id), ["b", "c"]);
  assert.equal(queue[0].id, "a");
  assert.equal(dailyNewLimit(100, 11), 10);
  assert.equal(dailyNewLimit(3, 11), 3);
});

const topics = Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, title: `Argomento ${i + 1}`, importance: (i % 3) + 1, difficulty: 2 }));
const base = { examType: "orale", level: 3, hoursPerDay: 3, topics, today: "2026-01-01" };

test("piano: fasi coerenti con i giorni disponibili", () => {
  for (const N of [1, 2, 3, 5, 10, 30]) {
    const p = splitPhases(N);
    assert.equal(p.learn + p.consolidate + p.sim + p.light, N, `N=${N}`);
    assert.ok(p.learn >= 1);
  }
});

test("piano: ogni argomento è studiato una volta, l'ultimo giorno è leggero", () => {
  const plan = buildPlan({ ...base, examDate: "2026-01-21" });
  assert.equal(plan.days.length, 20);
  const learned = plan.days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn").map((t) => t.topicId);
  assert.deepEqual([...learned].sort(), topics.map((t) => t.id).sort());
  const last = plan.days.at(-1);
  assert.equal(last.phase, "light");
  assert.ok(!last.tasks.some((t) => t.kind === "learn"));
  assert.ok(plan.days.some((d) => d.phase === "simulate"));
  assert.equal(new Set(plan.days.flatMap((d) => d.tasks).map((t) => t.id)).size, plan.days.flatMap((d) => d.tasks).length, "id unici");
});

test("piano: argomenti già studiati non tornano; tempo stretto → si tengono i più importanti", () => {
  const plan = buildPlan({ ...base, examDate: "2026-01-21", learned: { t1: true, t2: true } });
  const ids = plan.days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn").map((t) => t.topicId);
  assert.ok(!ids.includes("t1") && !ids.includes("t2"));

  const tight = buildPlan({ ...base, examDate: "2026-01-03", hoursPerDay: 1, level: 1 });
  assert.ok(tight.skipped.length > 0);
  const kept = tight.days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn").map((t) => t.topicId);
  const keptMin = Math.min(...kept.map((id) => topics.find((t) => t.id === id).importance));
  const skippedMax = Math.max(...tight.skipped.map((id) => topics.find((t) => t.id === id).importance));
  assert.ok(keptMin >= skippedMax);
});

test("piano: mai più giorni di comprensione che argomenti; tutto già studiato → solo consolidamento", () => {
  const plan = buildPlan({ ...base, examDate: "2026-01-21" });
  const learnDays = plan.days.filter((d) => d.phase === "learn");
  assert.ok(learnDays.length <= topics.length);
  assert.ok(learnDays.every((d) => d.tasks.some((t) => t.kind === "learn")), "nessun giorno di comprensione vuoto");
  const all = Object.fromEntries(topics.map((t) => [t.id, true]));
  const done = buildPlan({ ...base, examDate: "2026-01-21", learned: all });
  assert.ok(!done.days.some((d) => d.phase === "learn"));
  assert.equal(done.days.length, 20);
  assert.ok(done.days.some((d) => d.phase === "consolidate"));
});

test("piano: esame passato o oggi → vuoto; domani → un giorno", () => {
  assert.equal(buildPlan({ ...base, examDate: "2026-01-01" }).days.length, 0);
  assert.equal(buildPlan({ ...base, examDate: "2025-12-01" }).days.length, 0);
  assert.equal(buildPlan({ ...base, examDate: "2026-01-02" }).days.length, 1);
});

const mod = {
  topics: [{ id: "t1", importance: 3 }, { id: "t2", importance: 1 }],
  flashcards: [{ id: "c1", topicId: "t1" }, { id: "c2", topicId: "t1" }, { id: "c3", topicId: "t2" }],
  questions: [{ id: "q1", topicId: "t1" }, { id: "q2", topicId: "t1" }, { id: "q3", topicId: "t2" }, { id: "q4", topicId: "t2" }],
};

test("progresso: nessun dato → null; con dati → stima pesata", () => {
  assert.equal(readiness(mod, topicStats(mod, {}, {})), null);
  let q = {};
  for (const id of ["q1", "q2"]) q = recordScore(q, id, 1);
  const stats = topicStats(mod, {}, q);
  assert.ok(stats.t1.quiz > 0.6);
  const r = readiness(mod, stats);
  assert.ok(r > 0.2 && r < 1); // le carte mai viste pesano a zero: nessuna stima gonfiata
  assert.equal(weakTopics(mod, stats, 1)[0].id, "t1"); // lacuna pesata: 0.67×3 > 1×1
  assert.deepEqual(weakTopics(mod, stats, 2).map((t) => t.id), ["t1", "t2"]);
});

test("progresso: gli ultimi 5 esiti pesano, un solo tentativo non basta per dire 'pronto'", () => {
  let q = recordScore({}, "q1", 1);
  const s = topicStats(mod, {}, q);
  assert.ok(s.t1.quiz < 0.5, "1 domanda su 3 attese non può dare un punteggio pieno");
  for (let i = 0; i < 8; i++) q = recordScore(q, "q1", 0);
  assert.equal(q.q1.recent.length, 5);
});

test("domande: errori prima, interleaving tra argomenti", () => {
  let q = recordScore({}, "q3", 0);
  q = recordScore(q, "q1", 1);
  const picked = pickQuestions(mod.questions, q, 4, { rng: () => 0 });
  assert.equal(picked[0].id === "q3" || picked[0].topicId === "t2", true);
  assert.equal(new Set(picked.map((x) => x.topicId)).size, 2);
  assert.notEqual(picked[0].topicId, picked[1].topicId, "alternati");
  assert.deepEqual(pickQuestions(mod.questions, q, 5, { weakOnly: true }).map((x) => x.id), ["q3"]);
});

test("modalità base: argomenti e flashcard da definizioni", () => {
  const notes = `# Termodinamica\nEntropia: misura del disordine di un sistema fisico.\nL'energia interna è la somma delle energie delle particelle.\n\n# Cinematica\nLa **velocità** è la derivata della posizione rispetto al tempo.`;
  const m = buildLocalModule(notes, "Fisica");
  assert.equal(m.topics.length, 2);
  assert.ok(m.flashcards.some((c) => c.back.includes("disordine")));
  assert.ok(m.flashcards.some((c) => c.front.includes("_____") && c.back === "velocità"));
  assert.ok(m.flashcards.every((c) => m.topics.some((t) => t.id === c.topicId)));
});

test("server: normalizeModule scarta riferimenti orfani e mcq invalide", () => {
  const raw = {
    title: "X", overview: "Y",
    topics: [{ id: "a", title: "T", importance: 9, difficulty: 0, summary: "s", keyConcepts: [], mustKnow: [], commonMistakes: [], origin: "notes", sourceIds: ["S1", "S9"] }],
    flashcards: [{ id: "x", topicId: "a", front: "f", back: "b", type: "definizione" }, { id: "y", topicId: "zzz", front: "f", back: "b", type: "definizione" }],
    questions: [
      { id: "q", topicId: "a", kind: "mcq", prompt: "p", options: ["1", "2"], correctIndex: 5, modelAnswer: "", explanation: "", rubric: [] },
      { id: "r", topicId: "a", kind: "open", prompt: "p", options: [], correctIndex: -1, modelAnswer: "m", explanation: "", rubric: ["r"] },
    ],
    gaps: [],
  };
  const m = normalizeModule(raw, [{ id: "S1", title: "t", url: "u" }]);
  assert.equal(m.topics[0].importance, 3);
  assert.equal(m.topics[0].difficulty, 1);
  assert.deepEqual(m.topics[0].sourceIds, ["S1"]);
  assert.equal(m.flashcards.length, 1);
  assert.equal(m.questions.length, 1);
  assert.equal(m.questions[0].kind, "open");
});

test("tipo di prova: suggerito dalla materia, 'misto' con bassa confidenza se sconosciuta", () => {
  assert.equal(suggestExamType("Fisica 1").type, "problemi");
  assert.equal(suggestExamType("Analisi Matematica II").type, "problemi");
  assert.equal(suggestExamType("Diritto privato").type, "orale");
  assert.equal(suggestExamType("Storia Contemporanea").type, "orale");
  assert.equal(suggestExamType("Anatomia umana").type, "orale");
  assert.equal(suggestExamType("Basi di dati").type, "misto");
  assert.equal(suggestExamType("Lingua inglese B2").type, "test");
  assert.equal(suggestExamType("Economia aziendale").type, "misto"); // «economia aziendale» (17 car.) batte «economia politica»
  assert.equal(suggestExamType("Microeconomia").type, "problemi");
  const unknown = suggestExamType("Laboratorio di cose");
  assert.equal(unknown.type, "misto");
  assert.equal(unknown.confidence, "bassa");
  assert.equal(suggestExamType("").confidence, "bassa");
});

test("tipo di prova: lettura della modalità dichiarata dalla ricerca", () => {
  assert.equal(findExamFormat("blabla\nModalità d'esame: prova scritta con esercizi e orale facoltativo\nFonti").type, "misto");
  assert.equal(findExamFormat("Modalità d'esame: solo orale").type, "orale");
  assert.equal(findExamFormat("Modalità d'esame: test a risposta multipla (30 domande)").type, "test");
  assert.equal(findExamFormat("Modalità d'esame: non trovata"), null);
  assert.equal(findExamFormat("nessuna riga utile"), null);
});

test("atenei: sigle e alias risolti, testo libero lasciato in pace", () => {
  assert.equal(resolveUniversity("UNIBS"), "Università degli Studi di Brescia");
  assert.equal(resolveUniversity("unibs "), "Università degli Studi di Brescia");
  assert.equal(resolveUniversity("polimi"), "Politecnico di Milano");
  assert.equal(resolveUniversity("la statale"), "Università degli Studi di Milano");
  assert.equal(resolveUniversity("Universita degli studi di brescia"), "Università degli Studi di Brescia"); // senza accenti
  assert.equal(resolveUniversity("Ateneo sconosciuto"), null);
  assert.equal(resolveUniversity(""), null);
  const all = UNIVERSITIES.flatMap(([n, ...a]) => [n, ...a].map((x) => x.toLowerCase()));
  assert.equal(new Set(all).size, all.length, "nessuna sigla/nome duplicato (ambiguità)");
});

test("piano di studi: abbinamento insegnamento, ambiguo → nessuno", () => {
  const courses = [
    { name: "Analisi matematica 1", cfu: 9, format: "scritto", formatEvidence: "prova scritta", url: "https://u/x" },
    { name: "Analisi matematica 2", cfu: 9, format: "sconosciuto", formatEvidence: "", url: "" },
    { name: "Diritto privato (demo)", cfu: 6, format: "orale", formatEvidence: "demo", url: "" },
  ];
  assert.equal(findCourse(courses, "analisi matematica 1").cfu, 9);
  assert.equal(findCourse(courses, "Diritto privato").format, "orale");
  assert.equal(findCourse(courses, "Analisi matematica"), null, "troppo generico: due insegnamenti");
  assert.equal(findCourse(courses, "Fisica"), null);
  assert.deepEqual(examDefaultsFromCourse(courses[0]), { cfu: 9, type: "scritto", evidence: "prova scritta", url: "https://u/x" });
  assert.equal(examDefaultsFromCourse(courses[1]).type, null, "formato sconosciuto → si ricade sull'euristica");
});

test("piano incollato: anni, CFU, tabelle, attività a scelta e segnaposto", () => {
  const text = `Piano di studi — Ingegneria Informatica (L-8)
1° anno
Analisi matematica 1 - 9 CFU
Fisica generale (9 CFU)
Fondamenti di informatica\t9\tING-INF/05
Secondo anno
- Diritto privato 6 CFU
[12345] Basi di dati (I semestre) 9 CFU
Anno 3
Insegnamenti a scelta dello studente 12 CFU
A scelta (un esame tra i seguenti):
- Teoria dei giochi 6 CFU
- Statistica applicata 6 CFU

Prova finale 3 CFU
Totale CFU 180`;
  const { courses, years } = parseCurriculumText(text);
  assert.deepEqual(years, [1, 2, 3]);
  const by = (n) => courses.find((c) => c.name === n);
  assert.equal(by("Analisi matematica 1").cfu, 9);
  assert.equal(by("Fisica generale").year, 1);
  assert.equal(by("Fondamenti di informatica").cfu, 9, "riga a tabella con SSD");
  assert.equal(by("Diritto privato").year, 2);
  assert.equal(by("Basi di dati").cfu, 9, "codice e semestre rimossi");
  assert.equal(by("Insegnamenti a scelta dello studente").kind, "a_scelta");
  assert.equal(by("Teoria dei giochi").kind, "a_scelta");
  assert.match(by("Teoria dei giochi").group, /A scelta/);
  assert.equal(by("Prova finale").kind, "obbligatorio", "la riga vuota chiude il gruppo a scelta");
  assert.ok(!courses.some((c) => /totale/i.test(c.name)), "righe di totale escluse");
  assert.equal(parseCurriculumText("niente di utile qui").courses.length, 0);
});

test("raggruppamento per anno: obbligatori, gruppi a scelta, anno non indicato in fondo", () => {
  const cs = [
    { name: "A", year: 1, kind: "obbligatorio" }, { name: "B", year: 3, kind: "obbligatorio" },
    { name: "C", year: 3, kind: "a_scelta", group: "Area economica" }, { name: "D", year: 3, kind: "a_scelta", group: "Area economica" },
    { name: "E", year: 3, kind: "a_scelta", group: "" }, { name: "F", year: 0, kind: "sconosciuto" },
  ];
  const g = groupByYear(cs);
  assert.deepEqual(g.map((x) => x.label), ["1° anno", "3° anno", "Anno non indicato"]);
  assert.equal(g[1].required.length, 1);
  assert.deepEqual(g[1].electives.map((e) => [e.group, e.courses.length]), [["Area economica", 2], ["A scelta dello studente", 1]]);
  assert.deepEqual(coursesForYear(cs, 3).map((c) => c.name), ["B", "C", "D", "E", "F"], "anno + senza anno");
  assert.equal(coursesForYear(cs, 0).length, 6);
});

test("piano con lezioni: giorni occupati ricevono meno studio, mai sotto 30 minuti, lezioni passate al giorno", () => {
  const busy = (d) => (weekdayOf(d) === 1 ? 240 : 0); // ogni lunedì 4 ore di lezione, con 3 ore di studio disponibili
  const plain = buildPlan({ ...base, examDate: "2026-02-01", today: "2026-01-01" });
  const withBusy = buildPlan({ ...base, examDate: "2026-02-01", today: "2026-01-01", busy, lessons: (d) => (weekdayOf(d) === 1 ? [{ course: "A", start: "09:00", end: "13:00", room: "" }] : []) });
  const mondays = withBusy.days.filter((d) => weekdayOf(d.date) === 1);
  assert.ok(mondays.length >= 3);
  assert.ok(mondays.every((d) => d.avail === 0 && d.usable === 30 && d.lessons.length === 1));
  const learnMin = (days) => days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn").reduce((s, t) => s + t.minutes, 0);
  const learnDays = withBusy.days.filter((d) => d.phase === "learn");
  assert.equal(learnMin(learnDays.filter((d) => weekdayOf(d.date) === 1)), 0, "nessun argomento nuovo nei giorni di lezione piena");
  assert.equal(learnMin(withBusy.days), learnMin(plain.days), "ma tutti gli argomenti restano pianificati");
  assert.ok(plain.days.every((d) => d.lessons.length === 0 && d.avail === 180));
  assert.ok(withBusy.days.filter((d) => weekdayOf(d.date) === 1).every((d) => d.minutes <= 30 * 1.15 || d.overload), "il carico che non ci sta è segnalato");
});
