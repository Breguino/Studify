# Abbonamenti: provarli in modalità test e accenderli

Il codice c'è già: piani Gratis, Base e Pro (mensile e annuale), pagamento su Stripe, portale per gestirli e credito di Claude
che cambia col piano. **Finché su Vercel non metti `BILLING=on`, il sito resta com'è oggi:** tutto gratis, credito di 3 $
al mese, nessun prezzo nella landing.

| Piano | Mensile | Annuale | Credito di Claude al mese |
|---|---|---|---|
| Gratis | 0 € | — | 0,50 $ (con gli abbonamenti accesi) |
| Base | 4,99 € | 49 € | 3 $ |
| Pro | 9,99 € | 99 € | 5 $ |

I prezzi mostrati stanno in `public/js/plans.js`; quelli addebitati sono i «Price» che crei su Stripe: **devono coincidere**.

## 1. Provarli in modalità test (gratis, senza partita IVA, senza soldi veri)

1. **Crea un account su [stripe.com](https://stripe.com)** e resta in **modalità test** (l'interruttore «Test mode» in alto).
2. **Crea il prodotto e i 4 prezzi.** *Catalogo prodotti → Aggiungi prodotto*:
   - prodotto «Studify Base»: prezzo ricorrente 4,99 € al mese, e un secondo prezzo 49 € all'anno;
   - prodotto «Studify Pro»: 9,99 € al mese e 99 € all'anno;
   - in entrambi, «Il prezzo include le tasse» (IVA inclusa).

   Ogni prezzo ha un id che inizia con `price_…`: ti servono tutti e quattro.
3. **Attiva il portale clienti.** *Impostazioni → Fatturazione → Portale clienti*: consenti disdetta, cambio di piano (tra i
   4 prezzi) e aggiornamento della carta. Salva.
4. **Crea il webhook.** *Sviluppatori → Webhook → Aggiungi endpoint*:
   - URL: `https://<il tuo sito>/api/stripe-webhook`;
   - eventi: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`.

   Poi copia il «Segreto di firma» (`whsec_…`).
5. **Su Vercel**, in *Settings → Environment Variables*, aggiungi queste variabili **solo per l'ambiente «Preview»**.
   Così le provi nelle anteprime delle PR senza toccare il sito pubblico:

   | Variabile | Valore |
   |---|---|
   | `BILLING` | `on` |
   | `STRIPE_SECRET_KEY` | la chiave segreta di test (`sk_test_…`, *Sviluppatori → Chiavi API*) |
   | `STRIPE_WEBHOOK_SECRET` | il segreto del webhook (`whsec_…`) |
   | `STRIPE_PRICE_BASE_MONTH`, `STRIPE_PRICE_BASE_YEAR`, `STRIPE_PRICE_PRO_MONTH`, `STRIPE_PRICE_PRO_YEAR` | i 4 id `price_…` |
   | `SUPABASE_SERVICE_ROLE_KEY` | già presente: la usa anche `/api/claude` per registrare il consumo (vedi README) |

   La chiave di servizio di Supabase e quella di Stripe sono **segrete**: vanno solo su Vercel, mai nel codice e mai
   incollate in chat. Il webhook, per le anteprime protette da Vercel, ha bisogno dell'URL di produzione o di un
   «Protection Bypass»; per una prova semplice puoi mettere le variabili anche su «Production» con `BILLING=on`
   per qualche minuto, e toglierle subito dopo.
6. **Prova.** Apri l'app → *Account* → scegli Base o Pro → spunta la conferma → paga con la carta di test
   `4242 4242 4242 4242`, una data futura qualsiasi e un CVC qualsiasi. Tornato nell'app, l'account deve dire
   «Piano Base mensile · si rinnova il …», e «Gestisci abbonamento» deve aprire il portale di Stripe.

## 2. Prima di farli pagare davvero (servi tu, con un commercialista e un avvocato)

- [ ] **Partita IVA** (anche in regime forfettario): vendere abbonamenti con regolarità ne richiede una.
- [ ] **Account Stripe attivato** con i dati della tua attività, l'IBAN e la verifica dell'identità.
- [ ] **Ricevute o fatture**: decidi con il commercialista come emetterle (Stripe può mandare le ricevute da solo).
      Per l'IVA, se vendi a consumatori di altri Paesi UE oltre la soglia, va valutato il regime OSS.
- [ ] **Termini e privacy definitivi**: le parti sugli abbonamenti compaiono solo con `BILLING=on` e sono segnate
      [DA VERIFICARE]: diritto di recesso, rinnovo, prezzi, Stripe come fornitore, conservazione dei dati fiscali.
      Quando cambi la privacy, aggiorna anche `PRIVACY_VERSION` in `web/gate.js`, così gli utenti vedono l'avviso.
- [ ] **Controllo sull'eliminazione dell'account**: in Supabase, *SQL Editor → New query*, incolla ed esegui la funzione
      `delete_my_account` della parte 4 di `supabase/schema.sql`, nella versione con il controllo sull'abbonamento.
      L'app lo controlla già, ma così vale anche se qualcuno aggira l'app.
- [ ] **Una generazione vera misurata**: prima di far pagare, verifica in Supabase (`ai_usage`) quanto costa davvero un
      modulo, e che il credito di ogni piano basti per quello che prometti.
- [ ] **Chiavi live**: su Stripe passa in modalità live, ricrea prezzi e webhook (gli id cambiano), e metti le chiavi
      `sk_live_…` e i nuovi `price_…` su Vercel, ambiente «Production», con `BILLING=on`.

## Come funziona, in breve

- `public/js/plans.js`: piani, prezzi mostrati, piano in uso a partire dalla riga dell'abbonamento.
- `api/_billing.js`: limiti per piano, pagamento (`/api/billing`), portale e webhook (`/api/stripe-webhook`).
  Nessuna libreria: API REST di Stripe con `fetch`.
- `supabase/schema.sql` (parte 5): tabella `subscriptions`, leggibile solo dal proprietario; la scrive solo il webhook
  con la chiave di servizio, attraverso `billing_upsert`, che ignora gli eventi più vecchi di quello salvato.
- `/api/claude`: il credito del mese è quello del piano. Il tetto complessivo (`TOTAL_MONTHLY_LIMIT_USD`) vale solo per
  il piano Gratis, così chi paga non resta bloccato dagli altri.
- Un account con un abbonamento che si rinnova non si può eliminare: prima va disdetto, altrimenti Stripe
  continuerebbe ad addebitare.
