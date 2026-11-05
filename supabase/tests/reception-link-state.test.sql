begin;
insert into auth.users(id,email) values
 ('a9100000-0000-4000-8000-000000000001','state-admin@example.invalid'),
 ('a9100000-0000-4000-8000-000000000002','state-staff@example.invalid');
insert into public.patients(id,user_id,name,status) values('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','Synthetic state beneficiary','novo');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9100000-0000-4000-8000-000000000001',true);
select set_config('test.state_clinic',public.create_clinic('Synthetic link state clinic')::text,true);
select set_config('test.state_contact',public.reception_create_contact(current_setting('test.state_clinic')::uuid,'Synthetic state contact','','a9300000-0000-4000-8000-000000000001')::text,true);
select public.reception_link_patient(current_setting('test.state_contact')::uuid,auth.uid(),'a9200000-0000-4000-8000-000000000001','guardian');
select set_config('test.state_slot',public.reception_book_appointment(current_setting('test.state_clinic')::uuid,jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.state_contact')::uuid,'patientId','a9200000-0000-4000-8000-000000000001','startTime','2099-11-03T12:00:00Z','endTime','2099-11-03T12:30:00Z','type','retorno'),'a9300000-0000-4000-8000-000000000002')::text,true);
do $$ declare revision integer;begin
 revision:=public.reception_set_link_active(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',1,false);
 assert revision=2,'Suspension revision';
 assert public.reception_link_edit(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001')->>'active'='false','Suspended editor state';
 assert public.reception_contact_links(current_setting('test.state_clinic')::uuid,current_setting('test.state_contact')::uuid)#>>'{items,0,active}'='false','Suspended page state';
 assert jsonb_array_length(public.reception_contact(current_setting('test.state_contact')::uuid)->'beneficiaries')=0,'Operational reader includes suspended link';
 assert public.reception_set_link_active(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',2,false)=2,'State no-op changed revision';
 begin perform public.reception_set_link_active(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',1,true);raise exception 'Stale state accepted';exception when serialization_failure then null;end;
 begin perform public.reception_link_patient(current_setting('test.state_contact')::uuid,auth.uid(),'a9200000-0000-4000-8000-000000000001','guardian');raise exception 'Old confirmation reactivated';exception when insufficient_privilege then null;end;
 begin perform public.reception_update_link_relationship(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',2,'family');raise exception 'Inactive relationship edited';exception when insufficient_privilege then null;end;
 begin perform public.reception_book_appointment(current_setting('test.state_clinic')::uuid,jsonb_build_object('doctorId',auth.uid(),'contactId',current_setting('test.state_contact')::uuid,'patientId','a9200000-0000-4000-8000-000000000001','startTime','2099-11-03T13:00:00Z','endTime','2099-11-03T13:30:00Z','type','retorno'),'a9300000-0000-4000-8000-000000000003');raise exception 'Suspended link booked';exception when insufficient_privilege then null;end;
 begin perform public.reception_change_appointment(current_setting('test.state_clinic')::uuid,current_setting('test.state_slot')::uuid,1,'reschedule','2099-11-03T14:00Z','2099-11-03T14:30Z');raise exception 'Suspended link rescheduled';exception when insufficient_privilege then null;end;
 assert public.reception_change_appointment(current_setting('test.state_clinic')::uuid,current_setting('test.state_slot')::uuid,1,'confirm')=2,'Historical confirmation blocked';
 assert public.reception_change_appointment(current_setting('test.state_clinic')::uuid,current_setting('test.state_slot')::uuid,2,'check_in')=3,'Historical arrival blocked';
 assert public.reception_change_appointment(current_setting('test.state_clinic')::uuid,current_setting('test.state_slot')::uuid,3,'undo_check_in')=4,'Historical undo arrival blocked';
 assert public.reception_change_appointment(current_setting('test.state_clinic')::uuid,current_setting('test.state_slot')::uuid,4,'cancel')=5,'Historical cancellation blocked';
end $$;
reset role;
do $$ begin
 begin update public.appointments set status='agendado' where id=current_setting('test.state_slot')::uuid;raise exception 'Raw reopen bypassed state';exception when insufficient_privilege then null;end;
 begin update public.appointments set start_time='2099-11-03T15:00Z',end_time='2099-11-03T15:30Z' where id=current_setting('test.state_slot')::uuid;raise exception 'Raw interval bypassed state';exception when insufficient_privilege then null;end;
 assert (select count(*)=1 from public.reception_audit where action='beneficiary_suspended' and resource_id=current_setting('test.state_contact')::uuid),'Suspension audit duplicated';
end $$;
set local role authenticated;
do $$ begin
 assert public.reception_set_link_active(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',2,true)=3,'Reactivation failed';
 begin perform public.reception_set_link_active(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',1,false);raise exception 'Old suspension replay won';exception when serialization_failure then null;end;
end $$;
reset role;
do $$ begin
 assert (select relationship='guardian' and confirmed_by='a9100000-0000-4000-8000-000000000001' and revision=3 from public.patient_contact_links where contact_id=current_setting('test.state_contact')::uuid),'State rewrote relationship or original identity';
 assert not has_function_privilege('anon','public.reception_set_link_active(uuid,uuid,integer,boolean)','execute'),'Anonymous state writer';
 assert not has_function_privilege('service_role','public.reception_set_link_active(uuid,uuid,integer,boolean)','execute'),'Service state writer';
end $$;
set local role authenticated;
select public.reception_set_link_active(current_setting('test.state_contact')::uuid,'a9200000-0000-4000-8000-000000000001',3,false);
reset role;
set local session_replication_role='replica';
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ begin
 begin update public.patient_contact_links set active=true where contact_id=current_setting('test.state_contact')::uuid;raise exception 'Replica bypassed administrative state';exception when insufficient_privilege then null;end;
 begin update public.appointments set patient_id=gen_random_uuid() where id=current_setting('test.state_slot')::uuid;raise exception 'Replica reassigned historical beneficiary';exception when insufficient_privilege then null;end;
 begin update public.appointments set start_time='2099-11-03T15:00Z',end_time='2099-11-03T15:30Z' where id=current_setting('test.state_slot')::uuid;raise exception 'Replica bypassed inactive link interval guard';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local session_replication_role='origin';
do $$ begin
 assert (select not active and revision=4 from public.patient_contact_links where contact_id=current_setting('test.state_contact')::uuid),'Replica changed link state or revision';
 assert (select patient_id='a9200000-0000-4000-8000-000000000001' and status='cancelado' and start_time='2099-11-03T12:00Z'::timestamptz from public.appointments where id=current_setting('test.state_slot')::uuid),'Replica changed historical appointment';
end $$;
rollback;
