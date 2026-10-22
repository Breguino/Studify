// Funzione Vercel: pagamento degli abbonamenti (Stripe Checkout) e portale per gestirli. Spenta senza BILLING=on.
// Variabili d'ambiente: vedi README («Abbonamenti»).
import { createBillingHandler } from "./_billing.js";

const env = {
  ...process.env,
  SUPABASE_URL: process.env.SUPABASE_URL || "https://ujkyjbgfrzmhowqgkyrg.supabase.co",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "sb_publishable_ro1LPfAb3vpvZZsWiePxAg_TmHDYLzg",
};

export default createBillingHandler({ env });
