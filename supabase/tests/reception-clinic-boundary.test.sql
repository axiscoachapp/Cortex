begin;
insert into auth.users(id,email) values
 ('cb100000-0000-4000-8000-000000000001','boundary-doctor@example.invalid'),
 ('cb100000-0000-4000-8000-000000000002','boundary-staff@example.invalid'),
 ('cb100000-0000-4000-8000-000000000003','boundary-other@example.invalid');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('cb200000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','Pessoa sintética origem','novo','PRIVATE SYNTHETIC HISTORY');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='cb100000-0000-4000-8000-000000000001';
select set_config('test.boundary_clinic',public.create_clinic('Clínica sintética origem')::text,true);
insert into public.appointments(id,user_id,patient_id,title,notes,start_time,end_time) values
 ('cb300000-0000-4000-8000-000000000001',auth.uid(),'cb200000-0000-4000-8000-000000000001','PRIVATE SYNTHETIC TITLE','PRIVATE SYNTHETIC NOTE','2099-12-11T12:00Z','2099-12-11T12:30Z');
select set_config('test.boundary_block',public.reception_block_time(current_setting('test.boundary_clinic')::uuid,auth.uid(),'2099-12-11T16:00Z','2099-12-11T17:00Z','Indisponível',gen_random_uuid())::text,true);
set local request.jwt.claim.sub='cb100000-0000-4000-8000-000000000003';
select set_config('test.boundary_other_clinic',public.create_clinic('Outra clínica sintética origem')::text,true);
insert into public.appointments(id,user_id,title,start_time,end_time) values
 ('cb300000-0000-4000-8000-000000000002',auth.uid(),'PRIVATE OTHER TITLE','2099-12-11T12:00Z','2099-12-11T12:30Z');
select set_config('test.boundary_other_contact',public.reception_create_contact(current_setting('test.boundary_other_clinic')::uuid,'Outro contato sintético','41999990001',gen_random_uuid())::text,true);
select set_config('test.boundary_other_booking',public.reception_book_appointment(current_setting('test.boundary_other_clinic')::uuid,
 jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.boundary_other_contact'),'beneficiaryName','Outra pessoa sintética','dateOfBirth','2000-01-01','relationship','self','startTime','2099-12-11T13:00Z','endTime','2099-12-11T13:30Z','type','novo'),gen_random_uuid())::text,true);
reset role;
-- An old administrative event is not authority to assign this appointment.
insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details) values
 (current_setting('test.boundary_clinic')::uuid,'cb100000-0000-4000-8000-000000000001','appointment_confirm','cb300000-0000-4000-8000-000000000001','{"revision":1}');
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('cb100000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000002','Recepção sintética origem',array['cb100000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='cb100000-0000-4000-8000-000000000002';
select set_config('test.boundary_contact',public.reception_create_contact(current_setting('test.boundary_clinic')::uuid,'Contato sintético origem','41999990000',gen_random_uuid())::text,true);
select public.reception_link_patient(current_setting('test.boundary_contact')::uuid,'cb100000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','self');
select set_config('test.boundary_booking',public.reception_book_appointment(current_setting('test.boundary_clinic')::uuid,
 jsonb_build_object('doctorId','cb100000-0000-4000-8000-000000000001','contactId',current_setting('test.boundary_contact'),'patientId','cb200000-0000-4000-8000-000000000001','startTime','2099-12-11T13:00Z','endTime','2099-12-11T13:30Z','type','retorno'),gen_random_uuid())::text,true);

do $$ declare page jsonb; doctor uuid;begin
 foreach doctor in array array[null::uuid,'cb100000-0000-4000-8000-000000000001'::uuid] loop
  page:=public.reception_appointments(current_setting('test.boundary_clinic')::uuid,'2099-12-11','2099-12-12',doctor);
  assert not exists(select 1 from jsonb_array_elements(page->'items') a where a->>'id'='cb300000-0000-4000-8000-000000000001'),'Reception read unassigned appointment';
  assert jsonb_array_length(page->'items')=1 and page->'items'->0->>'id'=current_setting('test.boundary_booking'),'Explicit clinic appointment lost';
  assert page->'items'->0->>'patientName'='Pessoa sintética origem','Explicit clinic projection lost';
  assert jsonb_array_length(page->'blocks')=1 and page->'blocks'->0->>'id'=current_setting('test.boundary_block'),'Clinic block lost or unassigned appointment projected as a block';
  assert position('PRIVATE' in page::text)=0,'Clinical appointment content exposed';
  assert (page->'items'->0)-array['id','doctorId','patientId','contactId','caseId','patientName','startTime','endTime','type','status','revision','checkedInAt','googleSyncStatus']='{}'::jsonb,'Calendar DTO expanded';
 end loop;
 assert (select count(*) from public.appointments)=0 and (select count(*) from public.patients)=0,'Reception gained raw clinical access';
end $$;

do $$ declare action text;target uuid;message text;begin
 foreach action in array array['confirm','check_in','undo_check_in','cancel','reschedule'] loop
  foreach target in array array['cb300000-0000-4000-8000-000000000001'::uuid,'cb300000-0000-4000-8000-000000000002'::uuid,current_setting('test.boundary_other_booking')::uuid,'cb300000-0000-4000-8000-000000000099'::uuid,null::uuid] loop
   begin
    perform public.reception_change_appointment(current_setting('test.boundary_clinic')::uuid,target,1,action,'2099-12-11T15:00Z','2099-12-11T15:30Z');
    raise exception 'Unassigned/foreign/missing appointment mutation succeeded';
   exception when insufficient_privilege then
    get stacked diagnostics message=message_text;
    assert message='Agendamento indisponível','Appointment origin leaked through error: '||message;
   end;
  end loop;
 end loop;
 assert public.reception_change_appointment(current_setting('test.boundary_clinic')::uuid,current_setting('test.boundary_booking')::uuid,1,'confirm')=2,'Explicit clinic mutation lost';
 begin
  perform public.reception_book_appointment(current_setting('test.boundary_clinic')::uuid,
   jsonb_build_object('doctorId','cb100000-0000-4000-8000-000000000001','contactId',current_setting('test.boundary_contact'),'patientId','cb200000-0000-4000-8000-000000000001','startTime','2099-12-11T12:10Z','endTime','2099-12-11T12:20Z','type','retorno'),gen_random_uuid());
  raise exception 'Hidden appointment stopped blocking conflicts';
 exception when exclusion_violation then null;end;
end $$;

reset role;
do $$ begin
 assert (select clinic_id is null and contact_id is null and revision=1 and status='agendado' and checked_in_at is null and start_time='2099-12-11T12:00Z'::timestamptz and notes='PRIVATE SYNTHETIC NOTE' from public.appointments where id='cb300000-0000-4000-8000-000000000001'),'Rejected mutations changed unassigned appointment';
 assert (select count(*) from public.reception_audit where resource_id='cb300000-0000-4000-8000-000000000001')=1,'Rejected mutations added audit';
 assert (select count(*) from public.appointments where user_id='cb100000-0000-4000-8000-000000000001')=2,'Failed booking left a reservation';
end $$;
set local role authenticated;
set local request.jwt.claim.sub='cb100000-0000-4000-8000-000000000001';
do $$ declare page jsonb;begin
 page:=public.reception_appointments(current_setting('test.boundary_clinic')::uuid,'2099-12-11','2099-12-12',auth.uid());
 assert jsonb_array_length(page->'items')=2,'Owner lost own unassigned appointment';
 assert (select count(*) from public.appointments where user_id=auth.uid())=2,'Owner direct agenda lost';
 assert public.reception_change_appointment(current_setting('test.boundary_clinic')::uuid,'cb300000-0000-4000-8000-000000000001',1,'confirm')=2,'Owner cannot maintain own unassigned appointment';
 assert (select clinic_id is null and status='confirmado' from public.appointments where id='cb300000-0000-4000-8000-000000000001'),'Owner mutation assigned clinic implicitly';
end $$;
set local request.jwt.claim.sub='cb100000-0000-4000-8000-000000000002';
do $$ declare message text;begin
 assert jsonb_array_length(public.reception_appointments(current_setting('test.boundary_clinic')::uuid,'2099-12-11','2099-12-12')->'items')=1,'Owner audit attributed a clinic for reception';
 begin perform public.reception_change_appointment(current_setting('test.boundary_clinic')::uuid,'cb300000-0000-4000-8000-000000000001',2,'cancel');raise exception 'Owner audit enabled reception mutation';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Agendamento indisponível';end;
end $$;
rollback;
