-- Receita de Controle Especial (migration 20261104130000). Synthetic users and CPFs only.
begin;
insert into auth.users(id,email) values ('c4130000-0000-4000-8000-000000000001','controlled@example.invalid');
insert into auth.users(id,email,raw_app_meta_data) values
 ('c4130000-0000-4000-8000-000000000002','reception-controlled@example.invalid','{"account_type":"reception"}');

do $$ declare d text := pg_get_functiondef('public.update_user_settings(jsonb)'::regprocedure); begin
  assert d ~ 'assert_clinical_actor\(\)', 'update_user_settings lost the clinical-actor guard';
  assert d ~ 'assert_session_assurance\(\)', 'update_user_settings lost the session-assurance guard';
  assert d ~ 'professional_phone' and d ~ 'rqe', 'update_user_settings lost the prescriber contact keys';
  assert pg_get_constraintdef((select oid from pg_constraint where conname = 'prescriptions_doc_type_check')) ~ 'receita_controle_especial',
    'doc_type does not accept receita_controle_especial';
  assert pg_get_constraintdef((select oid from pg_constraint where conname = 'prescriptions_doc_type_check')) ~ 'solicitacao_exames',
    'doc_type lost an existing type';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','c4130000-0000-4000-8000-000000000001',true);
-- 111.444.777-35 is a synthetic CPF with a valid check digit.
select public.update_user_settings('{"prescriber_cpf":" 111.444.777-35 ","professional_phone":"(41) 3000-0000"}');
do $$ begin
  assert (select prescriber_cpf from public.user_settings where user_id='c4130000-0000-4000-8000-000000000001')='11144477735','CPF not stored as digits';
  assert (select professional_phone from public.user_settings where user_id='c4130000-0000-4000-8000-000000000001')='(41) 3000-0000','Existing key broken';
end $$;
select public.update_user_settings('{"prescriber_cpf":""}');
do $$ begin
  assert (select prescriber_cpf from public.user_settings where user_id='c4130000-0000-4000-8000-000000000001') is null,'Empty CPF not cleared';
  begin perform public.update_user_settings('{"prescriber_cpf":"111.444.777-36"}'); raise exception 'Wrong check digit accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_user_settings('{"prescriber_cpf":"CPF 11144477735"}'); raise exception 'Text around the CPF accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.update_user_settings('{"prescriber_cpf":11144477735}'); raise exception 'Non-string CPF accepted';
  exception when sqlstate '22023' then null; end;
end $$;

reset role;
do $$ begin
  begin update public.user_settings set prescriber_cpf='11111111111' where user_id='c4130000-0000-4000-8000-000000000001';
    raise exception 'Constraint missing on prescriber_cpf';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','c4130000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.update_user_settings('{"prescriber_cpf":"111.444.777-35"}'); raise exception 'Reception changed prescriber CPF';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
