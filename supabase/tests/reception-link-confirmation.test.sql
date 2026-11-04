begin;
insert into auth.users(id,email) values
 ('e1000000-0000-4000-8000-000000000001','link-admin@example.invalid'),
 ('e1000000-0000-4000-8000-000000000002','link-staff@example.invalid');
insert into public.patients(id,user_id,name,status) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Paciente sintético vinculado','novo'),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','Outro paciente sintético','novo');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('test.link_clinic',public.create_clinic('Clínica sintética vínculos')::text,true);
select set_config('test.link_contact',public.reception_create_contact(current_setting('test.link_clinic')::uuid,'Contato sintético','41999990002','e3000000-0000-4000-8000-000000000001')::text,true);
select public.reception_link_patient(current_setting('test.link_contact')::uuid,auth.uid(),'e2000000-0000-4000-8000-000000000001','guardian');
reset role;
select set_config('test.original_link_confirmation',(select confirmed_at::text from public.patient_contact_links where contact_id=current_setting('test.link_contact')::uuid),true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','Recepção sintética',array['e1000000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select public.reception_link_patient(current_setting('test.link_contact')::uuid,'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','guardian');
reset role;
do $$ begin
 assert (select confirmed_by='e1000000-0000-4000-8000-000000000001' and confirmed_at=current_setting('test.original_link_confirmation')::timestamptz and relationship='guardian'
  from public.patient_contact_links where contact_id=current_setting('test.link_contact')::uuid),'Retry replaced original confirmation authorship';
 assert (select count(*) from public.reception_audit where resource_id=current_setting('test.link_contact')::uuid and action='beneficiary_confirmed')=1,'Retry duplicated confirmation audit';
end $$;
set local role authenticated;
do $$ begin
 begin
  perform public.reception_link_patient(current_setting('test.link_contact')::uuid,'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','self');
  raise exception 'Old confirmation silently replaced guardian relationship';
 exception when invalid_parameter_value then null; end;
 assert public.reception_link_patient(current_setting('test.link_contact')::uuid,'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','family'),'New scoped link failed';
 assert jsonb_array_length(public.reception_contact(current_setting('test.link_contact')::uuid)->'beneficiaries')=2,'Administrative projection lost beneficiaries';
 assert (select count(*) from public.patients)=0,'Confirmation widened private chart access';
end $$;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.update_reception_staff('e1000000-0000-4000-8000-000000000002',array[]::uuid[],false);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  perform public.reception_link_patient(current_setting('test.link_contact')::uuid,'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','guardian');
  raise exception 'Idempotent confirmation bypassed revoked scope';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
