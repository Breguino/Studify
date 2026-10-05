// Piano di studio a ritroso dalla data d'esame.
//
// Fasi: Comprensione → Consolidamento → Simulazione → Ripasso leggero (ultimo giorno).
// Il piano è ricalcolabile: gli argomenti già "studiati" non vengono riproposti e, se
// il tempo non basta, vengono tenuti quelli più importanti (e gli altri segnalati).
import { readingMinutes } from "./books.js";
import { addDays, daysBetween } from "./dates.js";

const LEVEL_FACTOR = { 1: 1.5, 2: 1.25, 3: 1, 4: 0.8, 5: 0.65 };
const round5 = (n) => Math.max(5, Math.ceil(n / 5) * 5);

export const PHASES = {
  learn: "Comprensione",
  consolidate: "Consolidamento",
  simulate: "Simulazione",
  light: "Ripasso leggero",
};

export function topicMinutes(topic, level) {
  return round5(25 * (0.8 + 0.2 * (topic.difficulty ?? 2)) * (LEVEL_FACTOR[level] ?? 1));
}

export function splitPhases(N) {
  const light = N >= 3 ? 1 : 0;
  const sim = N >= 5 ? Math.max(1, Math.round(N * 0.15)) : N >= 3 ? 1 : 0;
  const rest = N - light - sim;
  const learn = Math.min(rest, Math.max(1, Math.round(rest * 0.5)));
  return { learn, consolidate: rest - learn, sim, light };
}

/**
 * `busy(date)` = minuti occupati da lezioni quel giorno (riducono il tempo di studio; mai sotto 30');
 * `lessons(date)` = elenco delle lezioni, solo per mostrarle.
 * `start` = primo giorno di studio (finestra scelta dallo studente, es. una settimana prima); di default oggi.
 * @param {{examDate:string, examType:string, level:number, hoursPerDay:number, topics:Array,
 *          learned?:Record<string,boolean>, today:string, start?:string, busy?:Function, lessons?:Function}} p
 */
export function buildPlan({ examDate, examType, level, hoursPerDay, topics, learned = {}, today, start = today, busy = () => 0, lessons = () => [] }) {
  if (start < today) start = today;
  const N = daysBetween(start, examDate); // giorni di studio: primo giorno … giorno prima dell'esame
  if (N <= 0) return { builtOn: today, start, days: [], skipped: [], phases: null };

  const budget = Math.round(hoursPerDay * 60);
  const pendingCount = topics.filter((t) => !learned[t.id]).length;
  const ph = splitPhases(N);
  // Niente giorni "di comprensione" senza argomenti da studiare: al massimo un argomento al giorno
  // (distanziare è utile), il resto del tempo va al consolidamento.
  const learnDays = Math.min(ph.learn, pendingCount);
  ph.consolidate += ph.learn - learnDays;
  ph.learn = learnDays;
  const days = Array.from({ length: N }, (_, i) => {
    const phase = i < ph.learn ? "learn" : i < ph.learn + ph.consolidate ? "consolidate" : i < N - ph.light ? "simulate" : "light";
    const date = addDays(start, i);
    const free = Math.max(0, budget - busy(date));
    return { date, phase, tasks: [], lessons: lessons(date), avail: free, usable: Math.max(30, free) };
  });
  const add = (day, t) => day.tasks.push({ ...t, id: `${day.date}|${t.kind}|${t.key ?? ""}`, date: day.date });

  // --- argomenti da studiare, con selezione per importanza se il tempo non basta
  // load = studio + esercizi guidati sui metodi del docente (25 min ciascuno, al massimo 2): conta per capacità e distribuzione
  // con un libro collegato: anche il tempo per leggere il capitolo (al massimo 2 ore e mezza per argomento)
  const study = (t) => topicMinutes(t, level) + Math.min(150, readingMinutes(t.readPages, level));
  const pending = topics.filter((t) => !learned[t.id]).map((t) => ({ ...t, minutes: study(t), load: study(t) + 25 * Math.min(2, t.methods?.length ?? 0) + (t.officialCount ? 25 : 0) }));
  // Nei giorni quasi pieni di lezioni (meno del 30% del tempo libero) non si introducono argomenti nuovi.
  const learnIdx = days.slice(0, ph.learn).map((_, i) => i);
  let eligible = learnIdx.filter((i) => days[i].avail >= budget * 0.3);
  if (!eligible.length) eligible = learnIdx;
  const capacity = eligible.reduce((sum, i) => sum + days[i].usable * 0.6, 0);
  let selected = pending;
  let skipped = [];
  if (pending.reduce((s, t) => s + t.load, 0) > capacity) {
    const byImportance = [...pending].sort((a, b) => b.importance - a.importance || topics.indexOf(a) - topics.indexOf(b));
    const keep = new Set();
    let used = 0;
    for (const t of byImportance) {
      if (used + t.load <= capacity || keep.size === 0) {
        keep.add(t.id);
        used += t.load;
      }
    }
    selected = pending.filter((t) => keep.has(t.id));
    skipped = pending.filter((t) => !keep.has(t.id)).map((t) => t.id);
  }

  // --- distribuzione sui giorni di comprensione (in ordine di programma), più argomenti nei giorni più liberi
  const total = selected.reduce((s, t) => s + t.load, 0);
  const weights = eligible.map((i) => days[i].usable);
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  const learnByDay = Array.from({ length: ph.learn }, () => []);
  for (const t of selected) {
    const pos = ((cum + t.load / 2) / (total || 1)) * wsum;
    let k = 0;
    for (let acc = weights[0] ?? 0; k < eligible.length - 1 && acc < pos; acc += weights[k + 1]) k++;
    learnByDay[eligible[k] ?? 0].push(t);
    cum += t.load;
  }

  const lastLearnDay = ph.learn - 1;
  days.forEach((day, i) => {
    const isLight = day.phase === "light";
    add(day, { kind: "flash", key: "", title: "Flashcard del giorno", minutes: isLight ? 10 : 15, method: "retrieval" });

    if (day.phase === "learn") {
      for (const t of learnByDay[i]) {
        add(day, { kind: "learn", key: t.id, topicId: t.id, title: `Studia: ${t.title}${t.readLabel ? ` (leggi ${t.readLabel})` : ""}`, minutes: t.minutes, method: level <= 2 ? "firstpass" : "elaborate" });
        // esercizi svolti dal docente: subito dopo averlo studiato, il suo metodo (esempio → completamento → da solo)
        (t.methods ?? []).slice(0, 2).forEach((m, k) =>
          add(day, { kind: "guided", key: `${t.id}-${k}`, topicId: t.id, methodIndex: k, title: `Esercizi guidati: ${m.name} (metodo del docente)`, minutes: 25, method: "practice" }));
        // esercitazioni con la soluzione e quiz del docente: le domande ufficiali sull'argomento appena studiato
        if (t.officialCount)
          add(day, { kind: "quiz", key: `off-${t.id}`, mode: "official", topicIds: [t.id], title: t.officialQuizOnly ? `Quiz del docente su ${t.title}: rispondi senza guardare, poi la sua risposta` : `Esercitazione su ${t.title}: prova da solo, poi la soluzione ufficiale`, minutes: 25, method: "practice" });
      }
      const prev = i > 0 ? learnByDay[i - 1] : [];
      if (prev.length)
        add(day, { kind: "quiz", key: "prev", mode: "topics", topicIds: prev.map((t) => t.id), title: "Quiz sugli argomenti di ieri", minutes: 15, method: "practice" });
    }

    if (day.phase === "consolidate") {
      if (i === lastLearnDay + 1 && learnByDay[lastLearnDay]?.length)
        add(day, { kind: "quiz", key: "prev", mode: "topics", topicIds: learnByDay[lastLearnDay].map((t) => t.id), title: "Quiz sugli ultimi argomenti studiati", minutes: 15, method: "practice" });
      if (examType === "problemi")
        add(day, { kind: "quiz", key: "problems", mode: "mixed", questionKind: "problem", title: "Esercizi misti (argomenti mescolati)", minutes: 40, method: "interleave" });
      else add(day, { kind: "quiz", key: "mixed", mode: "mixed", title: "Quiz misto su tutto il programma", minutes: 25, method: examType === "test" ? "practice" : "interleave" });

      const perDay = examType === "orale" || examType === "misto" ? 3 : examType === "scritto" ? 2 : 0;
      if (perDay) {
        const order = [...topics].sort((a, b) => b.importance - a.importance || topics.indexOf(a) - topics.indexOf(b));
        const k = i - ph.learn;
        for (let j = 0; j < perDay && order.length; j++) {
          const t = order[(k * perDay + j) % order.length];
          add(day, { kind: "explain", key: t.id, topicId: t.id, title: `Spiega a parole tue: ${t.title}`, minutes: 15, method: "feynman" });
        }
      }
    }

    if (day.phase === "simulate") {
      add(day, { kind: "mock", key: "", mode: "mock", title: "Simulazione d'esame (a tempo, senza appunti)", minutes: 60, method: "practice" });
      if (examType === "orale" || examType === "misto")
        add(day, { kind: "explain", key: "oral", mode: "oral", title: "Simulazione orale: 3 argomenti a sorpresa", minutes: 30, method: "feynman" });
      add(day, { kind: "quiz", key: "weak", mode: "weak", title: "Rivedi gli errori della simulazione", minutes: 20, method: "retrieval" });
    }

    if (isLight) {
      add(day, { kind: "quiz", key: "weak", mode: "weak", title: "Ripasso leggero dei punti deboli", minutes: 20, method: "retrieval" });
      add(day, { kind: "rest", key: "", title: "Basta così: dormi bene, non iniziare argomenti nuovi", minutes: 0, method: null });
    }
  });

  for (const d of days) {
    d.minutes = d.tasks.reduce((s, t) => s + t.minutes, 0);
    d.overload = d.minutes > d.usable * 1.15;
  }
  return { builtOn: today, start, days, skipped, phases: ph };
}
