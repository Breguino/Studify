# Studify — regole per il design (e per integrare i disegni Figma)

App di studio per esami universitari, interfaccia **in italiano**. JavaScript puro (ES modules), **nessun framework UI**,
un solo foglio di stile globale. Lo stesso codice dell'interfaccia (`public/js/`) produce **tre versioni**: server Node,
pagina Claude (artifact) e sito web (Vercel + Supabase). Ogni modifica all'interfaccia va provata in tutte e tre.

## 1. Token di design

**Dove:** variabili CSS in `:root` all'inizio di `public/styles.css`, ripetute **due volte** per il tema scuro
(`@media (prefers-color-scheme: dark)` dentro `:root:not([data-theme="light"])`, e `:root[data-theme="dark"]`).
Non c'è un sistema di trasformazione (niente Style Dictionary, JSON di token o Tailwind): i token sono CSS scritto a mano.

```css
:root {
  --bg: #f4f5f9; --surface: #ffffff; --surface-2: #eef0f5; --text: #171a23; --muted: #5b6275;
  --line: #e2e5ee; --line-strong: #d5d9e4; --brand: #4338ca; --brand-ink: #ffffff; --brand-soft: #eef0ff;
  --good: #13733a; --good-soft: #e8f6ee; --warn: #92400e; --warn-soft: #fef3e2; --bad: #b42318; --bad-soft: #fdecea;
  --radius: 18px; --shadow: 0 1px 2px rgba(20, 24, 40, .05), 0 6px 20px rgba(20, 24, 40, .05);
  --font: "Figtree Variable", "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

**Corrispondenza con i colori del design** (canvas Claude Design «Studify», stile indaco + Figtree):

| Colore nel design | Token | Uso |
|---|---|---|
| `#F4F5F9` | `--bg` | sfondo pagina |
| `#FFFFFF` | `--surface` | schede, barra in alto, campi |
| `#EEF0F5` / `#E8EAF2` | `--surface-2` | sfondo tab, barre di avanzamento vuote, pillole neutre |
| `#171A23` | `--text` | testo |
| `#5B6275` | `--muted` | testo secondario |
| `#E2E5EE` | `--line` | bordi delle schede |
| `#D5D9E4` / `#C9CEDB` | `--line-strong` | bordi di pulsanti e campi, bordi tratteggiati |
| `#4338CA` | `--brand` | accento: pulsanti primari, link, tab attiva |
| `#EEF0FF` | `--brand-soft` | sfondo dell'elemento attivo |
| `#15803D` → `#13733A` / `#E8F6EE` | `--good` / `--good-soft` | corretto, superato, materiale ufficiale (scurito per il contrasto: 5,3:1 sul fondo verde) |
| `#92400E` / `#FEF3E2` | `--warn` / `--warn-soft` | scadenze vicine, avvisi |
| `#B42318` / `#FDECEA` | `--bad` / `--bad-soft` | errori, «il docente ne parla per l'esame» |

**Regole**
- Nel CSS usa sempre `var(--token)`, mai esadecimali sparsi. Eccezioni già presenti: `mark.uncertain` e i colori di stampa.
- Un token nuovo va aggiunto nei **tre** blocchi (chiaro più i due scuri), altrimenti il tema scuro si rompe.
- **Tipografia**: Figtree variabile (300–900).
  - Titoli: `h1` `clamp(1.8rem, 4.2vw, 2.5rem)` peso 800, `letter-spacing: -.03em`; `h2` 1.3rem/800; `h3` 1.08rem/700;
    tutti con `text-wrap: balance`.
  - Corpo: 16px, `line-height: 1.55`. Testo piccolo: `.small` (.88rem).
- **Spaziatura**: non ci sono token di spaziatura. I valori ricorrenti sono 4/6/8/10/14/16/20/24 px (`gap`, `padding`).
  Il contenuto è largo al massimo 1120px (`main`), con 24px di margine (16px sul telefono).
- **Raggi**: schede `--radius` (18px); pulsanti e campi 12px; callout e righe 14px; pillole e badge 999px.
- **Controlli**: alti almeno **44px** (`.btn`, `input`, `select`); la versione compatta `.btn.small` è alta 34px.

## 2. Componenti

Non c'è una libreria di componenti né uno Storybook. I «componenti» sono **classi CSS** in `public/styles.css`
più **funzioni** che costruiscono il DOM con l'helper `h()` (`public/js/ui.js`).

```js
// public/js/ui.js — il testo è SEMPRE un text node: nessun innerHTML con contenuti dell'utente o dell'AI
h("a", { class: "card", href: `#/exam/${e.id}` }, h("h3", {}, e.name), badge("tra 21 g", "warn"));
h("button", { class: "btn primary", onclick: () => save() }, "Salva");
```

Altri helper di `ui.js`:
- `toast(msg, "ok"|"error")`
- `bar(valore, { label, tone })`
- `badge(testo, tone)`
- `emptyState(titolo, testo, ...azioni)`
- `link(href, testo, cls)`
- `confirmDialog(msg, { danger })`
- `paras(testo)`, `pct(x)`

**Catalogo delle classi** (riusale invece di crearne di nuove):

| Classe | Varianti | Note |
|---|---|---|
| `.card` | `.flat`, `a.card` (cliccabile, si solleva al passaggio) | scheda bianca, raggio 18, ombra |
| `.btn` | `.primary`, `.ghost`, `.danger`, `.small` | `[disabled]` gestito |
| `.badge` | `.brand`, `.good`, `.warn`, `.bad` | etichetta a pillola |
| `.pill` | `.on` | stato (es. «Claude» nella barra) |
| `.callout` | `.warn`, `.bad`, `.good`, `.hints`, `.follow-up` | riquadro informativo |
| `.tabs` | link con `aria-current="page"` | tab a pillola (segmented control) |
| `.bar` | `.good`, `.warn`, `.bad` | barra di avanzamento (`bar()`) |
| `.task`, `.day` | `.done`, `.today` | piano di studio |
| `.option` | `.correct`, `.wrong` | risposte del quiz |
| `.flashcard`, `.grades` | | ripasso |
| `.modal-backdrop` + `.modal` | | finestre di dialogo |
| `.empty`, `.file-drop` | | stati vuoti, caricamento file |
| layout | `.row`, `.row.between`, `.stack`, `.grid`, `.cols`, `.spacer`, `.form` | flex/grid |
| testo | `.muted`, `.small`, `.kbd` | |

**Viste:** `public/js/views/*.js`, una funzione per schermata che restituisce un nodo DOM
(`homeView`, `hubView(exam, tab)`, `quizView`, `careerView`, …).
Il router a hash sta in `public/js/app.js` (`#/`, `#/exam/:id/:tab`, `#/libretto`, `#/settings`, …).
Per ridisegnare, una vista tiene il nodo radice e lo rimpiazza:
`root.replaceChildren(...content().filter(Boolean))`. Filtra i `null`: `replaceChildren(null)` scrive la parola «null».

**Anteprima senza dati reali:** `npm run demo` (server con AI simulata ed esame demo), oppure `npm run build:harness`,
che crea `dist/harness.html`: la pagina Claude con un `window.claude` finto.

## 3. Framework, librerie, build

- **UI**: JavaScript puro in ES modules, senza React, Vue o JSX. La versione server serve `public/` così com'è, senza build.
- **Stile**: CSS puro, senza Tailwind, CSS Modules o styled-components.
- **Librerie**:
  - KaTeX (formule);
  - pdf.js (`pdfjs-dist`) e `pdf-lib` (PDF);
  - `@fontsource-variable/figtree` (carattere);
  - `@anthropic-ai/sdk`, solo lato server e nella funzione Vercel.
- **Build**: `scripts/build-artifact.mjs` (esbuild) in tre modi:
  - `npm run build:artifact` → `dist/studify.html`: un solo file con CSS, JS e font incorporati;
  - `npm run build:harness` → `dist/harness.html`;
  - `npm run build:web` → `dist-web/` (Vercel).
- **Sostituzione di moduli**: il plugin `swap-platform-modules` rimpiazza `public/js/{api,backend,pdf-text,pdf-pages,math-lib}.js`
  con quelli di `artifact/`; nella versione web `backend.js` viene da `web/`. Un componente che ha bisogno di
  qualcosa di specifico della piattaforma passa da `core` (`public/js/core.js`), non da import condizionali.
- **Prove**: `npm test` (`node --test`), che gira anche su GitHub Actions insieme alla build (`.github/workflows/test.yml`).

## 4. Asset

- **Niente immagini nel repository**. L'unico asset di contenuto è `public/demo/module.json`, l'esame demo.
- **Font**:
  - server: serviti da `node_modules` su `/vendor/figtree/*.woff2` e `/vendor/katex/` (`server/index.js`);
  - pagina Claude e web: **incorporati in base64** nel CSS al momento della build.
- **Niente CDN né risorse esterne**, per due motivi:
  - la pagina Claude non può caricarle;
  - Google Fonts o i CDN riceverebbero l'IP di chi visita, un problema di GDPR.
  La versione web ha anche una CSP restrittiva in `vercel.json`, con `connect-src` limitato all'origine e a Supabase.
- **Favicon**: SVG in data URI in `public/index.html` e `web/template.html`.
- **File dell'utente** (PDF, foto): IndexedDB nel browser, mai sul server. Le pagine di PDF diventano immagini JPEG (canvas → Blob).
- **Asset da Figma**:
  - piccoli (illustrazioni, loghi): SVG in linea o data URI nel CSS, mai URL esterni;
  - grandi: chiedere prima, perché la pagina Claude è un unico file (oggi circa 2,8 MB).

## 5. Icone

**Non c'è un sistema di icone**: niente icon font, sprite SVG o librerie.

| Glifo o tecnica | Uso |
|---|---|
| Carattere Unicode `→` | fine dei link d'azione: «Apri il libretto →» |
| Carattere Unicode `←` | «← Esci», «← Indietro» |
| Carattere Unicode `✓` | esame superato: `badge("✓ 28", "good")` |
| Carattere Unicode `✕` | pulsante di chiusura, sempre con `aria-label="Chiudi"` |
| CSS `.logo::before` | marchio: quadrato 26px, raggio 8, `--brand`, con il triangolo del token `--logo-glyph` (SVG in data URI); su fondo indaco scuro (`.on-hero`, `web/web.css`) diventa bianco con il triangolo scuro |
| CSS `li::before` | pallini degli elenchi nella schermata d'accesso |

Se un disegno Figma introduce icone vere, usa SVG in linea con `stroke="currentColor"`, così seguono il colore del testo
e il tema scuro. Nota che `h()` crea elementi HTML, non SVG: per gli SVG serve un helper con `document.createElementNS`.
I pulsanti con solo l'icona hanno sempre un `aria-label` in italiano.

## 6. Stile

- **Un foglio globale**: `public/styles.css`, valido per le tre versioni, più `web/web.css` (accesso e piè di pagina, solo web).
  Le classi sono semantiche e senza BEM (`.card`, `.task`, `.sim-head`), con alcune utility (`.row`, `.stack`, `.muted`).
- **Stili in linea** solo per ritocchi locali, tramite l'oggetto `style` di `h()`: `h("div", { style: { maxWidth: "860px" } })`.
  Se un valore si ripete, diventa una classe.
- **Responsive**: mobile-first leggero, con griglie `auto-fill` (`.grid` con minimo 300px) e `flex-wrap`.
  - Punti di rottura: `520px` (barra in alto, margini), `560px` (`.cols` su una colonna), `820px` (accesso, solo web).
  - Nessuno scorrimento orizzontale a 390px (larghezza di un telefono).
- **Tema scuro** automatico (`prefers-color-scheme`), forzabile con `data-theme`.
- **Movimento ridotto** rispettato (`prefers-reduced-motion`).
- **Stampa**: `@media print`, per la dispensa e le prove d'esame.
- **Accessibilità**:
  - focus visibile (`:focus-visible` con l'anello `--brand`);
  - `aria-current` sulla tab attiva;
  - `aria-live` per i toast;
  - i dialoghi chiudono con Esc;
  - le schermate in sovrimpressione rendono `inert` il resto della pagina.

## 7. Struttura del progetto

```
public/            index.html, styles.css (token e componenti), demo/
public/js/         logica pura e testata (dates, srs, planner, career, …) + store, ui, nav, core, app (router)
public/js/views/   una vista per schermata (home, hub, quiz, flash, materials, career, …)
artifact/          versione pagina Claude: template.html, entry, generate (Claude via `sample`), backend (`db`), fake-claude (prove)
web/               versione web: template.html, web.css, entry, auth, gate (accesso/account), claude.js, backend, termini/privacy
api/               funzione Vercel /api/claude (_lib.js testato)
server/            server Node senza dipendenze (versione locale con chiave API)
shared/            prompts.js, normalize.js (server e browser)
supabase/          schema.sql
scripts/           build-artifact.mjs
test/              node --test (+ fixtures/)
```

Le funzionalità seguono lo schema «logica pura in `public/js/<tema>.js` (testata in `test/<tema>.test.js`) più vista in `public/js/views/`».

## Come applicare un disegno Figma

1. Leggi il disegno (`get_design_context`, `get_screenshot`). L'output è pensato per React/Tailwind: **traducilo**,
   non copiarlo. Qui si scrive `h()` più classi esistenti, mai JSX, className Tailwind o componenti React.
2. Ogni colore, raggio e ombra va riportato a un token della tabella del punto 1. Se non c'è una corrispondenza,
   aggiungi un token nei tre blocchi del tema, oppure chiedi se è una deviazione voluta.
3. Riusa le classi del catalogo (punto 2). Una classe nuova va in `public/styles.css`, nella sezione del suo tema,
   e funziona anche in tema scuro e su telefono.
4. Testi: in italiano e brevi. Contenuti dell'utente o dell'AI sempre come testo (`h`), mai `innerHTML`.
5. Prova le tre versioni: `npm test`, `npm run demo` (server), `npm run build:harness` (pagina Claude) e
   `npm run build:web`. Poi controlla desktop e telefono (390px), il tema scuro e l'assenza di scorrimento orizzontale.
