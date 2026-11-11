-- AI quota: clinic day, default limit, zero-cost release and the stored profile proposal (migration 20261111160000).
begin;
insert into auth.users(id, email) values
 ('96000000-0000-4000-8000-000000000001', 'quota-default@example.invalid'),
 ('96000000-0000-4000-8000-000000000002', 'quota-custom@example.invalid');
insert into public.user_settings(user_id) values ('96000000-0000-4000-8000-000000000001');
insert into public.user_settings(user_id, daily_credit_limit) values ('96000000-0000-4000-8000-000000000002', 30);
do $$
declare
  v_result jsonb;
begin
  assert (select daily_credit_limit = 8000 from public.user_settings where user_id = '96000000-0000-4000-8000-000000000001'),
    'New settings rows do not get the 8000 default';
  assert not exists (select 1 from public.user_settings where daily_credit_limit = 1500),
    'A row still holds the old 1500 default';

  -- The day is the clinic's day, not UTC.
  v_result := public.reserve_usage('96000000-0000-4000-8000-000000000001', 400, '96000000-0000-4000-8000-000000000011');
  assert (v_result->>'allowed')::boolean and (v_result->>'limit')::numeric = 8000, 'Default limit not applied';
  assert (select day = (now() at time zone 'America/Sao_Paulo')::date from public.usage_reservations
    where id = '96000000-0000-4000-8000-000000000011'), 'Reservation not on the clinic day';
  assert exists (select 1 from public.usage_daily where user_id = '96000000-0000-4000-8000-000000000001'
    and day = (now() at time zone 'America/Sao_Paulo')::date and credits_reserved = 400), 'Usage row not on the clinic day';

  -- A failed call released at zero frees its reservation and charges nothing.
  assert public.settle_usage('96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000011', 0), 'Release refused';
  assert exists (select 1 from public.usage_daily where user_id = '96000000-0000-4000-8000-000000000001'
    and credits_reserved = 0 and credits_used = 0), 'Zero-cost release charged credits';
  -- Unknown usage (null) keeps the reservation charged.
  perform public.reserve_usage('96000000-0000-4000-8000-000000000001', 120, '96000000-0000-4000-8000-000000000012');
  perform public.settle_usage('96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000012', null);
  assert exists (select 1 from public.usage_daily where user_id = '96000000-0000-4000-8000-000000000001'
    and credits_reserved = 0 and credits_used = 120), 'Unknown usage did not keep the reservation charged';

  -- A limit the user already has is kept.
  v_result := public.reserve_usage('96000000-0000-4000-8000-000000000002', 31, '96000000-0000-4000-8000-000000000013');
  assert not (v_result->>'allowed')::boolean and (v_result->>'limit')::numeric = 30, 'Custom lower limit not kept';

  -- A user without a settings row gets the new default too.
  delete from public.user_settings where user_id = '96000000-0000-4000-8000-000000000002';
  v_result := public.reserve_usage('96000000-0000-4000-8000-000000000002', 31, '96000000-0000-4000-8000-000000000014');
  assert (v_result->>'allowed')::boolean and (v_result->>'limit')::numeric = 8000, 'Missing settings row not on the new default';
end $$;

-- The reservation functions stay service-only.
do $$ begin
  assert not has_function_privilege('authenticated', 'public.reserve_usage(uuid,numeric,uuid)', 'execute'), 'reserve_usage executable by authenticated';
  assert not has_function_privilege('anon', 'public.reserve_usage(uuid,numeric,uuid)', 'execute'), 'reserve_usage executable by anon';
  assert has_function_privilege('service_role', 'public.reserve_usage(uuid,numeric,uuid)', 'execute'), 'reserve_usage not executable by service_role';
end $$;

-- The profile proposal column: an object, empty by default.
insert into public.patients(id, user_id, name, status) values
 ('96000000-0000-4000-8000-000000000021', '96000000-0000-4000-8000-000000000001', 'Pessoa sintética', 'novo');
insert into public.consultations(id, patient_id, user_id, soap_note) values
 ('96000000-0000-4000-8000-000000000031', '96000000-0000-4000-8000-000000000021', '96000000-0000-4000-8000-000000000001', 'Nota sintética');
do $$ begin
  assert (select profile_proposals = '{}'::jsonb from public.consultations where id = '96000000-0000-4000-8000-000000000031'), 'Default is not an empty object';
  update public.consultations set profile_proposals = '{"medicationsStopped":["Medicamento A"],"notices":[]}'::jsonb
    where id = '96000000-0000-4000-8000-000000000031';
  assert (select profile_proposals->'medicationsStopped'->>0 = 'Medicamento A' from public.consultations
    where id = '96000000-0000-4000-8000-000000000031'), 'Proposal not stored';
  begin
    update public.consultations set profile_proposals = '[]'::jsonb where id = '96000000-0000-4000-8000-000000000031';
    raise exception 'Non-object proposal accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;
