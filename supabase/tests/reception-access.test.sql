begin;
insert into auth.users(id,email) values
 ('a1000000-0000-4000-8000-000000000001','reception-admin@example.invalid'),
 ('a1000000-0000-4000-8000-000000000002','reception-doctor@example.invalid'),
 ('a1000000-0000-4000-8000-000000000003','reception-staff@example.invalid'),
 ('a1000000-0000-4000-8000-000000000004','reception-outsider@example.invalid');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Paciente privado A','retorno','PRIVATE HISTORY'),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','Paciente privado B','novo','PRIVATE HISTORY B');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('test.reception_clinic',public.create_clinic('Clínica de Teste')::text,true);
select public.invite_clinic_doctor(current_setting('test.reception_clinic')::uuid,'reception-doctor@example.invalid');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation(current_setting('test.reception_clinic')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_clinic_receptionist('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','Secretária Teste',array['a1000000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
do $$ declare access jsonb; begin
 access:=public.clinic_access();
 assert access->>'kind'='reception' and (access->>'active')::boolean,'Reception identity missing';
 assert jsonb_array_length(access->'doctors')=1,'Undelegated doctor exposed';
 assert (select count(*) from public.patients)=0,'Reception can read private charts';
 assert (select count(*) from public.consultations)=0,'Reception can read consultations';
 begin perform public.sharing_overview();raise exception 'Reception entered clinical sharing';exception when insufficient_privilege then null;end;
 begin perform public.create_clinic('Escalation');raise exception 'Reception created a clinical admin account';exception when insufficient_privilege then null;end;
 begin perform public.workspace_directory();raise exception 'Clinical directory leaked';exception when insufficient_privilege then null;end;
 begin perform public.list_patient_chat_turns('a2000000-0000-4000-8000-000000000001');raise exception 'Clinical conversation leaked';exception when insufficient_privilege then null;end;
 begin insert into public.patients(user_id,name,status) values(auth.uid(),'Forbidden self chart','novo');raise exception 'Reception created clinical records';exception when insufficient_privilege then null;end;
 begin perform public.update_reception_staff('a1000000-0000-4000-8000-000000000003',array['a1000000-0000-4000-8000-000000000002'::uuid],true);raise exception 'Staff self-elevated';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
do $$ begin
 assert (select count(*) from public.patients)=1,'Doctor private directory changed';
 begin perform public.invite_clinic_doctor(current_setting('test.reception_clinic')::uuid,'reception-staff@example.invalid');raise exception 'Reception promoted through medical invitation';exception when insufficient_privilege then null;end;
end $$;
select public.update_reception_staff('a1000000-0000-4000-8000-000000000003',array['a1000000-0000-4000-8000-000000000002'::uuid],true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
do $$ begin assert public.clinic_access()->'doctors'->0->>'id'='a1000000-0000-4000-8000-000000000002','Scope update not immediate';end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select public.update_reception_staff('a1000000-0000-4000-8000-000000000003','{}'::uuid[],false);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
do $$ begin
 assert not (public.clinic_access()->>'active')::boolean,'Offboarding retained access';
 begin perform public.sharing_overview();raise exception 'Inactive staff became a clinical user';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
do $$ begin assert public.clinic_access()->>'kind'='clinical','Existing standalone clinician blocked';end $$;
rollback;
