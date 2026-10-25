-- Schema del progetto Supabase «studify» (versione web). Le parti 1-3 e 5 sono già applicate;
-- la parte 4 (eliminazione dell'account) va eseguita a mano nell'editor SQL di Supabase.

-- 1. Documenti dell'app (stesso modello della capability `db` delle pagine Claude): ognuno vede solo i propri.
create table public.docs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  doc_id text not null check (char_length(doc_id) between 1 and 200),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, doc_id),
  constraint docs_size check (pg_column_size(data) < 400000)
);
alter table public.docs enable row level security;
create policy "docs: lettura propria" on public.docs for select to authenticated using (user_id = (select auth.uid()));
create policy "docs: inserimento proprio" on public.docs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "docs: modifica propria" on public.docs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "docs: cancellazione propria" on public.docs for delete to authenticated using (user_id = (select auth.uid()));

-- 2. Consumo di Claude per utente e mese: scritto solo da record_ai_usage_for, chiamata dalla funzione Vercel con la chiave
--    di servizio (SUPABASE_SERVICE_ROLE_KEY). Gli utenti non possono scriverlo: altrimenti chiunque gonfierebbe il totale del mese.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  primary key (user_id, month)
);
alter table public.ai_usage enable row level security;
create policy "ai_usage: lettura propria" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- solo la chiave di servizio (la funzione Vercel, dopo aver verificato il token dell'utente); mai valori negativi.
create or replace function public.record_ai_usage_for(p_user uuid, p_input bigint, p_output bigint, p_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then raise exception 'utente mancante'; end if;
  if p_input < 0 or p_output < 0 or p_cost < 0 then raise exception 'valori non validi'; end if;
  insert into public.ai_usage (user_id, month, requests, input_tokens, output_tokens, cost_usd)
  values (p_user, date_trunc('month', now())::date, 1, p_input, p_output, p_cost)
  on conflict (user_id, month) do update set
    requests = public.ai_usage.requests + 1,
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cost_usd = public.ai_usage.cost_usd + excluded.cost_usd;
end $$;
-- la versione precedente, chiamabile dagli utenti con il loro token: da togliere nei progetti già creati
drop function if exists public.record_ai_usage(bigint, bigint, numeric);

-- security definer voluto: la propria spesa e il totale del servizio (per il tetto complessivo), senza i dati degli altri.
create or replace function public.ai_spend_this_month()
returns table (mine numeric, total numeric) language sql stable security definer set search_path = '' as $$
  select
    coalesce((select cost_usd from public.ai_usage where user_id = auth.uid() and month = date_trunc('month', now())::date), 0),
    coalesce((select sum(cost_usd) from public.ai_usage where month = date_trunc('month', now())::date), 0)
$$;

revoke all on function public.record_ai_usage_for(uuid, bigint, bigint, numeric) from public, anon, authenticated;
revoke all on function public.ai_spend_this_month() from public, anon;
grant execute on function public.record_ai_usage_for(uuid, bigint, bigint, numeric) to service_role;
grant execute on function public.ai_spend_this_month() to authenticated;

-- 3. Consenso a termini e privacy (copia dei metadati dell'account, scritta dall'app al primo accesso).
create table public.consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  adult boolean not null,
  accepted_at timestamptz not null default now()
);
alter table public.consents enable row level security;
create policy "consents: lettura propria" on public.consents for select to authenticated using (user_id = (select auth.uid()));
create policy "consents: inserimento proprio" on public.consents for insert to authenticated with check (user_id = (select auth.uid()));

-- 4. DA ESEGUIRE A MANO (SQL Editor → New query → Run): eliminazione dell'account da parte dell'utente stesso.
--    Cancella l'utente e, a cascata, docs, ai_usage e consents. Finché non c'è, l'app invita a scrivere al gestore.
--    Con gli abbonamenti (parte 5) rifiuta l'eliminazione finché c'è un abbonamento che si rinnova: Stripe continuerebbe
--    ad addebitare. VERSIONE DA RIESEGUIRE A MANO prima di accendere BILLING (quella applicata non ha ancora il controllo).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  if exists (
    select 1 from public.subscriptions
    where user_id = auth.uid() and status in ('active', 'trialing', 'past_due') and not cancel_at_period_end
      and (current_period_end is null or current_period_end > now())
  ) then raise exception 'abbonamento attivo: disdicilo prima di eliminare l''account'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 5. Abbonamenti (Stripe): una riga per utente, scritta solo dal webhook di Stripe (api/stripe-webhook.js) con la chiave
--    di servizio, attraverso billing_upsert. L'utente può solo leggere la propria. Finché BILLING non è «on» resta vuota.
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null check (plan in ('base', 'pro')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  event_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "subscriptions: lettura propria" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));

-- Gli eventi di Stripe possono arrivare in ritardo o due volte: si scrive solo se l'evento non è più vecchio di quello salvato.
create or replace function public.billing_upsert(
  p_user_id uuid, p_plan text, p_interval text, p_status text, p_period_end timestamptz, p_cancel_at_period_end boolean,
  p_customer text, p_subscription text, p_event_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into public.subscriptions (user_id, plan, billing_interval, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, event_at, updated_at)
  values (p_user_id, p_plan, p_interval, p_status, p_period_end, p_cancel_at_period_end, p_customer, p_subscription, p_event_at, now())
  on conflict (user_id) do update set
    plan = excluded.plan, billing_interval = excluded.billing_interval, status = excluded.status,
    current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, public.subscriptions.stripe_customer_id),
    stripe_subscription_id = excluded.stripe_subscription_id, event_at = excluded.event_at, updated_at = now()
  where public.subscriptions.event_at <= excluded.event_at
$$;
revoke all on function public.billing_upsert(uuid, text, text, text, timestamptz, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_upsert(uuid, text, text, text, timestamptz, boolean, text, text, timestamptz) to service_role;
