-- Synthetic historical rows isolate each restrictive reference; no real deletion.
begin;
insert into auth.users(id,email) values
 ('b8100000-0000-4000-8000-000000000001','custody-admin@example.invalid'),
 ('b8100000-0000-4000-8000-000000000002','custody-solo@example.invalid'),
 ('b8100000-0000-4000-8000-000000000003','custody-scope@example.invalid'),
 ('b8100000-0000-4000-8000-000000000004','custody-case@example.invalid'),
 ('b8100000-0000-4000-8000-000000000005','custody-block@example.invalid'),
 ('b8100000-0000-4000-8000-000000000006','custody-confirmer@example.invalid'),
 ('b8100000-0000-4000-8000-000000000007','custody-owner@example.invalid'),
 ('b8100000-0000-4000-8000-000000000008','custody-staff@example.invalid'),
 ('b8100000-0000-4000-8000-000000000009','custody-deleting@example.invalid'),
 ('b8100000-0000-4000-8000-000000000010','custody-booking-owner@example.invalid');
insert into public.clinics(id,name,created_by) values('b8200000-0000-4000-8000-000000000001','Clínica sintética custódia','b8100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status)
 select 'b8200000-0000-4000-8000-000000000001',id,case when email in ('custody-admin@example.invalid','custody-deleting@example.invalid') then 'admin' else 'doctor' end,'active'
 from auth.users where id in ('b8100000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000003','b8100000-0000-4000-8000-000000000004','b8100000-0000-4000-8000-000000000005','b8100000-0000-4000-8000-000000000006','b8100000-0000-4000-8000-000000000007','b8100000-0000-4000-8000-000000000009');
insert into public.clinic_staff_members(user_id,clinic_id,name) values('b8100000-0000-4000-8000-000000000008','b8200000-0000-4000-8000-000000000001','Recepção sintética');
insert into public.staff_doctor_scopes values('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000008','b8100000-0000-4000-8000-000000000003');
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('b8300000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001','Contato sintético','b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001');
insert into public.reception_cases(id,clinic_id,contact_id,doctor_user_id,subject,kind,status,created_by,request_id) values('b8400000-0000-4000-8000-000000000002','b8200000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000004','Caso sintético encerrado','scheduling','resolved','b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000003');
insert into public.reception_schedule_blocks(clinic_id,doctor_user_id,start_time,end_time,reason,created_by,request_id) values('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000005','2099-12-01T12:00Z','2099-12-01T13:00Z','Bloqueio sintético','b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000004');
insert into public.patients(id,user_id,name,status) values('b8500000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000007','Paciente sintético','novo');
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values('b8200000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000007','self','b8100000-0000-4000-8000-000000000006');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000002',true);
insert into public.appointments(user_id,title,start_time,end_time) values(auth.uid(),'Agenda própria sintética','2099-12-01T12:00Z','2099-12-01T12:30Z');
update public.appointments set notes='Edição própria sintética' where user_id=auth.uid();
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000010',true);
insert into public.appointments(id,user_id,title,start_time,end_time) values('b8600000-0000-4000-8000-000000000001',auth.uid(),'Agenda com referência sintética','2099-12-01T12:00Z','2099-12-01T12:30Z');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
-- Historical booking FK alone still preserves administrative custody.
insert into public.reception_booking_requests(clinic_id,actor_user_id,request_id,payload,appointment_id) values('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000006','{}','b8600000-0000-4000-8000-000000000001');
do $$ declare failures text[]:='{}'; r record; begin
 begin perform public.assert_deletion_scope('b8100000-0000-4000-8000-000000000002',null);
 exception when sqlstate 'P4092' then failures:=array_append(failures,'own-calendar-blocked');end;
 for r in select * from (values
  ('scope','b8100000-0000-4000-8000-000000000003'::uuid),
  ('resolved-case','b8100000-0000-4000-8000-000000000004'::uuid),
  ('schedule-block','b8100000-0000-4000-8000-000000000005'::uuid),
  ('confirmation-author','b8100000-0000-4000-8000-000000000006'::uuid)) x(kind,id) loop
  begin perform public.assert_deletion_scope(r.id,null);failures:=array_append(failures,r.kind||'-allowed');
  exception when sqlstate 'P4092' then null;end;
 end loop;
 assert cardinality(failures)=0,'Deletion custody regression: '||array_to_string(failures,', ');
end $$;
do $$ declare r record; begin
 for r in select id from auth.users where id in ('b8100000-0000-4000-8000-000000000003','b8100000-0000-4000-8000-000000000004','b8100000-0000-4000-8000-000000000005','b8100000-0000-4000-8000-000000000006') loop
  begin insert into public.account_deletion_requests(user_id) values(r.id);raise exception 'Unsafe deletion intent persisted';exception when sqlstate 'P4092' then null;end;
  assert not exists(select 1 from public.account_deletion_requests where user_id=r.id),'Blocked intent was retained';
 end loop;
end $$;
-- A fresh public read/write must refuse the target after its intent is visible.
-- This does not simulate an in-flight transaction or a privileged direct writer.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000009',true);
select public.reception_patient_search('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000009','Paciente');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
insert into public.account_deletion_requests(user_id) values('b8100000-0000-4000-8000-000000000009');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  perform public.update_reception_staff('b8100000-0000-4000-8000-000000000008',array['b8100000-0000-4000-8000-000000000009'::uuid],true);
  raise exception 'Deleting doctor delegation was accepted';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000009',true);
 begin
  perform public.reception_patient_search('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000009','Paciente');
  raise exception 'Deleting doctor remained searchable';
 exception when sqlstate '42501' then null;end;
 begin
  perform public.reception_create_case('b8300000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000009','Caso novo sintético','scheduling','b8400000-0000-4000-8000-000000000005');
  raise exception 'New case for deleting doctor was accepted';
 exception when sqlstate '42501' then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare failures text[]:='{}';begin
 begin perform public.assert_deletion_scope('b8100000-0000-4000-8000-000000000010',null);
  failures:=array_append(failures,'booking-reference-allowed');
 exception when sqlstate 'P4092' then null;end;
 if exists(select 1 from public.staff_doctor_scopes where doctor_user_id='b8100000-0000-4000-8000-000000000009') then
  failures:=array_append(failures,'deleting-doctor-delegation-allowed');
 end if;
 assert cardinality(failures)=0,'Additional custody regression: '||array_to_string(failures,', ');
 assert not exists(select 1 from public.reception_cases where doctor_user_id='b8100000-0000-4000-8000-000000000009'),'Rejected request left a case';
end $$;
-- Prove the actual synthetic cascade, including both authored-by FKs, not just preflight.
insert into public.account_deletion_requests(user_id) values('b8100000-0000-4000-8000-000000000002');
delete from auth.users where id='b8100000-0000-4000-8000-000000000002';
do $$ begin
 assert not exists(select 1 from public.appointments where user_id='b8100000-0000-4000-8000-000000000002'),'Own appointment cascade failed';
 assert exists(select 1 from public.reception_cases where id='b8400000-0000-4000-8000-000000000002'),'Foreign administrative history lost';
end $$;
rollback;
