begin;
insert into auth.users(id,email) select ('f8100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'provision-request-'||n||'@example.invalid' from generate_series(1,7)n;
insert into public.clinics(id,name,created_by) values
 ('f8200000-0000-4000-8000-000000000001','Synthetic provisioning clinic','f8100000-0000-4000-8000-000000000001'),
 ('f8200000-0000-4000-8000-000000000002','Synthetic external provisioning clinic','f8100000-0000-4000-8000-000000000006');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','admin','active'),
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000002','doctor','active'),
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000003','admin','active'),
 ('f8200000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000006','admin','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','Synthetic provision staff'),
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','Synthetic other provision staff'),
 ('f8200000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000007','Synthetic external provision staff');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000002','Synthetic private provision chart','novo','SYNTHETIC PRIVATE HISTORY');
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
-- RED: the actual private service request factory is absent in the predecessor.
select set_config('test.provision_request',(cortex_private.request_provisioned_reception_delegation(
 'f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001'))->>'id',true);
do $$ declare r jsonb;begin
 r:=cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001');
 assert r->>'id'=current_setting('test.provision_request') and r->>'state'='pending';
 assert (select count(*) from cortex_private.reception_delegation_operations where request_id=current_setting('test.provision_request')::uuid)=1,'Retry duplicated operation';
 assert (select request_source='staff_provisioning' and requested_by='f8100000-0000-4000-8000-000000000001' and state='pending' and revision=1 from cortex_private.reception_delegation_requests where id=current_setting('test.provision_request')::uuid);
 assert not exists(select 1 from public.staff_doctor_scopes),'Service request granted access';
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001');raise exception 'Operation payload rebound';exception when invalid_parameter_value then null;end;
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000003',gen_random_uuid());raise exception 'Other service admin adopted request';exception when serialization_failure then null;end;
 begin update cortex_private.reception_delegation_requests set state='approved',revision=2,decided_by=doctor_user_id,decided_at=clock_timestamp() where id=current_setting('test.provision_request')::uuid;raise exception 'Service approved request';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f8100000-0000-4000-8000-000000000004';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=0,'Pending source exposed a doctor';
 assert (select count(*) from public.patients)=0,'Pending source exposed private chart';
end $$;
reset role;
set local request.jwt.claim.sub='f8100000-0000-4000-8000-000000000003';
-- A later human alias records its own actor, preserving original provenance.
select cortex_private.request_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002',gen_random_uuid());
do $$ begin
 assert (select request_source='staff_provisioning' and requested_by='f8100000-0000-4000-8000-000000000001' from cortex_private.reception_delegation_requests where id=current_setting('test.provision_request')::uuid),'Human alias replaced provenance';
 begin insert into cortex_private.reception_delegation_requests(clinic_id,staff_user_id,doctor_user_id,requested_by,request_source)
  values('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','staff_provisioning');
  raise exception 'Human forged service origin';exception when insufficient_privilege then null;end;
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001',gen_random_uuid());raise exception 'Human called service factory';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='f8100000-0000-4000-8000-000000000002';
do $$ declare message text;begin
 begin update cortex_private.reception_delegation_requests set request_source='human_request',state='approved',revision=2,decided_by=auth.uid(),decided_at=clock_timestamp() where id=current_setting('test.provision_request')::uuid;raise exception 'Decision changed source';exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation request source immutable';end;
end $$;
select cortex_private.decide_reception_delegation(current_setting('test.provision_request')::uuid,1,'approve',gen_random_uuid());
set local request.jwt.claim.role='service_role';
do $$ declare r jsonb;begin
 r:=cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001');
 assert r->>'id'=current_setting('test.provision_request') and r->>'state'='approved' and r->>'revision'='2';
 assert (select count(*) from public.staff_doctor_scopes where delegation_request_id=current_setting('test.provision_request')::uuid)=1,'Replay changed physician grant';
end $$;
set local request.jwt.claim.role='authenticated';
select cortex_private.revoke_reception_delegation(current_setting('test.provision_request')::uuid,2,gen_random_uuid());
set local request.jwt.claim.role='service_role';
do $$ begin
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001');raise exception 'Replay reopened terminal request';exception when serialization_failure then null;end;
 assert not exists(select 1 from public.staff_doctor_scopes);
end $$;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f8100000-0000-4000-8000-000000000003';
select cortex_private.request_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000002',gen_random_uuid());
set local request.jwt.claim.role='service_role';
do $$ begin
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000003',gen_random_uuid());raise exception 'Service adopted human origin';exception when serialization_failure then null;end;
 assert not has_function_privilege('service_role','cortex_private.request_provisioned_reception_delegation(uuid,uuid,uuid,uuid,uuid)','execute');
 assert not has_function_privilege('authenticated','cortex_private.request_provisioned_reception_delegation(uuid,uuid,uuid,uuid,uuid)','execute');
 assert not has_function_privilege('anon','cortex_private.request_provisioned_reception_delegation(uuid,uuid,uuid,uuid,uuid)','execute');
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000006',gen_random_uuid());raise exception 'External admin requested access';exception when insufficient_privilege then null;end;
end $$;
-- A legacy grant is a reconciliation conflict, never silently adopted/deleted.
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000001');
do $$ declare message text;begin
 begin perform cortex_private.request_provisioned_reception_delegation('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001',gen_random_uuid());raise exception 'Service adopted legacy grant';exception when serialization_failure then get stacked diagnostics message=message_text;assert message='Delegation requires reconciliation';end;
 assert exists(select 1 from public.staff_doctor_scopes where staff_user_id='f8100000-0000-4000-8000-000000000005');
 assert not exists(select 1 from cortex_private.reception_delegation_requests where staff_user_id='f8100000-0000-4000-8000-000000000005' and doctor_user_id='f8100000-0000-4000-8000-000000000001');
end $$;
rollback;
