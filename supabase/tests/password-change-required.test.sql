-- Temporary password is a server-side control (migration 20261111110000).
-- Synthetic accounts only; the JWT is simulated with request.jwt.* settings, as in the other suites.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('c7100000-0000-4000-8000-000000000001','pw-admin@example.invalid',now(),'{}','{}'),
 ('c7100000-0000-4000-8000-000000000002','pw-doctor@example.invalid',now(),
  jsonb_build_object('provisioned_at',now(),'must_change_password',true,'temporary_password_expires_at',now()+interval '72 hours'),
  '{"full_name":"Médica Provisionada"}'),
 ('c7100000-0000-4000-8000-000000000003','pw-reception@example.invalid',now(),
  jsonb_build_object('account_type','reception','provisioned_at',now(),'must_change_password',true,'temporary_password_expires_at',now()+interval '72 hours'),
  '{"full_name":"Recepção Provisionada"}'),
 ('c7100000-0000-4000-8000-000000000004','pw-selfsigned@example.invalid',now(),'{}','{}'),
 ('c7100000-0000-4000-8000-000000000005','pw-unowned@example.invalid',now(),jsonb_build_object('provisioned_at',now()),'{}'),
 ('c7100000-0000-4000-8000-000000000006','pw-legacy@example.invalid',now(),'{}','{"must_change_password":false}');
insert into public.patients(id,user_id,name,status) values
 ('c7200000-0000-4000-8000-000000000001','c7100000-0000-4000-8000-000000000002','Paciente sintético da médica','novo');
insert into public.usage_daily(user_id,day,calls) values('c7100000-0000-4000-8000-000000000002',current_date,1);
insert into storage.objects(bucket_id,name) values
 ('patient-files','patients/c7100000-0000-4000-8000-000000000002/c7200000-0000-4000-8000-000000000001/exame.pdf');

create function pg_temp.as_user(p_user uuid,p_app jsonb default '{}',p_meta jsonb default '{}') returns void language sql as $$
 select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',p_user::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','aal','aal1','app_metadata',p_app,'user_metadata',p_meta)::text,true);
$$;
grant execute on function pg_temp.as_user(uuid,jsonb,jsonb) to authenticated,service_role;

-- Clinic created by an ordinary (self-registered) admin; the provisioned doctor is an active member,
-- as create-clinic-doctor leaves it; the receptionist is provisioned through the service role.
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000001');
select set_config('test.pw_clinic',public.create_clinic('Clínica Senha Temporária')::text,true);
reset role;
insert into public.clinic_members(clinic_id,user_id,role,status) values(current_setting('test.pw_clinic')::uuid,'c7100000-0000-4000-8000-000000000002','doctor','active');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.provision_clinic_receptionist('c7100000-0000-4000-8000-000000000001','c7100000-0000-4000-8000-000000000003','Recepção Provisionada',array['c7100000-0000-4000-8000-000000000001'::uuid]);

-- 1. A flagged JWT (the temporary-password session) is refused on every layer.
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000002','{"must_change_password":true}');
do $$ declare h text; begin
 assert public.password_change_pending(),'Flagged claim not detected';
 assert not public.session_assurance_ok() and not public.clinical_session_allowed(),'Central guards accept a flagged session';
 assert (select count(*) from public.patients)=0,'Flagged session reads the clinical record';
 assert (select count(*) from storage.objects where bucket_id='patient-files')=0,'Flagged session reads stored files';
 assert (select count(*) from public.usage_daily)=0,'Flagged session reads usage counters';
 begin insert into public.patients(user_id,name,status) values(auth.uid(),'Escrita com senha temporária','novo');
  raise exception 'Flagged session wrote a clinical record';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name) values('patient-files','patients/c7100000-0000-4000-8000-000000000002/c7200000-0000-4000-8000-000000000001/novo.pdf');
  raise exception 'Flagged session uploaded a file';exception when insufficient_privilege then null;end;
 begin perform public.update_user_settings('{"doctor_name":"Alterado com senha temporária"}');
  raise exception 'Settings RPC accepted a flagged session';
 exception when insufficient_privilege then get stacked diagnostics h=pg_exception_hint; assert h='password_change_required','Settings RPC without the machine-readable hint';end;
 begin perform public.clinic_access();
  raise exception 'clinic_access accepted a flagged session';
 exception when insufficient_privilege then get stacked diagnostics h=pg_exception_hint; assert h='password_change_required','clinic_access without the machine-readable hint';end;
 begin perform public.sharing_overview();raise exception 'Sharing RPC accepted a flagged session';exception when insufficient_privilege then null;end;
 begin perform public.grant_patient_share('c7200000-0000-4000-8000-000000000001','c7100000-0000-4000-8000-000000000001','read');
  raise exception 'Share granted by a flagged session';exception when insufficient_privilege then null;end;
 begin perform public.workspace_directory();raise exception 'Directory RPC accepted a flagged session';exception when insufficient_privilege then null;end;
end $$;
-- The legacy user_metadata flag (accounts created before the change) is refused the same way.
select pg_temp.as_user('c7100000-0000-4000-8000-000000000002','{}','{"must_change_password":true}');
do $$ begin
 assert (select count(*) from public.patients)=0,'Legacy flag reads the clinical record';
 begin perform public.clinic_access();raise exception 'Legacy flag reached clinic_access';exception when insufficient_privilege then null;end;
end $$;

-- 2. The owner changed the password: Auth now holds the cleared flag, but a JWT issued before the
--    change still carries the old claim and stays refused until the client refreshes.
reset role;
update auth.users set raw_app_meta_data=jsonb_build_object('provisioned_at',now(),'password_set_by_owner_at',now())
 where id='c7100000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000002','{"must_change_password":true}');
do $$ begin
 assert (select count(*) from public.patients)=0,'Pre-change token regained access before refresh';
 begin perform public.clinic_access();raise exception 'Pre-change token reached clinic_access';exception when insufficient_privilege then null;end;
end $$;
-- Refreshed token of the same user: everything works again.
select pg_temp.as_user('c7100000-0000-4000-8000-000000000002','{"password_set_by_owner_at":"2026-11-11T12:00:00Z"}');
do $$ declare access jsonb; begin
 assert not public.password_change_pending() and public.session_assurance_ok() and public.clinical_session_allowed(),'Refreshed session still pending';
 assert (select count(*) from public.patients)=1,'Refreshed session cannot read its own record';
 assert (select count(*) from storage.objects where bucket_id='patient-files')=1,'Refreshed session cannot read its own file';
 assert (select count(*) from public.usage_daily)=1,'Refreshed session cannot read its own usage';
 insert into public.patients(user_id,name,status) values(auth.uid(),'Escrita depois da troca','novo');
 perform public.update_user_settings('{"doctor_name":"Médica Provisionada"}');
 access:=public.clinic_access();
 assert access->>'kind'='clinical' and (access->>'active')::boolean and access->'clinic'->>'id'=current_setting('test.pw_clinic'),'clinic_access after the change';
 perform public.sharing_overview();
end $$;

-- 3. Reception: flagged session refused on reception RPCs, refreshed session works.
select pg_temp.as_user('c7100000-0000-4000-8000-000000000003','{"account_type":"reception","must_change_password":true}');
do $$ begin
 begin perform public.reception_contacts(current_setting('test.pw_clinic')::uuid,'');
  raise exception 'Reception RPC accepted a flagged session';exception when insufficient_privilege then null;end;
 begin perform public.clinic_access();raise exception 'Reception clinic_access accepted a flagged session';exception when insufficient_privilege then null;end;
 begin perform public.reception_create_contact(current_setting('test.pw_clinic')::uuid,'Contato sintético','11999990000',gen_random_uuid());
  raise exception 'Reception write accepted a flagged session';exception when insufficient_privilege then null;end;
end $$;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000003','{"account_type":"reception"}');
do $$ declare access jsonb; begin
 access:=public.clinic_access();
 assert access->>'kind'='reception' and (access->>'active')::boolean,'Reception clinic_access after the change';
 perform public.reception_contacts(current_setting('test.pw_clinic')::uuid,'');
 assert (select count(*) from public.patients)=0,'Reception reads clinical records';
end $$;

-- 4. Service role and cron calls carry no user claim and are unaffected.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ begin
 assert not public.password_change_pending() and public.session_assurance_ok() and public.clinical_session_allowed(),'Service role affected';
 perform public.assert_session_assurance();
 assert (select count(*) from public.patients where user_id='c7100000-0000-4000-8000-000000000002')=2,'Service role lost access';
end $$;

-- 5. Invitations only reach accounts whose owner set the password.
reset role;
update auth.users set raw_app_meta_data=jsonb_build_object('provisioned_at',now(),'must_change_password',true,'temporary_password_expires_at',now()+interval '72 hours')
 where id='c7100000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000001');
do $$ declare h text; begin
 begin perform public.invite_clinic_doctor(current_setting('test.pw_clinic')::uuid,'pw-unowned@example.invalid');
  raise exception 'Invitation reached an account still on its temporary password';
 exception when invalid_parameter_value then get stacked diagnostics h=pg_exception_hint; assert h='password_change_required','Invitation refusal without the hint';end;
end $$;
reset role;
update auth.users set raw_app_meta_data=jsonb_build_object('provisioned_at',now()) where id='c7100000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000001');
do $$ begin
 begin perform public.invite_clinic_doctor(current_setting('test.pw_clinic')::uuid,'pw-unowned@example.invalid');
  raise exception 'Invitation reached a provisioned account whose owner never set a password';exception when invalid_parameter_value then null;end;
 begin perform public.invite_clinic_doctor(current_setting('test.pw_clinic')::uuid,'pw-legacy@example.invalid');
  raise exception 'Invitation reached a legacy provisioned account without the owner marker';exception when invalid_parameter_value then null;end;
 assert public.invite_clinic_doctor(current_setting('test.pw_clinic')::uuid,'pw-selfsigned@example.invalid'),'Self-registered account cannot be invited';
end $$;
-- The accept path checks the live account too (an invitation recorded before the owner set a password).
reset role;
insert into public.clinic_members(clinic_id,user_id,role,status) values(current_setting('test.pw_clinic')::uuid,'c7100000-0000-4000-8000-000000000005','doctor','invited');
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000005');
do $$ begin
 begin perform public.respond_clinic_invitation(current_setting('test.pw_clinic')::uuid,true);
  raise exception 'Invitation accepted before the owner set a password';exception when insufficient_privilege then null;end;
end $$;
reset role;
update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('password_set_by_owner_at',now()) where id in ('c7100000-0000-4000-8000-000000000005','c7100000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000005');
do $$ begin
 assert public.respond_clinic_invitation(current_setting('test.pw_clinic')::uuid,true),'Owner-set account cannot accept';
end $$;
select pg_temp.as_user('c7100000-0000-4000-8000-000000000001');
do $$ begin
 assert public.invite_clinic_doctor(current_setting('test.pw_clinic')::uuid,'pw-legacy@example.invalid'),'Legacy account with the owner marker cannot be invited';
end $$;

-- 6. Grants of the replaced and new functions.
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.password_change_pending()','execute'),'anon executes the pending check';
 assert not has_function_privilege('authenticated','public.account_owner_verified(uuid)','execute'),'Clients probe other accounts';
 assert has_function_privilege('authenticated','public.session_assurance_ok()','execute')
    and has_function_privilege('authenticated','public.clinical_session_allowed()','execute')
    and has_function_privilege('authenticated','public.assert_session_assurance()','execute')
    and not has_function_privilege('authenticated','public.assert_clinical_actor()','execute')
    and has_function_privilege('authenticated','public.invite_clinic_doctor(uuid,text)','execute')
    and has_function_privilege('authenticated','public.respond_clinic_invitation(uuid,boolean)','execute'),'Replaced function grants changed';
end $$;
rollback;
