-- Synthetic patients deliberately share a contact and doctor: ownership/FKs alone
-- cannot stop reassigning the historical beneficiary of an existing CRM booking.
begin;
insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','identity-doctor@example.invalid');
insert into public.patients(id,user_id,name,status) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Beneficiário sintético A','novo'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','Beneficiário sintético B','novo');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('test.identity_clinic',public.create_clinic('Clínica sintética identidade')::text,true);
select set_config('test.identity_contact',public.reception_create_contact(current_setting('test.identity_clinic')::uuid,'Contato sintético','41999990001','d3000000-0000-4000-8000-000000000001')::text,true);
select public.reception_link_patient(current_setting('test.identity_contact')::uuid,auth.uid(),'d2000000-0000-4000-8000-000000000001','guardian');
select public.reception_link_patient(current_setting('test.identity_contact')::uuid,auth.uid(),'d2000000-0000-4000-8000-000000000002','family');
select set_config('test.identity_booking',public.reception_book_appointment(current_setting('test.identity_clinic')::uuid,
 jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.identity_contact'),
 'patientId','d2000000-0000-4000-8000-000000000001','startTime','2099-10-10T12:00:00Z','endTime','2099-10-10T12:30:00Z','type','retorno'),
 'd3000000-0000-4000-8000-000000000002')::text,true);

do $$ declare booking_id uuid:=current_setting('test.identity_booking')::uuid; begin
 begin
  update public.appointments set patient_id='d2000000-0000-4000-8000-000000000002' where id=booking_id;
  raise exception 'Existing CRM booking was reassigned to another linked patient';
 exception when insufficient_privilege then null; end;
 assert (select patient_id='d2000000-0000-4000-8000-000000000001' and revision=1 from public.appointments where id=booking_id),'Rejected identity edit changed patient or revision';
 begin
  update public.appointments set patient_id=null where id=booking_id;
  raise exception 'CRM beneficiary was removed';
 exception when insufficient_privilege then null; end;
 -- Editing the original appointment still works; no additional user rights.
 update public.appointments set notes='Nota sintética do médico',status='realizado' where id=booking_id;
 assert (select patient_id='d2000000-0000-4000-8000-000000000001' and status='realizado' and revision=2 from public.appointments where id=booking_id),'Original beneficiary completion was blocked';
 update public.appointments set status='cancelado' where id=booking_id;
 begin
  update public.appointments set patient_id='d2000000-0000-4000-8000-000000000002',status='agendado' where id=booking_id;
  raise exception 'Cancelled CRM booking reused for another patient';
 exception when insufficient_privilege then null; end;
end $$;

-- Ordinary clinical appointments retain their existing editing behavior.
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,status) values
 ('d4000000-0000-4000-8000-000000000001',auth.uid(),'d2000000-0000-4000-8000-000000000001','Compromisso clínico sintético','2099-10-10T14:00Z','2099-10-10T14:30Z','agendado');
update public.appointments set patient_id='d2000000-0000-4000-8000-000000000002' where id='d4000000-0000-4000-8000-000000000001';
do $$ begin
 assert (select patient_id='d2000000-0000-4000-8000-000000000002' from public.appointments where id='d4000000-0000-4000-8000-000000000001'),'Clinical-only appointment editing regressed';
end $$;

-- The row invariant applies to privileged writers too, not just the screen/RLS.
reset role;
do $$ begin
 assert (select count(*) from public.reception_audit where resource_id=current_setting('test.identity_booking')::uuid)=3,'Rejected identity edit created audit event';
 begin
  update public.appointments set patient_id='d2000000-0000-4000-8000-000000000002' where id=current_setting('test.identity_booking')::uuid;
  raise exception 'Privileged writer bypassed CRM beneficiary identity';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
