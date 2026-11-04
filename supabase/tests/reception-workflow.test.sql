begin;
insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000001','queue-admin@example.invalid'),
 ('b1000000-0000-4000-8000-000000000002','queue-doctor@example.invalid'),
 ('b1000000-0000-4000-8000-000000000003','queue-staff-a@example.invalid'),
 ('b1000000-0000-4000-8000-000000000004','queue-staff-b@example.invalid');
insert into public.patients(id,user_id,name,status,date_of_birth,medical_history) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Filho Exemplo','retorno','2015-01-01','NEVER RETURN THIS'),
 ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Outro Exemplo','novo',null,'PRIVATE');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('test.queue_clinic',public.create_clinic('Clínica Fila')::text,true);
select public.invite_clinic_doctor(current_setting('test.queue_clinic')::uuid,'queue-doctor@example.invalid');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation(current_setting('test.queue_clinic')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','Secretária A',array['b1000000-0000-4000-8000-000000000001'::uuid]);
select public.provision_clinic_receptionist('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004','Secretária B',array['b1000000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select set_config('test.queue_contact',public.reception_create_contact(current_setting('test.queue_clinic')::uuid,'Mãe Exemplo','(41) 99999-0000','b3000000-0000-4000-8000-000000000001')::text,true);
select public.reception_link_patient(current_setting('test.queue_contact')::uuid,'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','guardian');
select set_config('test.queue_case',public.reception_create_case(current_setting('test.queue_contact')::uuid,'b1000000-0000-4000-8000-000000000001','Agendar retorno','return','b3000000-0000-4000-8000-000000000002')::text,true);
do $$ declare data jsonb; id uuid; begin
 id:=public.reception_create_case(current_setting('test.queue_contact')::uuid,'b1000000-0000-4000-8000-000000000001','Agendar retorno','return','b3000000-0000-4000-8000-000000000002');
 assert id=current_setting('test.queue_case')::uuid,'Retry duplicated case';
 begin perform public.reception_create_case(current_setting('test.queue_contact')::uuid,'b1000000-0000-4000-8000-000000000001','DIFFERENT','return','b3000000-0000-4000-8000-000000000002');raise exception 'Request changed contents';exception when invalid_parameter_value then null;end;
 data:=public.reception_patient_search(current_setting('test.queue_clinic')::uuid,'b1000000-0000-4000-8000-000000000001','Filho');
 assert jsonb_array_length(data)=1 and position('NEVER RETURN THIS' in data::text)=0,'Clinical fields leaked';
 begin perform public.reception_patient_search(current_setting('test.queue_clinic')::uuid,'b1000000-0000-4000-8000-000000000002','Outro');raise exception 'Undelegated directory read';exception when insufficient_privilege then null;end;
 assert (select count(*) from public.patients)=0,'Contact linking widened clinical RLS';
 assert jsonb_array_length(public.reception_contacts(current_setting('test.queue_clinic')::uuid,'999990000',null)->'items')=1,'Normalized phone search failed';
end $$;
select public.reception_update_case(current_setting('test.queue_case')::uuid,1,'claim','{}');
select public.reception_save_draft(current_setting('test.queue_case')::uuid,'Ligar para confirmar horário',0);
do $$ declare d jsonb; begin
 d:=public.reception_case(current_setting('test.queue_case')::uuid);
 assert d->'draft'->>'body'='Ligar para confirmar horário','Server draft missing';
 begin perform public.reception_save_draft(current_setting('test.queue_case')::uuid,'Stale overwrite',0);raise exception 'Other tab overwrote draft';exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
do $$ begin
 begin perform public.reception_update_case(current_setting('test.queue_case')::uuid,1,'claim','{}');raise exception 'Case double claimed';exception when serialization_failure then null;end;
 assert public.reception_case(current_setting('test.queue_case')::uuid)->'draft'->>'body'='','Draft leaked to another staff';
 begin perform public.reception_add_note(current_setting('test.queue_case')::uuid,'Not my case','b3000000-0000-4000-8000-000000000003');raise exception 'Non-assignee changed case';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select public.reception_add_note(current_setting('test.queue_case')::uuid,'Orientação administrativa de teste','b3000000-0000-4000-8000-000000000003');
select public.reception_add_note(current_setting('test.queue_case')::uuid,'Orientação administrativa de teste','b3000000-0000-4000-8000-000000000003');
select public.reception_update_case(current_setting('test.queue_case')::uuid,2,'transfer','{"assigneeId":"b1000000-0000-4000-8000-000000000004"}');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
do $$ begin assert public.reception_case(current_setting('test.queue_case')::uuid)->>'noteCount'='1','Note retry duplicated entry';end $$;
select public.reception_update_case(current_setting('test.queue_case')::uuid,3,'status','{"status":"resolved"}');
select public.reception_update_case(current_setting('test.queue_case')::uuid,4,'reopen','{}');
select public.reception_update_case(current_setting('test.queue_case')::uuid,5,'claim','{}');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.reception_update_case(current_setting('test.queue_case')::uuid,6,'route','{"doctorId":"b1000000-0000-4000-8000-000000000002"}');
do $$ declare d jsonb; begin
 d:=public.reception_case(current_setting('test.queue_case')::uuid);
 assert d->>'assignedTo' is null and d->>'status'='new','Routing retained an assignee without the new agenda';
end $$;
-- Keep staff A active on another agenda: authorship must not retain an old contact.
select public.update_reception_staff('b1000000-0000-4000-8000-000000000003',array['b1000000-0000-4000-8000-000000000001'::uuid,'b1000000-0000-4000-8000-000000000002'::uuid],true);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select set_config('test.revoked_contact',public.reception_create_contact(current_setting('test.queue_clinic')::uuid,'Contato do escopo antigo','41999990001','b3000000-0000-4000-8000-000000000005')::text,true);
select public.reception_link_patient(current_setting('test.revoked_contact')::uuid,'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','self');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.update_reception_staff('b1000000-0000-4000-8000-000000000003',array['b1000000-0000-4000-8000-000000000002'::uuid],true);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.reception_contact(current_setting('test.revoked_contact')::uuid);raise exception 'Creator retained revoked contact';exception when insufficient_privilege then null;end;
 assert jsonb_array_length(public.reception_contacts(current_setting('test.queue_clinic')::uuid,'Contato do escopo antigo',null)->'items')=0,'Revoked contact remained searchable';
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
do $$ begin
 begin perform public.reception_save_draft(current_setting('test.queue_case')::uuid,'Old agenda draft',0);raise exception 'Routed case draft writable with old scope';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.clinic_members set status='inactive' where user_id='b1000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
do $$ declare d jsonb; begin
 d:=public.reception_case(current_setting('test.queue_case')::uuid);
 assert d->>'doctorId' is null and d->>'status'='new','Offboarded physician work disappeared instead of returning to intake';
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.update_reception_staff('b1000000-0000-4000-8000-000000000004','{}',false);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
do $$ begin
 begin perform public.reception_case(current_setting('test.queue_case')::uuid);raise exception 'Inactive staff retained case';exception when insufficient_privilege then null;end;
end $$;
rollback;
