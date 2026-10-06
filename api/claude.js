// Funzione Vercel: chiama Claude con la chiave del gestore di Studify, per gli utenti che hanno fatto l'accesso
// e finché non hanno esaurito il credito del mese. Variabili d'ambiente: vedi README («Versione web»).
import Anthropic from "@anthropic-ai/sdk";
import { createHandler } from "./_lib.js";

const env = {
  ...process.env,
  SUPABASE_URL: process.env.SUPABASE_URL || "https://ujkyjbgfrzmhowqgkyrg.supabase.co",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "sb_publishable_ro1LPfAb3vpvZZsWiePxAg_TmHDYLzg",
};
const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }) : null;

export default createHandler({ env, anthropic });
