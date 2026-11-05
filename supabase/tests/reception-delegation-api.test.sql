-- Synthetic SQL role/claim fixture, not Native Auth HTTP evidence.
begin;
insert into auth.users(id,email) values
 ('ab110000-0000-4000-8000-000000000001','api-admin@example.invalid'),
 ('ab110000-0000-4000-8000-000000000002','api-doctor@example.invalid'),
 ('ab110000-0000-4000-8000-000000000003','api-other@example.invalid'),
 ('ab110000-0000-4000-8000-000000000004','api-staff@example.invalid'),
 ('ab110000-0000-4000-8000-000000000005','api-foreign@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ab120000-0000-4000-8000-000000000001','Synthetic API clinic','ab110000-0000-4000-8000-000000000001'),
 ('ab120000-0000-4000-8000-000000000002','Synthetic foreign clinic','ab110000-0000-4000-8000-000000000005');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000001','admin','active'),
 ('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000002','doctor','active'),
 ('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000003','doctor','active'),
 ('ab120000-0000-4000-8000-000000000002','ab110000-0000-4000-8000-000000000005','admin','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000004','Synthetic reception');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('ab130000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000002','Synthetic chart','novo','SYNTHETIC PRIVATE');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000001';
set local role authenticated;
-- RED: the public authenticated surface does not exist yet.
select set_config('test.api_request',(public.reception_request_delegation('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000004','ab110000-0000-4000-8000-000000000002','ab140000-0000-4000-8000-000000000001'))->>'id',true);
do $$ declare page jsonb;begin
 page:=public.reception_delegation_requests('ab120000-0000-4000-8000-000000000001');
 assert page->>'canManage'='true' and jsonb_array_length(page->'items')=1;
 assert page#>>'{items,0,state}'='pending' and page#>>'{items,0,effective}'='false';
 assert page#>>'{items,0,canDecide}'='false' and page#>>'{items,0,canCancel}'='true';
 begin perform public.reception_decide_delegation(current_setting('test.api_request')::uuid,1,'approve',gen_random_uuid());raise exception 'Admin approved for doctor';exception when insufficient_privilege then null;end;
 begin perform cortex_private.request_reception_delegation(null,null,null,null);raise exception 'Private helper exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin assert not exists(select 1 from public.staff_doctor_scopes where clinic_id='ab120000-0000-4000-8000-000000000001');end $$;
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000003';set local role authenticated;
do $$ begin
 assert jsonb_array_length(public.reception_delegation_requests()->'items')=0;
 begin perform public.reception_decide_delegation(current_setting('test.api_request')::uuid,1,'approve',gen_random_uuid());raise exception 'Other doctor approved';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000005';
do $$ begin begin perform public.reception_delegation_requests('ab120000-0000-4000-8000-000000000001');raise exception 'Foreign clinic exposed';exception when insufficient_privilege then null;end;end $$;
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000002';
do $$ declare page jsonb;r jsonb;begin
 page:=public.reception_delegation_requests();assert page->>'canManage'='false' and page#>>'{items,0,canDecide}'='true';
 assert (select array_agg(k order by k) from jsonb_object_keys(page->'items'->0) k)=array['canCancel','canDecide','canRevoke','capabilityVersion','clinicId','clinicName','createdAt','doctorId','doctorName','effective','id','revision','staffId','staffName','state'];
 r:=public.reception_decide_delegation(current_setting('test.api_request')::uuid,1,'approve','ab140000-0000-4000-8000-000000000002');assert r->>'state'='approved' and r->>'revision'='2';
 assert public.reception_decide_delegation(current_setting('test.api_request')::uuid,1,'approve','ab140000-0000-4000-8000-000000000002')=r;
 assert public.reception_delegation_requests()#>>'{items,0,effective}'='true';
 begin perform public.reception_decide_delegation(current_setting('test.api_request')::uuid,1,'approve',gen_random_uuid());raise exception 'Stale decision accepted';exception when serialization_failure then null;end;
 begin perform public.reception_decide_delegation(current_setting('test.api_request')::uuid,1,'deny','ab140000-0000-4000-8000-000000000002');raise exception 'Operation payload changed';exception when invalid_parameter_value then null;end;
end $$;
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000004';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=1;
 assert (select count(*) from public.patients)=0,'Consent exposed chart';
 begin perform public.reception_delegation_requests();raise exception 'Reception read private requests';exception when insufficient_privilege then null;end;
 begin perform public.reception_request_delegation('ab120000-0000-4000-8000-000000000001',auth.uid(),'ab110000-0000-4000-8000-000000000002',gen_random_uuid());raise exception 'Reception self-granted';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000002';
select public.reception_revoke_delegation(current_setting('test.api_request')::uuid,2,gen_random_uuid());
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000004';
do $$ begin assert jsonb_array_length(public.clinic_access()->'doctors')=0;end $$;
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000001';
select set_config('test.api_denied',(public.reception_request_delegation('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000004','ab110000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000002';
select public.reception_decide_delegation(current_setting('test.api_denied')::uuid,1,'deny',gen_random_uuid());
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000001';
select set_config('test.api_cancel',(public.reception_request_delegation('ab120000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000004','ab110000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
select public.reception_cancel_delegation(current_setting('test.api_cancel')::uuid,1,gen_random_uuid());
do $$ declare first_page jsonb;second_page jsonb;begin
 first_page:=public.reception_delegation_requests('ab120000-0000-4000-8000-000000000001',null,null,1);
 assert jsonb_array_length(first_page->'items')=1 and first_page->'nextCursor'<>'null'::jsonb;
 second_page:=public.reception_delegation_requests('ab120000-0000-4000-8000-000000000001',(first_page#>>'{nextCursor,createdAt}')::timestamptz,(first_page#>>'{nextCursor,id}')::uuid,1);
 assert second_page#>>'{items,0,id}'<>first_page#>>'{items,0,id}';
 begin perform public.reception_delegation_requests(null,null,gen_random_uuid(),1);raise exception 'Half cursor accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_delegation_requests(null,null,null,101);raise exception 'Unbounded read';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$ declare f regprocedure;r text;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('reception_delegation_requests','reception_request_delegation','reception_decide_delegation','reception_cancel_delegation','reception_revoke_delegation') loop
  assert has_function_privilege('authenticated',f,'execute');
  foreach r in array array['anon','service_role'] loop assert not has_function_privilege(r,f,'execute'),'Unexpected direct/default grant';end loop;
 end loop;
 assert not has_table_privilege('authenticated','cortex_private.reception_delegation_requests','select');
 assert not exists(select 1 from public.staff_doctor_scopes where clinic_id='ab120000-0000-4000-8000-000000000001');
end $$;
-- A separate account has no retained administrative custody to block deletion.
insert into auth.users(id,email) values('ab110000-0000-4000-8000-000000000006','api-deleting@example.invalid');
insert into public.account_deletion_requests(user_id) values('ab110000-0000-4000-8000-000000000006');
set local request.jwt.claim.sub='ab110000-0000-4000-8000-000000000006';set local role authenticated;
do $$ begin begin perform public.reception_delegation_requests();raise exception 'Deleting actor read requests';exception when insufficient_privilege then null;end;end $$;
rollback;
