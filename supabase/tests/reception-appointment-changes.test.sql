begin;
insert into auth.users(id,email) values
 ('bf100000-0000-4000-8000-000000000001','change-doctor@example.invalid'),
 ('bf100000-0000-4000-8000-000000000002','change-reception@example.invalid'),
 ('bf100000-0000-4000-8000-000000000003','change-outsider@example.invalid');
insert into public.patients(id,user_id,name,status,medical_history) values
 ('bf500000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001','Pessoa sintética agenda','novo','PRIVATE SYNTHETIC HISTORY');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bf100000-0000-4000-8000-000000000001';
select set_config('test.change_clinic',public.create_clinic('Clínica sintética alterações')::text,true);
insert into public.appointments(user_id,title,start_time,end_time) values(auth.uid(),'Ocupação sintética','2099-12-10T13:00Z','2099-12-10T13:30Z');
set local request.jwt.claim.sub='bf100000-0000-4000-8000-000000000003';
select set_config('test.change_other_clinic',public.create_clinic('Outra clínica sintética alterações')::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('bf100000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000002','Recepção sintética alterações',array['bf100000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='bf100000-0000-4000-8000-000000000002';
select set_config('test.change_contact',public.reception_create_contact(current_setting('test.change_clinic')::uuid,'Contato sintético alterações','41999990000',gen_random_uuid())::text,true);
select public.reception_link_patient(current_setting('test.change_contact')::uuid,'bf100000-0000-4000-8000-000000000001','bf500000-0000-4000-8000-000000000001','self');
select set_config('test.change_booking',public.reception_book_appointment(current_setting('test.change_clinic')::uuid,
 jsonb_build_object('doctorId','bf100000-0000-4000-8000-000000000001','contactId',current_setting('test.change_contact'),'patientId','bf500000-0000-4000-8000-000000000001','startTime','2099-12-10T12:00Z','endTime','2099-12-10T12:30Z','type','retorno'),gen_random_uuid())::text,true);
do $$ declare missing uuid; message text;begin
 foreach missing in array array[null::uuid,'bf600000-0000-4000-8000-000000000099'::uuid] loop
  begin
   perform public.reception_change_appointment(current_setting('test.change_clinic')::uuid,missing,1,'cancel');
   raise exception 'Missing appointment succeeded';
  exception when insufficient_privilege then
   get stacked diagnostics message=message_text;
   assert message='Agendamento indisponível','Missing appointment exposed an internal failure: '||message;
  end;
 end loop;
 begin
  perform public.reception_change_appointment(current_setting('test.change_other_clinic')::uuid,current_setting('test.change_booking')::uuid,1,'cancel');
  raise exception 'Wrong clinic succeeded';
 exception when insufficient_privilege then
  get stacked diagnostics message=message_text;
  assert message='Agendamento indisponível','Cross-clinic appointment leaked another distinction';
 end;
 assert (select count(*) from public.patients)=0,'Reception gained clinical data';
end $$;
set local request.jwt.claim.sub='bf100000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.reception_change_appointment(current_setting('test.change_clinic')::uuid,current_setting('test.change_booking')::uuid,1,'cancel');raise exception 'Undelegated actor changed appointment';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('test.change_before',row_to_json(a)::text,true) from public.appointments a where id=current_setting('test.change_booking')::uuid;
select set_config('test.change_audit_before',count(*)::text,true) from public.reception_audit;
select set_config('test.change_version_before',revision::text,true) from public.reception_calendar_versions where doctor_user_id='bf100000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='bf100000-0000-4000-8000-000000000002';
do $$ begin
 begin perform public.reception_change_appointment(current_setting('test.change_clinic')::uuid,current_setting('test.change_booking')::uuid,0,'cancel');raise exception 'Stale revision succeeded';exception when serialization_failure then null;end;
 begin perform public.reception_change_appointment(current_setting('test.change_clinic')::uuid,current_setting('test.change_booking')::uuid,1,'reschedule','2099-12-10T13:10Z','2099-12-10T13:20Z');raise exception 'Conflict was overwritten';exception when exclusion_violation then null;end;
 begin perform public.reception_change_appointment(current_setting('test.change_clinic')::uuid,current_setting('test.change_booking')::uuid,1,'invalid');raise exception 'Invalid action succeeded';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$ begin
 assert (select row_to_json(a)::jsonb from public.appointments a where id=current_setting('test.change_booking')::uuid)=current_setting('test.change_before')::jsonb,'Refused changes modified appointment';
 assert (select count(*) from public.reception_audit)=current_setting('test.change_audit_before')::bigint,'Refused changes left audit writes';
 assert (select revision from public.reception_calendar_versions where doctor_user_id='bf100000-0000-4000-8000-000000000001')=current_setting('test.change_version_before')::bigint,'Refused changes left calendar versions';
end $$;
insert into auth.mfa_factors(user_id,status,factor_type) values('bf100000-0000-4000-8000-000000000002','verified','totp');
set local role authenticated;
set local request.jwt.claims='{"aal":"aal1"}';
do $$ declare target uuid; message text;begin
 foreach target in array array[current_setting('test.change_booking')::uuid,null::uuid,'bf600000-0000-4000-8000-000000000099'::uuid] loop
  begin perform public.reception_change_appointment(current_setting('test.change_clinic')::uuid,target,1,'cancel');raise exception 'Incomplete MFA accepted';
  exception when insufficient_privilege then
   get stacked diagnostics message=message_text;
   assert message='Verifique o segundo fator da sessão','Appointment availability bypassed session assurance';
  end;
 end loop;
 begin perform public.reception_change_appointment(current_setting('test.change_other_clinic')::uuid,current_setting('test.change_booking')::uuid,1,'cancel');raise exception 'Cross-clinic incomplete MFA accepted';
 exception when insufficient_privilege then
  get stacked diagnostics message=message_text;
  assert message='Verifique o segundo fator da sessão','Cross-clinic availability bypassed session assurance';
 end;
end $$;
set local request.jwt.claims='{"aal":"aal2"}';
do $$ begin assert public.reception_change_appointment(current_setting('test.change_clinic')::uuid,current_setting('test.change_booking')::uuid,1,'confirm')=2,'AAL2 confirmation failed';end $$;
rollback;
