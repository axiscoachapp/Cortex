begin;
insert into auth.users(id,email) values
 ('bc100000-0000-4000-8000-000000000001','lifecycle-admin@example.invalid'),
 ('bc100000-0000-4000-8000-000000000002','lifecycle-doctor@example.invalid'),
 ('bc100000-0000-4000-8000-000000000003','lifecycle-staff-a@example.invalid'),
 ('bc100000-0000-4000-8000-000000000004','lifecycle-staff-b@example.invalid'),
 ('bc100000-0000-4000-8000-000000000005','lifecycle-other-admin@example.invalid'),
 ('bc100000-0000-4000-8000-000000000006','lifecycle-other-staff@example.invalid');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('bc500000-0000-4000-8000-000000000001','bc100000-0000-4000-8000-000000000002','Pessoa sintética privada','novo','SYNTHETIC PRIVATE HISTORY');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000001';
select set_config('test.lifecycle_clinic',public.create_clinic('Clínica sintética ciclo')::text,true);
select public.invite_clinic_doctor(current_setting('test.lifecycle_clinic')::uuid,'lifecycle-doctor@example.invalid');
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000002';
select public.respond_clinic_invitation(current_setting('test.lifecycle_clinic')::uuid,true);
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time) values
 ('bc600000-0000-4000-8000-000000000001',auth.uid(),'bc500000-0000-4000-8000-000000000001','Reserva sintética privada','2099-12-07T12:00Z','2099-12-07T12:30Z');
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000005';
select set_config('test.lifecycle_other',public.create_clinic('Outra clínica sintética ciclo')::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('bc100000-0000-4000-8000-000000000001','bc100000-0000-4000-8000-000000000003','Recepção A',array['bc100000-0000-4000-8000-000000000001'::uuid,'bc100000-0000-4000-8000-000000000002'::uuid]);
select public.provision_clinic_receptionist('bc100000-0000-4000-8000-000000000001','bc100000-0000-4000-8000-000000000004','Recepção B',array['bc100000-0000-4000-8000-000000000002'::uuid]);
select public.provision_clinic_receptionist('bc100000-0000-4000-8000-000000000005','bc100000-0000-4000-8000-000000000006','Recepção externa',array['bc100000-0000-4000-8000-000000000005'::uuid]);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000003';
select set_config('test.lifecycle_contact',public.reception_create_contact(current_setting('test.lifecycle_clinic')::uuid,'Contato sintético ciclo','41999990000',gen_random_uuid())::text,true);
select public.reception_link_patient(current_setting('test.lifecycle_contact')::uuid,'bc100000-0000-4000-8000-000000000002','bc500000-0000-4000-8000-000000000001','self');
select set_config('test.lifecycle_open',public.reception_create_case(current_setting('test.lifecycle_contact')::uuid,'bc100000-0000-4000-8000-000000000002','Atendimento aberto sintético','scheduling',gen_random_uuid())::text,true);
select public.reception_update_case(current_setting('test.lifecycle_open')::uuid,1,'claim','{}');
select set_config('test.lifecycle_closed',public.reception_create_case(current_setting('test.lifecycle_contact')::uuid,'bc100000-0000-4000-8000-000000000002','Atendimento encerrado sintético','information',gen_random_uuid())::text,true);
select public.reception_update_case(current_setting('test.lifecycle_closed')::uuid,1,'claim','{}');
select public.reception_add_note(current_setting('test.lifecycle_closed')::uuid,'Nota sintética preservada',gen_random_uuid());
select public.reception_update_case(current_setting('test.lifecycle_closed')::uuid,2,'status','{"status":"resolved"}');
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000002';
select public.leave_clinic(current_setting('test.lifecycle_clinic')::uuid);
reset role;
do $$ begin
 assert not exists(select 1 from public.staff_doctor_scopes where doctor_user_id='bc100000-0000-4000-8000-000000000002'),'L5: leaving retained latent doctor scopes';
 assert (select count(*) from public.staff_doctor_scopes where clinic_id=current_setting('test.lifecycle_clinic')::uuid)=1,'Another doctor lost delegation';
 assert (select count(*) from public.staff_doctor_scopes where clinic_id=current_setting('test.lifecycle_other')::uuid)=1,'Another clinic lost delegation';
 assert exists(select 1 from public.reception_cases where id=current_setting('test.lifecycle_open')::uuid and doctor_user_id is null and assigned_to is null and status='new' and revision=3),'Open work was not returned exactly once';
 assert exists(select 1 from public.reception_cases where id=current_setting('test.lifecycle_closed')::uuid and doctor_user_id='bc100000-0000-4000-8000-000000000002' and assigned_to='bc100000-0000-4000-8000-000000000003' and status='resolved' and revision=3),'Closed work history changed';
 assert exists(select 1 from public.reception_case_notes where case_id=current_setting('test.lifecycle_closed')::uuid and actor_user_id='bc100000-0000-4000-8000-000000000003' and body='Nota sintética preservada'),'Note or authorship changed';
 assert exists(select 1 from public.reception_audit where action='doctor_scopes_revoked' and resource_id='bc100000-0000-4000-8000-000000000002' and details='{"count":2}'::jsonb),'Minimum revocation audit missing';
end $$;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.reception_patient_search(current_setting('test.lifecycle_clinic')::uuid,'bc100000-0000-4000-8000-000000000002','Pessoa');raise exception 'Departed scope can search';exception when insufficient_privilege then null;end;
 begin perform public.reception_create_case(current_setting('test.lifecycle_contact')::uuid,'bc100000-0000-4000-8000-000000000002','Forbidden departed scope','scheduling',gen_random_uuid());raise exception 'Departed scope can write';exception when insufficient_privilege then null;end;
end $$;
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ begin
 begin
  insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values(current_setting('test.lifecycle_clinic')::uuid,'bc100000-0000-4000-8000-000000000004','bc100000-0000-4000-8000-000000000002');
  raise exception 'Inactive doctor accepted a privileged scope';
 exception when insufficient_privilege then null;end;
 begin
  update public.staff_doctor_scopes set doctor_user_id='bc100000-0000-4000-8000-000000000002' where clinic_id=current_setting('test.lifecycle_clinic')::uuid and staff_user_id='bc100000-0000-4000-8000-000000000003' and doctor_user_id='bc100000-0000-4000-8000-000000000001';
  raise exception 'Inactive doctor accepted a retargeted privileged scope';
 exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000001';
select public.invite_clinic_doctor(current_setting('test.lifecycle_clinic')::uuid,'lifecycle-doctor@example.invalid');
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ begin
 begin
  insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values(current_setting('test.lifecycle_clinic')::uuid,'bc100000-0000-4000-8000-000000000004','bc100000-0000-4000-8000-000000000002');
  raise exception 'Invited doctor accepted a privileged scope';
 exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000002';
select public.respond_clinic_invitation(current_setting('test.lifecycle_clinic')::uuid,false);
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000001';
select public.invite_clinic_doctor(current_setting('test.lifecycle_clinic')::uuid,'lifecycle-doctor@example.invalid');
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000002';
select public.respond_clinic_invitation(current_setting('test.lifecycle_clinic')::uuid,true);
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000003';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=1,'Rejoining restored old scopes';
 assert (select count(*) from public.patients)=0,'Reception gained clinical records';
 begin perform public.reception_patient_search(current_setting('test.lifecycle_clinic')::uuid,'bc100000-0000-4000-8000-000000000002','Pessoa');raise exception 'Old scope can search after rejoin';exception when insufficient_privilege then null;end;
 begin perform public.reception_appointments(current_setting('test.lifecycle_clinic')::uuid,'2099-12-07','2099-12-08','bc100000-0000-4000-8000-000000000002');raise exception 'Old scope can read agenda after rejoin';exception when insufficient_privilege then null;end;
 begin perform public.reception_create_case(current_setting('test.lifecycle_contact')::uuid,'bc100000-0000-4000-8000-000000000002','Forbidden old scope','scheduling',gen_random_uuid());raise exception 'Old scope can write after rejoin';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000001';
select public.update_reception_staff('bc100000-0000-4000-8000-000000000003',array['bc100000-0000-4000-8000-000000000001'::uuid,'bc100000-0000-4000-8000-000000000002'::uuid],true);
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000003';
do $$ begin
 assert jsonb_array_length(public.clinic_access()->'doctors')=2,'Fresh explicit grant did not work';
 assert jsonb_array_length(public.reception_patient_search(current_setting('test.lifecycle_clinic')::uuid,'bc100000-0000-4000-8000-000000000002','Pessoa'))=1,'Fresh explicit grant cannot search';
end $$;
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000001';
select public.offboard_clinic_doctor(current_setting('test.lifecycle_clinic')::uuid,'bc100000-0000-4000-8000-000000000002');
reset role;
do $$ begin
 assert not exists(select 1 from public.staff_doctor_scopes where doctor_user_id='bc100000-0000-4000-8000-000000000002'),'Administrative offboarding retained scopes';
 assert (select count(*) from public.reception_audit where action='doctor_scopes_revoked' and resource_id='bc100000-0000-4000-8000-000000000002')=2,'Offboarding audit missing or duplicated';
 assert exists(select 1 from public.patients where id='bc500000-0000-4000-8000-000000000001' and user_id='bc100000-0000-4000-8000-000000000002' and medical_history='SYNTHETIC PRIVATE HISTORY'),'Private chart changed';
 assert exists(select 1 from public.patient_contact_links where contact_id=current_setting('test.lifecycle_contact')::uuid and patient_id='bc500000-0000-4000-8000-000000000001' and relationship='self' and confirmed_by='bc100000-0000-4000-8000-000000000003'),'Beneficiary history changed';
 assert exists(select 1 from public.appointments where id='bc600000-0000-4000-8000-000000000001' and user_id='bc100000-0000-4000-8000-000000000002' and patient_id='bc500000-0000-4000-8000-000000000001'),'Appointment custody changed';
end $$;
rollback;
