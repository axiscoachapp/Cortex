begin;
insert into auth.users(id,email) values
 ('a7100000-0000-4000-8000-000000000001','array-admin@example.invalid'),
 ('a7100000-0000-4000-8000-000000000002','array-doctor@example.invalid'),
 ('a7100000-0000-4000-8000-000000000003','array-other@example.invalid'),
 ('a7100000-0000-4000-8000-000000000004','array-staff@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('a7200000-0000-4000-8000-000000000001','Synthetic legacy array clinic','a7100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status)
 select 'a7200000-0000-4000-8000-000000000001',id,case when id='a7100000-0000-4000-8000-000000000001' then 'admin' else 'doctor' end,'active'
 from auth.users where id in ('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000003');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000004','Synthetic array staff');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','Synthetic private array chart','novo','PRIVATE SYNTHETIC HISTORY');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='a7100000-0000-4000-8000-000000000001';
select set_config('test.array_request',(cortex_private.request_reception_delegation(
 'a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000004','a7100000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='a7100000-0000-4000-8000-000000000002';
select cortex_private.decide_reception_delegation(current_setting('test.array_request')::uuid,1,'approve',gen_random_uuid());
set local request.jwt.claim.sub='a7100000-0000-4000-8000-000000000001';
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values
 ('a7400000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','Synthetic array contact',auth.uid(),gen_random_uuid());
insert into public.reception_cases(id,clinic_id,contact_id,doctor_user_id,subject,kind,status,assigned_to,created_by,request_id) values
 ('a7500000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','Synthetic open array work','scheduling','assigned','a7100000-0000-4000-8000-000000000004',auth.uid(),gen_random_uuid()),
 ('a7500000-0000-4000-8000-000000000002','a7200000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','Synthetic closed array work','scheduling','resolved','a7100000-0000-4000-8000-000000000004',auth.uid(),gen_random_uuid());
set local role authenticated;
do $$ declare message text;begin
 begin
  perform public.update_reception_staff('a7100000-0000-4000-8000-000000000004',array['a7100000-0000-4000-8000-000000000003'::uuid],true);
  raise exception 'Legacy array removed physician approval';
 exception when serialization_failure then
  get stacked diagnostics message=message_text;assert message='Approved delegation requires explicit withdrawal';
 end;
end $$;
reset role;
do $$ declare message text;begin
 assert (select active from public.clinic_staff_members where user_id='a7100000-0000-4000-8000-000000000004');
 assert (select state='approved' and revision=2 from cortex_private.reception_delegation_requests where id=current_setting('test.array_request')::uuid),'Array changed physician decision';
 assert (select count(*) from public.staff_doctor_scopes where staff_user_id='a7100000-0000-4000-8000-000000000004')=1,'Rejected save changed another scope';
 assert (select delegation_request_id=current_setting('test.array_request')::uuid from public.staff_doctor_scopes where staff_user_id='a7100000-0000-4000-8000-000000000004');
 assert (select status='assigned' and assigned_to='a7100000-0000-4000-8000-000000000004' and revision=1 from public.reception_cases where id='a7500000-0000-4000-8000-000000000001'),'Rejected array released open work';
 assert not exists(select 1 from public.reception_audit where action='staff_scopes_updated' and resource_id='a7100000-0000-4000-8000-000000000004'),'Rejected save produced success audit';
 begin perform public.set_reception_scopes('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000004','{}',true);raise exception 'Internal array bypassed guard';
 exception when serialization_failure then get stacked diagnostics message=message_text;assert message='Approved delegation requires explicit withdrawal';end;
end $$;
set local role authenticated;
-- An up-to-date array is a no-op for the exact consent identity.
select public.update_reception_staff('a7100000-0000-4000-8000-000000000004',array['a7100000-0000-4000-8000-000000000002'::uuid],true);
reset role;
do $$ begin
 assert (select state='approved' and revision=2 from cortex_private.reception_delegation_requests where id=current_setting('test.array_request')::uuid),'Identical array changed consent revision/state';
 assert (select delegation_request_id=current_setting('test.array_request')::uuid from public.staff_doctor_scopes where staff_user_id='a7100000-0000-4000-8000-000000000004'),'Identical array replaced exact consent identity';
end $$;
set local role authenticated;
set local request.jwt.claim.sub='a7100000-0000-4000-8000-000000000004';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=1,'Preserved consent not effective';
 assert (select count(*) from public.patients)=0,'Array protection opened private charts';
end $$;
set local request.jwt.claim.sub='a7100000-0000-4000-8000-000000000001';
-- Explicit account deactivation is still available, including empty arrays.
select public.update_reception_staff('a7100000-0000-4000-8000-000000000004','{}',false);
reset role;
do $$ begin
 assert not (select active from public.clinic_staff_members where user_id='a7100000-0000-4000-8000-000000000004');
 assert not exists(select 1 from public.staff_doctor_scopes where staff_user_id='a7100000-0000-4000-8000-000000000004');
 assert (select state='revoked' and revision=3 and end_reason='member_inactive' from cortex_private.reception_delegation_requests where id=current_setting('test.array_request')::uuid);
 assert (select status='new' and assigned_to is null and revision=2 from public.reception_cases where id='a7500000-0000-4000-8000-000000000001');
 assert (select status='resolved' and assigned_to='a7100000-0000-4000-8000-000000000004' and revision=1 from public.reception_cases where id='a7500000-0000-4000-8000-000000000002');
 assert (select count(*) from public.reception_audit where action='case_assignment_released' and resource_id='a7500000-0000-4000-8000-000000000001')=1;
 assert (select medical_history='PRIVATE SYNTHETIC HISTORY' from public.patients where id='a7300000-0000-4000-8000-000000000001');
end $$;
set local role authenticated;
do $$ declare message text;begin
 begin perform public.update_reception_staff('a7100000-0000-4000-8000-000000000004',array['a7100000-0000-4000-8000-000000000002'::uuid],true);raise exception 'Array revived closed physician approval';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation physician approval required';end;
end $$;
reset role;
do $$ begin
 assert not (select active from public.clinic_staff_members where user_id='a7100000-0000-4000-8000-000000000004'),'Failed regrant activated account';
 assert not has_function_privilege('authenticated','public.set_reception_scopes(uuid,uuid,uuid[],boolean)','execute');
 assert not has_function_privilege('anon','public.set_reception_scopes(uuid,uuid,uuid[],boolean)','execute');
end $$;
rollback;
