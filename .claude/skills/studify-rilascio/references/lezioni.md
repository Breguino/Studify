# Lezioni dalle consegne precedenti

Problemi che sono già capitati nelle prove di Studify e che **sembrano** difetti dell'app ma non lo sono, più qualche
difetto vero che le prove hanno trovato. Leggilo quando una prova nel browser fallisce in modo strano.

## Falsi allarmi delle prove nel browser

- **Scorrimento della landing.** `html { scroll-behavior: smooth }`: `scrollTo(0, y)` parte un'animazione e la posizione
  letta subito dopo è a metà strada. Usa `scrollTo({ top: y, behavior: "instant" })`.
- **Testo in maiuscolo.** Etichette come `.cd-label` hanno `text-transform: uppercase`: `innerText` restituisce
  «OGGI · 50 MINUTI». Per confrontare il testo usa `textContent`.
- **`pointer: coarse` nella simulazione.** In Playwright con `isMobile` e `hasTouch`, `matchMedia("(pointer: coarse)")`
  a volte è falso. Per questo la regola dei campi a 16px vale anche per larghezza (`max-width: 820px`), non solo per tocco.
- **Elementi fuori schermo.** `mouse.click(x, y)` su coordinate fuori dalla finestra non fa nulla: prima
  `scrollIntoViewIfNeeded()`.
- **Stesso hash.** Impostare `location.hash` al valore che ha già non fa scattare `hashchange`: passa da un'altra pagina.
- **Prima prova del giro.** La prima prova dopo l'avvio a freddo del server può superare i tempi (lettura di un PDF
  con pdf.js). Se passa al secondo tentativo, riferiscilo come instabile, non come risolto.
- **Argomenti degli script.** Alcuni script di prova usano il primo argomento come filtro: passare un argomento a caso
  li fa terminare con zero controlli e codice 0. Un risultato «0 controlli» non è un successo.

## Difetti veri trovati dalle prove (da non ripetere)

- Una vista che salva i dati **mentre si disegna** (es. chiudere l'onboarding nel render di «Oggi») fa saltare passi:
  lo stato cambia prima che l'utente veda la schermata. Cambia i dati solo su un'azione, o quando mostrare la schermata
  è l'evento stesso (la schermata «pronto» si vede una volta).
- Una correzione può creare una trappola: rimandare sempre «Oggi» a «pronto» finché non si preme un pulsante bloccava
  chi andava a vedere il modulo. Dopo ogni correzione di navigazione, prova anche il percorso «torno indietro e riprovo».
- Ascoltatori di tastiera su `window` (quiz, flashcard) vanno tolti al cambio pagina (`releaseOnLeave` in `ui.js`).
- La landing mostra il piano con `buildPlan`, non con `splitPhases`: i giorni di comprensione non superano gli argomenti.
  Quando mostri numeri «come nell'app», ricavali dalla stessa funzione dell'app e provalo con un test che le confronta.

## Pubblicazione

- `expectedHeadSha` del merge vuole lo SHA completo (40 caratteri).
- La pagina Claude si ripubblica sullo **stesso** indirizzo; un percorso di file diverso crea un artifact nuovo.
- La demo e la pagina Claude sono private finché l'utente non le condivide: se l'utente vuole mandarle ad altri, diglielo.
