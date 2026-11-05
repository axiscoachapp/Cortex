-- Synthetic claims/SET ROLE fixture, no Native Auth or real records.
begin;
insert into auth.users(id,email) values
 ('ab410000-0000-4000-8000-000000000001','withdraw-admin@example.invalid'),
 ('ab410000-0000-4000-8000-000000000002','withdraw-doctor@example.invalid'),
 ('ab410000-0000-4000-8000-000000000003','withdraw-staff@example.invalid'),
 ('ab410000-0000-4000-8000-000000000004','withdraw-outsider@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ab420000-0000-4000-8000-000000000001','Synthetic withdrawal clinic','ab410000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ab420000-0000-4000-8000-000000000001','ab410000-0000-4000-8000-000000000001','admin','active'),
 ('ab420000-0000-4000-8000-000000000001','ab410000-0000-4000-8000-000000000002','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('ab420000-0000-4000-8000-000000000001','ab410000-0000-4000-8000-000000000003','Synthetic withdrawal reception');
set local request.jwt.claim.role='authenticated';set local request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000001';set local role authenticated;
select set_config('test.withdraw_old',(public.reception_request_delegation('ab420000-0000-4000-8000-000000000001','ab410000-0000-4000-8000-000000000003','ab410000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000002';
select public.reception_decide_delegation(current_setting('test.withdraw_old')::uuid,1,'approve',gen_random_uuid());
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000001';
-- RED: missing new reader; the existing writer is not replaced.
do $$ declare r jsonb;begin
 r:=public.reception_delegation_withdrawal(current_setting('test.withdraw_old')::uuid);
 assert r->>'id'=current_setting('test.withdraw_old') and r->>'state'='approved' and r->>'revision'='2';
 assert r->>'clinicId'='ab420000-0000-4000-8000-000000000001' and r->>'staffId'='ab410000-0000-4000-8000-000000000003';
 assert (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['capabilityVersion','clinicId','clinicName','doctorId','doctorName','id','revision','staffId','staffName','state'];
 begin perform public.reception_revoke_delegation(current_setting('test.withdraw_old')::uuid,3,gen_random_uuid());raise exception 'Wrong revision accepted';exception when serialization_failure then null;end;
end $$;
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000002';
do $$ begin begin perform public.reception_delegation_withdrawal(current_setting('test.withdraw_old')::uuid);raise exception 'Non-admin doctor read admin review';exception when insufficient_privilege then null;end;end $$;
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000003';
do $$ begin begin perform public.reception_delegation_withdrawal(current_setting('test.withdraw_old')::uuid);raise exception 'Staff read review';exception when insufficient_privilege then null;end;end $$;
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000004';
do $$ begin begin perform public.reception_delegation_withdrawal(current_setting('test.withdraw_old')::uuid);raise exception 'Outsider read review';exception when insufficient_privilege then null;end;end $$;
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000001';
select public.reception_revoke_delegation(current_setting('test.withdraw_old')::uuid,2,'ab440000-0000-4000-8000-000000000001');
do $$ begin begin perform public.reception_delegation_withdrawal(current_setting('test.withdraw_old')::uuid);raise exception 'Old review still available';exception when insufficient_privilege then null;end;end $$;
select set_config('test.withdraw_new',(public.reception_request_delegation('ab420000-0000-4000-8000-000000000001','ab410000-0000-4000-8000-000000000003','ab410000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000002';
select public.reception_decide_delegation(current_setting('test.withdraw_new')::uuid,1,'approve',gen_random_uuid());
set local request.jwt.claim.sub='ab410000-0000-4000-8000-000000000001';
do $$ declare r jsonb;begin
 r:=public.reception_revoke_delegation(current_setting('test.withdraw_old')::uuid,2,'ab440000-0000-4000-8000-000000000001');
 assert r->>'state'='revoked' and r->>'id'=current_setting('test.withdraw_old');
 begin perform public.reception_revoke_delegation(current_setting('test.withdraw_old')::uuid,2,gen_random_uuid());raise exception 'Stale new operation accepted';exception when serialization_failure then null;end;
 assert public.reception_delegation_withdrawal(current_setting('test.withdraw_new')::uuid)->>'id'=current_setting('test.withdraw_new');
end $$;
reset role;
do $$ declare r text;begin
 assert exists(select 1 from public.staff_doctor_scopes where delegation_request_id=current_setting('test.withdraw_new')::uuid),'Old replay removed newer approval';
 foreach r in array array['anon','service_role'] loop assert not has_function_privilege(r,'public.reception_delegation_withdrawal(uuid)','execute');end loop;
end $$;
rollback;
