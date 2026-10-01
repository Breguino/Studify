# Studify

Ambiente di studio per chi prepara esami universitari. Parti dai **tuoi appunti** (testo, `.md`, PDF)
e/o da **materiale cercato online dall'AI**; ottieni un **modulo di studio** con argomenti, flashcard,
quiz e un **piano a ritroso dalla data d'esame**, costruito con metodi di studio che hanno evidenza
scientifica.

```
npm install
export ANTHROPIC_API_KEY=sk-ant-...    # facoltativa: senza, l'app parte in "modalità base"
npm start                              # http://127.0.0.1:3000
npm run demo                           # AI simulata + esame demo: per provare tutto senza chiave
npm test
```

Serve Node ≥ 20 (≥ 22.13 per eseguire i test, che leggono PDF con pdf.js). Nessun build step: il frontend è JavaScript ES modules servito così com'è; pdf.js (`pdfjs-dist`) viene servito da `node_modules` solo quando si apre un PDF.

## Versione per Claude (senza installare nulla)

Lo stesso Studify si può pubblicare come **pagina Claude** (artifact): niente Node, niente chiave API.
Usa l'account Claude di chi apre la pagina e salva i dati nel suo spazio privato.

```
npm run build:artifact     # crea dist/studify.html (un solo file, ~1,9 MB: include pdf.js)
```

Si pubblica con le capacità `sample` (Claude), `db` + `user` (archivio privato per utente) e `downloads` (backup).
Differenze rispetto alla versione con server:

| | Server (`npm start`) | Pagina Claude |
|---|---|---|
| Generazione modulo | una richiesta, PDF compresi (anche scansioni) | a passi (schema → carte e domande per argomento); max ~200k caratteri; di un PDF si usa il testo (le scansioni no) |
| Ricerca web: corsi dell'ateneo, piano di studi, materiali | sì | **no** (Claude non può navigare): il piano si **incolla** (letto da Claude) o si scrive; al posto dei materiali web una «traccia dal programma» marcata *non verificata* |
| Dati | IndexedDB nel browser | `db` privato per utente (non visibile agli altri nemmeno se condividi la pagina) |
| Costo | la tua chiave API | uso del tuo account Claude |

`npm run build:harness` crea `dist/harness.html`: la pagina con un `window.claude` finto, per provarla in un browser normale.
I moduli `public/js/api.js` e `public/js/backend.js` vengono sostituiti da `artifact/api.js` e `artifact/backend.js` in fase di build.

## Come funziona

0. **Ateneo, corso di studio, anni e materie** (scheda «Ateneo»):
   - scegli l'ateneo (anche con la sigla: `UNIBS`, `POLIMI`, `UNIBO`…);
   - il **corso di studio**: con l'AI e la ricerca web (versione con server) l'app cerca l'offerta formativa dell'ateneo e ti propone i corsi
     in un menu (triennali / magistrali / ciclo unico); altrimenti lo scrivi tu;
   - il **piano di studi per anno** (1°, 2°, 3°…), con gli **insegnamenti a scelta** (tipici del terzo anno) raggruppati a parte. Tre modi:
     cercarlo sul sito dell'ateneo (solo versione con server), **incollare** il piano copiato dal sito/Esse3/PDF (letto dall'AI oppure con
     la lettura rapida senza AI), o inserire gli insegnamenti a mano. Anno, tipo (obbligatorio / a scelta), CFU e prova si correggono riga per riga.
   - creando un esame scegli **anno** e **insegnamento**: CFU, tipo di prova e anno si precompilano.
   I dati trovati sul web sono sempre segnalati «da verificare» (a.a., fonti): la prova d'esame resta «Non indicato» se la scheda non la dichiara.
0b. **Importa da CSV o Excel** (pulsante «Importa CSV / Excel»): tre tipi di file, riconosciuti dalle intestazioni (colonne correggibili a mano):
   - **appelli d'esame**: insegnamento, data, ora, aula, tipo di prova, CFU, anno. Più date per lo stesso insegnamento = più appelli (si sceglie
     da «Modifica»); le date già passate vengono ignorate; l'esame esistente con lo stesso nome viene aggiornato, non duplicato;
   - **piano di studi**: insegnamento, anno, CFU, tipo (obbligatorio / a scelta), prova;
   - **orari delle lezioni**: insegnamento, giorno (lunedì… o una data), inizio e fine (o «09:00-11:00»), aula. Le lezioni riducono il tempo di studio
     dei giorni in cui cadono (mai sotto 30') e nei giorni quasi pieni non si introducono argomenti nuovi. Le lezioni settimanali valgono fino
     alla data indicata.
   Un **calendario `.ics`** (esportato da Esse3/CINECA, Google Calendar, Outlook) si importa come orario delle lezioni o come appelli: gli orari
   in UTC vengono convertiti nell'ora di Roma con l'ora legale, le ricorrenze (`RRULE`, `EXDATE`) espanse, gli eventi annullati e «tutto il
   giorno» ignorati. Le lezioni sovrapposte sono segnalate e non vengono sottratte due volte al tempo di studio.
   Si legge `.xlsx` (date e orari anche con formato Excel), `.csv`/`.tsv` (delimitatore e codifica Windows-1252 riconosciuti), **`.pdf`** e testo
   copiato da Excel. Titoli e note sopra la tabella vengono saltati. Il vecchio `.xls` non è supportato.
   **PDF**: il testo posizionato viene ricostruito in righe e colonne (intestazioni ripetute a ogni pagina e numeri di pagina esclusi): gli
   elenchi di appelli si importano così, senza AI. Per gli **orari a griglia** (giorni in colonna, fasce orarie in riga) e le impaginazioni
   complesse c'è «Leggi con l'AI», che riceve il testo con le colonne allineate; per i **PDF scansionati** (senza testo) l'AI riceve il PDF
   (versione con server) o le pagine come immagini (pagina Claude). Il risultato passa dalla stessa anteprima e dagli stessi controlli dei CSV.
   Un **piano di studi in PDF** (tabella «SSD | insegnamento | CFU | quadrimestre» con sezioni «INSEGNAMENTI 2° ANNO» e blocco «Altre attività»)
   viene riconosciuto da solo, senza AI: anni, CFU, attività a scelta, corso e anno accademico; la somma dei CFU letti è confrontata con il
   «Totale» dichiarato dal documento (collaudato sul piano 2026-27 di Economia e analisi dei dati: 24 voci, 180/180 CFU). Ha anche la «lettura rapida» senza AI. Errori e righe scartate sono elencati con il numero di riga del tuo file.
1. **Descrivi l'esame**: data, tipo di prova (scritto, test, esercizi, orale, misto), livello di partenza (1-5), ore al giorno.
2. **Porta i materiali**: incolla/carica appunti e PDF; oppure «Cerca online con l'AI» (ricerca web con fonti e link,
   che puoi leggere ed eliminare prima di usarla).
3. **Genera il modulo**: l'AI produce argomenti (con importanza/difficoltà), flashcard atomiche, domande
   (scelta multipla, aperte, esercizi con rubrica) e un elenco di **lacune** nei materiali.
4. **Studia con il piano**: ogni giorno hai una lista di attività; si ricalcola da solo se salti giorni o finisci prima.

| Sessione | Cosa fa |
|---|---|
| Flashcard | Richiamo attivo con ripasso dilazionato (SM-2 semplificato) che **non programma nulla oltre il giorno prima dell'esame**. Le carte nuove sono introdotte solo per argomenti già studiati. |
| Quiz | Errori recenti per primi, argomenti alternati (interleaving). Risposte aperte: spunti i punti della rubrica o chiedi la correzione all'AI. |
| Simulazione | Quiz a tempo con correzione **differita**, come all'esame. |
| Spiega a parole tue | Per scritto aperto/orale: spieghi senza appunti e confronti con i punti chiave. «Simulazione orale» sceglie 3 argomenti pesati per importanza. |
| Progressi | Stima di preparazione per argomento (flashcard solide + quiz), con i punti dove conviene lavorare. |

### Perché questi metodi (e non gli «stili di apprendimento»)

La scelta dei metodi dipende da **tipo di prova, giorni rimasti e livello di partenza** (`public/js/methods.js`),
non da «sono visivo/uditivo»: gli studi non mostrano benefici nell'adattare il metodo allo stile dichiarato.
Si privilegiano le tecniche ad alta utilità (richiamo attivo, ripasso distribuito, prove pratiche) rispetto a
rilettura ed evidenziazione (Dunlosky et al. 2013; Roediger & Karpicke 2006). Per i principianti il piano parte da
una prima lettura guidata e da esempi svolti (expertise reversal); con pochi giorni passa in «modalità emergenza»
(solo richiamo attivo e prove sugli argomenti più probabili).

## Limiti da conoscere

- **Il modulo è una bozza, non una verità.** L'AI può sbagliare. Ogni argomento indica l'origine
  (*tuoi appunti* / *web* / *conoscenza generale dell'AI — da verificare*); le lacune sono esplicitate. Confronta con il programma del corso.
- **La «preparazione» è una stima**, non una previsione del voto: non misura quanto il tuo esame sarà simile ai quiz generati.
- **Non c'è un archivio nazionale incorporato** dei corsi e dei piani di studio (l'open data del MUR non era raggiungibile dall'ambiente
  di sviluppo): elenco corsi e piano arrivano dalla ricerca web dell'AI, dal testo che incolli o da ciò che scrivi.
- **Piano di studi trovato online**: può essere di un anno accademico precedente o di un altro curriculum, e molte guide (Esse3, PDF)
  non sono raggiungibili dalla ricerca. L'app lo segnala come «da verificare»; se non lo trova, usa l'inserimento manuale.
  L'elenco atenei è solo per l'autocompletamento: puoi scrivere qualunque ateneo.
- **Ricerca online**: la qualità dipende da ciò che il web offre sul tuo corso; dispense del tuo docente battono qualsiasi ricerca.
- **Privacy**: i dati restano nel browser (IndexedDB). Il testo dei materiali viene inviato al server locale e da lì all'API di
  Anthropic solo quando generi un modulo, cerchi online o fai correggere una risposta.
- **Modalità base** (senza chiave API): argomenti e flashcard ricavati euristicamente dalle definizioni nei tuoi appunti testuali; niente quiz, PDF, né ricerca.
- Un solo utente per browser, nessun account né sincronizzazione (usa «Dati → Esporta backup»).

## Configurazione

| Variabile | Default | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Senza chiave l'app funziona in modalità base. |
| `STUDIFY_MODEL` | `claude-opus-5-5` | Puoi usare un modello più economico (es. `claude-sonnet-5-5`). |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Con host non-loopback le protezioni same-origin sono disattivate: non esporre il server senza autenticazione, spendi i tuoi crediti API. |
| `STUDIFY_MOCK` | – | `1` = AI simulata (anche `npm run demo`). |

La generazione di un modulo usa un'unica richiesta (con ragionamento adattivo e output strutturato) e può costare qualche
dollaro per materiali molto lunghi: parti da pochi appunti per farti un'idea.

## Struttura

```
server/           index.js (HTTP, job asincroni, sicurezza) · ai.js (Anthropic SDK) · schema.js (zod)
shared/           prompts.js, normalize.js: usati sia dal server sia dalla pagina Claude (nessuna dipendenza)
artifact/         versione pagina Claude: generate.js (sample), backend.js (db), api.js, entry.js, template, fake-claude (prove)
scripts/          build-artifact.mjs (esbuild)
public/js/        logica pura (testata): dates, methods, srs, planner, progress, local-builder, tabular (CSV/xlsx), importers, timetable
                  stato/UI: store (IndexedDB), domain, api, ui, views/*
public/demo/      modulo demo (Microeconomia)
test/             node --test: logica pura + client AI con SDK simulato
```

## Idee per dopo

Import da Notion/Drive, OCR di foto degli appunti, calendario con più esami in competizione per il tempo,
calibrazione della fiducia (quanto sei sicuro prima di vedere la risposta), versione sincronizzata multi-dispositivo.
