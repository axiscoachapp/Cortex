begin;
create function pg_temp.admin_scope_refused(command text) returns boolean language plpgsql as $$
begin execute command;raise exception 'Unexpected success' using errcode='PT001';
exception when sqlstate 'PT001' then return false;when insufficient_privilege then return true;end $$;
insert into auth.users(id,email) values
 ('ba100000-0000-4000-8000-000000000001','scope-admin@example.invalid'),
 ('ba100000-0000-4000-8000-000000000002','scope-doctor@example.invalid'),
 ('ba100000-0000-4000-8000-000000000003','scope-staff@example.invalid'),
 ('ba100000-0000-4000-8000-000000000004','scope-external@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ba200000-0000-4000-8000-000000000001','Clínica sintética escopos','ba100000-0000-4000-8000-000000000001'),
 ('ba200000-0000-4000-8000-000000000002','Outra clínica sintética','ba100000-0000-4000-8000-000000000004');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','admin','active'),
 ('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','doctor','active'),
 ('ba200000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000004','admin','active');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('ba500000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','Pessoa sintética A','novo','PRIVATE A'),
 ('ba500000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000002','Pessoa sintética B','novo','PRIVATE B');
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('ba300000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000001','Contato sintético','ba100000-0000-4000-8000-000000000001',gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
insert into public.appointments(user_id,patient_id,title,start_time,end_time) values(auth.uid(),'ba500000-0000-4000-8000-000000000001','Agenda própria A','2099-12-06T12:00Z','2099-12-06T12:30Z');
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000002',true);
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time) values('ba600000-0000-4000-8000-000000000002',auth.uid(),'ba500000-0000-4000-8000-000000000002','Agenda própria B','2099-12-06T12:00Z','2099-12-06T12:30Z');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('ba100000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000003','Recepção sintética',array['ba100000-0000-4000-8000-000000000002'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000003',true);
select public.reception_link_patient('ba300000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','ba500000-0000-4000-8000-000000000002','self');
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
do $$ declare failures text[]:='{}';r record;begin
 for r in select * from (values
 ('patient-search',$q$select public.reception_patient_search('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','Pessoa')$q$),
 ('calendar',$q$select public.reception_appointments('ba200000-0000-4000-8000-000000000001','2099-12-06','2099-12-07','ba100000-0000-4000-8000-000000000002')$q$),
 ('link',$q$select public.reception_link_patient('ba300000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','ba500000-0000-4000-8000-000000000002','self')$q$),
 ('case',$q$select public.reception_create_case('ba300000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','Novo caso sintético','scheduling',gen_random_uuid())$q$),
 ('booking',$q$select public.reception_book_appointment('ba200000-0000-4000-8000-000000000001','{"doctorId":"ba100000-0000-4000-8000-000000000002","contactId":"ba300000-0000-4000-8000-000000000001","patientId":"ba500000-0000-4000-8000-000000000002","startTime":"2099-12-06T13:00Z","endTime":"2099-12-06T13:30Z","type":"retorno"}',gen_random_uuid())$q$),
 ('cancel',$q$select public.reception_change_appointment('ba200000-0000-4000-8000-000000000001','ba600000-0000-4000-8000-000000000002',1,'cancel')$q$)
 ) x(name,command) loop
  if not pg_temp.admin_scope_refused(r.command) then failures:=array_append(failures,r.name);end if;
 end loop;
 if jsonb_array_length(public.reception_appointments('ba200000-0000-4000-8000-000000000001','2099-12-06','2099-12-07')->'items')<>1 then failures:=array_append(failures,'aggregate-calendar');end if;
 if jsonb_array_length(public.clinic_access()->'doctors')<>1 then failures:=array_append(failures,'operational-doctor-list');end if;
 assert cardinality(failures)=0,'Implicit admin scope regression: '||array_to_string(failures,', ');
end $$;
do $$ declare directory jsonb;begin
 directory:=public.reception_team_doctors('ba200000-0000-4000-8000-000000000001');
 assert jsonb_array_length(directory)=2,'Team management lost its doctor directory';
 assert not exists(select 1 from jsonb_array_elements(directory) d where d-array['id','name','specialty']<>'{}'),'Team directory leaked extra fields';
 assert jsonb_array_length(public.reception_patient_search('ba200000-0000-4000-8000-000000000001',auth.uid(),'Pessoa'))=1,'Admin own agenda lost';
end $$;
select public.update_reception_staff('ba100000-0000-4000-8000-000000000003',array['ba100000-0000-4000-8000-000000000002'::uuid],true);
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000003',true);
do $$ begin
 assert jsonb_array_length(public.reception_patient_search('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','Pessoa'))=1,'Explicit staff scope lost';
 assert (select count(*) from public.patients)=0,'Clinical chart exposed to staff';
 assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'Staff entered management directory';
end $$;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000002',true);
do $$ begin
 assert jsonb_array_length(public.reception_patient_search('ba200000-0000-4000-8000-000000000001',auth.uid(),'Pessoa'))=1,'Member own agenda lost';
 assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'Non-admin entered management directory';
end $$;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000004',true);
do $$ begin assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'External admin entered directory';end $$;
reset role;
update public.clinic_members set status='inactive' where clinic_id='ba200000-0000-4000-8000-000000000001' and user_id='ba100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
do $$ begin assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'Inactive admin entered directory';end $$;
reset role;
update public.clinic_members set status='active' where clinic_id='ba200000-0000-4000-8000-000000000001' and user_id='ba100000-0000-4000-8000-000000000001';
insert into auth.mfa_factors(user_id,status,factor_type) values('ba100000-0000-4000-8000-000000000001','verified','totp');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'Incomplete MFA entered directory';end $$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
do $$ begin assert jsonb_array_length(public.reception_team_doctors('ba200000-0000-4000-8000-000000000001'))=2,'Valid MFA lost directory';end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'Service role entered directory';
 assert not has_function_privilege('anon','public.reception_team_doctors(uuid)','execute'),'Anonymous directory access';
 assert not has_function_privilege('service_role','public.reception_team_doctors(uuid)','execute'),'Service directory bypass';
end $$;
insert into auth.users(id,email) values('ba100000-0000-4000-8000-000000000005','scope-deleting-admin@example.invalid');
insert into public.clinic_members(clinic_id,user_id,role,status) values('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000005','admin','active');
insert into public.account_deletion_requests(user_id) values('ba100000-0000-4000-8000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000005',true);
do $$ begin assert pg_temp.admin_scope_refused($q$select public.reception_team_doctors('ba200000-0000-4000-8000-000000000001')$q$),'Deleting admin entered directory';end $$;
rollback;
