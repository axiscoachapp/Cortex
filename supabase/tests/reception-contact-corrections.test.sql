begin;
insert into auth.users(id,email) values
 ('f1000000-0000-4000-8000-000000000001','correction-admin@example.invalid'),
 ('f1000000-0000-4000-8000-000000000002','correction-staff@example.invalid'),
 ('f1000000-0000-4000-8000-000000000003','correction-outsider@example.invalid'),
 ('f1000000-0000-4000-8000-000000000004','correction-doctor@example.invalid');
insert into public.patients(id,user_id,name,phone,status,medical_history) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Beneficiário sintético','41999990000','novo','PRIVATE CHART');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('test.correction_clinic',public.create_clinic('Clínica Correção')::text,true);
select set_config('test.correction_contact',public.reception_create_contact(current_setting('test.correction_clinic')::uuid,'Contato Exemplo','41999990001','f3000000-0000-4000-8000-000000000001')::text,true);
select public.reception_link_patient(current_setting('test.correction_contact')::uuid,'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','guardian');
do $$ declare data jsonb; revision integer; begin
 data:=public.reception_contact_edit(current_setting('test.correction_contact')::uuid);
 assert data->>'revision'='1' and data->>'name'='Contato Exemplo','Editor snapshot missing';
 assert data-array['id','name','phone','revision']='{}'::jsonb,'Editor leaked unrelated fields';
 revision:=public.reception_update_contact(current_setting('test.correction_contact')::uuid,1,'Contato Corrigido','(41) 99999-0002');
 assert revision=2,'Correction did not advance revision';
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,1,'Stale overwrite','41999990003');raise exception 'Concurrent correction overwritten';exception when serialization_failure then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,2,'Contato Inválido','99990002');raise exception 'New ambiguous phone accepted';exception when invalid_parameter_value then null;end;
 assert public.reception_update_contact(current_setting('test.correction_contact')::uuid,2,'Contato Corrigido','(41) 99999-0002')=2,'No-op advanced revision';
 assert public.reception_contact(current_setting('test.correction_contact')::uuid)->>'name'='Contato Corrigido','Contact lookup remained stale';
 assert public.reception_create_contact(current_setting('test.correction_clinic')::uuid,'Contato Exemplo','41999990001','f3000000-0000-4000-8000-000000000001')=current_setting('test.correction_contact')::uuid,'Creation retry broke after correction';
 begin perform public.reception_create_contact(current_setting('test.correction_clinic')::uuid,'Changed creation payload','41999990001','f3000000-0000-4000-8000-000000000001');raise exception 'Request reused with another creation payload';exception when invalid_parameter_value then null;end;
 assert (select name='Beneficiário sintético' and phone='41999990000' and medical_history='PRIVATE CHART' from public.patients where id='f2000000-0000-4000-8000-000000000001'),'Correction changed clinical identity';
end $$;
reset role;
do $$ declare audit jsonb; begin
 assert (select phone_normalized='5541999990002' from public.clinic_contacts where id=current_setting('test.correction_contact')::uuid),'Correction failed to normalize';
 select details into audit from public.reception_audit where resource_id=current_setting('test.correction_contact')::uuid and action='contact_corrected';
 assert audit->>'revision'='2' and audit->'changedFields' ? 'name' and audit->'changedFields' ? 'phone','Correction audit missing';
 assert position('Contato' in audit::text)=0 and position('9999' in audit::text)=0,'Audit copied personal values';
 assert (select count(*) from public.reception_audit where resource_id=current_setting('test.correction_contact')::uuid and action='contact_corrected')=1,'Failed/stale/no-op corrections duplicated audit';
 -- Preserve legacy raw phones during a name-only correction.
 update public.clinic_contacts set phone=' 9999-1234 ',phone_normalized=null where id=current_setting('test.correction_contact')::uuid;
 begin update public.clinic_contacts set clinic_id=gen_random_uuid() where id=current_setting('test.correction_contact')::uuid;raise exception 'Contact identity moved';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,2,'Stale after trusted import','');raise exception 'Trusted write did not invalidate stale revision';exception when serialization_failure then null;end;
end $$;
select public.reception_update_contact(current_setting('test.correction_contact')::uuid,3,'Nome Legado Corrigido',' 9999-1234 ');
do $$ begin assert public.reception_contact(current_setting('test.correction_contact')::uuid)->>'phone'=' 9999-1234 ','Name-only correction changed raw legacy phone';end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','Secretária Sintética',array['f1000000-0000-4000-8000-000000000001'::uuid]);
do $$ begin
 begin perform public.reception_contact_edit(current_setting('test.correction_contact')::uuid);raise exception 'Service bot read editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,4,'Bot edit','');raise exception 'Service bot bypassed human editor';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
do $$ begin
 assert public.reception_contact(current_setting('test.correction_contact')::uuid)->>'name'='Nome Legado Corrigido','Scoped read broken';
 begin perform public.reception_contact_edit(current_setting('test.correction_contact')::uuid);raise exception 'Staff got shared-contact editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,4,'Staff edit','');raise exception 'Staff edited shared metadata';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select public.create_clinic('Outra Clínica');
do $$ begin
 begin perform public.reception_contact_edit(current_setting('test.correction_contact')::uuid);raise exception 'Foreign admin read editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,4,'Foreign edit','');raise exception 'Foreign admin edited contact';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into auth.mfa_factors(user_id,status,factor_type) values('f1000000-0000-4000-8000-000000000001','verified','totp');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin
 begin perform public.reception_contact_edit(current_setting('test.correction_contact')::uuid);raise exception 'Editor bypassed MFA';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,4,'MFA bypass','');raise exception 'Correction bypassed MFA';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select public.invite_clinic_doctor(current_setting('test.correction_clinic')::uuid,'correction-doctor@example.invalid');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select public.respond_clinic_invitation(current_setting('test.correction_clinic')::uuid,true);
do $$ begin
 begin perform public.reception_contact_edit(current_setting('test.correction_contact')::uuid);raise exception 'Doctor-only read shared editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,4,'Doctor edit','');raise exception 'Doctor-only edited contact';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.clinic_members set status='inactive' where user_id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform public.reception_contact_edit(current_setting('test.correction_contact')::uuid);raise exception 'Inactive admin read editor';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_contact(current_setting('test.correction_contact')::uuid,4,'Inactive edit','');raise exception 'Inactive admin edited contact';exception when insufficient_privilege then null;end;
end $$;
rollback;
