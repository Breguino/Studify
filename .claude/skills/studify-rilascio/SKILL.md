---
name: studify-rilascio
description: Chiude e pubblica una modifica a Studify (questo repository) nel modo concordato con il proprietario. Prova le versioni toccate (server, pagina Claude, sito web, demo guidata), aggiorna README e CLAUDE.md, fa commit e push sul branch di lavoro, apre la PR e fa il merge solo quando GitHub è verde, ripubblica la pagina Claude o la demo, poi riferisce in italiano con i limiti delle prove. Usala ogni volta che finisci una modifica a Studify e ogni volta che l'utente dice cose come «apri la pr», «fai il merge», «mettila online», «ripubblica», «pubblica la pagina Claude», «salva», «committa», anche se non nomina la skill, e anche a metà di un lavoro più grande quando arriva il momento di consegnare.
---

# Rilascio di una modifica a Studify

Studify ha **tre versioni costruite dallo stesso codice** (`public/js/`), più una demo a parte. Quando una modifica va
online in modo sbagliato, l'errore non si vede subito: compare in una versione che nessuno ha aperto. Questa skill esiste
per rendere ogni consegna uguale alla precedente: stesse prove, stessi passi, stesso resoconto onesto.

Il proprietario scrive in italiano e vuole essere contraddetto quando sbaglia (vedi le sue preferenze): il resoconto finale
dice che cosa **non** è stato provato, non solo che cosa è andato bene.

## 1. Che cosa ha toccato la modifica

Guarda `git diff --stat origin/main` e decidi le prove da qui, non a memoria:

| File toccati | Versioni da provare | Da ripubblicare |
|---|---|---|
| `public/js/`, `public/styles.css`, `shared/` | tutte e tre: server, pagina Claude, web | pagina Claude |
| `artifact/` | pagina Claude | pagina Claude |
| `web/`, `api/`, `vercel.json`, `supabase/` | web | niente (Vercel pubblica da `main`) |
| `demo/` | solo la demo (`pnpm check`, `pnpm build`) | la demo guidata |
| solo documenti | nessuna build | niente |

`web/landing.html` e `web/landing-plan.js` usano anche codice di `public/js/` (per esempio `planner.js`): se cambi
`public/js/planner.js` o `dates.js`, prova anche la landing.

## 2. Prove

Esegui lo script della skill, che fa le prove automatiche e le build nell'ordine giusto e si ferma al primo errore:

```bash
bash .claude/skills/studify-rilascio/scripts/verifica.sh        # tutto
bash .claude/skills/studify-rilascio/scripts/verifica.sh demo   # anche la demo guidata
```

Lo script **non sostituisce** la prova nel browser. Per ogni schermata toccata aprila davvero, sul computer e a 390px,
anche in tema scuro, perché i difetti tipici di questo progetto (scorrimento orizzontale, testo sotto i 12px,
bersagli piccoli, campi che fanno zoomare Safari) non li vede nessun test unitario. Come avviare le versioni:

- server: `STUDIFY_MOCK=1 PORT=3129 node server/index.js` (AI simulata, pulsante «Prova con l'esame demo»);
- pagina Claude: `npm run build:harness`, poi apri `dist/harness.html`;
- web: `STUDIFY_SUPABASE_URL=… STUDIFY_SUPABASE_KEY=… node scripts/build-artifact.mjs --web` e servi `dist-web/`
  (per l'accesso serve un Supabase finto o vero: dillo all'utente se non hai potuto provarlo).

Chromium è installato (`/opt/pw-browsers`, Playwright già configurato): usalo con script nella scratchpad. Le prove nel
browser **non sono nel repository**: se ne scrivi, restano nella scratchpad e si perdono. Non promettere all'utente
che «ci sono le prove e2e» se non le hai eseguite in questa sessione.

Errori ricorrenti nelle prove, che sembrano bug dell'app e non lo sono: vedi `references/lezioni.md`. Leggilo
quando una prova nel browser fallisce in modo strano, **prima** di cambiare il codice.

Una prova che fallisce una volta e passa alla seconda non è «a posto»: riferiscilo come instabile e di' la causa probabile.

## 3. Documentazione

- `README.md`: comportamento visibile all'utente (cosa fa una schermata, un comando nuovo).
- `CLAUDE.md`: regole per chi scrive codice (classi nuove, helper nuovi in `ui.js`, eccezioni alle regole di stile).
- Aggiornali nello **stesso** commit della modifica, non in un commit successivo «docs».

## 4. Commit e push

- Branch: quello indicato dalla sessione. Se la PR precedente su quel branch è già stata unita, riparti da `main`:
  `git fetch origin main && git checkout -B <branch> origin/main` (mai impilare commit su storia già unita).
- Messaggio in italiano: titolo che dice che cosa cambia per chi usa Studify, poi un elenco breve.
  Chiudi con le righe di attribuzione indicate dal sistema per quella sessione. Mai il nome o l'identificativo del modello.
- `git push -u origin <branch>`. Se fallisce per la rete, riprova fino a 4 volte (2, 4, 8, 16 secondi).
- Mai `--force`, mai riscrivere la storia di `main`, mai `pkill` (ferma i processi con il loro PID).

## 5. PR e merge (solo se l'utente lo chiede)

Non aprire PR di tua iniziativa. Quando l'utente dice «apri la pr» o «sì» alla tua proposta:

1. Crea la PR con gli strumenti GitHub disponibili (non c'è `gh`). Corpo in italiano con due sezioni:
   **Cosa cambia** (per chi usa l'app) e **Prove** (che cosa hai provato e che cosa no), più le righe finali indicate dal sistema.
2. Iscriviti agli eventi della PR e fermati: GitHub ti sveglia quando il controllo `test` finisce. Non aspettare con `sleep`.
3. Al risveglio leggi i check run e lo stato della PR. Fai il merge solo se `test` è `success` e lo stato è `clean`.
   Passa `expectedHeadSha` con lo SHA **completo** di 40 caratteri (`git rev-parse HEAD`): quello abbreviato viene rifiutato.
4. Metodo `merge` (non squash: è il metodo usato finora in questo repository). Poi annulla l'iscrizione agli eventi.
5. Se `test` è rosso: trova la causa, correggi, rifai le prove del punto 2 e fai push. Non rilanciare il controllo
   sperando che passi, non disattivare prove.

I commenti di `vercel[bot]` sono solo l'anteprima: nessuna azione.

## 6. Pubblicazione

- **Pagina Claude** (quando cambia l'app o `artifact/`): `npm run build:artifact`, poi ripubblica `dist/studify.html`
  sull'indirizzo esistente `https://claude.ai/artifact/UPyh1kg5Mxc7EjR84cgHsS` (mai creare un artifact nuovo).
  Ricostruisci **dal codice del commit**, non da una build vecchia.
- **Demo guidata** (quando cambia `demo/`): `cd demo && pnpm check && pnpm build`, poi ripubblica
  `demo/dist/studify-demo.html` su `https://claude.ai/artifact/ChyMzzuaDYV1EdMDUKi42m`. Per provarla in locale
  avvolgila in `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" …></head><body>…</body></html>`,
  perché il file pubblicato non ha doctype né `<head>`.
- **Sito web**: lo pubblica Vercel da `main` (https://studify-beta-dun.vercel.app). Dopo il merge non dire «è online»
  se non l'hai verificato: di' che dovrebbe esserlo tra qualche minuto.

## 7. Resoconto all'utente

In italiano, breve, senza gergo inutile. Sempre in quest'ordine:

1. che cosa cambia per chi usa Studify (non l'elenco dei file);
2. le prove fatte, con i numeri (es. «231 su 231»);
3. **che cosa non è stato provato** e perché (Safari su iPhone, Supabase vero, generazione con Claude vera…);
4. dove l'hai contraddetto o dove una sua richiesta non conveniva, con la ragione;
5. la domanda per il passo successivo («Apro la PR e faccio il merge?»), solo se serve una sua decisione.

Se un tuo errore è emerso durante il lavoro (una prova scritta male, una correzione che ha rotto altro), dillo: l'utente
preferisce saperlo.
