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
npm run build:artifact     # crea dist/studify.html (un solo file, ~2,7 MB: include pdf.js e KaTeX)
```

Si pubblica con le capacità `sample` (Claude), `db` + `user` (archivio privato per utente) e `downloads` (backup).
Differenze rispetto alla versione con server:

| | Server (`npm start`) | Pagina Claude |
|---|---|---|
| Generazione modulo | una richiesta, PDF compresi (anche scansioni) | a passi (schema → carte e domande per argomento); max ~200k caratteri; di un PDF si usa il testo (le scansioni no) |
| Ricerca web: corsi dell'ateneo, piano di studi, materiali | sì | **no** (Claude non può navigare): il piano si **incolla** (letto da Claude) o si scrive; al posto dei materiali web una «traccia dal programma» marcata *non verificata* |
| Esami passati | analisi e correzione anche con le prove in PDF (le pagine della prova vanno a Claude); i PDF con più prove si dividono dal testo | prove come testo (anche da PDF); stessa analisi, simulazione e correzione |
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
   - **Modalità d'esame dalla scheda dell'insegnamento** (versione con server e chiave API): se la modalità di un insegnamento del
     piano non è nota, scegliendolo parte da sola una ricerca web sulla scheda/syllabus dell'ateneo. Vale solo con una frase copiata
     dalla pagina e un URL effettivamente visto nella ricerca; il risultato (anche «non trovata») resta nel piano, così non si ripete.
     Per insegnamenti fuori dal piano c'è un bottone; un tipo scelto a mano non viene sovrascritto. Serve l'ateneo nel profilo.
   - **Scheda incollata** (ovunque, anche nella pagina Claude che non naviga): incolli la sezione «Modalità di verifica
     dell'apprendimento» e Claude ne ricava il tipo di prova. La citazione deve comparire davvero nel testo incollato, altrimenti il
     risultato è scartato; un orale facoltativo non rende l'esame «scritto + orale». Senza AI la lettura è a regole (dichiarata come
     tale). Il risultato resta nel piano di studi.
   I dati trovati sul web sono sempre segnalati «da verificare» (a.a., fonti): la prova d'esame resta «Non indicato» se la scheda non la dichiara.
0b. **Importa da CSV o Excel** (pulsante «Importa CSV / Excel»): tre tipi di file, riconosciuti dalle intestazioni (colonne correggibili a mano):
   - **appelli d'esame**: insegnamento, data, ora, aula, tipo di prova, CFU, anno. Più date per lo stesso insegnamento = più appelli (si sceglie
     da «Modifica»); le date già passate vengono ignorate; l'esame esistente con lo stesso nome viene aggiornato, non duplicato;
   - **piano di studi**: insegnamento, anno, CFU, tipo (obbligatorio / a scelta), prova;
   - **orari delle lezioni**: insegnamento, giorno (lunedì… o una data), inizio e fine (o «09:00-11:00»), aula. Le lezioni riducono il tempo di studio
     dei giorni in cui cadono (mai sotto 30') e nei giorni quasi pieni non si introducono argomenti nuovi. Le lezioni settimanali valgono fino
     alla data indicata. Se nel profilo indichi l'**anno che frequenti** e hai il piano di studi, vengono spuntati in automatico solo gli
     insegnamenti di quell'anno; quelli che il piano mette in altri anni restano da spuntare a mano, quelli che non trova nel piano restano
     spuntati e segnalati («non nel piano»). Un nuovo orario sostituisce il precedente, previa conferma.
     **Appelli non ancora usciti:** creando un esame la cui materia è nell'orario, la data proposta è *provvisoria*, una settimana dopo
     l'ultima lezione (non fra 30 giorni, che cadrebbe in pieno semestre). Home e pagina dell'esame la indicano come tale; quando importi gli
     appelli la data provvisoria viene sostituita dal primo appello e il piano si ricalcola.
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
1. **Descrivi l'esame**: data, tipo di prova (scritto, test, esercizi, orale, misto), livello di partenza (1-5), ore al giorno e
   **quanto tempo ti dai** (es. una settimana prima dell'esame: prima di allora il piano non propone attività per quell'esame).
   Il form confronta le ore disponibili nella finestra (tolte le lezioni) con l'ordine di grandezza dato dai CFU: per legge
   1 CFU = 25 ore di lavoro complessivo, lezioni comprese, quindi circa 15-18 ore di studio individuale per CFU partendo da zero.
   È una stima, non una regola (chi ha studiato durante il semestre ne usa meno), ma rende visibile quando una settimana per un
   esame da 9 CFU copre una piccola parte del lavoro. Segnala anche le finestre che si sovrappongono con altri esami.
2. **Porta i materiali**: carica o incolla **libro, slide, dispense, esercizi e appunti** (`.pdf`, `.docx`, `.pptx`, `.txt`, `.md`),
   oppure «Cerca online con l'AI» (ricerca web con fonti e link, che puoi leggere ed eliminare prima di usarla).
   - Ogni materiale ha un **tipo** (indovinato dal nome del file, modificabile) che cambia come l'AI lo usa: gli **appunti** dicono
     cosa ha sottolineato il docente (importanza), **dispense del docente e libro** sono la fonte per definizioni e approfondimenti, gli
     **esercizi** (eserciziari, temi d'esame) non diventano flashcard ma il modello delle domande-esercizio, con svolgimento
     (se la soluzione non è nei materiali, l'AI lo risolve e lo segnala come da verificare).
   - Di un **libro** (o di un PDF/una presentazione lunghi) si scelgono le **pagine**: un libro intero non sta in una richiesta
     (limiti dell'API: 600 pagine e 32 MB; ogni pagina costa ~1.500-3.000 token) e il programma di solito ne copre una parte.
     Con il server le pagine scelte vengono estratte nel browser (pdf-lib) e all'AI arriva solo quel PDF, figure e formule
     comprese; nella pagina Claude si usa il testo di quelle pagine (circa 60-80 pagine per volta; le formule possono uscire male).
     Allargando l'intervallo dopo (es. da 1-40 a 1-80) «Aggiungi al modulo» manda solo le pagine nuove.
   - **Formule.** Nel modulo (argomenti, flashcard, quiz, svolgimenti, correzioni) le formule sono LaTeX disegnato con **KaTeX**
     (`$…$` nel testo, `$$…$$` a sé); i prompt lo chiedono esplicitamente, con i comandi supportati. Un «\frac» scritto con un solo
     backslash in una stringa JSON diventa un carattere di controllo (form feed) senza dare errore, come \beta, \theta, \nabla, \rho:
     `repairLatex` lo ripara in tutto il testo generato. In ingresso: i **PDF** con il server arrivano a Claude come PDF (formule
     comprese); nella **pagina Claude** il testo estratto le spezza su più righe, quindi «Leggi formule e figure con Claude» manda
     le pagine scelte come immagini e Claude le trascrive in LaTeX (3 pagine per richiesta, al massimo 30 per volta; l'app segnala le
     pagine che sembrano avere formule rovinate). Le **equazioni di Word e PowerPoint** (OMML) sono convertite in LaTeX: frazioni,
     apici/pedici, radici, sommatorie e integrali, parentesi, funzioni e limiti, accenti, matrici, sistemi. L'«Anteprima del testo»
     di ogni materiale mostra le formule disegnate, per controllarle prima di generare il modulo.
   - **Sbobine** (trascrizioni delle lezioni fatte da studenti): tipo riconosciuto dal nome del file («sbobin…», «trascrizione…»).
     Un documento senza pagine (Word, testo, testo incollato) con almeno due intestazioni di lezione («Lezione 5», «LEZ. 3»,
     «Lezione del 12/10», una data su una riga a sé) viene **diviso per lezioni**, che si scelgono come le pagine di un libro;
     allargando l'intervallo si mandano solo le lezioni nuove. Si può indicare l'anno accademico della sbobina. Nel prompt le sbobine
     servono per importanza e mustKnow, con l'avvertenza che possono contenere errori di trascrizione (vale il libro) e venire da
     un anno precedente.
   - **Indicazioni del docente sull'esame** (`examHints`): le frasi come «questo all'esame lo chiedo sempre», «il boxplot non lo
     chiedo», con fonte e argomento, nel riquadro «Cosa ha detto il docente sull'esame» del modulo e nella pagina dell'argomento.
     Devono essere **copiate** dai materiali: l'app controlla che compaiano nel testo mandato all'AI e scarta quelle inventate o
     parafrasate (da un PDF non si può verificare: restano, segnate come non verificate). In modalità base si trovano con le regole.
   - **Registrazioni audio**: Claude non legge l'audio. L'app lo dice e suggerisce di trascriverle con un servizio apposito e
     caricare il testo come sbobina.
   - **Appunti scritti a mano.** «Fotografa gli appunti» (fotocamera del telefono) o «Carica foto o scansioni»: una foto per
     pagina, in ordine di nome. Le foto vengono raddrizzate, ridotte a 2576 px sul lato lungo (il massimo che i modelli usano) e
     convertite in JPEG nel browser; Claude le trascrive (3 per richiesta) con le formule in LaTeX, segnando «[?]» le parole lette
     con incertezza e «[illeggibile]» le parti non lette, senza riscrivere in bella. L'anteprima mette ogni foto accanto alla
     sua trascrizione, con le parti incerte in giallo e «Correggi» pagina per pagina; nel prompt del modulo gli appunti sono
     segnati come scritti a mano e le letture incerte non devono diventare carte. Le foto HEIC dell'iPhone non si aprono in Chrome:
     l'app spiega come averle in JPEG. Con il server le foto restano nel browser e si possono rileggere; nella pagina Claude solo
     per la sessione. Per le tavolette (GoodNotes, Notability) si esporta in PDF.
3. **Genera il modulo**: l'AI produce argomenti (con importanza/difficoltà), flashcard atomiche, domande
   (scelta multipla, aperte, esercizi con rubrica) e un elenco di **lacune** nei materiali.
   **Durante il semestre non serve aspettare di avere tutto:** dopo ogni lezione aggiungi gli appunti e premi «Aggiungi al
   modulo». L'AI vede il modulo esistente (argomenti, riassunti, carte e domande già presenti) e restituisce solo le novità:
   argomenti nuovi, argomenti esistenti approfonditi (riassunto aggiornato, concetti in più) e carte/domande sui contenuti nuovi,
   senza doppioni. Gli id esistenti non cambiano, quindi ripasso dilazionato, statistiche dei quiz e argomenti studiati restano;
   le lacune vengono aggiornate. «Rigenera tutto» resta disponibile ma azzera i progressi (e lo dice prima).
4. **Dispensa (facoltativa)**: dalla scheda «Dispensa» l'AI scrive un documento unico da studiare, un capitolo per argomento del
   modulo, che integra appunti, sbobine, slide, libro ed esercizi senza ripetizioni: spiegazione con le fonti tra parentesi
   ([Libro p. 45], [Sbobine, lez. 3]), formule e definizioni, esempio svolto, frasi del docente, errori da evitare e «Mettiti alla
   prova», con le soluzioni in appendice. Le parti che non vengono dai materiali sono marcate «Integrazione»; senza materiali la
   dispensa non si scrive. Lunghezza sintetica o completa (proporzionale all'importanza). Con il server i materiali partono una
   volta sola e restano in cache tra un capitolo e l'altro (prompt caching); i capitoli si salvano man mano e quelli il cui
   argomento è cambiato con materiali nuovi risultano «da aggiornare». «Stampa o salva in PDF» (un capitolo per pagina, formule
   intere) oppure «Scarica il file»: un HTML autonomo con formule e font incorporati, da aprire e stampare in PDF.
   Rileggere da solo dà l'illusione di sapere: la dispensa serve a capire la prima volta e a consultare, flashcard e quiz a ricordare.
5. **Esami degli anni passati** (scheda «Esami passati»): carichi i temi d'esame (PDF, Word, testo o foto) con il tipo «Esami passati»
   (riconosciuto dal nome: «Temi d'esame», «Appello…», «Compito A», «Prove scritte»). Un file con più appelli viene diviso in prove
   dai titoli («Appello del 12/01/2024», «Esame del 14 giugno 2023», «Compito B», «2° appello»); per un PDF (versione con server) gli
   inizi si trovano nel testo delle pagine, e si correggono a mano («dove inizia ogni prova: 1, 4, 7»). Le prove vere:
   - **non diventano flashcard né domande del quiz**: il modulo ne imita lo stile con esercizi nuovi (dati diversi), così restano
     intatte per le simulazioni; la dispensa non le risolve;
   - **analisi con Claude**: ogni esercizio di ogni prova è collegato agli argomenti del modulo (id controllati), con durata, punti e
     tipo (calcolo, teoria, test). Si vedono gli argomenti più chiesti («Elasticità 3/4»), gli esercizi che si ripetono (solo se
     compaiono davvero in almeno 2 prove), gli argomenti chiesti ma assenti dal modulo. Con almeno 3 prove, un argomento che esce in
     metà delle prove diventa «centrale» nel piano (e torna come prima se un'analisi successiva non lo conferma). Con meno di 3 prove
     l'app dice che la frequenza conta poco; gli argomenti mai usciti non vengono abbassati («non è uscito» non vuol dire «non uscirà»).
     Rigenerando il modulo l'analisi va rifatta (gli argomenti cambiano);
   - **simulazione a tempo**: scegli la prova (consigliata: la più vecchia non ancora fatta, le più recenti si tengono per gli ultimi
     giorni), la durata (letta nella prova) e se rispondere su carta o a schermo. Il testo compare solo all'inizio; il timer continua
     anche uscendo dalla pagina (la prova resta in corso e si riprende). Alla consegna: foto dei fogli trascritte da Claude (parole
     incerte segnate, da correggere prima), poi **correzione di Claude** (punti per esercizio, giudizio, cosa sbagli e come si fa,
     voto stimato in trentesimi) oppure **autocorrezione** con i punti dell'analisi. I punti si possono cambiare; il risultato va nei
     progressi degli argomenti, e nel piano le simulazioni finali usano le prove vere finché ce ne sono di mai fatte.
   - **elenchi di domande d'esame** (tipo «Domande d'esame», riconosciuto da «Domande d'esame», «Domande dell'orale», «Domande
     uscite»…): le domande raccolte dagli studenti, tipiche dell'orale. A differenza dei temi scritti **vanno nel quiz**, perché
     all'orale si ripetono. L'elenco viene letto una voce per riga («-», «1.», «a)» o una riga che finisce con «?»), con le ripetizioni
     («(x3)», «(3 volte)», «[2]», «(chiesta spesso)», la stessa domanda in più appelli) e l'appello come contesto. All'AI arriva come
     voci numerate «D12»: per ogni domanda distinta crea una domanda del quiz con risposta modello dai tuoi materiali, rubrica e la
     domanda con cui il docente potrebbe incalzare; ogni domanda del quiz dice quali voci riproduce (id controllati: quelle inventate
     si scartano, quelle mancanti sono elencate come «non ancora nel quiz»). Nel quiz hanno il badge «domanda d'esame vera · chiesta
     3 volte» e, a parità di stato, escono prima le più chieste. Un argomento chiesto almeno una volta e mezza più della media (con
     almeno 10 domande) diventa «centrale»; nel piano c'è un giro sulle domande d'esame nei giorni di consolidamento e la
     simulazione orale usa quelle vere. Nella dispensa ogni capitolo ha le sue «Domande uscite all'esame», con le risposte in appendice.
     Un PDF con l'elenco (versione con server) viene letto come testo; una foto si trascrive come gli appunti a mano.
6. **Esercizi svolti dal docente** (tipo «Esercizi svolti dal docente», riconosciuto da «svolti», «risolti», «svolgimenti»): non
   sono esercizi da fare ma il **metodo** che il docente si aspetta all'esame. L'AI ne ricava, per ogni tipo di esercizio, il
   procedimento in passi generici e copia un suo esercizio svolto (testo e svolgimento); un esercizio «copiato» le cui parole e i cui
   numeri non sono nei materiali viene scartato e segnalato tra le lacune (un esempio inventato ha dati diversi). Gli esercizi del
   quiz dello stesso tipo hanno dati diversi, lo stesso procedimento e la stessa notazione. Nell'argomento c'è «Come lo risolve il
   docente» e gli **esercizi guidati**, secondo gli studi sugli esempi svolti:
   - **esempio del docente**, un passaggio alla volta, chiedendosi il perché di ognuno (autospiegazione); poi il metodo in generale;
   - **svolgimento da completare**: un esercizio simile con i primi passaggi, gli altri li scrivi tu;
   - **da solo**, con il metodo come aiuto se ti blocchi (un esercizio riuscito con l'aiuto conta al massimo 70%).
   Chi è già bravo (livello 4-5, o esercizi dell'argomento già riusciti) parte direttamente dall'esercizio da solo: a chi sa impostare
   gli esercizi gli esempi svolti servono poco (effetto di inversione dell'esperienza). Nel piano gli esercizi guidati seguono lo
   studio dell'argomento; la dispensa usa gli esercizi del docente come esempi svolti.
7. **Slide del docente** (tipo «Slide del docente», riconosciuto da «slide», «lucidi», «presentazione» e dai file .pptx): sono la traccia
   del corso, cioè quali argomenti fa il docente e in che ordine, e ciò su cui insiste, ma sono schematiche. L'AI segue il loro ordine
   per gli argomenti, prende le spiegazioni da libro, dispense, sbobine e appunti e segnala tra le lacune gli argomenti che sono **solo
   sulle slide**; nella dispensa le spiega per esteso citando [Slide n]. Da un PowerPoint l'app legge:
   - le slide **nell'ordine della presentazione** (non dei file: una slide spostata ha un nome «fuori posto»), con il loro titolo, che
     compare quando scegli quali slide usare («Slide 2–3: Elasticità → Monopolio»); le slide nascoste sono incluse e segnalate;
   - le **note del relatore**, spesso la spiegazione del docente («Note del docente: …»);
   - i **grafici con i dati**, come tabelle («[Grafico a barre: …]»), e il testo alternativo delle immagini.
   I grafici disegnati con linee e frecce e le immagini senza descrizione da un PowerPoint non si leggono: l'app indica in quali slide
   sono e consiglia di caricare la presentazione in PDF, che Claude legge con le figure.
8. **Libri consigliati** (riquadro nei Materiali): i testi di riferimento della scheda dell'insegnamento, aggiunti a mano o ricavati da
   Claude dalla scheda incollata (un titolo che nel testo non c'è viene scartato), con i capitoli del programma («capp. 1-6») e se li
   hai in PDF, cartacei o no. Anche se il libro è cartaceo basta l'**indice** (incollato, o fotografato e trascritto da Claude): l'app ne
   legge capitoli, pagine e paragrafi, e Claude collega i capitoli agli argomenti del modulo (id controllati). Così:
   - nell'argomento: **che cosa leggere**, con le pagine e il tempo (circa 4 minuti a pagina partendo da zero, 3 con basi solide);
   - nel modulo: i **capitoli del programma che i tuoi materiali non coprono**;
   - nel piano: «Studia: Elasticità (leggi Mankiw cap. 5, pp. 89–112)», con il tempo di lettura (un capitolo che serve a più argomenti
     divide le sue pagine tra loro; un libro che non hai non entra nel piano);
   - con il PDF: l'app trova di quante pagine i capitoli sono spostati rispetto ai numeri stampati (copertina, indice) e usa nel modulo
     solo le pagine dei capitoli del programma.
9. **Esercitazioni con le soluzioni** (tipo «Esercizi»): l'app divide il testo in esercizi («Esercizio 3», o «1.», «2.» consecutivi)
   e trova la soluzione di ciascuno: sotto l'esercizio («Soluzione»), in una sezione «Soluzioni» in fondo, o in un file a parte con lo
   stesso nome («Esercitazione 3» ↔ «Esercitazione 3 - soluzioni»; «Esercitazione 4 con soluzioni» è un file unico). Gli esercizi con
   soluzione entrano nel quiz **così come sono**, testo e soluzione ufficiali: a Claude si chiede solo l'argomento e una rubrica, e se
   una soluzione ufficiale gli sembra sbagliata lo segnala tra le lacune invece di correggerla. Un esercizio che l'AI aveva già copiato
   nel quiz viene riconosciuto (stessi numeri e parole) e prende testo e soluzione ufficiali, senza doppioni e senza perdere i progressi.
   «Fai l'esercitazione» propone gli esercizi nell'ordine; la soluzione ufficiale compare dopo il tuo tentativo. Nel piano l'esercitazione
   sull'argomento segue lo studio. Versione con server: un PDF di esercitazione lo legge Claude (formule comprese) e diventa testo.
10. **Dispense del docente** (tipo «Dispense del docente»): il corso scritto per esteso da chi fa l'esame, quindi la fonte principale.
   L'AI usa le sue definizioni, i suoi simboli e la sua impostazione in carte, risposte e dispensa, ne copre tutti i capitoli e, se su
   una definizione o una formula non concordano con il libro, usa le dispense e **segnala la differenza** tra le lacune (può essere una
   scelta del docente o un refuso: va chiesto). Da un PDF di dispense l'app ricava l'**indice**, dalla pagina «Indice» o dai titoli
   «Capitolo 3 …» nelle pagine, e lo usa come quello di un libro (le dispense compaiono tra i libri, prima di loro):
   - nell'argomento e nel piano: **quali pagine delle dispense leggere** («Studia: Elasticità (leggi Dispense Microeconomia cap. 2,
     pp. 5–6)»); nel piano si legge una fonte sola, le dispense dove ci sono e il libro dove non arrivano;
   - nel modulo: i **capitoli delle dispense di cui l'AI non ha fatto un argomento**, pur avendo ricevuto quelle pagine (accorpati a un
     altro, o saltati): un controllo che il modulo copra davvero il testo del docente;
   - un PDF chiamato «Lezione 4» con poche parole per pagina (almeno 8 pagine) è un pacco di **slide**: l'app lo segna come tale e lo
     dice; «riassunti» e «schemi» sono appunti di studenti, non del docente.
   Nella scheda «Dispensa» l'app ricorda che, se ci sono le dispense del docente, il testo di riferimento restano quelle.
11. **Studia con il piano**: ogni giorno hai una lista di attività; si ricalcola da solo se salti giorni o finisci prima.

| Sessione | Cosa fa |
|---|---|
| Flashcard | Richiamo attivo con ripasso dilazionato (SM-2 semplificato) che **non programma nulla oltre il giorno prima dell'esame**. Le carte nuove sono introdotte solo per argomenti già studiati. |
| Quiz | Errori recenti per primi, argomenti alternati (interleaving). Risposte aperte: spunti i punti della rubrica o chiedi la correzione all'AI. |
| Simulazione | Con le prove degli anni passati: una prova vera a tempo, senza appunti, corretta da Claude o da te. Senza: quiz a tempo con correzione **differita**. |
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
- **Esami passati**: la correzione di Claude è una stima, non il voto del tuo docente (che può pesare diversamente procedimento e
  risultato); con le foto, una cattiva lettura della calligrafia pesa sulla correzione, per questo la trascrizione si controlla prima.
  La frequenza degli argomenti su poche prove è rumorosa, e prove di un altro docente o di un programma vecchio possono ingannare.
  Gli elenchi di domande raccolti dagli studenti riflettono ciò che chi li ha scritti ricorda: i conteggi sono indicativi. E sapere
  a memoria le risposte dell'elenco non basta all'orale, dove il docente incalza.
- **Libri consigliati**: i capitoli «non coperti» sono quelli che nessun argomento del modulo tratta, non la prova che non li sai; e un
  argomento collegato a un capitolo non vuol dire che i tuoi materiali lo trattino come il libro. Il tempo di lettura è una stima.
- **Dispense del docente**: l'indice si ricava da una pagina «Indice» o da titoli come «Capitolo 3»; dispense senza né l'una né gli altri
  (o una scansione) non danno le pagine da leggere, e un indice ricavato dai titoli va controllato. Il riconoscimento delle slide
  guarda solo quante parole ci sono per pagina: slide molto fitte restano «dispense» (cambia il tipo a mano). Che le dispense
  prevalgano sul libro vale per definizioni e notazione; su un fatto o un calcolo un refuso del docente resta un refuso, per questo
  le differenze vengono segnalate e non risolte in silenzio.
- **Esercitazioni**: rifare più volte gli stessi esercizi fa ricordare i numeri, non il metodo: dopo i primi giri passa agli esercizi
  nuovi dello stesso tipo (quelli creati dall'AI) e agli esercizi misti. Le soluzioni ufficiali possono essere sintetiche («Q = 20»):
  in quel caso la correzione di Claude confronta anche il procedimento.
- **Esercizi svolti**: leggere uno svolgimento dà l'impressione di saperlo rifare. Per questo gli esercizi guidati finiscono sempre
  con un esercizio da solo. Da scansioni o appunti a mano le formule possono essere trascritte male: controllale.
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
public/js/        logica pura (testata): dates, methods, srs, planner, progress, local-builder, tabular (CSV/xlsx), importers, timetable,
                  lessons (lezioni e prove), past-exams (prove, frequenze, voto), exam-questions (elenchi di domande d'esame),
                  worked (metodi del docente ed esercizi guidati), exercises (esercitazioni con le soluzioni), books (libri consigliati),
                  dispense (indice delle dispense del docente, slide o dispense)
                  stato/UI: store (IndexedDB), domain, api, ui, views/*
public/demo/      modulo demo (Microeconomia)
test/             node --test: logica pura + client AI con SDK simulato
```

## Idee per dopo

Import da Notion/Drive, OCR di foto degli appunti, calendario con più esami in competizione per il tempo,
calibrazione della fiducia (quanto sei sicuro prima di vedere la risposta), versione sincronizzata multi-dispositivo.
