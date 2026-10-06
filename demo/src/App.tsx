// Demo guidata di Studify: a sinistra il percorso in sei passi, a destra la finestra dell'app con la schermata del passo.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { EndScreen, ExamScreen, FlashScreen, MaterialsScreen, QuizScreen, ReadyScreen, TodayScreen, type Exam, type Loaded, type Shared } from "./screens";
import { Logo, btn } from "./ui";

const STEPS = [
  { title: "Descrivi l'esame", text: "Data, tipo di prova, livello e ore al giorno bastano per costruire il piano a ritroso dall'appello.", why: "Le simulazioni d'esame cadono a ridosso dell'appello e l'ultimo giorno resta leggero.", tip: "Sposta i giorni: le fasi si ridistribuiscono come nell'app." },
  { title: "Porta i materiali", text: "Dispense, slide, esami passati, quiz del docente, sbobine, appunti a mano. Il tipo di file decide come viene usato.", why: "Gli esami passati dicono che cosa pesa di più; le parole del docente entrano così come sono.", tip: "Aggiungi i file d'esempio e genera il modulo." },
  { title: "Controlla il modulo", text: "Argomenti in ordine di importanza, ognuno con la sua fonte. Ciò che non viene dai tuoi materiali è segnato da verificare.", why: "Con la fonte accanto controlli subito sulle dispense: l'AI può sbagliare.", tip: "Guarda da dove viene ogni argomento, poi parti." },
  { title: "Segui il piano di oggi", text: "Ogni giorno una sessione breve, con l'attività da fare adesso in evidenza. Gli argomenti che salti tornano nei giorni dopo.", why: "Ripasso distribuito: rivedere a intervalli fissa più che concentrare tutto alla fine.", tip: "Spunta le attività, o apri quiz e flashcard da «Inizia»." },
  { title: "Mettiti alla prova", text: "Domande dai tuoi materiali e dagli esami passati, con il perché di ogni risposta.", why: "Richiamo attivo: rispondere fissa più che rileggere. Gli errori tornano nei quiz successivi.", tip: "Rispondi con A–D, vai avanti con Invio." },
  { title: "Ripassa con le flashcard", text: "Prima ricordi, poi giri la carta e dici quanto bene te la ricordavi: la carta torna quando stai per dimenticarla.", why: "Ripasso a intervalli crescenti, senza programmare nulla oltre il giorno prima dell'esame.", tip: "Spazio per girare la carta, 1–4 per valutare." },
];
const END = STEPS.length;
const START_EXAM: Exam = { name: "Microeconomia", days: 21, type: "misto", level: 2, hours: 2 };

export default function App() {
  const [step, setStep] = useState(0);
  const [exam, setExam] = useState<Exam>(START_EXAM);
  const [files, setFiles] = useState<Loaded[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<Record<string, number[]>>({});
  const [flash, setFlash] = useState<{ reviewed: number; remembered: number } | null>(null);
  const [run, setRun] = useState(0); // cambia a ogni «Ricomincia»: le schermate ripartono da zero
  const screenRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const go = useCallback((n: number) => { moved.current = true; setStep(Math.max(0, Math.min(END, n))); }, []);
  const restart = useCallback(() => {
    setExam(START_EXAM); setFiles([]); setDone(new Set()); setScores({}); setFlash(null); setRun((r) => r + 1); go(0);
  }, [go]);
  const toggle = useCallback((id: string, on?: boolean) => setDone((d) => {
    const n = new Set(d);
    if (on ?? !n.has(id)) n.add(id); else n.delete(id);
    return n;
  }), []);
  const addScores = useCallback((s: Record<string, number[]>) => setScores((old) => {
    const n = { ...old };
    for (const [k, v] of Object.entries(s)) n[k] = [...(n[k] ?? []), ...v];
    return n;
  }), []);

  // a ogni cambio di passo: in cima alla schermata, con il fuoco sulla finestra (chi usa la tastiera o un lettore di schermo sa dov'è)
  useEffect(() => {
    // sul telefono l'elenco dei passi scorre di lato: porta in vista quello di adesso
    const rail = railRef.current;
    const cur = rail?.querySelector<HTMLElement>('[aria-current="step"]');
    if (rail && cur && rail.scrollWidth > rail.clientWidth) rail.scrollTo({ left: Math.max(0, cur.offsetLeft - 16), behavior: "auto" });
    if (!moved.current) return;
    screenRef.current?.focus({ preventScroll: true });
    screenRef.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [step]);

  // il passo arriva al modulo solo dopo averlo generato: chi salta avanti dal percorso trova i file d'esempio già letti
  useEffect(() => {
    if (step >= 2 && !files.length) setFiles([{ id: "dispense", progress: 100 }, { id: "esame", progress: 100 }]);
  }, [step, files.length]);

  const shared: Shared = { exam, setExam, files, setFiles, done, toggle, scores, addScores, flash, setFlash, go };
  const screens = [ExamScreen, MaterialsScreen, ReadyScreen, TodayScreen, QuizScreen, FlashScreen];
  const Screen = step < END ? screens[step] : null;
  const s = STEPS[Math.min(step, END - 1)];

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-10 pt-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Logo />
          <span className="rounded-full bg-brand-soft px-2.5 py-[3px] text-[.8rem] font-bold text-brand">Demo guidata</span>
        </div>
        <a href="https://studify-beta-dun.vercel.app" target="_blank" rel="noopener noreferrer" className={cn(btn.base, btn.ghost, btn.small)}>
          Apri Studify <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="Percorso della demo" className="grid gap-4 lg:sticky lg:top-5">
          <div className="grid gap-1">
            <h1 className="m-0 text-[1.45rem] font-extrabold leading-tight tracking-[-0.025em]">Un esame in Studify, dall'appello al primo ripasso</h1>
            <p className="m-0 text-[.92rem] text-muted">Dati d'esempio, nessun account e nessuna AI: in cinque minuti vedi che cosa fa l'app.</p>
          </div>
          <div ref={railRef} className="relative -mx-1 overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0">
            <ol className="m-0 flex list-none gap-1.5 p-0 lg:grid lg:gap-1">
              {STEPS.map((st, k) => {
                const cur = k === step;
                const past = k < step;
                return (
                  <li key={st.title} className="flex-none lg:flex-auto">
                    <button type="button" aria-current={cur ? "step" : undefined} onClick={() => go(k)}
                      className={cn("flex min-h-[44px] w-full items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-left font-semibold transition-colors",
                        cur ? "bg-surface text-text shadow-card" : "text-muted hover:bg-surface hover:text-text")}>
                      <span className={cn("grid h-7 w-7 flex-none place-items-center rounded-full text-[.82rem] font-extrabold",
                        cur ? "bg-brand text-brand-ink" : past ? "bg-good-soft text-good" : "border-[1.5px] border-line-strong")}>
                        {past ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-label="fatto" /> : k + 1}
                      </span>
                      <span className="whitespace-nowrap lg:whitespace-normal">{st.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          {step < END ? (
            <section aria-live="polite" aria-labelledby="tour-title" className="grid gap-3 rounded-card border border-line bg-surface p-5">
              <span className="text-[.78rem] font-extrabold uppercase tracking-[.07em] text-brand">Passo {step + 1} di {END}</span>
              <h2 id="tour-title" className="m-0 text-[1.15rem] font-extrabold">{s.title}</h2>
              <p className="m-0 text-[.95rem]">{s.text}</p>
              <p className="m-0 rounded-row bg-surface-2 px-3.5 py-2.5 text-[.9rem]"><b>Perché funziona.</b> {s.why}</p>
              <p className="m-0 text-[.9rem] text-muted"><b className="text-text">Prova:</b> {s.tip}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button type="button" className={cn(btn.base, btn.ghost, btn.small)} disabled={step === 0} onClick={() => go(step - 1)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Indietro</button>
                <button type="button" className={cn(btn.base, btn.plain, btn.small)} onClick={() => go(step + 1)}>{step === END - 1 ? "Fine" : "Passo dopo"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </section>
          ) : (
            <section className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <h2 className="m-0 text-[1.15rem] font-extrabold">Ecco tutto</h2>
              <p className="m-0 text-[.95rem]">Sei passi: l'esame, i materiali, il modulo, il piano di oggi, quiz e flashcard.</p>
              <button type="button" className={cn(btn.base, btn.plain, btn.small, "justify-self-start")} onClick={restart}>Ricomincia la demo</button>
            </section>
          )}
        </aside>

        <div ref={screenRef} tabIndex={-1} aria-label="Finestra di Studify" className="min-w-0 scroll-mt-4 overflow-hidden rounded-card border border-line bg-bg shadow-lift focus:outline-none">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
            <Logo />
            <nav aria-hidden="true" className="hidden gap-1 text-[.9rem] font-semibold text-muted sm:flex">
              <span className="rounded-[10px] bg-brand-soft px-3 py-1.5 text-brand">Esami</span>
              <span className="px-3 py-1.5">Libretto</span><span className="px-3 py-1.5">Ateneo</span><span className="px-3 py-1.5">Dati</span>
            </nav>
          </div>
          <div key={`${run}-${step}`} className={cn("min-h-[560px] px-4 py-6 sm:px-7 sm:py-8", moved.current && "animate-fade-up")}>
            {Screen ? <Screen {...shared} /> : <EndScreen {...shared} go={(n) => (n === 0 ? restart() : go(n))} />}
          </div>
        </div>
      </div>
    </div>
  );
}
