-- reception_busy_intervals: anonymous busy periods for the doctors in the caller's scope.
-- Proves: only doctorId/startTime/endTime leave the server; hidden periods are merged and
-- clipped; what reception_appointments already shows is not repeated; colleagues outside
-- the delegation, other clinics and anon/service_role get nothing; the intervals match the
-- real booking conflict rule.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('e2100000-0000-4000-8000-000000000001','busy-owner@example.invalid',now()),
 ('e2100000-0000-4000-8000-000000000002','busy-staff@example.invalid',now()),
 ('e2100000-0000-4000-8000-000000000003','busy-colleague@example.invalid',now()),
 ('e2100000-0000-4000-8000-000000000004','busy-foreign@example.invalid',now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000001';
select set_config('test.busy.clinic',public.create_clinic('Clínica sintética ocupação')::text,true);
select public.invite_clinic_doctor(current_setting('test.busy.clinic')::uuid,'busy-colleague@example.invalid');
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000003';
select public.respond_clinic_invitation(current_setting('test.busy.clinic')::uuid,true);
-- A second clinic holds a historical appointment and a block of the owner (the pending
-- invitation row is enough for the block's membership key; a doctor is active in one clinic).
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000004';
select set_config('test.busy.foreign',public.create_clinic('Clínica sintética vizinha')::text,true);
select public.invite_clinic_doctor(current_setting('test.busy.foreign')::uuid,'busy-owner@example.invalid');
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000001';
-- A clinic booking the reception may see.
select set_config('test.busy.contact',public.reception_create_contact(current_setting('test.busy.clinic')::uuid,'Contato sintético ocupação','',gen_random_uuid())::text,true);
select set_config('test.busy.visible',public.reception_book_appointment(current_setting('test.busy.clinic')::uuid,jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.busy.contact'),'beneficiaryName','Pessoa sintética visível','dateOfBirth','2000-01-01','relationship','self','startTime','2099-12-15T12:00Z','endTime','2099-12-15T12:30Z','type','novo'),gen_random_uuid())::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('e2100000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000002','Recepção sintética ocupação',array['e2100000-0000-4000-8000-000000000001'::uuid]);
reset role;
set local request.jwt.claim.role='authenticated';
-- Seed the doctor's private agenda directly, as the disposable database owner.
alter table public.appointments disable trigger zz_reception_appointment_guard;
alter table public.appointments disable trigger ab_reception_link_activity;
insert into public.patients(id,user_id,name,status) values('e2200000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000001','PRIVATE SYNTHETIC PATIENT','novo');
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('e2400000-0000-4000-8000-000000000001',current_setting('test.busy.foreign')::uuid,'PRIVATE FOREIGN CONTACT','e2100000-0000-4000-8000-000000000004',gen_random_uuid());
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values(current_setting('test.busy.foreign')::uuid,'e2400000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000001','self','e2100000-0000-4000-8000-000000000004');
insert into public.appointments(id,user_id,patient_id,title,notes,start_time,end_time,clinic_id,status,contact_id) values
 -- Two touching private appointments: one merged period 13:00–14:00.
 ('e2300000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','PRIVATE SYNTHETIC TITLE','PRIVATE SYNTHETIC NOTE','2099-12-15T13:00Z','2099-12-15T13:30Z',null,'agendado',null),
 ('e2300000-0000-4000-8000-000000000002','e2100000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','PRIVATE SYNTHETIC TITLE','PRIVATE SYNTHETIC NOTE','2099-12-15T13:30Z','2099-12-15T14:00Z',null,'confirmado',null),
 -- Overlapping one inside it: still one period.
 ('e2300000-0000-4000-8000-000000000003','e2100000-0000-4000-8000-000000000001',null,'PRIVATE SYNTHETIC TITLE',null,'2099-12-15T13:10Z','2099-12-15T13:20Z',null,null,null),
 -- Cancelled: does not occupy the slot.
 ('e2300000-0000-4000-8000-000000000004','e2100000-0000-4000-8000-000000000001',null,'PRIVATE SYNTHETIC TITLE',null,'2099-12-15T15:00Z','2099-12-15T15:30Z',null,'cancelado',null),
 -- Another clinic's appointment of the same doctor.
 ('e2300000-0000-4000-8000-000000000005','e2100000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','PRIVATE FOREIGN TITLE','PRIVATE FOREIGN NOTE','2099-12-15T10:00Z','2099-12-15T10:30Z',current_setting('test.busy.foreign')::uuid,'agendado','e2400000-0000-4000-8000-000000000001'),
 -- Outside the window.
 ('e2300000-0000-4000-8000-000000000006','e2100000-0000-4000-8000-000000000001',null,'PRIVATE SYNTHETIC TITLE',null,'2099-12-17T13:00Z','2099-12-17T13:30Z',null,'agendado',null),
 -- A colleague the receptionist is not delegated to.
 ('e2300000-0000-4000-8000-000000000007','e2100000-0000-4000-8000-000000000003',null,'PRIVATE COLLEAGUE TITLE',null,'2099-12-15T09:00Z','2099-12-15T09:30Z',null,'agendado',null);
alter table public.appointments enable trigger zz_reception_appointment_guard;
alter table public.appointments enable always trigger ab_reception_link_activity;
insert into public.reception_schedule_blocks(clinic_id,doctor_user_id,start_time,end_time,reason,created_by,request_id) values
 (current_setting('test.busy.foreign')::uuid,'e2100000-0000-4000-8000-000000000001','2099-12-15T16:00Z','2099-12-15T17:00Z','PRIVATE FOREIGN REASON','e2100000-0000-4000-8000-000000000004',gen_random_uuid()),
 (current_setting('test.busy.clinic')::uuid,'e2100000-0000-4000-8000-000000000001','2099-12-15T18:00Z','2099-12-15T19:00Z','Bloqueio sintético da clínica','e2100000-0000-4000-8000-000000000001',gen_random_uuid());

-- The delegated receptionist.
set local role authenticated;
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000002';
do $$ declare busy jsonb; filtered jsonb; clipped jsonb; item jsonb; agenda jsonb;begin
 busy:=public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15T03:00Z','2099-12-16T03:00Z');
 assert busy=jsonb_build_array(
  jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','startTime','2099-12-15T10:00:00+00:00','endTime','2099-12-15T10:30:00+00:00'),
  jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','startTime','2099-12-15T13:00:00+00:00','endTime','2099-12-15T14:00:00+00:00'),
  jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','startTime','2099-12-15T16:00:00+00:00','endTime','2099-12-15T17:00:00+00:00')),
  'Unexpected busy intervals: '||busy::text;
 for item in select * from jsonb_array_elements(busy) loop
  assert (select array_agg(k order by k) from jsonb_object_keys(item) k)=array['doctorId','endTime','startTime'],'A field beyond doctor/start/end leaked';
 end loop;
 assert position('PRIVATE' in busy::text)=0,'Private title, note, patient or reason leaked';
 assert position('e2300000' in busy::text)=0 and position('e2200000' in busy::text)=0,'Appointment or patient id leaked';
 assert position(current_setting('test.busy.foreign') in busy::text)=0,'Other clinic id leaked';
 assert position('e2100000-0000-4000-8000-000000000003' in busy::text)=0,'Undelegated colleague leaked into the aggregate';
 -- Visible clinic bookings and clinic blocks stay in reception_appointments only.
 agenda:=public.reception_appointments(current_setting('test.busy.clinic')::uuid,'2099-12-15T03:00Z','2099-12-16T03:00Z');
 assert jsonb_array_length(agenda->'items')=1 and jsonb_array_length(agenda->'blocks')=1,'The existing read changed';
 assert position('2099-12-15T12:00' in busy::text)=0 and position('2099-12-15T18:00' in busy::text)=0,'Visible booking or clinic block repeated as busy';
 filtered:=public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15T03:00Z','2099-12-16T03:00Z','e2100000-0000-4000-8000-000000000001');
 assert filtered=busy,'Doctor filter changed the authorized result';
 -- Clipped to the window: nothing outside it is revealed.
 clipped:=public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15T13:15Z','2099-12-15T13:45Z');
 assert clipped=jsonb_build_array(jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','startTime','2099-12-15T13:15:00+00:00','endTime','2099-12-15T13:45:00+00:00')),'Interval not clipped: '||clipped::text;
 assert public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15T14:00Z','2099-12-15T15:59Z')='[]'::jsonb,'Cancelled or exclusive end reported as busy';
 begin perform public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15','2099-12-16','e2100000-0000-4000-8000-000000000003');raise exception 'Undelegated doctor accepted';exception when insufficient_privilege then null;end;
 begin perform public.reception_busy_intervals(current_setting('test.busy.foreign')::uuid,'2099-12-15','2099-12-16');raise exception 'Foreign clinic accepted';exception when insufficient_privilege then null;end;
 begin perform public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'-infinity','2099-12-16');raise exception 'Unbounded start accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15','2100-02-01');raise exception 'Window beyond 42 days accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-16','2099-12-15');raise exception 'Reversed window accepted';exception when invalid_parameter_value then null;end;
end $$;
-- A reported busy period is a real conflict for the booking.
do $$ begin
 begin
  perform public.reception_book_appointment(current_setting('test.busy.clinic')::uuid,jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','contactId',current_setting('test.busy.contact'),'beneficiaryName','Pessoa sintética conflito','dateOfBirth','2000-01-01','relationship','self','startTime','2099-12-15T13:15Z','endTime','2099-12-15T13:45Z','type','novo'),gen_random_uuid());
  raise exception 'Booking over a busy period succeeded';
 exception when exclusion_violation then null;
 end;
end $$;

-- The doctor sees her own clinic-less agenda in reception_appointments; it is not repeated as busy.
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000001';
do $$ declare busy jsonb;begin
 busy:=public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15T03:00Z','2099-12-16T03:00Z');
 assert busy=jsonb_build_array(
  jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','startTime','2099-12-15T10:00:00+00:00','endTime','2099-12-15T10:30:00+00:00'),
  jsonb_build_object('doctorId','e2100000-0000-4000-8000-000000000001','startTime','2099-12-15T16:00:00+00:00','endTime','2099-12-15T17:00:00+00:00')),
  'Owner view: '||busy::text;
end $$;

-- A colleague without a reception delegation from the owner gets nothing.
set local request.jwt.claim.sub='e2100000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15','2099-12-16','e2100000-0000-4000-8000-000000000001');raise exception 'Colleague read another doctor';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Grants: only authenticated callers; never anon or service_role.
do $$ begin
 assert has_function_privilege('authenticated','public.reception_busy_intervals(uuid,timestamptz,timestamptz,uuid)','execute'),'authenticated lost execute';
 assert not has_function_privilege('anon','public.reception_busy_intervals(uuid,timestamptz,timestamptz,uuid)','execute'),'anon can execute';
 assert not has_function_privilege('service_role','public.reception_busy_intervals(uuid,timestamptz,timestamptz,uuid)','execute'),'service_role can execute';
 assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.reception_busy_intervals(uuid,timestamptz,timestamptz,uuid)'::regprocedure),'Definer or search_path missing';
end $$;
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ begin
 begin perform public.reception_busy_intervals(current_setting('test.busy.clinic')::uuid,'2099-12-15','2099-12-16');raise exception 'service_role executed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
