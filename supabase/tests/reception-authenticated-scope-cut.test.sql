begin;
insert into auth.users(id,email) values
 ('a8100000-0000-4000-8000-000000000001','cut-admin@example.invalid'),
 ('a8100000-0000-4000-8000-000000000002','cut-doctor@example.invalid'),
 ('a8100000-0000-4000-8000-000000000003','cut-staff@example.invalid'),
 ('a8100000-0000-4000-8000-000000000004','cut-other-staff@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('a8200000-0000-4000-8000-000000000001','Synthetic authenticated cut','a8100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','admin','active'),
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000003','Synthetic cut staff');
-- Pre-existing unreviewed grant: retained here only to prove compatibility,
-- not converted to consent or used as a production backfill.
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000003','a8100000-0000-4000-8000-000000000001');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='a8100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare message text;begin
 begin
  perform public.update_reception_staff('a8100000-0000-4000-8000-000000000003',array['a8100000-0000-4000-8000-000000000002'::uuid],true);
  raise exception 'Authenticated legacy writer granted access';
 exception when insufficient_privilege then
  get stacked diagnostics message=message_text;
  assert message='Authenticated legacy delegation requires physician approval';
 end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from public.staff_doctor_scopes where staff_user_id='a8100000-0000-4000-8000-000000000003')=1;
 assert exists(select 1 from public.staff_doctor_scopes where staff_user_id='a8100000-0000-4000-8000-000000000003' and doctor_user_id='a8100000-0000-4000-8000-000000000001' and delegation_request_id is null);
 assert not exists(select 1 from public.reception_audit where resource_id='a8100000-0000-4000-8000-000000000003' and action='staff_scopes_updated'),'Rejected save produced an audit';
end $$;
set local role authenticated;
-- ON CONFLICT DO NOTHING must remain a genuine no-op; AFTER INSERT, not BEFORE.
select public.update_reception_staff('a8100000-0000-4000-8000-000000000003',array['a8100000-0000-4000-8000-000000000001'::uuid],true);
select public.update_reception_staff('a8100000-0000-4000-8000-000000000003','{}',true);
do $$ declare message text;begin
 begin
  perform public.update_reception_staff('a8100000-0000-4000-8000-000000000003',array['a8100000-0000-4000-8000-000000000001'::uuid],true);
  raise exception 'Authenticated legacy writer restored access';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Authenticated legacy delegation requires physician approval';end;
end $$;
reset role;
-- Caller impersonation is not a client option: this is a trusted database
-- fixture proving the row guard covers the helper as well as the public RPC.
do $$ declare message text;begin
 begin
  perform public.set_reception_scopes('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000003',array['a8100000-0000-4000-8000-000000000002'::uuid],true);
  raise exception 'Internal setter bypassed authenticated cut';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Authenticated legacy delegation requires physician approval';end;
end $$;
select set_config('test.cut_request',(cortex_private.request_reception_delegation('a8200000-0000-4000-8000-000000000001',
 'a8100000-0000-4000-8000-000000000003','a8100000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='a8100000-0000-4000-8000-000000000002';
select cortex_private.decide_reception_delegation(current_setting('test.cut_request')::uuid,1,'approve',gen_random_uuid());
set local role authenticated;
set local request.jwt.claim.sub='a8100000-0000-4000-8000-000000000001';
select public.update_reception_staff('a8100000-0000-4000-8000-000000000003',array['a8100000-0000-4000-8000-000000000002'::uuid],true);
reset role;
do $$ begin
 assert (select state='approved' and revision=2 from cortex_private.reception_delegation_requests where id=current_setting('test.cut_request')::uuid);
 assert (select delegation_request_id=current_setting('test.cut_request')::uuid from public.staff_doctor_scopes where staff_user_id='a8100000-0000-4000-8000-000000000003');
end $$;
set local role authenticated;
select public.update_reception_staff('a8100000-0000-4000-8000-000000000003','{}',false);
reset role;
do $$ begin
 assert not (select active from public.clinic_staff_members where user_id='a8100000-0000-4000-8000-000000000003');
 assert not exists(select 1 from public.staff_doctor_scopes where staff_user_id='a8100000-0000-4000-8000-000000000003');
 assert (select state='revoked' from cortex_private.reception_delegation_requests where id=current_setting('test.cut_request')::uuid);
end $$;
-- Explicit remaining boundary: the service provisioning path is a later cut.
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('a8100000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000004','Synthetic service boundary',array['a8100000-0000-4000-8000-000000000002'::uuid]);
reset role;
do $$ begin
 assert exists(select 1 from public.staff_doctor_scopes where staff_user_id='a8100000-0000-4000-8000-000000000004' and delegation_request_id is null),'Service boundary changed unexpectedly';
 assert not has_function_privilege('authenticated','cortex_private.guard_authenticated_legacy_scope()','execute');
 assert not has_function_privilege('service_role','cortex_private.guard_authenticated_legacy_scope()','execute');
end $$;
rollback;
