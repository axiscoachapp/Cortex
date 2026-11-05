begin;
insert into auth.users(id,email) values
 ('d9100000-0000-4000-8000-000000000001','legacy-interval-doctor@example.invalid'),
 ('d9100000-0000-4000-8000-000000000002','legacy-interval-staff@example.invalid'),
 ('d9100000-0000-4000-8000-000000000003','legacy-interval-outsider@example.invalid');
insert into public.patients(id,user_id,name,status) values
 ('d9200000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001','Pessoa sintética intervalo','novo');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000001';
select set_config('test.legacy.clinic',public.create_clinic('Clínica sintética intervalo')::text,true);
insert into public.appointments(id,user_id,title,start_time,end_time,status) values
 ('d9300000-0000-4000-8000-000000000001',auth.uid(),'Reserva particular sintética','2099-11-20T08:00Z','2099-11-20T08:30Z','agendado'),
 ('d9300000-0000-4000-8000-000000000002',auth.uid(),'Controle válido sintético','2099-11-21T08:00Z','2099-11-21T08:30Z','agendado');
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('d9100000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000002','Recepção sintética intervalo',array['d9100000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000002';
select set_config('test.legacy.contact',public.reception_create_contact(current_setting('test.legacy.clinic')::uuid,'Contato sintético intervalo','',gen_random_uuid())::text,true);
select public.reception_link_patient(current_setting('test.legacy.contact')::uuid,'d9100000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','self');
do $$ declare kind text; n integer:=0; id uuid; begin
 foreach kind in array array['zero','reverse','infinite_end','infinite_start','completed','unknown'] loop
  id:=public.reception_book_appointment(current_setting('test.legacy.clinic')::uuid,
   jsonb_build_object('doctorId','d9100000-0000-4000-8000-000000000001','contactId',current_setting('test.legacy.contact'),'patientId','d9200000-0000-4000-8000-000000000001',
    'startTime','2099-11-22T12:00Z'::timestamptz+n*interval '1 hour','endTime','2099-11-22T12:30Z'::timestamptz+n*interval '1 hour','type','retorno'),gen_random_uuid());
  perform set_config('test.legacy.'||kind,id::text,true); n:=n+1;
 end loop;
end $$;
-- Only the owned disposable fixture seeds historical corruption. Every tested
-- command below runs with all guards enabled, through the ordinary human RPC.
reset role;
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000001';
alter table public.appointments disable trigger zz_reception_appointment_guard;
update public.appointments set end_time=start_time where id in(current_setting('test.legacy.zero')::uuid,current_setting('test.legacy.completed')::uuid,current_setting('test.legacy.unknown')::uuid,'d9300000-0000-4000-8000-000000000001');
update public.appointments set end_time=start_time-interval '1 minute' where id=current_setting('test.legacy.reverse')::uuid;
update public.appointments set end_time='infinity' where id=current_setting('test.legacy.infinite_end')::uuid;
update public.appointments set start_time='-infinity' where id=current_setting('test.legacy.infinite_start')::uuid;
update public.appointments set status='realizado' where id=current_setting('test.legacy.completed')::uuid;
update public.appointments set status=null where id=current_setting('test.legacy.unknown')::uuid;
alter table public.appointments enable trigger zz_reception_appointment_guard;
do $$ declare kind text; begin
 foreach kind in array array['zero','reverse','infinite_end','infinite_start'] loop
  perform set_config('test.legacy.before_'||kind,(select to_jsonb(a)::text from public.appointments a where id=current_setting('test.legacy.'||kind)::uuid),true);
  perform set_config('test.legacy.audit_'||kind,(select count(*)::text from public.reception_audit where resource_id=current_setting('test.legacy.'||kind)::uuid),true);
 end loop;
end $$;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000001';
do $$ declare kind text; target_id uuid; begin
 foreach kind in array array['zero','reverse','infinite_end','infinite_start'] loop
  target_id:=current_setting('test.legacy.'||kind)::uuid;
  begin update public.appointments set status='cancelado',title='Simultaneous title change' where appointments.id=target_id;raise exception 'Cancellation rewrote title';exception when invalid_parameter_value then null;end;
  begin update public.appointments set status='cancelado',notes='Simultaneous note change' where appointments.id=target_id;raise exception 'Cancellation rewrote note';exception when invalid_parameter_value then null;end;
 end loop;
end $$;
-- Suspension blocks future bookings, while historical cancellation remains valid.
select public.reception_set_link_active(current_setting('test.legacy.contact')::uuid,'d9200000-0000-4000-8000-000000000001',1,false);
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000002';
do $$ declare kind text; id uuid; revision integer; begin
 assert (select count(*) from public.patients)=0,'Reception read a private chart';
 begin perform public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,'d9300000-0000-4000-8000-000000000001',1,'cancel');raise exception 'Staff cancelled a private-origin legacy row';exception when insufficient_privilege then null;end;
 foreach kind in array array['zero','reverse','infinite_end','infinite_start'] loop
  id:=current_setting('test.legacy.'||kind)::uuid;
  revision:=public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,id,1,'cancel');
  assert revision=2,'Cancellation did not advance exactly once';
  assert public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,id,revision,'cancel')=revision,'Cancellation retry changed revision';
  begin perform public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,id,1,'cancel');raise exception 'Stale cancellation succeeded';exception when serialization_failure then null;end;
  begin perform public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,id,revision,'reschedule','2099-12-01T13:00Z','2099-12-01T13:00Z');raise exception 'Invalid reschedule succeeded';exception when invalid_parameter_value then null;end;
 end loop;
end $$;
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,current_setting('test.legacy.zero')::uuid,2,'cancel');raise exception 'Outsider cancellation succeeded';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='d9100000-0000-4000-8000-000000000001';
do $$ declare kind text; target_id uuid; begin
 foreach kind in array array['zero','reverse','infinite_end','infinite_start'] loop
  target_id:=current_setting('test.legacy.'||kind)::uuid;
  begin update public.appointments set status='agendado' where appointments.id=target_id;raise exception 'Suspended link reopened';exception when insufficient_privilege then null;end;
 end loop;
end $$;
select public.reception_set_link_active(current_setting('test.legacy.contact')::uuid,'d9200000-0000-4000-8000-000000000001',2,true);
do $$ declare kind text; target_id uuid; begin
 assert public.reception_change_appointment(current_setting('test.legacy.clinic')::uuid,'d9300000-0000-4000-8000-000000000001',1,'cancel')=2,'Owner could not cancel private-origin legacy row';
 foreach kind in array array['zero','reverse','infinite_end','infinite_start'] loop
  target_id:=current_setting('test.legacy.'||kind)::uuid;
  begin update public.appointments set status='agendado' where appointments.id=target_id;raise exception 'Invalid legacy row reopened';exception when invalid_parameter_value then null;end;
  begin update public.appointments set title='Changed title' where appointments.id=target_id;raise exception 'Unrelated business field changed';exception when invalid_parameter_value then null;end;
  begin update public.appointments set end_time=start_time-interval '2 minutes' where appointments.id=target_id;raise exception 'Invalid interval mutated';exception when invalid_parameter_value then null;end;
  begin update public.appointments set status=null where appointments.id=target_id;raise exception 'Invalid legacy status became null';exception when invalid_parameter_value then null;end;
  begin update public.appointments set patient_id=null where appointments.id=target_id;raise exception 'CRM beneficiary changed';exception when insufficient_privilege then null;end;
 end loop;
 foreach kind in array array['completed','unknown'] loop
  begin update public.appointments set status='cancelado' where appointments.id=current_setting('test.legacy.'||kind)::uuid;raise exception 'Completed/unknown invalid row cancelled';exception when invalid_parameter_value then null;end;
 end loop;
 begin update public.appointments set end_time=start_time,status='cancelado' where appointments.id='d9300000-0000-4000-8000-000000000002';raise exception 'Valid row became invalid while cancelling';exception when invalid_parameter_value then null;end;
 foreach kind in array array['zero','reverse','infinity'] loop
  begin insert into public.appointments(user_id,title,start_time,end_time,status) values(auth.uid(),'Invalid new row','2099-12-02T12:00Z',case kind when 'zero' then '2099-12-02T12:00Z'::timestamptz when 'reverse' then '2099-12-02T11:00Z'::timestamptz else 'infinity'::timestamptz end,'cancelado');raise exception 'Invalid new cancelled row inserted';exception when invalid_parameter_value then null;end;
 end loop;
end $$;
reset role;
do $$ declare kind text; before jsonb; after jsonb; target_id uuid; begin
 foreach kind in array array['zero','reverse','infinite_end','infinite_start'] loop
  target_id:=current_setting('test.legacy.'||kind)::uuid;before:=current_setting('test.legacy.before_'||kind)::jsonb;
  select to_jsonb(a) into after from public.appointments a where a.id=target_id;
  assert after->>'status'='cancelado' and (after->>'revision')::integer=2,'Final cancellation state changed';
  assert (before-array['status','revision','updated_by','google_sync_revision','google_sync_status','google_sync_error','reminder_sent'])=(after-array['status','revision','updated_by','google_sync_revision','google_sync_status','google_sync_error','reminder_sent']),'Historical business data changed';
  assert (select count(*) from public.reception_audit where resource_id=target_id)=current_setting('test.legacy.audit_'||kind)::integer+1,'Cancellation audit was missing or duplicated';
  update public.appointments set google_sync_status='idle',google_sync_error=null,google_sync_revision=google_sync_revision+1 where appointments.id=target_id;
  assert (select revision from public.appointments where appointments.id=target_id)=2,'Cancelled metadata update changed business revision';
  assert (select count(*) from public.reception_audit where resource_id=target_id)=current_setting('test.legacy.audit_'||kind)::integer+1,'Metadata update created a business audit';
 end loop;
end $$;
rollback;
