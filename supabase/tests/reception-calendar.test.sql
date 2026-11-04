begin;
insert into auth.users(id,email) values
 ('c1000000-0000-4000-8000-000000000001','calendar-admin@example.invalid'),
 ('c1000000-0000-4000-8000-000000000002','calendar-staff@example.invalid'),
 ('c1000000-0000-4000-8000-000000000003','calendar-foreign-doctor@example.invalid'),
 ('c1000000-0000-4000-8000-000000000004','calendar-second-doctor@example.invalid');
insert into public.patients(id,user_id,name,status) values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Paciente legado','novo');
insert into public.appointments(id,user_id,patient_id,title,notes,start_time,end_time,status) values
 ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','PRIVATE TITLE','PRIVATE CLINICAL NOTE','2099-11-01T12:00Z','2099-11-01T12:30Z','agendado');
insert into public.appointments(id,user_id,title,start_time,end_time,status) values('c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000003','FOREIGN PRIVATE TITLE','2099-11-01T13:00Z','2099-11-01T13:30Z','agendado');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select set_config('test.calendar_clinic',public.create_clinic('Clínica Agenda')::text,true);
select public.invite_clinic_doctor(current_setting('test.calendar_clinic')::uuid,'calendar-second-doctor@example.invalid');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
select public.respond_clinic_invitation(current_setting('test.calendar_clinic')::uuid,true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
do $$ begin
 assert jsonb_array_length(public.reception_appointments(current_setting('test.calendar_clinic')::uuid,'2099-11-01','2099-11-02',null)->'items')=1,'Clinic admin read a foreign legacy calendar';
 begin perform public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,'c3000000-0000-4000-8000-000000000002',1,'cancel',null,null);raise exception 'Clinic admin cancelled foreign appointment';exception when insufficient_privilege then null;end;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','Secretária Agenda',array['c1000000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select set_config('test.calendar_contact',public.reception_create_contact(current_setting('test.calendar_clinic')::uuid,'Responsável Exemplo','41999990000','c4000000-0000-4000-8000-000000000001')::text,true);
select public.reception_link_patient(current_setting('test.calendar_contact')::uuid,'c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','self');
select set_config('test.calendar_case',public.reception_create_case(current_setting('test.calendar_contact')::uuid,'c1000000-0000-4000-8000-000000000001','Retorno administrativo','return','c4000000-0000-4000-8000-000000000007')::text,true);
do $$ declare data jsonb; booking jsonb; id uuid; revision integer; begin
 data:=public.reception_appointments(current_setting('test.calendar_clinic')::uuid,'2099-11-01','2099-11-02',null);
 assert position('PRIVATE' in data::text)=0,'Legacy appointment clinical text leaked';
 assert jsonb_array_length(data->'items')=0,'Delegation exposed an appointment without clinic origin';
 booking:=jsonb_build_object('doctorId','c1000000-0000-4000-8000-000000000001','contactId',current_setting('test.calendar_contact'),
  'patientId','c2000000-0000-4000-8000-000000000001','caseId',current_setting('test.calendar_case'),'startTime','2099-11-01T13:00:00Z','endTime','2099-11-01T13:30:00Z','type','retorno');
 id:=public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking,'c4000000-0000-4000-8000-000000000002');
 assert id=public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking,'c4000000-0000-4000-8000-000000000002'),'Booking retry duplicated';
 begin perform public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking||'{"startTime":"2099-11-01T13:10:00Z"}','c4000000-0000-4000-8000-000000000002');raise exception 'Booking request reused with other content';exception when invalid_parameter_value then null;end;
 begin perform public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking||'{"startTime":"2099-11-01T12:10:00Z","endTime":"2099-11-01T12:40:00Z"}','c4000000-0000-4000-8000-000000000003');raise exception 'Conflicting legacy interval booked';exception when exclusion_violation then null;end;
 revision:=public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,id,1,'reschedule','2099-11-01T14:00Z','2099-11-01T14:30Z');
 assert revision=2,'Appointment revision missing';
 begin perform public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,id,1,'cancel',null,null);raise exception 'Stale appointment cancelled';exception when serialization_failure then null;end;
 perform public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,id,2,'check_in',null,null);
 assert (select count(*) from public.appointments)=0,'Reception raw access widened';
 perform set_config('test.booked_id',id::text,true);
end $$;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
do $$ declare booked_id uuid:=current_setting('test.booked_id')::uuid; begin
 assert (select checked_in_at is not null and created_by='c1000000-0000-4000-8000-000000000002' and user_id=auth.uid() from public.appointments where appointments.id=booked_id),'Actor collapsed into doctor or check-in lost';
 assert (select status='novo' from public.patients where patients.id='c2000000-0000-4000-8000-000000000001'),'Check-in changed clinical patient status';
 begin update public.appointments set start_time='2099-11-01T12:05Z',end_time='2099-11-01T12:25Z' where appointments.id=booked_id;raise exception 'Legacy writer bypassed conflict guard';exception when exclusion_violation then null;end;
 begin update public.appointments set created_by=auth.uid() where appointments.id=booked_id;raise exception 'Actor forged by owner write';exception when insufficient_privilege then null;end;
 begin delete from public.appointments where appointments.id=booked_id;raise exception 'CRM appointment history erased';exception when insufficient_privilege then null;end;
end $$;
-- Routing across doctors requires an explicitly scoped receptionist, not the admin role.
-- Trusted pre-existing scope fixture for cross-doctor routing. Client creation
-- of this unreviewed scope is independently refused by the cutover suite.
reset role;
set local request.jwt.claim.role='service_role';
select public.set_reception_scopes(current_setting('test.calendar_clinic')::uuid,'c1000000-0000-4000-8000-000000000002',array['c1000000-0000-4000-8000-000000000001'::uuid,'c1000000-0000-4000-8000-000000000004'::uuid],true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select public.reception_update_case(current_setting('test.calendar_case')::uuid,1,'claim','{}');
select public.reception_update_case(current_setting('test.calendar_case')::uuid,2,'route','{"doctorId":"c1000000-0000-4000-8000-000000000004"}');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,current_setting('test.booked_id')::uuid,3,'cancel',null,null);
select set_config('test.calendar_block',public.reception_block_time(current_setting('test.calendar_clinic')::uuid,'c1000000-0000-4000-8000-000000000001','2099-11-01T16:00Z','2099-11-01T17:00Z','Indisponível','c4000000-0000-4000-8000-000000000004')::text,true);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$ declare booking jsonb; booked uuid; begin
 booking:=jsonb_build_object('doctorId','c1000000-0000-4000-8000-000000000001','contactId',current_setting('test.calendar_contact'),
 'patientId',null,'beneficiaryName','Novo Cadastro Privado','dateOfBirth','2000-01-01','relationship','guardian','startTime','2099-11-01T16:00:00Z','endTime','2099-11-01T16:30:00Z','type','novo');
 begin perform public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking,'c4000000-0000-4000-8000-000000000005');raise exception 'Schedule block bypassed';exception when exclusion_violation then null;end;
 booking:=booking||'{"startTime":"2099-11-01T17:00:00Z","endTime":"2099-11-01T17:30:00Z"}';
 booked:=public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking,'c4000000-0000-4000-8000-000000000006');
 assert booked=public.reception_book_appointment(current_setting('test.calendar_clinic')::uuid,booking,'c4000000-0000-4000-8000-000000000006'),'First-cadastro retry duplicated';
 begin perform public.reception_unblock_time(current_setting('test.calendar_block')::uuid,1);raise exception 'Staff removed admin block';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
do $$ begin
 assert (select count(*) from public.patients where name='Novo Cadastro Privado')=1,'Failed/duplicate bookings left private patient stubs';
 assert (select status='cancelado' from public.appointments where id=current_setting('test.booked_id')::uuid),'Case reroute prevented cancellation of original appointment';
end $$;
select public.reception_unblock_time(current_setting('test.calendar_block')::uuid,1);
select public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,'c3000000-0000-4000-8000-000000000001',1,'confirm',null,null);
do $$ begin
 begin update public.appointments set id=gen_random_uuid() where id='c3000000-0000-4000-8000-000000000001';raise exception 'Legacy audit identity replaced';exception when insufficient_privilege then null;end;
 begin delete from public.appointments where id='c3000000-0000-4000-8000-000000000001';raise exception 'Legacy audited appointment deleted';exception when insufficient_privilege then null;end;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.assert_deletion_scope('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001');raise exception 'CRM custody passed destructive preflight';exception when sqlstate 'P4092' then null;end;
 begin perform public.assert_deletion_scope('c1000000-0000-4000-8000-000000000002',null);raise exception 'Staff history passed destructive preflight';exception when sqlstate 'P4092' then null;end;
 begin perform public.reception_change_appointment(current_setting('test.calendar_clinic')::uuid,current_setting('test.booked_id')::uuid,3,'cancel',null,null);raise exception 'Service bot scheduled on behalf of human';exception when insufficient_privilege then null;end;
end $$;
rollback;
