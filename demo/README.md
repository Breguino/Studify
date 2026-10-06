# Demo guidata di Studify

Una pagina a parte che fa provare il percorso di Studify con dati d'esempio, senza account e senza AI:
descrivi l'esame → porta i materiali → controlla il modulo → piano di oggi → quiz → flashcard.
È pubblicata come Artifact su claude.ai: <https://claude.ai/artifact/ChyMzzuaDYV1EdMDUKi42m> (privata finché non la condividi).

**Non fa parte dell'app.** L'app è JavaScript puro senza framework (vedi `CLAUDE.md`); questa cartella è l'unica eccezione:
React + TypeScript + Tailwind + un componente di shadcn/ui (`checkbox`), impacchettati da Parcel in un solo file HTML.
Build, prove e deploy di Studify non la toccano (`npm test` legge solo `test/`, Vercel pubblica `dist-web/`).

## Comandi

Con [pnpm](https://pnpm.io) (la cartella ha il suo `pnpm-lock.yaml`, separato da quello dell'app):

```sh
cd demo
pnpm install
pnpm dev        # anteprima con Vite su http://localhost:5173
pnpm check      # controllo dei tipi
pnpm build      # dist/studify-demo.html: la pagina da pubblicare
```

`pnpm build` fa tre cose:
1. genera `src/figtree.css` con Figtree incorporato in base64 (`scripts/font.mjs`): nessuna richiesta a Google Fonts, come nell'app;
2. impacchetta con Parcel e incorpora tutto in un file con `html-inline` (`dist/bundle.html`);
3. toglie doctype, `<html>`, `<head>` e `<body>`, che la pubblicazione come Artifact aggiunge da sé (`scripts/page.mjs`).

Per aggiornare la pagina pubblicata: ripubblica `dist/studify-demo.html` sullo stesso indirizzo.

## Dove sta cosa

| File | Che cosa |
|---|---|
| `src/data.ts` | dati d'esempio: argomenti, domande e flashcard copiati dall'esame demo dell'app (`public/demo/module.json`, senza le formule); `splitPhases` uguale a `public/js/planner.js` |
| `src/screens.tsx` | le sei schermate più quella finale |
| `src/App.tsx` | il percorso a sinistra (testi dei passi) e la finestra dell'app a destra |
| `src/ui.tsx` | marchio, indicatore dei passi, scelte a pulsante, barre |
| `src/index.css` | i token di Studify (`public/styles.css`) in HSL, chiaro e scuro, per Tailwind e shadcn/ui |

Se cambiano i token, le fasi del piano o l'esame demo dell'app, vanno ricopiati qui: la demo non li importa dall'app.
Le promesse dei testi devono restare vere per l'app (es. «gli argomenti che salti tornano nei giorni dopo»); ciò che è
solo della demo è elencato nella schermata finale («Solo nella demo»).
