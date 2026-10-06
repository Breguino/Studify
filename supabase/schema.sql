-- Schema del progetto Supabase «studify» (versione web). Le parti 1-3 sono già applicate;
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

-- 2. Consumo di Claude per utente e mese: scritto solo da record_ai_usage (chiamata dalla funzione Vercel con il token dell'utente).
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

-- security definer voluto: l'utente può solo AGGIUNGERE consumo a sé stesso (mai valori negativi).
create or replace function public.record_ai_usage(p_input bigint, p_output bigint, p_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  if p_input < 0 or p_output < 0 or p_cost < 0 then raise exception 'valori non validi'; end if;
  insert into public.ai_usage (user_id, month, requests, input_tokens, output_tokens, cost_usd)
  values (auth.uid(), date_trunc('month', now())::date, 1, p_input, p_output, p_cost)
  on conflict (user_id, month) do update set
    requests = public.ai_usage.requests + 1,
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cost_usd = public.ai_usage.cost_usd + excluded.cost_usd;
end $$;

-- security definer voluto: la propria spesa e il totale del servizio (per il tetto complessivo), senza i dati degli altri.
create or replace function public.ai_spend_this_month()
returns table (mine numeric, total numeric) language sql stable security definer set search_path = '' as $$
  select
    coalesce((select cost_usd from public.ai_usage where user_id = auth.uid() and month = date_trunc('month', now())::date), 0),
    coalesce((select sum(cost_usd) from public.ai_usage where month = date_trunc('month', now())::date), 0)
$$;

revoke all on function public.record_ai_usage(bigint, bigint, numeric) from public, anon;
revoke all on function public.ai_spend_this_month() from public, anon;
grant execute on function public.record_ai_usage(bigint, bigint, numeric) to authenticated;
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
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
