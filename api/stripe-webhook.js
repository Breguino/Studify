// Funzione Vercel: Stripe avvisa quando un abbonamento nasce, cambia o finisce; la riga in Supabase segue.
// Verifica la firma sul corpo grezzo (STRIPE_WEBHOOK_SECRET), o rilegge l'evento da Stripe; scrive con SUPABASE_SERVICE_ROLE_KEY.
import { createWebhookHandler } from "./_billing.js";

const env = {
  ...process.env,
  SUPABASE_URL: process.env.SUPABASE_URL || "https://ujkyjbgfrzmhowqgkyrg.supabase.co",
};

export default createWebhookHandler({ env });
