# Email di Supabase in italiano

Le email di accesso le manda Supabase (Authentication). I modelli predefiniti sono in inglese: questi li sostituiscono.
Si incollano a mano nel pannello di Supabase; non c'è niente da pubblicare.

**Dove:** progetto `studify` → *Authentication* → *Emails* → *Templates*. Per ogni modello: oggetto e corpo (HTML).

| Modello di Supabase | Oggetto | File |
|---|---|---|
| Confirm signup | Conferma la tua email per Studify | `conferma-iscrizione.html` |
| Reset password | Nuova password per Studify | `recupero-password.html` |
| Change email address | Conferma il nuovo indirizzo email | `cambio-email.html` |
| Magic link | Il tuo link per entrare in Studify | `link-di-accesso.html` |

I link usano `{{ .ConfirmationURL }}`: l'app legge l'accesso dal frammento dell'indirizzo (`#access_token=…`,
`web/auth.js`), quindi **non** va sostituito con la forma `token_hash` della documentazione di Supabase.
Niente immagini né caratteri esterni: molti programmi di posta li bloccano.

## Servizio email (SMTP)

Il servizio incluso in Supabase manda pochissime email all'ora ed è pensato per le prove: con più iscrizioni nella
stessa ora, alcune conferme non partono. Il limite si alza solo con un servizio proprio
(*Authentication* → *Emails* → *SMTP Settings*), e poi in *Authentication* → *Rate Limits*.

- **Senza dominio (subito):** l'account Gmail del gestore, con una «password per le app» (serve la verifica in due passaggi).
  Host `smtp.gmail.com`, porta `465`, utente e mittente `info.studify@gmail.com`. Gmail ha un tetto giornaliero
  di invii: va bene per iniziare.
- **Con un dominio proprio (meglio, poi):** un servizio come Resend, Brevo o Postmark, con il dominio verificato
  (record DNS). Le email arrivano più spesso nella posta in arrivo e meno nello spam.

Dopo il cambio: prova una registrazione con un indirizzo vero e controlla anche la cartella spam.
