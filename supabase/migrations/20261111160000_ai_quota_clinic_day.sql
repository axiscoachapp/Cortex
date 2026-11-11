-- AI quota on the clinic's day, a daily limit that fits a clinic day, and the stored profile proposal.
-- Owner: Claude (ia-servidor, plan round 2, 2026-11-11). Source: docs/reviews/2026-11-10/revisao-geral/
-- relatorios/ia-openai.md, findings 10 and 13.
--
-- 1. reserve_usage counted the day in UTC, so the quota renewed at 21:00 in São Paulo while the message
--    said "em 24h". The day is now the clinic's day (America/Sao_Paulo). Reservations already open keep
--    the day they were made on: settle_usage settles by the reservation's own day.
-- 2. The default daily limit was 1,500 credits, about ten 20-minute consultations at the current OpenAI
--    prices. The default is now 8,000 (arithmetic in supabase/functions/_shared/quota.ts). Rows that still
--    hold the old default are raised; any other limit a user has is kept, and no limit is lowered.
-- 3. finalize-consultation returned empty profile proposals when a retry found the consultation already
--    saved. The proposal (diagnoses, medications, allergies, medicationsStopped, notices) is now stored
--    with the consultation, like history_proposals.

alter table public.user_settings alter column daily_credit_limit set default 8000;
update public.user_settings set daily_credit_limit = 8000, updated_at = now() where daily_credit_limit = 1500;

alter table public.consultations add column if not exists profile_proposals jsonb not null default '{}'::jsonb
  check (jsonb_typeof(profile_proposals) = 'object');
comment on column public.consultations.profile_proposals is
  'Post-save AI proposal for the chart (diagnoses, medications, allergies, medicationsStopped) and notices about proposals that could not be generated. Never applied without the doctor''s review.';

create or replace function public.reserve_usage(p_user_id uuid, p_credits numeric, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_limit numeric;
  v_used numeric;
  v_existing public.usage_reservations;
begin
  if p_user_id is null or p_reservation_id is null or p_credits is null or p_credits <= 0 or p_credits > 100000
    or p_credits::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Invalid reservation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists (select 1 from public.account_deletion_requests where user_id = p_user_id) then raise exception 'Account deletion in progress'; end if;
  select daily_credit_limit into v_limit from public.user_settings where user_id = p_user_id;
  v_limit := coalesce(v_limit, 8000);
  insert into public.usage_daily(user_id, day) values (p_user_id, v_day) on conflict do nothing;
  select credits_used + credits_reserved into v_used from public.usage_daily where user_id = p_user_id and day = v_day;
  select * into v_existing from public.usage_reservations where id = p_reservation_id;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.reserved <> p_credits or v_existing.day <> v_day or v_existing.settled then
      raise exception 'Reservation already used';
    end if;
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
  end if;
  if v_used + p_credits > v_limit then return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit); end if;
  insert into public.usage_reservations(id, user_id, day, reserved) values (p_reservation_id, p_user_id, v_day, p_credits);
  update public.usage_daily set credits_reserved = credits_reserved + p_credits, updated_at = now() where user_id = p_user_id and day = v_day;
  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
end;
$$;
revoke all on function public.reserve_usage(uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.reserve_usage(uuid, numeric, uuid) to service_role;
