// Le schermate della demo: le stesse dell'app (passi del primo esame, Oggi, quiz, flashcard), con dati d'esempio.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, FileText, Mic, Upload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  CARDS, EXAM_TYPES, GRADES, IMPORTANCE, LEVELS, PHASES, QUESTIONS, QUOTE, SAMPLE_FILES, TODAY, TOPICS,
  phaseOfDay, splitPhases, type Phase, type SampleFile,
} from "./data";
import { Bar, Choices, Kbd, Kicker, Pill, Stepper, btn, phaseColor, phaseColorHero } from "./ui";

/* ------------------------------- stato condiviso ------------------------------- */

export type Exam = { name: string; days: number; type: string; level: number; hours: number };
export type Loaded = { id: string; progress: number };
export type Shared = {
  exam: Exam; setExam: (e: Exam) => void;
  files: Loaded[]; setFiles: (f: Loaded[] | ((f: Loaded[]) => Loaded[])) => void;
  done: Set<string>; toggle: (id: string, on?: boolean) => void;
  scores: Record<string, number[]>; addScores: (s: Record<string, number[]>) => void;
  flash: { reviewed: number; remembered: number } | null; setFlash: (f: { reviewed: number; remembered: number }) => void;
  go: (step: number) => void;
};

/* ------------------------------------ date ------------------------------------ */

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtLong = (d: Date) => `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`;
const fmtShort = (d: Date) => `${GIORNI[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}`;
const hoursLabel = (h: number) => `${String(h).replace(".", ",")} ${h === 1 ? "ora" : "ore"}`;
const examTypeLabel = (id: string) => EXAM_TYPES.find((t) => t.id === id)?.label ?? "";

const h1 = "m-0 text-[clamp(1.7rem,4vw,2.4rem)] font-extrabold leading-[1.12] tracking-[-0.03em]";
const lead = "m-0 max-w-[38em] text-[1.06rem] text-muted";
const card = "rounded-card border border-line bg-surface shadow-card";

/* ------------------------------ 1. descrivi l'esame ------------------------------ */

export function ExamScreen({ exam, setExam, go }: Shared) {
  const ph = splitPhases(exam.days);
  const parts = ([["learn", ph.learn], ["consolidate", ph.consolidate], ["simulate", ph.sim], ["light", ph.light]] as [Phase, number][]).filter(([, n]) => n > 0);
  const date = addDays(new Date(), exam.days);
  return (
    <div className="grid gap-6">
      <Stepper current={1} />
      <div className="grid gap-1.5">
        <h2 className={h1}>Che esame devi preparare?</h2>
        <p className={lead}>Bastano data, tipo di prova e il tempo che hai: il piano parte da qui e si affina con i materiali.</p>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <form className={cn(card, "grid min-w-0 flex-[999_1_420px] gap-5 p-5 sm:p-6")} onSubmit={(e) => { e.preventDefault(); go(1); }}>
          <label htmlFor="exam-name" className="grid gap-1.5 text-[.92rem] font-semibold">
            Insegnamento / esame
            <input id="exam-name" value={exam.name} onChange={(e) => setExam({ ...exam, name: e.target.value })}
              className="min-h-[44px] rounded-ctl border border-line-strong bg-surface px-3 text-[1rem] font-normal text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20" />
          </label>
          <div className="grid gap-2">
            <label htmlFor="exam-days" className="text-[.92rem] font-semibold">Quando è l'appello?</label>
            <input id="exam-days" type="range" min={5} max={45} value={exam.days} onChange={(e) => setExam({ ...exam, days: Number(e.target.value) })} className="w-full accent-brand" />
            <span className="text-[.95rem]"><b>tra {exam.days} giorni</b> <span className="text-muted">· {fmtLong(date)}</span></span>
          </div>
          <Choices name="exam-type" legend="Tipo di prova" value={exam.type} onChange={(type) => setExam({ ...exam, type })}
            options={EXAM_TYPES.map((t) => ({ value: t.id as string, label: t.label }))} />
          <Choices name="exam-level" legend="Quanto conosci già la materia?" grid value={exam.level} onChange={(level) => setExam({ ...exam, level })}
            options={LEVELS.map((l) => ({ value: l.n as number, label: <span className="grid"><b>{l.n}</b><span className={cn("text-[.84rem] font-medium", exam.level === l.n ? "text-brand" : "text-muted")}>{l.label}</span></span> }))} />
          <Choices name="exam-hours" legend="Ore di studio al giorno" value={exam.hours} onChange={(hours) => setExam({ ...exam, hours })}
            options={[1, 1.5, 2, 3].map((n) => ({ value: n, label: hoursLabel(n) }))} />
          <div className="flex justify-end border-t border-line pt-4">
            <button type="submit" className={cn(btn.base, btn.primary)}>Continua: aggiungi i materiali</button>
          </div>
        </form>
        <aside aria-labelledby="preview-title" className="grid min-w-0 flex-[1_1_260px] gap-4 rounded-[22px] bg-hero p-6 text-hero-ink">
          <Kicker className="text-hero-faint"><span id="preview-title">Il piano, a grandi linee</span></Kicker>
          <div className="flex items-end gap-3">
            <b className="text-[4.2rem] font-black leading-[.85] tracking-[-0.05em] tabular-nums">{exam.days}</b>
            <span className="font-bold leading-tight text-hero-muted">giorni di studio,<br />{hoursLabel(exam.hours)} al giorno</span>
          </div>
          <div className="flex h-3 gap-[3px]" aria-hidden="true">
            {parts.map(([k, n]) => <span key={k} className={cn("rounded-full", phaseColorHero[k])} style={{ flexGrow: n, flexBasis: 0 }} />)}
          </div>
          <ul className="m-0 grid list-none gap-2 p-0 text-[.95rem]">
            {parts.map(([k, n]) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="flex items-center gap-2"><i className={cn("h-2.5 w-2.5 rounded-full", phaseColorHero[k])} />{PHASES[k]}</span>
                <span className="text-hero-muted tabular-nums">{k === "light" && n === 1 ? "il giorno prima" : `${n} ${n === 1 ? "giorno" : "giorni"}`}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[.86rem] text-hero-faint">Gli argomenti e i minuti di ogni giorno arrivano dal modulo, quando carichi i materiali.</p>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------ 2. porta i materiali ------------------------------ */

const GEN_STEPS = ["Leggo i materiali", "Riconosco gli argomenti e quanto pesano", "Controllo le frasi del docente sul testo", "Scrivo flashcard e domande"];

function FileIcon({ f }: { f: SampleFile }) {
  const I = f.icon === "mic" ? Mic : FileText;
  return <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-surface-2 text-muted"><I className="h-5 w-5" aria-hidden="true" /></span>;
}

export function MaterialsScreen({ exam, files, setFiles, go }: Shared) {
  const [gen, setGen] = useState<number | null>(null);
  const reading = files.some((f) => f.progress < 100);
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => setFiles((fs) => fs.map((f) => (f.progress < 100 ? { ...f, progress: Math.min(100, f.progress + 9) } : f))), 90);
    return () => clearInterval(t);
  }, [reading, setFiles]);
  useEffect(() => {
    if (gen == null) return;
    const t = setTimeout(() => (gen < GEN_STEPS.length - 1 ? setGen(gen + 1) : go(2)), 750);
    return () => clearTimeout(t);
  }, [gen, go]);
  const add = (ids: string[]) => setFiles((fs) => [...fs, ...ids.filter((id) => !fs.some((f) => f.id === id)).map((id) => ({ id, progress: 0 }))]);
  const missing = SAMPLE_FILES.filter((f) => !files.some((x) => x.id === f.id));
  const ready = files.some((f) => f.progress >= 100);

  return (
    <div className="grid gap-6">
      <Stepper current={2} />
      <div className="grid gap-1.5">
        <h2 className={h1}>Porta quello che hai già</h2>
        <p className={lead}>Per {exam.name || "il tuo esame"}: dispense, slide, esami passati, quiz del docente, appunti, sbobine. Più è vicino al corso, più il modulo è fedele.</p>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="grid min-w-0 flex-[999_1_420px] gap-4">
          <div className="grid justify-items-center gap-2 rounded-card border-2 border-dashed border-line-strong bg-surface px-5 py-7 text-center">
            <span className="grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-brand-soft text-brand"><Upload className="h-6 w-6" aria-hidden="true" /></span>
            <b className="text-[1.12rem]">Trascina qui i file</b>
            <span className="text-[.9rem] text-muted">PDF, Word, PowerPoint, foto degli appunti, trascrizioni. In questa demo usi i file d'esempio:</span>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {missing.map((f) => <button key={f.id} type="button" className={cn(btn.base, btn.plain, btn.small)} onClick={() => add([f.id])}>+ {f.name}</button>)}
              {missing.length > 1 ? <button type="button" className={cn(btn.base, btn.ghost, btn.small)} onClick={() => add(missing.map((f) => f.id))}>Aggiungili tutti</button> : null}
              {!missing.length ? <span className="text-[.9rem] font-semibold text-good">Tutti i file d'esempio sono nell'elenco.</span> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-[1.25rem] font-extrabold">{files.length === 1 ? "1 materiale" : `${files.length} materiali`}</h2>
            {files.length ? <span className="text-[.88rem] text-muted">Il tipo decide come vengono usati</span> : null}
          </div>
          {files.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {files.map((x) => {
                const f = SAMPLE_FILES.find((s) => s.id === x.id)!;
                return (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-row border border-line bg-surface px-4 py-3 animate-fade-up">
                    <FileIcon f={f} />
                    <div className="grid min-w-0 flex-[1_1_200px] gap-1">
                      <b className="break-words">{f.name}</b>
                      {x.progress < 100
                        ? <div className="flex items-center gap-2.5"><Bar value={x.progress / 100} label={`Lettura di ${f.name}`} className="h-1.5 max-w-[200px] flex-1" /><span className="text-[.86rem] text-muted">Lettura…</span></div>
                        : <span className="text-[.88rem] font-semibold text-good">{f.done}</span>}
                    </div>
                    <Pill>{f.kind}</Pill>
                  </li>
                );
              })}
            </ul>
          ) : <p className="m-0 text-muted">Nessun materiale ancora: aggiungi un file d'esempio qui sopra.</p>}

          <section aria-labelledby="gen-title" className={cn(card, "grid gap-3 p-5")}>
            <h3 id="gen-title" className="m-0 text-[1.08rem] font-bold">Genera il modulo di studio</h3>
            <p className="m-0 text-[.92rem] text-muted">L'AI legge tutti i materiali e ne ricava argomenti, flashcard, domande e l'elenco delle cose da verificare. In questa demo non c'è AI: il modulo è quello d'esempio di Studify.</p>
            {gen != null ? (
              <ol aria-live="polite" className="m-0 grid list-none gap-1.5 p-0 text-[.95rem]">
                {GEN_STEPS.map((s, i) => (
                  <li key={s} className={cn("flex items-center gap-2", i > gen && "text-muted")}>
                    {i < gen ? <Check className="h-4 w-4 text-good" aria-hidden="true" /> : i === gen ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden="true" /> : <span className="h-4 w-4" />}
                    {s}{i === gen ? "…" : ""}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={cn(btn.base, btn.ghost)} onClick={() => go(0)}>← Indietro</button>
              <button type="button" className={cn(btn.base, btn.primary)} disabled={!ready || reading || gen != null} onClick={() => setGen(0)}>Genera il modulo</button>
            </div>
          </section>
        </div>

        <aside className="grid min-w-0 flex-[1_1_240px] gap-4">
          <section aria-labelledby="how-title" className={cn(card, "grid gap-3 p-5")}>
            <h2 id="how-title" className="m-0 text-[1.02rem] font-extrabold">Come li usiamo</h2>
            <ul className="m-0 grid list-none gap-3 p-0 text-[.93rem]">
              {["Le frasi del docente e le soluzioni ufficiali entrano così come sono, con la fonte.", "Ciò che non viene dai tuoi materiali è segnato «dal web» o «da verificare».", "Gli esami passati dicono quali argomenti pesano di più nel piano."].map((t) => (
                <li key={t} className="flex items-start gap-2.5"><span className="mt-px grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-good-soft text-good"><Check className="h-3 w-3" strokeWidth={3.4} aria-hidden="true" /></span>{t}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="files-title" className="grid gap-1 rounded-row bg-brand-soft p-5">
            <h2 id="files-title" className="m-0 text-[1rem] font-extrabold">I file restano qui</h2>
            <p className="m-0 text-[.93rem]">Nell'app PDF e foto sono salvati solo nel tuo browser; Claude li legge per generare il modulo.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------ 3. il modulo è pronto ------------------------------ */

function QuoteCard() {
  return (
    <section aria-label="Il docente ne parla per l'esame" className="grid gap-2.5 rounded-card bg-bad-soft p-5">
      <Kicker className="text-bad">Il docente ne parla per l'esame</Kicker>
      <q className="text-[1.1rem] font-semibold italic leading-snug">{QUOTE.text}</q>
      <span className="text-[.86rem] text-muted">{QUOTE.source}</span>
    </section>
  );
}

export function ReadyScreen({ exam, go }: Shared) {
  const stats: [string | number, string, string][] = [[TOPICS.length, "argomenti", ""], [25, "flashcard", ""], [10, "domande da quiz", ""], [1, "frase del docente sull'esame", "bad"]];
  const sorted = [...TOPICS].sort((a, b) => b.importance - a.importance);
  return (
    <div className="grid gap-6">
      <Stepper current={3} />
      <div className="grid gap-1.5">
        <h2 className={h1}>Il modulo di {exam.name || "esame"} è pronto</h2>
        <p className={lead}>Viene dai tuoi materiali, con la fonte accanto: dai un'occhiata e parti.</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {stats.map(([n, l, tone]) => (
          <div key={l} className={cn("grid rounded-[16px] border px-5 py-4", tone === "bad" ? "border-transparent bg-bad-soft text-bad" : "border-line bg-surface")}>
            <b className="text-[2rem] font-black leading-tight tracking-[-0.03em] tabular-nums">{n}</b>
            <span className={tone ? "" : "text-muted"}>{l}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="topics-title" className={cn(card, "grid min-w-0 flex-[999_1_420px] px-5 pb-4 pt-2 sm:px-6")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
            <h2 id="topics-title" className="m-0 text-[1.2rem] font-extrabold">Argomenti, dal più importante</h2>
            <span className="text-[.86rem] text-muted">L'importanza tiene conto degli esami passati</span>
          </div>
          {sorted.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-3.5">
              <div className="grid min-w-0 flex-[1_1_240px] gap-0.5"><b>{t.title}</b><span className="text-[.86rem] text-muted">{t.source}</span></div>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={t.importance === 3 ? "brand" : ""}>{IMPORTANCE[t.importance]}</Pill>
                {t.said ? <Pill tone="bad">il docente ne parla per l'esame</Pill> : null}
                <Pill tone="good">dai tuoi materiali</Pill>
              </div>
            </div>
          ))}
          <div className="mt-2 rounded-row bg-warn-soft px-4 py-3 text-[.93rem] text-warn"><b>1 cosa da verificare:</b> un esempio aggiunto sul ricavo marginale, che non viene dai tuoi materiali.</div>
        </section>
        <aside aria-labelledby="start-title" className="grid min-w-0 flex-[1_1_260px] gap-4 rounded-[22px] bg-hero p-6 text-hero-ink">
          <Kicker className="text-hero-faint">Il piano parte oggi</Kicker>
          <h2 id="start-title" className="m-0 text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em]">Prima sessione: {TODAY.reduce((s, t) => s + t.minutes, 0)} min</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {TODAY.map((t) => <li key={t.id} className="flex justify-between gap-3 rounded-ctl bg-hero-ink/10 px-3.5 py-3"><span>{t.title}</span><b className="flex-none tabular-nums">{t.minutes} min</b></li>)}
          </ul>
          <button type="button" className={cn(btn.base, "min-h-[50px] border-hero-ink bg-hero-ink font-extrabold text-hero hover:bg-hero-ink/90")} onClick={() => go(3)}>Inizia oggi →</button>
          <p className="m-0 text-[.86rem] text-hero-faint">Puoi aggiungere materiali quando vuoi: il piano si ricalcola.</p>
        </aside>
      </div>
    </div>
  );
}

/* ----------------------------------- 4. oggi ----------------------------------- */

const STUDY = ["Domanda, offerta ed equilibrio", "Elasticità", "Teoria del consumatore", "Costi e concorrenza perfetta", "Monopolio"];
function dayPlan(i: number, n: number, hours: number) {
  const phase = phaseOfDay(i, n);
  const budget = hours * 60;
  const round5 = (x: number) => Math.max(15, Math.round(x / 5) * 5);
  const what = { learn: `Studia: ${STUDY[i % STUDY.length]}`, consolidate: i % 2 ? "Esercizi misti" : "Quiz misto su tutto il programma", simulate: "Simulazione d'esame a tempo", light: "Ripasso leggero dei punti deboli" }[phase];
  const minutes = phase === "light" ? 30 : round5(budget * (phase === "simulate" ? 0.95 : phase === "consolidate" ? 0.75 : 0.6));
  return { phase, what, minutes };
}

export function TodayScreen({ exam, done, toggle, scores, go }: Shared) {
  const today = new Date();
  const total = TODAY.reduce((s, t) => s + t.minutes, 0);
  const doneMin = TODAY.filter((t) => done.has(t.id)).reduce((s, t) => s + t.minutes, 0);
  const next = TODAY.find((t) => !done.has(t.id));
  const days = Array.from({ length: Math.min(6, exam.days - 1) }, (_, k) => ({ date: addDays(today, k + 1), ...dayPlan(k + 1, exam.days, exam.hours) }));
  const weak = useMemo(() => TOPICS.map((t) => {
    const s = scores[t.title];
    return { t, score: s?.length ? s.reduce((a, b) => a + b, 0) / s.length : null };
  }).sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || b.t.importance - a.t.importance).slice(0, 3), [scores]);

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className={h1}>{exam.name || "Il tuo esame"}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-muted">{fmtShort(addDays(today, exam.days))} · {examTypeLabel(exam.type)}</span>
          <Pill tone={exam.days <= 10 ? "warn" : ""}>tra {exam.days} giorni</Pill>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="grid min-w-0 flex-[999_1_420px] gap-6">
          <section aria-labelledby="session-title" className={cn(card, "grid gap-3.5 p-5 sm:p-6")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="grid gap-0.5">
                <Kicker>Oggi · {fmtShort(today)} · {PHASES[phaseOfDay(0, exam.days)]}</Kicker>
                <h2 id="session-title" className="m-0 text-[1.4rem] font-extrabold tracking-[-0.02em]">La sessione di oggi: {total} min</h2>
              </div>
              <span className="text-[.88rem] text-muted tabular-nums">{doneMin} di {total} min fatti</span>
            </div>
            <Bar value={doneMin / total} tone="good" label="sessione di oggi" />
            <ul className="m-0 grid list-none gap-2 p-0">
              {TODAY.map((t) => {
                const isDone = done.has(t.id);
                const now = next?.id === t.id;
                return (
                  <li key={t.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-row border px-4 py-3.5 transition-colors",
                    isDone ? "border-transparent bg-good-soft" : now ? "border-[1.5px] border-brand bg-surface shadow-[0_6px_18px_hsl(var(--brand)/.14)]" : "border-line bg-surface")}>
                    <Checkbox id={`t-${t.id}`} checked={isDone} onCheckedChange={(v) => toggle(t.id, v === true)} aria-label={`Segna «${t.title}» come fatto`}
                      className={cn("h-[22px] w-[22px] rounded-[6px] border-line-strong", isDone && "border-good data-[state=checked]:bg-good")} />
                    <div className="grid min-w-0 flex-[1_1_180px] gap-1">
                      {now ? <span className="text-[.72rem] font-extrabold uppercase tracking-[.07em] text-brand">Adesso</span> : null}
                      <label htmlFor={`t-${t.id}`} className={cn("cursor-pointer font-semibold", now && "text-[1.05rem]", isDone && "line-through decoration-good/50")}>{t.title}</label>
                      <div className="flex flex-wrap gap-1.5"><Pill tone={now ? "brand" : ""}>{t.method}</Pill></div>
                    </div>
                    <span className={cn("whitespace-nowrap text-[.88rem] font-bold", isDone ? "text-good" : "text-muted")}>{t.minutes} min</span>
                    {t.goto && !isDone ? <button type="button" className={cn(btn.base, btn.small, now ? btn.primary : btn.plain)} onClick={() => go(t.goto === "quiz" ? 4 : 5)}>Inizia</button> : null}
                  </li>
                );
              })}
            </ul>
            {next ? <p className="m-0 text-[.88rem] text-muted">Hai poco tempo? Comincia da «Adesso»: gli argomenti che oggi non studi tornano nel piano dei prossimi giorni.</p>
              : <div className="rounded-row bg-good-soft px-4 py-3 text-good"><b>Fatto per oggi.</b> Domani il piano riparte da dove sei arrivato.</div>}
          </section>

          {days.length ? (
            <section aria-labelledby="days-title" className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="days-title" className="m-0 text-[1.2rem] font-extrabold">I prossimi giorni</h2>
                <ul aria-label="Fasi del piano" className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-[.82rem] text-muted">
                  {(Object.keys(PHASES) as Phase[]).map((k) => <li key={k} className="flex items-center gap-1.5"><i className={cn("h-2 w-2 rounded-full", phaseColor[k])} />{PHASES[k]}</li>)}
                </ul>
              </div>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 p-0">
                {days.map((d) => (
                  <li key={d.date.toISOString()} className="grid gap-0.5 rounded-ctl border border-line bg-surface px-3.5 py-3">
                    <span className="flex items-center gap-2 text-[.84rem] font-bold text-muted"><i className={cn("h-2 w-2 rounded-full", phaseColor[d.phase])} />{fmtShort(d.date)}<span className="sr-only"> ({PHASES[d.phase]})</span></span>
                    <b className="text-[1.15rem] tracking-[-0.02em] tabular-nums">~{d.minutes} min</b>
                    <span className="text-[.84rem] text-muted">{d.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="grid min-w-0 flex-[1_1_240px] gap-4">
          <QuoteCard />
          <section aria-labelledby="weak-title" className={cn(card, "grid gap-3 p-5")}>
            <h2 id="weak-title" className="m-0 text-[1.02rem] font-extrabold">Dove c'è più da guadagnare</h2>
            {weak.map(({ t, score }) => (
              <div key={t.id} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-3"><span className="min-w-0">{t.title}</span><b className={cn("flex-none", score == null && "text-bad")}>{score == null ? "mai provato" : `${Math.round(score * 100)}%`}</b></div>
                <Bar value={score ?? 0} tone={score != null && score >= 0.7 ? "good" : "brand"} label={`Padronanza: ${t.title}`} className="h-1.5" />
              </div>
            ))}
            <span className="text-[.84rem] text-muted">Si aggiorna con i quiz e le flashcard.</span>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ----------------------------------- 5. quiz ----------------------------------- */

function SessionHead({ title, right, onExit }: { title: string; right: string; onExit: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className={cn(btn.base, btn.ghost, btn.small, "-ml-3")} onClick={onExit}>← Esci</button>
      <b className="min-w-0 flex-[1_1_160px] text-center">{title}</b>
      <span className="text-[.88rem] text-muted tabular-nums">{right}</span>
    </div>
  );
}

const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.matches("input, textarea, select");

export function QuizScreen({ toggle, addScores, go }: Shared) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => QUESTIONS.map(() => null));
  const [finished, setFinished] = useState(false);
  const q = QUESTIONS[i];
  const answer = answers[i];
  const revealed = answer != null;
  const nextRef = useRef<() => void>(() => {});
  const choose = (k: number) => !revealed && setAnswers((a) => a.map((x, j) => (j === i ? k : x)));
  const next = () => {
    if (!revealed) return;
    if (i < QUESTIONS.length - 1) return setI(i + 1);
    const per: Record<string, number[]> = {};
    QUESTIONS.forEach((qq, j) => (per[qq.topic] ??= []).push(answers[j] === qq.correct ? 1 : 0));
    addScores(per);
    toggle("quiz", true);
    setFinished(true);
  };
  nextRef.current = next;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? "abcd".indexOf(e.key.toLowerCase()) : -1;
      const n = e.key.length === 1 ? "1234".indexOf(e.key) : -1;
      if (!revealed && (k >= 0 || n >= 0)) { e.preventDefault(); choose(k >= 0 ? k : n); }
      else if (revealed && e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); nextRef.current(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (finished) {
    const right = QUESTIONS.filter((qq, j) => answers[j] === qq.correct).length;
    return (
      <div className="mx-auto grid w-full max-w-[720px] gap-5">
        <section className={cn(card, "grid gap-4 p-6")} aria-labelledby="quiz-done">
          <Kicker>Risultato</Kicker>
          <h2 id="quiz-done" className="m-0 text-[3rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{Math.round((right / QUESTIONS.length) * 100)}%</h2>
          <Bar value={right / QUESTIONS.length} tone={right / QUESTIONS.length >= 0.75 ? "good" : "brand"} label="punteggio" />
          <p className="m-0 text-muted">{right} su {QUESTIONS.length} giuste. {right < QUESTIONS.length ? "Gli errori tornano nei prossimi quiz, finché non li superi." : "Rifallo tra qualche giorno: ricordare a distanza è ciò che fissa."}</p>
        </section>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(btn.base, btn.primary)} onClick={() => go(5)}>Avanti: le flashcard →</button>
          <button type="button" className={cn(btn.base, btn.plain)} onClick={() => go(3)}>Torna al piano</button>
        </div>
      </div>
    );
  }

  const ok = answer === q.correct;
  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-4">
      <SessionHead title="Quiz sugli argomenti di ieri" right={`Domanda ${i + 1}/${QUESTIONS.length}`} onExit={() => go(3)} />
      <ol aria-label="Domande" className="m-0 flex list-none gap-1 p-0">
        {QUESTIONS.map((qq, j) => {
          const a = answers[j];
          const tone = a == null ? (j === i ? "bg-brand" : "bg-line") : a === qq.correct ? "bg-good" : "bg-bad";
          return <li key={j} className={cn("h-1.5 flex-1 rounded-full", tone)}><span className="sr-only">{a == null ? (j === i ? "domanda di adesso" : "da fare") : a === qq.correct ? "giusta" : "da rivedere"}</span></li>;
        })}
      </ol>
      <section aria-labelledby="q-prompt" className={cn(card, "grid gap-4 rounded-[22px] p-5 sm:p-6")}>
        <div className="flex flex-wrap gap-1.5"><Pill tone="brand">{q.topic}</Pill><Pill>Scelta multipla</Pill></div>
        <h2 id="q-prompt" className="m-0 text-[1.3rem] font-semibold leading-snug tracking-[-0.01em]">{q.prompt}</h2>
        <div className="grid gap-2.5">
          {q.options.map((o, k) => {
            const isRight = revealed && k === q.correct;
            const isWrong = revealed && k === answer && !ok;
            return (
              <button key={o} type="button" disabled={revealed} onClick={() => choose(k)}
                className={cn("flex min-h-[54px] w-full items-center gap-3.5 rounded-row border-[1.5px] px-4 py-3 text-left transition-colors",
                  isRight ? "border-good bg-good-soft" : isWrong ? "border-bad bg-bad-soft" : revealed ? "border-line opacity-65" : "border-line-strong bg-surface hover:border-brand hover:bg-brand-soft")}>
                <span className={cn("grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] font-extrabold",
                  isRight ? "bg-good text-brand-ink" : isWrong ? "bg-bad text-brand-ink" : "bg-surface-2 text-muted")}>{"ABCD"[k]}</span>
                <span className={cn("min-w-0 flex-1", isRight && "font-bold")}>{o}</span>
                {isRight ? <span className="flex-none text-[.85rem] font-bold text-good">Corretta</span> : isWrong ? <span className="flex-none text-[.85rem] font-bold text-bad">La tua risposta</span> : null}
              </button>
            );
          })}
        </div>
      </section>
      {revealed ? (
        <section aria-live="polite" className={cn(card, "grid gap-2 p-5 shadow-none animate-fade-up")}>
          <p className="m-0"><b className={ok ? "text-good" : "text-bad"}>{ok ? "Corretto." : "Non proprio."}</b>{ok ? "" : ` La risposta giusta è la ${"ABCD"[q.correct]}.`}</p>
          <h3 className="m-0 text-[1rem] font-bold">Perché</h3>
          <p className="m-0">{q.why}</p>
        </section>
      ) : <p className="m-0 text-center text-[.88rem] text-muted">Rispondi con un clic, oppure con i tasti A–D.</p>}
      {revealed ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[.88rem] text-muted">{ok ? "Tornerà più avanti, per non dimenticarla." : "Le risposte sbagliate tornano nei prossimi quiz, finché non le sai."}</span>
          <button type="button" className={cn(btn.base, btn.primary)} onClick={next} autoFocus>{i < QUESTIONS.length - 1 ? "Avanti →" : "Vedi il risultato"} <Kbd>Invio</Kbd></button>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- 6. flashcard --------------------------------- */

export function FlashScreen({ toggle, setFlash, go }: Shared) {
  const [queue, setQueue] = useState(() => CARDS.map((_, k) => k));
  const [again, setAgain] = useState<Set<number>>(new Set());
  const [reviewed, setReviewed] = useState(0);
  const [forgot, setForgot] = useState(0);
  const [shown, setShown] = useState(false);
  const total = CARDS.length + again.size;
  const card0 = queue.length ? CARDS[queue[0]] : null;
  const grade = (g: number) => {
    const k = queue[0];
    setReviewed((n) => n + 1);
    let rest = queue.slice(1);
    if (g === 0) {
      setForgot((n) => n + 1);
      if (!again.has(k)) { setAgain(new Set(again).add(k)); rest = [...rest.slice(0, 2), k, ...rest.slice(2)]; } // la rivedi a breve, non subito
    }
    setQueue(rest);
    setShown(false);
    if (!rest.length) { toggle("flash", true); setFlash({ reviewed: reviewed + 1, remembered: reviewed + 1 - (forgot + (g === 0 ? 1 : 0)) }); }
  };
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card0 || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!shown && (e.key === " " || e.key === "Enter") && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); setShown(true); }
      else if (shown && "1234".includes(e.key) && e.key.length === 1) { e.preventDefault(); gradeRef.current(Number(e.key) - 1); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!card0) {
    return (
      <div className="mx-auto grid w-full max-w-[720px] gap-5">
        <section className={cn(card, "grid gap-3 p-6 text-center")} aria-labelledby="flash-done">
          <h2 id="flash-done" className="m-0 text-[1.5rem] font-extrabold">Sessione completata</h2>
          <p className="m-0">{reviewed} risposte, {reviewed - forgot} ricordate al primo colpo.</p>
          <p className="m-0 text-[.9rem] text-muted">Le carte tornano quando stai per dimenticarle, mai oltre il giorno prima dell'esame.</p>
        </section>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={cn(btn.base, btn.primary)} onClick={() => go(6)}>Fine della demo →</button>
          <button type="button" className={cn(btn.base, btn.plain)} onClick={() => go(3)}>Torna al piano</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-3">
      <SessionHead title="Flashcard del giorno" right={`${queue.length} rimaste`} onExit={() => go(3)} />
      <Bar value={1 - queue.length / total} label="avanzamento della sessione" className="h-1.5" />
      <div className="flex flex-wrap justify-between gap-2 text-[.88rem] text-muted">
        <span>{Math.min(reviewed + 1, total)} di {total} · {card0.topic}</span>
        {reviewed ? <span>{reviewed - forgot} ricordate · {forgot} da rivedere</span> : null}
      </div>
      <div className="relative pb-4">
        <div aria-hidden="true" className="absolute inset-x-7 bottom-0 h-10 rounded-[22px] bg-surface-2" />
        <div aria-hidden="true" className="absolute inset-x-3.5 bottom-2 h-10 rounded-[22px] border border-line bg-surface-2" />
        <section aria-live="polite" aria-labelledby="fc-front" className={cn(card, "relative grid min-h-[260px] content-start gap-5 rounded-[22px] p-6 sm:p-8")}>
          <div className="grid gap-2">
            <Kicker>Domanda</Kicker>
            <h2 id="fc-front" className="m-0 text-[1.4rem] font-semibold leading-snug tracking-[-0.01em]">{card0.front}</h2>
          </div>
          {shown ? (
            <div className="grid gap-2 border-t border-line pt-5 animate-fade-up">
              <Kicker className="text-brand">Risposta</Kicker>
              <p className="m-0 text-[1.12rem] leading-normal">{card0.back}</p>
            </div>
          ) : null}
        </section>
      </div>
      {shown ? (
        <div className="grid gap-2.5">
          <p className="m-0 text-center text-muted">Quanto bene te la ricordavi?</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
            {GRADES.map((g, k) => (
              <button key={g.label} type="button" onClick={() => grade(k)}
                className={cn("grid min-h-[60px] place-items-center gap-0 rounded-row border px-2 py-2 font-bold transition-colors",
                  g.tone === "bad" ? "border-[1.5px] border-bad bg-surface text-bad" : g.tone === "good" ? "border-[1.5px] border-good bg-good-soft text-good" : "border-line-strong bg-surface hover:border-brand")}>
                <span className="flex items-center gap-2">{g.label} <Kbd>{k + 1}</Kbd></span>
                <small className={cn("text-[.82rem] font-medium", g.tone === "good" ? "text-good" : "text-muted")}>{g.next}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid justify-items-center gap-2">
          <button type="button" className={cn(btn.base, btn.primary)} onClick={() => setShown(true)} autoFocus>Mostra risposta <Kbd>spazio</Kbd></button>
          <p className="m-0 text-center text-[.88rem] text-muted">Prima prova a rispondere a mente: è lo sforzo di ricordare che consolida.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------ fine ------------------------------------ */

export function EndScreen({ scores, flash, go }: Shared) {
  const all = Object.values(scores).flat();
  const quiz = all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) : null;
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h2 className={h1}>Fine della demo</h2>
        <p className={lead}>Hai fatto il percorso di un esame in Studify, dalla data dell'appello al primo ripasso.</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <div className="grid rounded-[16px] border border-line bg-surface px-5 py-4"><b className="text-[2rem] font-black leading-tight tabular-nums">{quiz == null ? "—" : `${quiz}%`}</b><span className="text-muted">{quiz == null ? "quiz non fatto" : "nel quiz"}</span></div>
        <div className="grid rounded-[16px] border border-line bg-surface px-5 py-4"><b className="text-[2rem] font-black leading-tight tabular-nums">{flash ? flash.remembered : "—"}</b><span className="text-muted">{flash ? `flashcard ricordate su ${flash.reviewed} risposte` : "flashcard non fatte"}</span></div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="real-title" className={cn(card, "grid min-w-0 flex-[1_1_300px] gap-3 p-5")}>
          <h2 id="real-title" className="m-0 text-[1.1rem] font-extrabold">Come nell'app</h2>
          <ul className="m-0 grid list-none gap-2.5 p-0 text-[.95rem]">
            {["Il piano a ritroso, con le stesse fasi e la stessa divisione dei giorni.", "Quiz con il perché di ogni risposta; A–D e Invio da tastiera.", "Flashcard con la valutazione da 1 a 4 e i giorni del prossimo ripasso.", "Le frasi del docente e la fonte di ogni argomento."].map((t) => (
              <li key={t} className="flex items-start gap-2.5"><span className="mt-px grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-good-soft text-good"><Check className="h-3 w-3" strokeWidth={3.4} aria-hidden="true" /></span>{t}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="fake-title" className={cn(card, "grid min-w-0 flex-[1_1_300px] gap-3 p-5")}>
          <h2 id="fake-title" className="m-0 text-[1.1rem] font-extrabold">Solo nella demo</h2>
          <ul className="m-0 grid list-disc gap-2.5 pl-5 text-[.95rem] marker:text-muted">
            <li>Nessuna AI: argomenti, domande e flashcard sono quelli dell'esame d'esempio di Studify.</li>
            <li>I file d'esempio non vengono letti, e i tuoi progressi non vengono salvati.</li>
            <li>I minuti dei prossimi giorni sono indicativi: nell'app li decide il modulo.</li>
          </ul>
        </section>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a href="https://studify-beta-dun.vercel.app" target="_blank" rel="noopener noreferrer" className={cn(btn.base, btn.primary)}>Prova Studify con i tuoi materiali <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
        <button type="button" className={cn(btn.base, btn.plain)} onClick={() => go(0)}>Ricomincia la demo</button>
      </div>
    </div>
  );
}
