begin;
insert into auth.users(id,email) values
 ('e1100000-0000-4000-8000-000000000001','request-admin@example.invalid'),
 ('e1100000-0000-4000-8000-000000000002','request-admin-two@example.invalid'),
 ('e1100000-0000-4000-8000-000000000003','request-doctor@example.invalid'),
 ('e1100000-0000-4000-8000-000000000004','request-other@example.invalid'),
 ('e1100000-0000-4000-8000-000000000005','request-staff@example.invalid'),
 ('e1100000-0000-4000-8000-000000000006','request-foreign@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('e1200000-0000-4000-8000-000000000001','Synthetic request clinic','e1100000-0000-4000-8000-000000000001'),
 ('e1200000-0000-4000-8000-000000000002','Synthetic other clinic','e1100000-0000-4000-8000-000000000006');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','admin','active'),
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002','admin','active'),
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000003','doctor','active'),
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000004','doctor','active'),
 ('e1200000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000006','admin','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','Synthetic request reception');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('e1300000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000003','Synthetic private chart','novo','PRIVATE SYNTHETIC HISTORY');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
select set_config('test.request_first',(cortex_private.request_reception_delegation(
 'e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003','e1400000-0000-4000-8000-000000000001'))->>'id',true);
do $$ declare r jsonb;message text;begin
 r:=cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003','e1400000-0000-4000-8000-000000000001');
 assert r=jsonb_build_object('id',current_setting('test.request_first'),'state','pending','revision',1,'capabilityVersion','clinic_reception_v1'),'Unexpected private request DTO';
 r:=cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003','e1400000-0000-4000-8000-000000000002');
 assert r->>'id'=current_setting('test.request_first'),'Concurrent-pair identity changed';
 assert (select count(*) from cortex_private.reception_delegation_requests)=1;
 assert (select count(*) from cortex_private.reception_delegation_operations)=2;
 assert (select count(*) from public.staff_doctor_scopes)=0,'Pending request granted a scope';
 begin
  perform cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000004','e1400000-0000-4000-8000-000000000001');
  raise exception 'Operation payload changed';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation operation mismatch';end;
 begin
  perform cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000006',gen_random_uuid());
  raise exception 'Foreign clinic accepted';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation administration unavailable';end;
 begin
  update cortex_private.reception_delegation_requests set doctor_user_id='e1100000-0000-4000-8000-000000000004',revision=revision+1 where id=current_setting('test.request_first')::uuid;
  raise exception 'Request retargeted';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation identity or transition invalid';end;
 begin
  update cortex_private.reception_delegation_requests set state='approved',revision=revision+1 where id=current_setting('test.request_first')::uuid;
  raise exception 'Approval accidentally enabled';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation identity or transition invalid';end;
 begin delete from cortex_private.reception_delegation_requests;raise exception 'History deleted';
 exception when invalid_parameter_value then get stacked diagnostics message=message_text;assert message='Delegation history immutable';end;
end $$;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000003';
do $$ declare message text;begin
 begin perform cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003',gen_random_uuid());raise exception 'Non-admin requested delegation';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Delegation administration unavailable';end;
end $$;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
insert into auth.mfa_factors(id,user_id,status,factor_type) values('e1500000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','verified','totp');
do $$ declare message text;begin
 begin perform cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003',gen_random_uuid());raise exception 'Missing MFA accepted';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Verifique o segundo fator da sessão';end;
end $$;
delete from auth.mfa_factors where id='e1500000-0000-4000-8000-000000000001';
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000002';
do $$ declare a jsonb;b jsonb;message text;begin
 a:=cortex_private.cancel_reception_delegation(current_setting('test.request_first')::uuid,1,'e1400000-0000-4000-8000-000000000003');
 b:=cortex_private.cancel_reception_delegation(current_setting('test.request_first')::uuid,1,'e1400000-0000-4000-8000-000000000003');
 assert a=b and a->>'state'='cancelled' and a->>'revision'='2','Cancellation retry changed result';
 begin perform cortex_private.cancel_reception_delegation(current_setting('test.request_first')::uuid,1,gen_random_uuid());raise exception 'Terminal request reopened';
 exception when serialization_failure then get stacked diagnostics message=message_text;assert message='Delegation changed';end;
 begin perform public.assert_deletion_scope('e1100000-0000-4000-8000-000000000002');raise exception 'Canceller custody omitted';
 exception when sqlstate 'P4092' then null;end;
end $$;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
do $$ declare message text;begin
 begin perform cortex_private.request_reception_delegation('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003','e1400000-0000-4000-8000-000000000002');raise exception 'Alias operation recreated terminal request';
 exception when serialization_failure then get stacked diagnostics message=message_text;assert message='Delegation changed';end;
end $$;
select set_config('test.request_second',(cortex_private.request_reception_delegation(
 'e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003',gen_random_uuid()))->>'id',true);
update public.clinic_staff_members set active=false where user_id='e1100000-0000-4000-8000-000000000005';
update public.clinic_staff_members set active=true where user_id='e1100000-0000-4000-8000-000000000005';
do $$ begin
 assert current_setting('test.request_first')<>current_setting('test.request_second');
 assert (select state='cancelled' and revision=2 and ended_by is null and end_reason='member_inactive' from cortex_private.reception_delegation_requests where id=current_setting('test.request_second')::uuid),'Pending staff lifecycle not closed';
end $$;
select set_config('test.request_third',(cortex_private.request_reception_delegation(
 'e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000003',gen_random_uuid()))->>'id',true);
update public.clinic_members set status='inactive' where clinic_id='e1200000-0000-4000-8000-000000000001' and user_id='e1100000-0000-4000-8000-000000000003';
update public.clinic_members set status='active' where clinic_id='e1200000-0000-4000-8000-000000000001' and user_id='e1100000-0000-4000-8000-000000000003';
do $$ declare p regprocedure;role_name text;begin
 assert (select state='cancelled' and revision=2 from cortex_private.reception_delegation_requests where id=current_setting('test.request_third')::uuid),'Pending doctor lifecycle not closed';
 assert (select medical_history='PRIVATE SYNTHETIC HISTORY' from public.patients where id='e1300000-0000-4000-8000-000000000001');
 assert public.assert_deletion_scope('e1100000-0000-4000-8000-000000000003','e1300000-0000-4000-8000-000000000001'),'Private patient deletion widened to administrative account custody';
 for p in select oid::regprocedure from pg_proc where pronamespace='cortex_private'::regnamespace and proname like '%reception_delegation%' loop
  foreach role_name in array array['anon','authenticated','service_role'] loop
   assert not has_function_privilege(role_name,p,'execute'),'Request foundation exposed a private helper';
  end loop;
 end loop;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000005';
do $$ begin
 assert (select count(*) from public.patients)=0,'Request foundation opened a clinical chart';
 assert jsonb_array_length(public.clinic_access()->'doctors')=0,'Request foundation granted an agenda';
 begin perform cortex_private.request_reception_delegation(null,null,null,null);raise exception 'Client invoked private writer';exception when insufficient_privilege then null;end;
end $$;
rollback;
