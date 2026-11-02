-- Schema del progetto Supabase «studify» (versione web). Le parti 1-3, 5 e 6 sono già applicate;
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

-- 2b. Richieste a Claude in corso: il costo stimato è «prenotato» prima di chiamare Claude e saldato alla fine.
--     Senza, il consumo si registra solo a risposta finita: tante richieste partite insieme passerebbero tutte il
--     controllo del credito e lo supererebbero di molto. Una prenotazione più vecchia di 10 minuti (la funzione Vercel
--     dura al massimo 5) non conta più: una richiesta interrotta non blocca il credito. Solo la chiave di servizio.
create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reserved_usd numeric(12, 6) not null check (reserved_usd >= 0),
  started_at timestamptz not null default now()
);
alter table public.ai_requests enable row level security; -- nessuna policy: gli utenti non la vedono
create index if not exists ai_requests_user on public.ai_requests (user_id);

-- Prenota `p_reserve` dollari se il credito lo permette (spesa del mese + prenotazioni aperte sotto il limite) e se l'utente
-- non ha già `p_max_open` richieste in corso. `p_total_limit` (solo per il piano Gratis): il tetto di tutto il servizio.
-- Restituisce l'id della prenotazione, oppure il motivo del no: busy, quota, pending (credito già prenotato), total.
-- Il lucchetto rende il controllo e la prenotazione un passo solo, anche con molte richieste insieme.
create or replace function public.begin_ai_request(p_user uuid, p_reserve numeric, p_limit numeric, p_total_limit numeric, p_max_open integer)
returns table (request_id uuid, reason text) language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_spent numeric;
  v_open numeric;
  v_count integer;
  v_id uuid;
begin
  if p_user is null or p_reserve is null or p_reserve < 0 or p_limit is null then raise exception 'valori non validi'; end if;
  perform pg_advisory_xact_lock(hashtext('studify.ai_requests'));
  delete from public.ai_requests where started_at < now() - interval '10 minutes';
  select coalesce(sum(reserved_usd), 0), count(*) into v_open, v_count from public.ai_requests where user_id = p_user;
  if v_count >= p_max_open then return query select null::uuid, 'busy'::text; return; end if;
  select coalesce((select cost_usd from public.ai_usage where user_id = p_user and month = v_month), 0) into v_spent;
  if v_spent >= p_limit then return query select null::uuid, 'quota'::text; return; end if;
  if v_spent + v_open >= p_limit then return query select null::uuid, 'pending'::text; return; end if;
  if p_total_limit is not null and
     (select coalesce(sum(cost_usd), 0) from public.ai_usage where month = v_month)
     + (select coalesce(sum(reserved_usd), 0) from public.ai_requests) >= p_total_limit
  then return query select null::uuid, 'total'::text; return; end if;
  insert into public.ai_requests (user_id, reserved_usd) values (p_user, p_reserve) returning id into v_id;
  return query select v_id, null::text;
end $$;

-- Fine della richiesta: toglie la prenotazione e registra il consumo vero (se c'è stato).
create or replace function public.finish_ai_request(p_request uuid, p_user uuid, p_input bigint, p_output bigint, p_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ai_requests where id = p_request and user_id = p_user;
  if p_input > 0 or p_output > 0 or p_cost > 0 then perform public.record_ai_usage_for(p_user, p_input, p_output, p_cost); end if;
end $$;

revoke all on function public.begin_ai_request(uuid, numeric, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.finish_ai_request(uuid, uuid, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.begin_ai_request(uuid, numeric, numeric, numeric, integer) to service_role;
grant execute on function public.finish_ai_request(uuid, uuid, bigint, bigint, numeric) to service_role;

-- security definer voluto: la propria spesa; il totale del servizio (per il tetto complessivo) solo alla chiave di
-- servizio, cioè alla funzione Vercel. A un utente il totale torna vuoto: quanto spende Studify non gli serve.
create or replace function public.ai_spend_this_month()
returns table (mine numeric, total numeric) language sql stable security definer set search_path = '' as $$
  select
    coalesce((select cost_usd from public.ai_usage where user_id = auth.uid() and month = date_trunc('month', now())::date), 0),
    case when coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      then coalesce((select sum(cost_usd) from public.ai_usage where month = date_trunc('month', now())::date), 0)
    end
$$;

revoke all on function public.record_ai_usage_for(uuid, bigint, bigint, numeric) from public, anon, authenticated;
revoke all on function public.ai_spend_this_month() from public, anon;
grant execute on function public.record_ai_usage_for(uuid, bigint, bigint, numeric) to service_role;
grant execute on function public.ai_spend_this_month() to authenticated, service_role;

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

-- Gli eventi di Stripe possono arrivare in ritardo o due volte. Per lo stesso abbonamento si scrive solo se l'evento non è
-- più vecchio di quello salvato. Per un abbonamento diverso (uno vecchio disdetto, o pagato due volte) conta chi addebita:
-- un abbonamento che addebita vince su uno finito anche se il suo evento è più vecchio, e uno finito non prende mai il
-- posto di uno che addebita. Tra due dello stesso tipo vince l'evento più recente.
-- VERSIONE DA RIESEGUIRE A MANO nei progetti creati prima di questa regola (create or replace: nient'altro cambia).
create or replace function public.billing_charging(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
$$;
revoke all on function public.billing_charging(text) from public, anon, authenticated;
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
  where case
    when public.subscriptions.stripe_subscription_id is not distinct from excluded.stripe_subscription_id
      then public.subscriptions.event_at <= excluded.event_at
    when public.billing_charging(excluded.status) <> public.billing_charging(public.subscriptions.status)
      then public.billing_charging(excluded.status)
    else public.subscriptions.event_at <= excluded.event_at
  end
$$;
revoke all on function public.billing_upsert(uuid, text, text, text, timestamptz, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_upsert(uuid, text, text, text, timestamptz, boolean, text, text, timestamptz) to service_role;

-- 6. PDF e foto online (solo con i piani a pagamento): bucket privato «files», un file per oggetto in <id utente>/<id file>.
--    Ognuno legge, sostituisce e cancella solo la propria cartella. Si carica solo se lo spazio usato è sotto quello del
--    piano (Gratis 0, Base 1 GB, Pro 5 GB, come public/js/plans.js): il controllo guarda lo spazio prima del caricamento,
--    quindi si può sforare al massimo di un file (50 MB, il limite del bucket). Finito l'abbonamento i file restano
--    leggibili e cancellabili, ma non se ne aggiungono altri. Le righe di storage.objects non si cancellano in SQL
--    (protect_delete di Supabase): i file si tolgono dall'API di Storage, anche prima di eliminare l'account (web/gate.js).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Piano in uso, come activePlan() in public/js/plans.js: attivo, in prova o con il pagamento da ritentare, entro 3 giorni
-- dalla fine del periodo.
create or replace function public.my_plan()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select plan from public.subscriptions
    where user_id = (select auth.uid()) and status in ('active', 'trialing', 'past_due')
      and (current_period_end is null or current_period_end + interval '3 days' > now())
  ), 'free')
$$;
create or replace function public.files_quota(p_plan text)
returns bigint language sql immutable set search_path = '' as $$
  select (case p_plan when 'pro' then 5368709120 when 'base' then 1073741824 else 0 end)::bigint
$$;
create or replace function public.files_used()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint from storage.objects
  where bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text
$$;
create or replace function public.files_room()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.files_used() < public.files_quota(public.my_plan())
$$;
-- Per l'app: spazio usato, spazio del piano e piano.
create or replace function public.files_usage()
returns table (used bigint, quota bigint, plan text) language sql stable security definer set search_path = '' as $$
  select public.files_used(), public.files_quota(public.my_plan()), public.my_plan()
$$;
revoke all on function public.my_plan() from public, anon;
revoke all on function public.files_quota(text) from public, anon;
revoke all on function public.files_used() from public, anon;
revoke all on function public.files_room() from public, anon;
revoke all on function public.files_usage() from public, anon;
grant execute on function public.my_plan() to authenticated;
grant execute on function public.files_quota(text) to authenticated;
grant execute on function public.files_used() to authenticated;
grant execute on function public.files_room() to authenticated;
grant execute on function public.files_usage() to authenticated;

create policy "files: lettura propria" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files: caricamento nello spazio del piano" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text and public.files_room());
-- La sostituzione non controlla lo spazio: cambia un file che c'è già (al più 50 MB in più). E se Storage aggiorna i dati del
-- file dopo averlo caricato, il controllo farebbe fallire proprio il caricamento che porta al limite.
-- Nel progetto c'è anche la regola di prima, «files: sostituzione nello spazio del piano»: non conta più (le regole si
-- sommano, basta che una lo permetta) e si può togliere a mano dall'editor SQL.
create policy "files: sostituzione propria" on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files: cancellazione propria" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
