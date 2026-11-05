begin;
insert into auth.users(id,email) values
 ('e1100000-0000-4000-8000-000000000001','window-owner@example.invalid'),
 ('e1100000-0000-4000-8000-000000000002','window-staff@example.invalid'),
 ('e1100000-0000-4000-8000-000000000003','window-colleague@example.invalid'),
 ('e1100000-0000-4000-8000-000000000004','window-foreign@example.invalid');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
select set_config('test.window.clinic',public.create_clinic('Clínica sintética janela')::text,true);
select public.invite_clinic_doctor(current_setting('test.window.clinic')::uuid,'window-colleague@example.invalid');
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000003';
select public.respond_clinic_invitation(current_setting('test.window.clinic')::uuid,true);
-- A non-admin clinician does not have the clinic-wide contact creation API.
-- Seed this negative-control record explicitly as the disposable database owner.
reset role;
insert into public.patients(id,user_id,name,status) values('e1200000-0000-4000-8000-000000000003',auth.uid(),'Pessoa sintética C','novo');
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('e1400000-0000-4000-8000-000000000003',current_setting('test.window.clinic')::uuid,'Contato sintético C',auth.uid(),gen_random_uuid());
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values(current_setting('test.window.clinic')::uuid,'e1400000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000003',auth.uid(),'self',auth.uid());
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,clinic_id,contact_id) values('e1500000-0000-4000-8000-000000000003',auth.uid(),'e1200000-0000-4000-8000-000000000003','Synthetic undelegated control','2099-12-15T12:00Z','2099-12-15T12:30Z',current_setting('test.window.clinic')::uuid,'e1400000-0000-4000-8000-000000000003');
select set_config('test.window.booking_c','e1500000-0000-4000-8000-000000000003',true);
set local role authenticated;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000004';
select set_config('test.window.foreign_clinic',public.create_clinic('Clínica sintética externa')::text,true);
select set_config('test.window.contact_b',public.reception_create_contact(current_setting('test.window.foreign_clinic')::uuid,'Contato sintético B','',gen_random_uuid())::text,true);
select set_config('test.window.booking_b',public.reception_book_appointment(current_setting('test.window.foreign_clinic')::uuid,jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.window.contact_b'),'beneficiaryName','Pessoa sintética B','dateOfBirth','2000-01-01','relationship','self','startTime','2099-12-15T12:00Z','endTime','2099-12-15T12:30Z','type','novo'),gen_random_uuid())::text,true);
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
select set_config('test.window.contact_a',public.reception_create_contact(current_setting('test.window.clinic')::uuid,'Contato sintético A','',gen_random_uuid())::text,true);
select set_config('test.window.booking_a',public.reception_book_appointment(current_setting('test.window.clinic')::uuid,jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.window.contact_a'),'beneficiaryName','Pessoa sintética A','dateOfBirth','2000-01-01','relationship','self','startTime','2099-12-15T12:00Z','endTime','2099-12-15T12:30Z','type','novo'),gen_random_uuid())::text,true);
select set_config('test.window.patient_a',(select patient_id::text from public.appointments where id=current_setting('test.window.booking_a')::uuid),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('e1100000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002','Recepção sintética janela',array['e1100000-0000-4000-8000-000000000001'::uuid]);
reset role;
set local request.jwt.claim.role='authenticated';
-- Seed corruption only in this owned disposable transaction, not through an app writer.
alter table public.appointments disable trigger zz_reception_appointment_guard;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000003';
update public.appointments set start_time='2099-12-10T03:00Z',end_time='2099-12-10T03:00Z' where id=current_setting('test.window.booking_c')::uuid;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000004';
update public.appointments set start_time='2099-12-10T03:00Z',end_time='2099-12-10T03:00Z' where id=current_setting('test.window.booking_b')::uuid;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
insert into public.appointments(id,user_id,patient_id,title,notes,start_time,end_time,clinic_id,contact_id,status)
select ('e1300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,auth.uid(),current_setting('test.window.patient_a')::uuid,'PRIVATE SYNTHETIC TITLE','PRIVATE SYNTHETIC NOTE',starts,ends,current_setting('test.window.clinic')::uuid,current_setting('test.window.contact_a')::uuid,state
from (values
 (1,'2099-12-10T03:00Z'::timestamptz,'2099-12-10T03:00Z'::timestamptz,'agendado'),
 (2,'2099-12-10T03:10Z'::timestamptz,'2099-12-10T02:50Z'::timestamptz,'confirmado'),
 (3,'2099-12-10T04:00Z'::timestamptz,'-infinity'::timestamptz,'cancelado'),
 (4,'2099-12-10T02:59:59.999999Z'::timestamptz,'2099-12-10T02:59:59.999999Z'::timestamptz,'agendado'),
 (5,'2099-12-11T03:00Z'::timestamptz,'2099-12-11T03:00Z'::timestamptz,'agendado'),
 (6,'2099-12-11T04:00Z'::timestamptz,'2099-12-10T02:00Z'::timestamptz,'agendado'),
 (7,'2099-12-10T03:00Z'::timestamptz,'2099-12-10T03:00Z'::timestamptz,null),
 (8,'2099-12-10T02:30Z'::timestamptz,'2099-12-10T03:30Z'::timestamptz,'agendado'),
 (9,'2099-12-10T05:00Z'::timestamptz,'2099-12-10T05:30Z'::timestamptz,'realizado'),
 (11,'-infinity'::timestamptz,'2099-12-10T02:00Z'::timestamptz,'agendado')
) fixture(n,starts,ends,state);
insert into public.appointments(id,user_id,title,start_time,end_time,status) values
 ('e1300000-0000-4000-8000-000000000010',auth.uid(),'PRIVATE ORIGIN SYNTHETIC','2099-12-10T03:00Z','2099-12-10T03:00Z','agendado');
alter table public.appointments enable trigger zz_reception_appointment_guard;
set local role authenticated;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000002';
do $$ declare result jsonb; items jsonb; n integer; expected_id uuid; filtered jsonb;begin
 result:=public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10T03:00Z','2099-12-11T03:00Z');items:=result->'items';
 assert exists(select 1 from jsonb_array_elements(items) x where x->>'id'='e1300000-0000-4000-8000-000000000001'),'Zero interval at lower bound was hidden';
 foreach n in array array[1,2,3,8,9] loop
  expected_id:=('e1300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  assert exists(select 1 from jsonb_array_elements(items) x where (x->>'id')::uuid=expected_id),'Expected window record missing';
 end loop;
 assert jsonb_array_length(items)=5,'Boundary, origin, null-status or undelegated row leaked';
 assert position('PRIVATE' in result::text)=0,'Private title or note leaked';
 assert (select count(*) from public.patients)=0,'Reception gained chart access';
 filtered:=public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10T03:00Z','2099-12-11T03:00Z','e1100000-0000-4000-8000-000000000001');
 assert filtered=result,'Doctor filter changed the authorized result';
 assert jsonb_array_length(public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-11T03:00Z','2099-12-12T03:00Z')->'items')=2,'Upper bound is not exclusive or following window lost its own starts';
 begin perform public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10','2099-12-11','e1100000-0000-4000-8000-000000000003');raise exception 'Undelegated doctor accepted';exception when insufficient_privilege then null;end;
 begin perform public.reception_appointments(current_setting('test.window.foreign_clinic')::uuid,'2099-12-10','2099-12-11');raise exception 'Foreign clinic accepted';exception when insufficient_privilege then null;end;
 begin perform public.reception_appointments(current_setting('test.window.clinic')::uuid,'-infinity','2099-12-11');raise exception 'Unbounded start accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10','2100-02-01');raise exception 'Window beyond42days accepted';exception when invalid_parameter_value then null;end;
end $$;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
do $$ declare items jsonb;begin
 items:=public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10T03:00Z','2099-12-11T03:00Z')->'items';
 assert jsonb_array_length(items)=6,'Owner gained another doctor agenda or lost own private origin';
 assert exists(select 1 from jsonb_array_elements(items) x where x->>'id'='e1300000-0000-4000-8000-000000000010'),'Owner private legacy row missing';
 assert (select clinic_id is null from public.appointments where id='e1300000-0000-4000-8000-000000000010'),'Reader assigned clinic origin';
end $$;
-- The additional branch participates in the existing result cap, never truncates silently.
reset role;
alter table public.appointments disable trigger zz_reception_appointment_guard;
insert into public.appointments(user_id,patient_id,title,start_time,end_time,clinic_id,contact_id,status)
select 'e1100000-0000-4000-8000-000000000001',current_setting('test.window.patient_a')::uuid,'Synthetic capped boundary','2099-12-10T03:00Z','2099-12-10T03:00Z',current_setting('test.window.clinic')::uuid,current_setting('test.window.contact_a')::uuid,'cancelado' from generate_series(1,995);
alter table public.appointments enable trigger zz_reception_appointment_guard;
set local role authenticated;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000002';
do $$ begin
 assert jsonb_array_length(public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10T03:00Z','2099-12-11T03:00Z')->'items')=1000,'Exact1000 boundary was truncated or rejected';
end $$;
reset role;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
alter table public.appointments disable trigger zz_reception_appointment_guard;
insert into public.appointments(user_id,patient_id,title,start_time,end_time,clinic_id,contact_id,status)
values(auth.uid(),current_setting('test.window.patient_a')::uuid,'Synthetic1001st boundary','2099-12-10T03:00Z','2099-12-10T03:00Z',current_setting('test.window.clinic')::uuid,current_setting('test.window.contact_a')::uuid,'cancelado');
alter table public.appointments enable trigger zz_reception_appointment_guard;
set local role authenticated;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000002';
do $$ begin
 begin perform public.reception_appointments(current_setting('test.window.clinic')::uuid,'2099-12-10T03:00Z','2099-12-11T03:00Z');raise exception 'Result cap was bypassed';exception when invalid_parameter_value then null;end;
end $$;
rollback;
