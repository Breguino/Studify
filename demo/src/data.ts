// Dati d'esempio della demo: argomenti, domande e flashcard vengono dall'esame demo di Studify (public/demo/module.json).

export const EXAM_TYPES = [
  { id: "scritto", label: "Scritto (domande aperte)" },
  { id: "test", label: "Test a risposta multipla" },
  { id: "problemi", label: "Scritto con esercizi" },
  { id: "orale", label: "Orale" },
  { id: "misto", label: "Scritto + orale" },
] as const;

export const LEVELS = [
  { n: 1, label: "Parto da zero" },
  { n: 2, label: "Ne so poco" },
  { n: 3, label: "Conosco le basi" },
  { n: 4, label: "Ci sono già dentro" },
  { n: 5, label: "Mi serve solo ripassare" },
] as const;

export type Phase = "learn" | "consolidate" | "simulate" | "light";
export const PHASES: Record<Phase, string> = {
  learn: "Comprensione",
  consolidate: "Consolidamento",
  simulate: "Simulazione",
  light: "Ripasso leggero",
};

/** La stessa divisione del piano vero (public/js/planner.js, splitPhases). */
export function splitPhases(n: number) {
  const light = n >= 3 ? 1 : 0;
  const sim = n >= 5 ? Math.max(1, Math.round(n * 0.15)) : n >= 3 ? 1 : 0;
  const rest = n - light - sim;
  const learn = Math.min(rest, Math.max(1, Math.round(rest * 0.5)));
  return { learn, consolidate: rest - learn, sim, light };
}

export function phaseOfDay(i: number, n: number): Phase {
  const p = splitPhases(n);
  return i < p.learn ? "learn" : i < p.learn + p.consolidate ? "consolidate" : i < n - p.light ? "simulate" : "light";
}

export type SampleFile = { id: string; name: string; kind: string; done: string; icon: "file" | "mic" };
export const SAMPLE_FILES: SampleFile[] = [
  { id: "dispense", name: "Dispense del docente.pdf", kind: "Dispensa del docente", done: "Letto · 56 pagine", icon: "file" },
  { id: "sbobina", name: "Lezione 4 (sbobina).txt", kind: "Registrazione della lezione", done: "Letto · 12.400 parole", icon: "mic" },
  { id: "esame", name: "Esame 14-06-2025.pdf", kind: "Esame passato", done: "Letto · 4 esercizi", icon: "file" },
  { id: "moodle", name: "Quiz Moodle cap. 3–5.html", kind: "Quiz del docente", done: "Letto · 12 domande con la risposta del docente", icon: "file" },
];

export type Topic = { id: string; title: string; importance: 1 | 2 | 3; source: string; said?: boolean };
export const TOPICS: Topic[] = [
  { id: "t1", title: "Domanda, offerta ed equilibrio", importance: 3, source: "Dispense pp. 4–15 · in 2/2 prove d'esame" },
  { id: "t2", title: "Elasticità", importance: 3, source: "Dispense pp. 16–24 · Quiz Moodle cap. 3" },
  { id: "t3", title: "Teoria del consumatore", importance: 3, source: "Dispense pp. 25–38" },
  { id: "t4", title: "Costi e concorrenza perfetta", importance: 2, source: "Dispense pp. 39–48 · Esame 2025, es. 2" },
  { id: "t5", title: "Monopolio", importance: 2, source: "Dispense pp. 49–56 · Lezione 4", said: true },
];
export const IMPORTANCE = ["", "marginale", "importante", "centrale"];

export const QUOTE = {
  text: "Questa è una domanda che faccio sempre: sappiatela spiegare con un grafico.",
  source: "Lezione 4 · min 32 · Monopolio",
};

export type Question = { topic: string; prompt: string; options: string[]; correct: number; why: string };
export const QUESTIONS: Question[] = [
  { topic: "Domanda, offerta ed equilibrio", prompt: "Il prezzo di un bene sale. Quale affermazione è corretta?", options: ["La curva di domanda si sposta a sinistra", "La quantità domandata diminuisce lungo la stessa curva", "La domanda aumenta", "La curva di offerta si sposta a destra"], correct: 1, why: "Una variazione del prezzo del bene stesso causa un movimento lungo la curva di domanda, non uno spostamento. Gli spostamenti dipendono da altri fattori (reddito, gusti, prezzi di altri beni)." },
  { topic: "Elasticità", prompt: "Se l'elasticità della domanda al prezzo è 0,4 e il prezzo aumenta del 10%, la quantità domandata:", options: ["Diminuisce del 25%", "Diminuisce del 4%", "Diminuisce del 40%", "Aumenta del 4%"], correct: 1, why: "La variazione percentuale della quantità è l'elasticità per la variazione percentuale del prezzo: 0,4 × 10% = 4%, in diminuzione. Con domanda anelastica i ricavi aumentano." },
  { topic: "Teoria del consumatore", prompt: "All'ottimo del consumatore con due beni vale:", options: ["MUx = MUy", "MRS = Px/Py", "Px = Py", "Utilità totale dei due beni uguale"], correct: 1, why: "All'ottimo la curva di indifferenza è tangente al vincolo di bilancio: MRS = Px/Py. Equivale a MUx/Px = MUy/Py, non a MUx = MUy." },
  { topic: "Costi e concorrenza perfetta", prompt: "Un'impresa concorrenziale ha costo marginale 8 alla quantità corrente e il prezzo di mercato è 12. Cosa dovrebbe fare?", options: ["Ridurre la produzione", "Aumentare la produzione", "Mantenere la produzione", "Chiudere"], correct: 1, why: "Con P > MC ogni unità addizionale aggiunge più ricavo (12) che costo (8): conviene aumentare la produzione fino a P = MC." },
  { topic: "Monopolio", prompt: "Per un monopolista con domanda lineare, rispetto al prezzo il ricavo marginale è:", options: ["Uguale", "Maggiore", "Minore", "Indipendente"], correct: 2, why: "Per vendere di più deve abbassare il prezzo su tutte le unità: MR < P. Con domanda lineare MR ha pendenza doppia." },
];

export type Card = { topic: string; front: string; back: string };
export const CARDS: Card[] = [
  { topic: "Domanda, offerta ed equilibrio", front: "Cosa succede al prezzo se c'è eccesso di offerta?", back: "Tende a scendere, finché quantità domandata e offerta si riequilibrano." },
  { topic: "Elasticità", front: "Domanda anelastica (<1): cosa accade ai ricavi se il prezzo aumenta?", back: "Aumentano: la quantità cala meno che proporzionalmente." },
  { topic: "Teoria del consumatore", front: "Cosa fa ruotare il vincolo di bilancio?", back: "Una variazione del prezzo di uno solo dei due beni." },
  { topic: "Costi e concorrenza perfetta", front: "Quando un'impresa concorrenziale chiude nel breve periodo?", back: "Se il prezzo è inferiore al costo variabile medio minimo." },
  { topic: "Monopolio", front: "Perché per il monopolista MR < P?", back: "Per vendere un'unità in più deve abbassare il prezzo su tutte le unità, non solo sull'ultima." },
];
// gli intervalli del ripasso come li mostra l'app sui pulsanti (carta nuova)
export const GRADES = [
  { label: "Di nuovo", next: "1 g", tone: "bad" },
  { label: "Difficile", next: "1 g", tone: "" },
  { label: "Bene", next: "1 g", tone: "good" },
  { label: "Facile", next: "3 g", tone: "" },
] as const;

export type Task = { id: string; title: string; minutes: number; method: string; goto?: "quiz" | "flash" };
export const TODAY: Task[] = [
  { id: "flash", title: "Flashcard del giorno", minutes: 15, method: "Richiamo attivo (flashcard)", goto: "flash" },
  { id: "learn", title: "Studia: Elasticità (leggi pp. 16–24)", minutes: 35, method: "Prima lettura guidata" },
  { id: "quiz", title: "Quiz sugli argomenti di ieri", minutes: 15, method: "Quiz e simulazioni", goto: "quiz" },
];
