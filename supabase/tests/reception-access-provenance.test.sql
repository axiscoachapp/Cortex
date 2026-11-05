-- Synthetic SQL claims/role fixture, not Native Auth.
begin;
insert into auth.users(id,email) values
 ('ab310000-0000-4000-8000-000000000001','origin-admin@example.invalid'),
 ('ab310000-0000-4000-8000-000000000002','origin-approved@example.invalid'),
 ('ab310000-0000-4000-8000-000000000003','origin-legacy@example.invalid'),
 ('ab310000-0000-4000-8000-000000000004','origin-staff@example.invalid'),
 ('ab310000-0000-4000-8000-000000000005','origin-outsider@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ab320000-0000-4000-8000-000000000001','Synthetic origin clinic','ab310000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000001','admin','active'),
 ('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000002','doctor','active'),
 ('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000003','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004','Synthetic origin reception');
-- Existing legacy grant, created by the privileged historical path, never inferred as consent.
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004','ab310000-0000-4000-8000-000000000003');
set local request.jwt.claim.role='authenticated';set local request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000001';set local role authenticated;
select set_config('test.origin_request',(public.reception_request_delegation('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004','ab310000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000002';
select public.reception_decide_delegation(current_setting('test.origin_request')::uuid,1,'approve',gen_random_uuid());
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000001';
-- RED calls the not-yet-existing public reader.
do $$ declare p jsonb;n jsonb;begin
 p:=public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004',null,1);
 assert jsonb_array_length(p->'items')=1 and p#>>'{items,0,source}'='physician_approval';
 assert p#>>'{items,0,requestId}'=current_setting('test.origin_request') and p#>>'{items,0,effective}'='true';
 assert (select array_agg(k order by k) from jsonb_object_keys(p->'items'->0) k)=array['doctorId','doctorName','effective','requestId','source'];
 n:=public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004',(p->>'nextCursor')::uuid,1);
 assert n#>>'{items,0,source}'='legacy' and n#>>'{items,0,requestId}' is null and n#>>'{items,0,effective}'='true';
 assert n->'nextCursor'='null'::jsonb and n#>>'{items,0,doctorId}'<>p#>>'{items,0,doctorId}';
 begin perform public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004',null,101);raise exception 'Unbounded page';exception when invalid_parameter_value then null;end;
 begin perform public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001',gen_random_uuid());raise exception 'Unknown staff exposed';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000002';
do $$ begin begin perform public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004');raise exception 'Doctor read team provenance';exception when insufficient_privilege then null;end;end $$;
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000004';
do $$ begin begin perform public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001',auth.uid());raise exception 'Reception read provenance';exception when insufficient_privilege then null;end;end $$;
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000005';
do $$ begin begin perform public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004');raise exception 'Outsider read provenance';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$ declare r text;begin
 assert (select count(*) from public.staff_doctor_scopes where staff_user_id='ab310000-0000-4000-8000-000000000004')=2,'Reader changed grants';
 assert (select state='approved' and revision=2 from cortex_private.reception_delegation_requests where id=current_setting('test.origin_request')::uuid);
 foreach r in array array['anon','service_role'] loop assert not has_function_privilege(r,'public.reception_staff_permissions(uuid,uuid,uuid,integer)','execute');end loop;
end $$;
-- Inactivation remains canonical; this reader neither restores nor reconciles.
set local request.jwt.claim.sub='ab310000-0000-4000-8000-000000000001';set local role authenticated;
select public.update_reception_staff('ab310000-0000-4000-8000-000000000004','{}'::uuid[],false);
do $$ begin assert jsonb_array_length(public.reception_staff_permissions('ab320000-0000-4000-8000-000000000001','ab310000-0000-4000-8000-000000000004')->'items')=0;end $$;
rollback;
