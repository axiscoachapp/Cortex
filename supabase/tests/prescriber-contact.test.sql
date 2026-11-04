-- Prescriber phone and RQE (migration 20261104100000). Synthetic users only.
begin;
insert into auth.users(id,email) values ('c4100000-0000-4000-8000-000000000001','prescriber@example.invalid');
insert into auth.users(id,email,raw_app_meta_data) values
 ('c4100000-0000-4000-8000-000000000002','reception-prescriber@example.invalid','{"account_type":"reception"}');

-- The redefinition keeps both guards that earlier migrations injected at runtime.
do $$ declare d text := pg_get_functiondef('public.update_user_settings(jsonb)'::regprocedure); begin
  assert d ~ 'assert_clinical_actor\(\)', 'update_user_settings lost the clinical-actor guard';
  assert d ~ 'assert_session_assurance\(\)', 'update_user_settings lost the session-assurance guard';
  assert not has_function_privilege('anon','public.update_user_settings(jsonb)','execute'), 'anon can call update_user_settings';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','c4100000-0000-4000-8000-000000000001',true);
select public.update_user_settings('{"doctor_name":"Médica Sintética","professional_phone":" (41) 3000-0000 ","rqe":"RQE 12345"}');
do $$ begin
  assert (select professional_phone from public.user_settings where user_id='c4100000-0000-4000-8000-000000000001')='(41) 3000-0000','Phone not trimmed/stored';
  assert (select rqe from public.user_settings where user_id='c4100000-0000-4000-8000-000000000001')='RQE 12345','RQE not stored';
  assert (select doctor_name from public.user_settings where user_id='c4100000-0000-4000-8000-000000000001')='Médica Sintética','Existing key broken';
end $$;

-- Empty text clears; a patch without the key keeps the value.
select public.update_user_settings('{"rqe":""}');
select public.update_user_settings('{"specialty":"ginecologia"}');
do $$ begin
  assert (select rqe from public.user_settings where user_id='c4100000-0000-4000-8000-000000000001') is null,'Empty RQE not cleared';
  assert (select professional_phone from public.user_settings where user_id='c4100000-0000-4000-8000-000000000001')='(41) 3000-0000','Unrelated patch changed the phone';
end $$;

do $$ begin
  begin perform public.update_user_settings('{"professional_phone":"3000-0000"}'); raise exception 'Phone without DDD accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_user_settings('{"professional_phone":"telefone"}'); raise exception 'Non-numeric phone accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_user_settings('{"professional_phone":12}'); raise exception 'Non-string phone accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_user_settings('{"unknown_key":"x"}'); raise exception 'Unknown key accepted';
  exception when sqlstate '22023' then null; end;
end $$;

-- Direct writes still go through the table constraints.
reset role;
do $$ begin
  begin update public.user_settings set professional_phone='123' where user_id='c4100000-0000-4000-8000-000000000001';
    raise exception 'Constraint missing on professional_phone';
  exception when check_violation then null; end;
end $$;

-- A reception account cannot change prescriber settings.
set local role authenticated;
select set_config('request.jwt.claim.sub','c4100000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.update_user_settings('{"professional_phone":"(41) 3000-0001"}'); raise exception 'Reception changed prescriber settings';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
