-- Synthetic SET ROLE/claims fixture; no Native Auth or real patient data.
begin;
insert into auth.users(id,email) values
 ('ab210000-0000-4000-8000-000000000001','reactivate-admin@example.invalid'),
 ('ab210000-0000-4000-8000-000000000002','reactivate-doctor@example.invalid'),
 ('ab210000-0000-4000-8000-000000000003','reactivate-staff@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ab220000-0000-4000-8000-000000000001','Synthetic reactivation clinic','ab210000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ab220000-0000-4000-8000-000000000001','ab210000-0000-4000-8000-000000000001','admin','active'),
 ('ab220000-0000-4000-8000-000000000001','ab210000-0000-4000-8000-000000000002','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('ab220000-0000-4000-8000-000000000001','ab210000-0000-4000-8000-000000000003','Synthetic reception');
insert into public.patients(id,user_id,name,status) values
 ('ab230000-0000-4000-8000-000000000001','ab210000-0000-4000-8000-000000000002','Synthetic private chart','novo');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000001';set local role authenticated;
select set_config('test.reactivation_old',(public.reception_request_delegation('ab220000-0000-4000-8000-000000000001','ab210000-0000-4000-8000-000000000003','ab210000-0000-4000-8000-000000000002','ab240000-0000-4000-8000-000000000001'))->>'id',true);
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000002';
select public.reception_decide_delegation(current_setting('test.reactivation_old')::uuid,1,'approve','ab240000-0000-4000-8000-000000000002');
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000003';
do $$ begin assert jsonb_array_length(public.clinic_access()->'doctors')=1;end $$;
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000001';
do $$ begin assert public.update_reception_staff('ab210000-0000-4000-8000-000000000003','{}'::uuid[],false);end $$;
-- The exact existing public RPC/payload now used by the reactivation button.
do $$ begin assert public.update_reception_staff('ab210000-0000-4000-8000-000000000003','{}'::uuid[],true);end $$;
do $$ begin assert public.update_reception_staff('ab210000-0000-4000-8000-000000000003','{}'::uuid[],true);end $$;
reset role;
do $$ begin
 assert (select active from public.clinic_staff_members where user_id='ab210000-0000-4000-8000-000000000003');
 assert not exists(select 1 from public.staff_doctor_scopes where staff_user_id='ab210000-0000-4000-8000-000000000003');
 assert (select state='revoked' from cortex_private.reception_delegation_requests where id=current_setting('test.reactivation_old')::uuid);
end $$;
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000003';set local role authenticated;
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=0,'Empty-scope reactivation restored access';
 assert (select count(*) from public.patients)=0;
 begin perform public.update_reception_staff(auth.uid(),'{}'::uuid[],true);raise exception 'Reception reactivated itself';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000002';
do $$ begin
 begin perform public.update_reception_staff('ab210000-0000-4000-8000-000000000003','{}'::uuid[],true);raise exception 'Doctor reactivated staff';exception when insufficient_privilege then null;end;
 begin perform public.reception_decide_delegation(current_setting('test.reactivation_old')::uuid,1,'approve','ab240000-0000-4000-8000-000000000002');raise exception 'Old approval revived';exception when serialization_failure then null;end;
end $$;
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000001';
select set_config('test.reactivation_new',(public.reception_request_delegation('ab220000-0000-4000-8000-000000000001','ab210000-0000-4000-8000-000000000003','ab210000-0000-4000-8000-000000000002',gen_random_uuid()))->>'id',true);
do $$ begin assert current_setting('test.reactivation_new')<>current_setting('test.reactivation_old');end $$;
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000002';
select public.reception_decide_delegation(current_setting('test.reactivation_new')::uuid,1,'approve',gen_random_uuid());
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000003';
do $$ begin assert jsonb_array_length(public.clinic_access()->'doctors')=1;assert (select count(*) from public.patients)=0;end $$;
-- A stale empty array must not withdraw the later physician approval.
set local request.jwt.claim.sub='ab210000-0000-4000-8000-000000000001';
do $$ begin begin perform public.update_reception_staff('ab210000-0000-4000-8000-000000000003','{}'::uuid[],true);raise exception 'Stale reactivation withdrew approval';exception when serialization_failure then null;end;end $$;
reset role;
do $$ begin assert exists(select 1 from public.staff_doctor_scopes where delegation_request_id=current_setting('test.reactivation_new')::uuid);end $$;
rollback;
