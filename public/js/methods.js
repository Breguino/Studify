// Scelta dei metodi di studio.
//
// Basata sulle evidenze della psicologia dell'apprendimento (es. Dunlosky et al. 2013;
// Roediger & Karpicke 2006; Cepeda et al. 2006; Kalyuga, expertise reversal effect):
//   - alta utilità: richiamo attivo / prove pratiche, ripasso distribuito nel tempo
//   - media: interrogazione elaborativa ("perché?"), auto-spiegazione, interleaving
//   - bassa: rilettura, evidenziazione, riassunti passivi
// NON si usano gli "stili di apprendimento" (visivo/uditivo/...): non c'è evidenza che
// abbinare il metodo allo stile migliori i risultati. Contano invece il TIPO DI PROVA,
// il TEMPO RIMASTO e il LIVELLO DI PARTENZA.

export const EXAM_TYPES = {
  scritto: "Scritto (domande aperte)",
  test: "Test a risposta multipla",
  problemi: "Scritto con esercizi / problemi",
  orale: "Orale",
  misto: "Scritto + orale",
};

export const METHODS = {
  firstpass: {
    name: "Prima lettura guidata",
    how: "Leggi il riassunto dell'argomento, poi chiudilo e scrivi 3 cose che ricordi. Serve solo a capire: non è ancora studio.",
  },
  elaborate: {
    name: "Elaborazione (perché? come?)",
    how: "Per ogni concetto chiediti «perché è vero?» e «come si collega a ciò che so già?». Rispondi per iscritto.",
  },
  retrieval: {
    name: "Richiamo attivo (flashcard)",
    how: "Prova a rispondere prima di girare la carta. Lo sforzo di ricordare è ciò che consolida la memoria.",
  },
  spaced: {
    name: "Ripasso a intervalli",
    how: "Le carte ricompaiono a distanza crescente (1, 3, 7… giorni), adattata alla data d'esame.",
  },
  practice: {
    name: "Quiz e simulazioni",
    how: "Rispondi a domande nel formato dell'esame, senza appunti. Gli errori indicano cosa ripassare.",
  },
  feynman: {
    name: "Spiegazione con parole tue",
    how: "Spiega l'argomento come all'esame, senza appunti; poi confronta con la checklist dei punti chiave.",
  },
  worked: {
    name: "Esempi svolti → esercizi",
    how: "Prima studia un esercizio già risolto passo per passo, poi risolvine uno simile da solo.",
  },
  interleave: {
    name: "Interleaving (argomenti mescolati)",
    how: "Nei quiz mescola argomenti diversi invece di farli a blocchi: impari a riconoscere quale metodo serve.",
  },
};

// Pesi base (0-100) per tipo di prova.
const BASE = {
  scritto: { firstpass: 50, elaborate: 60, retrieval: 80, spaced: 80, practice: 80, feynman: 75, worked: 20, interleave: 50 },
  test: { firstpass: 50, elaborate: 40, retrieval: 85, spaced: 80, practice: 95, feynman: 25, worked: 20, interleave: 60 },
  problemi: { firstpass: 40, elaborate: 40, retrieval: 60, spaced: 70, practice: 90, feynman: 40, worked: 90, interleave: 80 },
  orale: { firstpass: 50, elaborate: 70, retrieval: 75, spaced: 75, practice: 60, feynman: 95, worked: 10, interleave: 30 },
  misto: { firstpass: 50, elaborate: 60, retrieval: 80, spaced: 80, practice: 80, feynman: 80, worked: 30, interleave: 50 },
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * @param {{examType:string, daysLeft:number, level:number, hoursPerDay:number, topicCount?:number}} p
 *   level: 1 = parto da zero … 5 = conosco già bene la materia
 */
export function recommendMethods({ examType, daysLeft, level, hoursPerDay, topicCount = 0 }) {
  const w = { ...(BASE[examType] ?? BASE.misto) };
  const why = {};
  const note = (id, text) => (why[id] ??= []).push(text);

  const mode = daysLeft <= 2 ? "emergenza" : daysLeft <= 7 ? "intensivo" : "normale";

  // Tempo: senza giorni a sufficienza il ripasso distribuito perde senso.
  if (daysLeft < 4) {
    w.spaced = Math.min(w.spaced, 25);
    w.retrieval += 10;
    w.practice += 5;
    w.elaborate -= 30;
    note("spaced", `mancano ${Math.max(daysLeft, 0)} giorni: pochi per distanziare i ripassi`);
    note("retrieval", "con poco tempo il richiamo attivo rende più della rilettura");
  } else if (daysLeft >= 14) {
    w.spaced += 10;
    note("spaced", `hai ${daysLeft} giorni: il ripasso distribuito è il tuo vantaggio maggiore`);
  }

  // Livello: i principianti hanno bisogno di capire prima di mettersi alla prova
  // (expertise reversal: gli aiuti utili ai novizi rallentano gli esperti).
  if (level <= 2) {
    w.firstpass += 30;
    w.elaborate += 15;
    w.worked += 10;
    w.interleave -= 20;
    note("firstpass", "parti da una base bassa: prima capire, poi mettersi alla prova");
    note("worked", "i principianti imparano meglio da esempi svolti che da problemi a freddo");
    note("interleave", "per ora meglio argomenti a blocchi; mescola più avanti");
  } else if (level >= 4) {
    w.firstpass -= 30;
    w.practice += 5;
    w.interleave += 15;
    note("firstpass", "conosci già la materia: salta la lettura e vai dritto alle prove");
    note("interleave", "base solida: mescolare gli argomenti allena la discriminazione");
  }

  const examNotes = {
    orale: { feynman: "all'orale devi saper spiegare a voce, non solo riconoscere" },
    test: { practice: "il test premia il riconoscimento rapido: allenati nello stesso formato" },
    problemi: { worked: "agli esercizi serve la procedura: esempi svolti, poi pratica", interleave: "agli esami di esercizi la difficoltà è scegliere il metodo giusto" },
    scritto: { feynman: "le domande aperte richiedono di ricostruire un ragionamento" },
    misto: { feynman: "la parte orale richiede di spiegare a voce" },
  }[examType] ?? {};
  for (const [id, t] of Object.entries(examNotes)) note(id, t);

  const warnings = [];
  const budget = hoursPerDay * 60 * Math.max(daysLeft, 0);
  const needed = topicCount * 45; // stima prudente: 45' per argomento tra studio e ripasso
  if (daysLeft <= 0) warnings.push("La data d'esame è oggi o già passata.");
  else if (topicCount && needed > budget * 0.7)
    warnings.push(
      `Tempo stretto: ${topicCount} argomenti richiedono ~${Math.round(needed / 60)} h, ne hai ~${Math.round(budget / 60)} h. ` +
        "Il piano darà priorità agli argomenti più importanti.",
    );
  if (mode === "emergenza")
    warnings.push("Modalità emergenza: niente riletture. Solo richiamo attivo e prove sugli argomenti più probabili.");

  const methods = Object.entries(w)
    .map(([id, weight]) => ({ id, name: METHODS[id].name, how: METHODS[id].how, weight: clamp(weight), why: why[id] ?? [] }))
    .filter((m) => m.weight >= 40)
    .sort((a, b) => b.weight - a.weight);

  return { mode, methods, warnings };
}

/** Consiglio sulla durata dei blocchi di studio (Pomodoro e varianti). */
export function sessionAdvice(minutes) {
  const m = Number(minutes) || 25;
  const brk = m >= 50 ? 10 : 5;
  return `Blocchi da ${m} min con ${brk} min di pausa; ogni 3-4 blocchi una pausa lunga.`;
}
