begin;
insert into auth.users(id,email) values
 ('a9100000-0000-4000-8000-000000000001','identity-admin@example.invalid'),
 ('a9100000-0000-4000-8000-000000000002','identity-doctor@example.invalid'),
 ('a9100000-0000-4000-8000-000000000003','identity-other-admin@example.invalid'),
 ('a9100000-0000-4000-8000-000000000004','identity-staff@example.invalid'),
 ('a9100000-0000-4000-8000-000000000005','identity-other-staff@example.invalid'),
 ('a9100000-0000-4000-8000-000000000006','identity-external-staff@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('a9200000-0000-4000-8000-000000000001','Synthetic identity clinic','a9100000-0000-4000-8000-000000000001'),
 ('a9200000-0000-4000-8000-000000000002','Synthetic other identity clinic','a9100000-0000-4000-8000-000000000003');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','admin','active'),
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000002','doctor','active'),
 ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000003','admin','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000004','Synthetic identity staff'),
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000005','Synthetic second identity staff'),
 ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000006','Synthetic external identity staff');
-- Trusted pre-existing legacy fixture. Its provenance is not physician consent.
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000001');
set local request.jwt.claim.role='service_role';
set local role service_role;
do $$ declare statement text;message text;begin
 foreach statement in array array[
  $q$update public.staff_doctor_scopes set doctor_user_id='a9100000-0000-4000-8000-000000000002' where staff_user_id='a9100000-0000-4000-8000-000000000004'$q$,
  $q$update public.staff_doctor_scopes set staff_user_id='a9100000-0000-4000-8000-000000000005' where staff_user_id='a9100000-0000-4000-8000-000000000004'$q$,
  $q$update public.staff_doctor_scopes set clinic_id='a9200000-0000-4000-8000-000000000002',staff_user_id='a9100000-0000-4000-8000-000000000006',doctor_user_id='a9100000-0000-4000-8000-000000000003' where staff_user_id='a9100000-0000-4000-8000-000000000004'$q$
 ] loop
  begin execute statement;raise exception 'Legacy scope identity moved';
  exception when invalid_parameter_value then get stacked diagnostics message=message_text;
   assert message='Legacy delegation identity immutable';
  end;
 end loop;
end $$;
-- A no-op UPDATE and the old array's no-op must remain compatible.
update public.staff_doctor_scopes set doctor_user_id=doctor_user_id;
reset role;
set local request.jwt.claim.role='';
-- A database-owner writer without a JWT cannot retarget legacy data either.
do $$ declare message text;begin
 begin
  update public.staff_doctor_scopes set doctor_user_id='a9100000-0000-4000-8000-000000000002';
  raise exception 'Owner retargeted legacy scope';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;
  assert message='Legacy delegation identity immutable';
 end;
end $$;
do $$ begin
 assert (select count(*) from public.staff_doctor_scopes)=1;
 assert exists(select 1 from public.staff_doctor_scopes where clinic_id='a9200000-0000-4000-8000-000000000001'
  and staff_user_id='a9100000-0000-4000-8000-000000000004' and doctor_user_id='a9100000-0000-4000-8000-000000000001' and delegation_request_id is null),'Rejected retarget changed the original row';
end $$;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='a9100000-0000-4000-8000-000000000001';
set local role authenticated;
select public.update_reception_staff('a9100000-0000-4000-8000-000000000004',array['a9100000-0000-4000-8000-000000000001'::uuid],true);
reset role;
select set_config('test.identity_request',(cortex_private.request_reception_delegation('a9200000-0000-4000-8000-000000000001',
 'a9100000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000001',gen_random_uuid()))->>'id',true);
-- Actual physician approval adopts the legacy row via ON CONFLICT DO UPDATE.
select cortex_private.decide_reception_delegation(current_setting('test.identity_request')::uuid,1,'approve',gen_random_uuid());
do $$ declare message text;begin
 assert (select delegation_request_id=current_setting('test.identity_request')::uuid from public.staff_doctor_scopes where staff_user_id='a9100000-0000-4000-8000-000000000004');
 begin update public.staff_doctor_scopes set delegation_request_id=null;raise exception 'Bound scope detached';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;
  assert message='Delegation grant identity immutable';end;
 assert not has_function_privilege('authenticated','cortex_private.guard_legacy_scope_identity()','execute');
 assert not has_function_privilege('service_role','cortex_private.guard_legacy_scope_identity()','execute');
end $$;
set local role authenticated;
select public.update_reception_staff('a9100000-0000-4000-8000-000000000004','{}',false);
reset role;
do $$ begin
 assert not exists(select 1 from public.staff_doctor_scopes);
 assert (select state='revoked' from cortex_private.reception_delegation_requests where id=current_setting('test.identity_request')::uuid);
end $$;
rollback;
