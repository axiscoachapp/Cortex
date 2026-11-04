begin;
insert into auth.users(id,email) values
 ('d4100000-0000-4000-8000-000000000001','staff-life-admin@example.invalid'),
 ('d4100000-0000-4000-8000-000000000002','staff-life-doctor@example.invalid'),
 ('d4100000-0000-4000-8000-000000000003','staff-life-active@example.invalid'),
 ('d4100000-0000-4000-8000-000000000004','staff-life-inactive@example.invalid');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('d4200000-0000-4000-8000-000000000001','d4100000-0000-4000-8000-000000000001','Pessoa sintética recepção','novo','PRIVATE SYNTHETIC HISTORY');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d4100000-0000-4000-8000-000000000001';
select set_config('test.staff_life_clinic',public.create_clinic('Clínica sintética inativação')::text,true);
select public.invite_clinic_doctor(current_setting('test.staff_life_clinic')::uuid,'staff-life-doctor@example.invalid');
set local request.jwt.claim.sub='d4100000-0000-4000-8000-000000000002';
select public.respond_clinic_invitation(current_setting('test.staff_life_clinic')::uuid,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
select public.provision_clinic_receptionist('d4100000-0000-4000-8000-000000000001','d4100000-0000-4000-8000-000000000003','Recepção sintética ativa',array['d4100000-0000-4000-8000-000000000001'::uuid,'d4100000-0000-4000-8000-000000000002'::uuid]);
insert into public.clinic_staff_members(user_id,clinic_id,name,active) values
 ('d4100000-0000-4000-8000-000000000004',current_setting('test.staff_life_clinic')::uuid,'Recepção sintética inativa',false);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d4100000-0000-4000-8000-000000000003';
select set_config('test.staff_life_contact',public.reception_create_contact(current_setting('test.staff_life_clinic')::uuid,'Contato sintético inativação','41999990000',gen_random_uuid())::text,true);
select public.reception_link_patient(current_setting('test.staff_life_contact')::uuid,'d4100000-0000-4000-8000-000000000001','d4200000-0000-4000-8000-000000000001','self');
select set_config('test.staff_life_open',public.reception_create_case(current_setting('test.staff_life_contact')::uuid,'d4100000-0000-4000-8000-000000000001','Atendimento sintético aberto','scheduling',gen_random_uuid())::text,true);
select public.reception_update_case(current_setting('test.staff_life_open')::uuid,1,'claim','{}');
select set_config('test.staff_life_closed',public.reception_create_case(current_setting('test.staff_life_contact')::uuid,'d4100000-0000-4000-8000-000000000001','Atendimento sintético encerrado','scheduling',gen_random_uuid())::text,true);
select public.reception_update_case(current_setting('test.staff_life_closed')::uuid,1,'claim','{}');
select public.reception_update_case(current_setting('test.staff_life_closed')::uuid,2,'status','{"status":"resolved"}');
select set_config('test.staff_life_booking',public.reception_book_appointment(current_setting('test.staff_life_clinic')::uuid,
 jsonb_build_object('doctorId','d4100000-0000-4000-8000-000000000001','contactId',current_setting('test.staff_life_contact'),'patientId','d4200000-0000-4000-8000-000000000001','startTime','2099-12-12T12:00Z','endTime','2099-12-12T12:30Z','type','retorno'),gen_random_uuid())::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
update public.clinic_staff_members set active=false where user_id='d4100000-0000-4000-8000-000000000003';
reset role;
do $$ begin
 assert (select count(*) from public.staff_doctor_scopes where staff_user_id='d4100000-0000-4000-8000-000000000003')=0,'Inactive staff retained delegation';
 assert (select assigned_to is null and status='new' and revision=3 from public.reception_cases where id=current_setting('test.staff_life_open')::uuid),'Open assignment not released exactly once';
 assert (select assigned_to='d4100000-0000-4000-8000-000000000003' and status='resolved' and revision=3 from public.reception_cases where id=current_setting('test.staff_life_closed')::uuid),'Closed history changed';
 assert (select count(*) from public.reception_audit where action='staff_scopes_revoked' and resource_id='d4100000-0000-4000-8000-000000000003' and actor_user_id is null and details='{"count":2}'::jsonb)=1,'Minimal staff revocation audit missing';
 assert (select user_id='d4100000-0000-4000-8000-000000000001' and created_by='d4100000-0000-4000-8000-000000000003' and revision=1 from public.appointments where id=current_setting('test.staff_life_booking')::uuid),'Appointment changed';
 assert (select medical_history='PRIVATE SYNTHETIC HISTORY' from public.patients where id='d4200000-0000-4000-8000-000000000001'),'Clinical history changed';
 assert (select count(*) from public.patient_contact_links where patient_id='d4200000-0000-4000-8000-000000000001')=1,'Beneficiary link removed';
end $$;
set local role service_role;
do $$ declare message text;begin
 begin
  insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values(current_setting('test.staff_life_clinic')::uuid,'d4100000-0000-4000-8000-000000000003','d4100000-0000-4000-8000-000000000001');
  raise exception 'Direct grant accepted inactive staff';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Recepção indisponível na clínica';end;
end $$;
update public.clinic_staff_members set active=true where user_id='d4100000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='d4100000-0000-4000-8000-000000000003';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=0,'Flag-only reactivation restored delegation';
 begin perform public.reception_patient_search(current_setting('test.staff_life_clinic')::uuid,'d4100000-0000-4000-8000-000000000001','Pessoa');raise exception 'Reactivated staff read roster';exception when insufficient_privilege then null;end;
 begin perform public.reception_save_draft(current_setting('test.staff_life_open')::uuid,'Synthetic stale draft',0);raise exception 'Reactivated staff wrote draft';exception when insufficient_privilege then null;end;
 assert (select count(*) from public.patients)=0,'Clinical access exposed to reception';
end $$;
set local request.jwt.claim.sub='d4100000-0000-4000-8000-000000000001';
select public.update_reception_staff('d4100000-0000-4000-8000-000000000003',array['d4100000-0000-4000-8000-000000000001'::uuid],true);
set local request.jwt.claim.sub='d4100000-0000-4000-8000-000000000003';
do $$ begin assert jsonb_array_length(public.reception_patient_search(current_setting('test.staff_life_clinic')::uuid,'d4100000-0000-4000-8000-000000000001','Pessoa'))=1,'Fresh explicit grant lost';end $$;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
do $$ declare message text;begin
 begin
  update public.staff_doctor_scopes set staff_user_id='d4100000-0000-4000-8000-000000000004' where staff_user_id='d4100000-0000-4000-8000-000000000003';
  raise exception 'Scope reassigned to inactive staff';
 exception when insufficient_privilege then get stacked diagnostics message=message_text;assert message='Recepção indisponível na clínica';end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from public.staff_doctor_scopes where staff_user_id='d4100000-0000-4000-8000-000000000003')=1,'Refused reassignment lost active grant';
 assert (select count(*) from public.staff_doctor_scopes where staff_user_id='d4100000-0000-4000-8000-000000000004')=0,'Inactive staff received a latent grant';
end $$;
rollback;
