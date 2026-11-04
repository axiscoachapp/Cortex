begin;
insert into auth.users(id,email) values
 ('a7100000-0000-4000-8000-000000000001','link-edit-admin@example.invalid'),
 ('a7100000-0000-4000-8000-000000000002','link-edit-staff@example.invalid'),
 ('a7100000-0000-4000-8000-000000000003','link-edit-other@example.invalid'),
 ('a7100000-0000-4000-8000-000000000004','link-edit-doctor@example.invalid');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','Beneficiário sintético A','novo','SYNTHETIC PRIVATE HISTORY'),
 ('a7200000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000001','Beneficiário sintético B','novo',''),
 ('a7200000-0000-4000-8000-000000000003','a7100000-0000-4000-8000-000000000004','Paciente médico sintético','novo','');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000001',true);
select set_config('test.link_edit_clinic',public.create_clinic('Clínica sintética correção')::text,true);
select set_config('test.link_edit_contact',public.reception_create_contact(current_setting('test.link_edit_clinic')::uuid,'Contato sintético A','','a7300000-0000-4000-8000-000000000001')::text,true);
select set_config('test.link_edit_other_contact',public.reception_create_contact(current_setting('test.link_edit_clinic')::uuid,'Contato sintético B','','a7300000-0000-4000-8000-000000000002')::text,true);
select public.reception_link_patient(current_setting('test.link_edit_contact')::uuid,auth.uid(),'a7200000-0000-4000-8000-000000000001','guardian');
select public.invite_clinic_doctor(current_setting('test.link_edit_clinic')::uuid,'link-edit-doctor@example.invalid');
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000004',true);
select public.respond_clinic_invitation(current_setting('test.link_edit_clinic')::uuid,true);
do $$ begin
 begin perform public.reception_link_edit(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001');raise exception 'Non-admin physician got editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',1,'other');raise exception 'Non-admin physician edited relation';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000001',true);
reset role;
-- Existing administrative correction remains valid for a historical foreign
-- link; creating that link through an undelegated admin RPC is now forbidden.
insert into public.patient_contact_links(clinic_id,contact_id,doctor_user_id,patient_id,relationship,confirmed_by)
 values(current_setting('test.link_edit_clinic')::uuid,current_setting('test.link_edit_contact')::uuid,'a7100000-0000-4000-8000-000000000004','a7200000-0000-4000-8000-000000000003','self','a7100000-0000-4000-8000-000000000001');
do $$ begin
 begin
  update public.patient_contact_links set contact_id=current_setting('test.link_edit_other_contact')::uuid where contact_id=current_setting('test.link_edit_contact')::uuid;
  raise exception 'Existing link identity moved to another contact';
 exception when insufficient_privilege then null; end;
 begin
  update public.patient_contact_links set patient_id='a7200000-0000-4000-8000-000000000002' where contact_id=current_setting('test.link_edit_contact')::uuid;
  raise exception 'Existing link reassigned to another patient';
 exception when insufficient_privilege then null; end;
 begin
  update public.patient_contact_links set confirmed_by='a7100000-0000-4000-8000-000000000002',confirmed_at='2000-01-01' where contact_id=current_setting('test.link_edit_contact')::uuid;
  raise exception 'Original confirmation attribution forged';
 exception when insufficient_privilege then null; end;
 begin delete from public.patient_contact_links where contact_id=current_setting('test.link_edit_contact')::uuid;raise exception 'Link history deleted';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$ declare data jsonb; begin
 data:=public.reception_link_edit(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001');
 assert data->>'revision'='1' and data->>'relationship'='guardian','Link edit snapshot missing';
 assert data-array['contactId','patientId','doctorId','patientName','dateOfBirth','doctorName','relationship','revision','active','patientAvailable','doctorActive']='{}'::jsonb,'Snapshot includes clinical/unrelated values';
 assert public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',1,'family')=2,'Correction did not advance revision';
 assert public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'family')=2,'No-op advanced revision';
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',1,'other');raise exception 'Stale correction overwritten';exception when serialization_failure then null;end;
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'invalid');raise exception 'Invalid relation accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_link_patient(current_setting('test.link_edit_contact')::uuid,auth.uid(),'a7200000-0000-4000-8000-000000000001','guardian');raise exception 'Old confirmation undid correction';exception when invalid_parameter_value then null;end;
 perform public.reception_link_patient(current_setting('test.link_edit_contact')::uuid,auth.uid(),'a7200000-0000-4000-8000-000000000001','family');
 assert public.reception_contact(current_setting('test.link_edit_contact')::uuid)->'beneficiaries'->0->>'relationship'='family','Existing read lost correction';
end $$;
reset role;
do $$ declare details jsonb; begin
 assert (select confirmed_by='a7100000-0000-4000-8000-000000000001' and revision=2 and updated_by=confirmed_by from public.patient_contact_links where contact_id=current_setting('test.link_edit_contact')::uuid and patient_id='a7200000-0000-4000-8000-000000000001'),'Correction changed original actor or missed revision';
 assert (select medical_history='SYNTHETIC PRIVATE HISTORY' from public.patients where id='a7200000-0000-4000-8000-000000000001'),'Correction touched private chart';
 select a.details into details from public.reception_audit a where resource_id=current_setting('test.link_edit_contact')::uuid and action='beneficiary_relationship_corrected';
 assert details->>'from'='guardian' and details->>'to'='family' and details->>'revision'='2','Correction audit missing';
 assert (select count(*) from public.reception_audit where resource_id=current_setting('test.link_edit_contact')::uuid and action='beneficiary_relationship_corrected')=1,'Failed/no-op correction duplicated audit';
 assert position('sintético' in details::text)=0 and position('HISTORY' in details::text)=0,'Audit copied personal/clinical text';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','Secretária sintética',array['a7100000-0000-4000-8000-000000000001'::uuid]);
do $$ begin
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'other');raise exception 'Service bot edited relation';exception when insufficient_privilege then null;end;
 begin update public.patient_contact_links set relationship='other' where contact_id=current_setting('test.link_edit_contact')::uuid;raise exception 'Service bot bypassed RPC';exception when insufficient_privilege then null;end;
 begin truncate public.patient_contact_links cascade;raise exception 'Service bot truncated history';exception when insufficient_privilege then null;end;
 update public.patient_contact_links set revision=999,updated_at='2000-01-01',updated_by=null where contact_id=current_setting('test.link_edit_contact')::uuid;
end $$;
reset role;
do $$ begin
 assert (select revision=2 and updated_by=confirmed_by and updated_at<>'2000-01-01'::timestamptz from public.patient_contact_links where contact_id=current_setting('test.link_edit_contact')::uuid and patient_id='a7200000-0000-4000-8000-000000000001'),'Server metadata was forged';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000002',true);
do $$ begin
 begin perform public.reception_link_edit(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001');raise exception 'Staff got editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'other');raise exception 'Staff edited relation';exception when insufficient_privilege then null;end;
 assert (select count(*) from public.patients)=0,'Correction widened clinical read';
end $$;
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000003',true);
select public.create_clinic('Clínica externa sintética');
do $$ begin
 begin perform public.reception_link_edit(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001');raise exception 'Foreign admin got editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'other');raise exception 'Foreign admin edited relation';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into auth.mfa_factors(user_id,status,factor_type) values('a7100000-0000-4000-8000-000000000001','verified','totp');
set local role authenticated;
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'other');raise exception 'Correction bypassed MFA';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
reset role;
update public.patients set archived_at=now() where id='a7200000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 assert (public.reception_link_edit(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001')->>'patientAvailable')::boolean=false,'Archived patient availability hidden from admin editor';
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000001',2,'other');raise exception 'Archived patient relation corrected';exception when insufficient_privilege then null;end;
end $$;
select public.offboard_clinic_doctor(current_setting('test.link_edit_clinic')::uuid,'a7100000-0000-4000-8000-000000000004');
do $$ begin
 assert (public.reception_link_edit(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000003')->>'doctorActive')::boolean=false,'Inactive doctor hidden from admin snapshot';
 begin perform public.reception_update_link_relationship(current_setting('test.link_edit_contact')::uuid,'a7200000-0000-4000-8000-000000000003',1,'other');raise exception 'Inactive doctor relation corrected';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 begin update public.patient_contact_links set relationship='other' where patient_id='a7200000-0000-4000-8000-000000000003';raise exception 'Raw correction bypassed inactive doctor';exception when insufficient_privilege then null;end;
 assert (select revision=1 and relationship='self' from public.patient_contact_links where patient_id='a7200000-0000-4000-8000-000000000003'),'Rejected inactive correction changed revision';
 assert not exists(select 1 from public.reception_audit where action='beneficiary_relationship_corrected' and details->>'patientId'='a7200000-0000-4000-8000-000000000003'),'Rejected inactive correction created audit';
end $$;
rollback;
