begin;
insert into auth.users(id,email) values
 ('d6100000-0000-4000-8000-000000000001','decision-admin@example.invalid'),
 ('d6100000-0000-4000-8000-000000000002','decision-doctor@example.invalid'),
 ('d6100000-0000-4000-8000-000000000003','decision-other@example.invalid'),
 ('d6100000-0000-4000-8000-000000000004','decision-staff@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('d6200000-0000-4000-8000-000000000001','Synthetic decision clinic','d6100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status)
 select 'd6200000-0000-4000-8000-000000000001',id,case when id='d6100000-0000-4000-8000-000000000001' then 'admin' else 'doctor' end,'active'
 from auth.users where id in ('d6100000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000002','d6100000-0000-4000-8000-000000000003');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','Synthetic decision staff');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000002','Synthetic private decision chart','novo','PRIVATE SYNTHETIC HISTORY');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
-- Legacy adoption is explicit: creating the request does not bind the grant.
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002');
select set_config('test.decision_request',(cortex_private.request_reception_delegation(
 'd6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
-- RED is a missing real private decision function, not a prototype assertion.
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000002';
select cortex_private.decide_reception_delegation(current_setting('test.decision_request')::uuid,1,'approve','d6400000-0000-4000-8000-000000000001');
do $$ declare r jsonb;message text;begin
 r:=cortex_private.decide_reception_delegation(current_setting('test.decision_request')::uuid,1,'approve','d6400000-0000-4000-8000-000000000001');
 assert r->>'state'='approved' and r->>'revision'='2';
 assert (select count(*) from cortex_private.reception_delegation_operations where request_id=current_setting('test.decision_request')::uuid)=2,'Retry duplicated decision';
 assert (select delegation_request_id=current_setting('test.decision_request')::uuid from public.staff_doctor_scopes where doctor_user_id=auth.uid()),'Approval missing bound grant';
 begin perform cortex_private.decide_reception_delegation(current_setting('test.decision_request')::uuid,1,'approve',gen_random_uuid());raise exception 'Stale CAS reused approval';exception when serialization_failure then null;end;
 begin perform cortex_private.decide_reception_delegation(current_setting('test.decision_request')::uuid,1,'deny','d6400000-0000-4000-8000-000000000001');raise exception 'Payload mismatch accepted';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation operation mismatch';end;
 begin update public.staff_doctor_scopes set delegation_request_id=null where doctor_user_id=auth.uid();raise exception 'Bound grant detached';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation grant identity immutable';end;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000004';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=1,'Approved grant not operational';
 assert (select count(*) from public.patients)=0,'Administrative consent opened private charts';
 begin perform cortex_private.decide_reception_delegation(null,null,null,null);raise exception 'Private decision callable by client';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values
 ('d6600000-0000-4000-8000-000000000001','d6200000-0000-4000-8000-000000000001','Synthetic decision contact',auth.uid(),gen_random_uuid());
insert into public.reception_cases(id,clinic_id,contact_id,doctor_user_id,subject,kind,status,assigned_to,created_by,request_id) values
 ('d6700000-0000-4000-8000-000000000001','d6200000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000002','Synthetic open work','scheduling','assigned','d6100000-0000-4000-8000-000000000004',auth.uid(),gen_random_uuid()),
 ('d6700000-0000-4000-8000-000000000002','d6200000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000002','Synthetic closed work','scheduling','resolved','d6100000-0000-4000-8000-000000000004',auth.uid(),gen_random_uuid());
do $$ declare message text;begin
 begin perform cortex_private.decide_reception_delegation(current_setting('test.decision_request')::uuid,2,'deny',gen_random_uuid());raise exception 'Admin decided for doctor';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation physician unavailable';end;
end $$;
-- The old setter may preserve an already approved scope, but cannot restore
-- one after it closes. Its public grant-creation cutover is still separate.
select public.set_reception_scopes('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004',array['d6100000-0000-4000-8000-000000000002'::uuid],true);
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000003';
do $$ declare message text;begin
 begin perform cortex_private.revoke_reception_delegation(current_setting('test.decision_request')::uuid,2,gen_random_uuid());raise exception 'Other doctor revoked';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation administration unavailable';end;
end $$;
-- Direct scope removal closes consent, including privileged writers. No reuse.
set local request.jwt.claim.sub='';
delete from public.staff_doctor_scopes where doctor_user_id='d6100000-0000-4000-8000-000000000002';
do $$ declare message text;begin
 assert (select state='revoked' and revision=3 and end_reason='scope_removed' and ended_by is null from cortex_private.reception_delegation_requests where id=current_setting('test.decision_request')::uuid);
 assert (select assigned_to is null and status='new' and revision=2 and doctor_user_id='d6100000-0000-4000-8000-000000000002' from public.reception_cases where id='d6700000-0000-4000-8000-000000000001'),'Open work not released exactly once';
 assert (select assigned_to='d6100000-0000-4000-8000-000000000004' and status='resolved' and revision=1 from public.reception_cases where id='d6700000-0000-4000-8000-000000000002'),'Closed history changed on revocation';
 assert (select count(*) from public.reception_audit where resource_id='d6700000-0000-4000-8000-000000000001' and action='case_assignment_released')=1,'Assignment release duplicated';
 begin insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id,delegation_request_id) values('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002',current_setting('test.decision_request')::uuid);raise exception 'Terminal approval reused';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation physician approval required';end;
 begin insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002');raise exception 'Legacy writer bypassed revocation';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation physician approval required';end;
end $$;
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000002';
do $$ begin
 begin perform cortex_private.decide_reception_delegation(current_setting('test.decision_request')::uuid,1,'approve','d6400000-0000-4000-8000-000000000001');raise exception 'Old retry restored access';exception when serialization_failure then null;end;
end $$;
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
do $$ declare message text;begin
 begin perform public.set_reception_scopes('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004',array['d6100000-0000-4000-8000-000000000002'::uuid],true);raise exception 'Old setter restored withdrawn approval';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation physician approval required';end;
end $$;
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
select set_config('test.decision_second',(cortex_private.request_reception_delegation('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000002';
insert into auth.mfa_factors(id,user_id,status,factor_type) values('d6500000-0000-4000-8000-000000000001',auth.uid(),'verified','totp');
do $$ declare message text;begin
 begin perform cortex_private.decide_reception_delegation(current_setting('test.decision_second')::uuid,1,'deny',gen_random_uuid());raise exception 'Missing MFA accepted';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Verifique o segundo fator da sessão';end;
end $$;
delete from auth.mfa_factors where id='d6500000-0000-4000-8000-000000000001';
select cortex_private.decide_reception_delegation(current_setting('test.decision_second')::uuid,1,'deny','d6400000-0000-4000-8000-000000000002');
select cortex_private.decide_reception_delegation(current_setting('test.decision_second')::uuid,1,'deny','d6400000-0000-4000-8000-000000000002');
do $$ begin
 assert not exists(select 1 from public.staff_doctor_scopes where doctor_user_id=auth.uid());
 assert current_setting('test.decision_second')<>current_setting('test.decision_request'),'New request reused old UUID';
 begin perform public.assert_deletion_scope(auth.uid());raise exception 'Decision omitted from custody';exception when sqlstate 'P4092' then null;end;
 assert public.assert_deletion_scope(auth.uid(),'d6300000-0000-4000-8000-000000000001');
end $$;
-- Approval of a previously untouched legacy grant requires the actual doctor.
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000003');
select set_config('test.decision_third',(cortex_private.request_reception_delegation('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000003',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000003';
select cortex_private.decide_reception_delegation(current_setting('test.decision_third')::uuid,1,'deny',gen_random_uuid());
do $$ begin assert not exists(select 1 from public.staff_doctor_scopes),'Denial left legacy access';end $$;
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
select set_config('test.decision_fourth',(cortex_private.request_reception_delegation('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000002';
select cortex_private.decide_reception_delegation(current_setting('test.decision_fourth')::uuid,1,'approve',gen_random_uuid());
select cortex_private.revoke_reception_delegation(current_setting('test.decision_fourth')::uuid,2,'d6400000-0000-4000-8000-000000000003');
select cortex_private.revoke_reception_delegation(current_setting('test.decision_fourth')::uuid,2,'d6400000-0000-4000-8000-000000000003');
do $$ begin assert not exists(select 1 from public.staff_doctor_scopes);end $$;
-- An admin who is the target physician decides only their own request.
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
select set_config('test.decision_self',(cortex_private.request_reception_delegation('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000001',gen_random_uuid()))->>'id',true);
select cortex_private.decide_reception_delegation(current_setting('test.decision_self')::uuid,1,'approve',gen_random_uuid());
select cortex_private.revoke_reception_delegation(current_setting('test.decision_self')::uuid,2,gen_random_uuid());
-- Lifecycle ends both request and grant; rejoining does not revive either.
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000001';
select set_config('test.decision_fifth',(cortex_private.request_reception_delegation('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='d6100000-0000-4000-8000-000000000002';
select cortex_private.decide_reception_delegation(current_setting('test.decision_fifth')::uuid,1,'approve',gen_random_uuid());
update public.clinic_staff_members set active=false where user_id='d6100000-0000-4000-8000-000000000004';
update public.clinic_staff_members set active=true where user_id='d6100000-0000-4000-8000-000000000004';
do $$ declare p regprocedure;role_name text;begin
 assert (select state='revoked' and revision=3 and end_reason='member_inactive' and ended_by is null from cortex_private.reception_delegation_requests where id=current_setting('test.decision_fifth')::uuid);
 assert not exists(select 1 from public.staff_doctor_scopes);
 assert (select medical_history='PRIVATE SYNTHETIC HISTORY' from public.patients where id='d6300000-0000-4000-8000-000000000001');
 for p in select oid::regprocedure from pg_proc where pronamespace='cortex_private'::regnamespace and (proname like '%reception_delegation%' or proname like '%delegation_scope%') loop
  foreach role_name in array array['anon','authenticated','service_role'] loop assert not has_function_privilege(role_name,p,'execute'),'Private consent function exposed';end loop;
 end loop;
end $$;
rollback;
