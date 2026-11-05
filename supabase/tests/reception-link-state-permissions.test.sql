begin;
insert into auth.users(id,email) values
 ('aa100000-0000-4000-8000-000000000001','state-permissions-admin@example.invalid'),
 ('aa100000-0000-4000-8000-000000000002','state-permissions-staff@example.invalid'),
 ('aa100000-0000-4000-8000-000000000003','state-permissions-doctor@example.invalid'),
 ('aa100000-0000-4000-8000-000000000004','state-permissions-foreign@example.invalid');
insert into public.patients(id,user_id,name,status) values
 ('aa200000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','Synthetic permissions patient','novo'),
 ('aa200000-0000-4000-8000-000000000002','aa100000-0000-4000-8000-000000000003','Synthetic inactive doctor patient','novo');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000001';
select set_config('test.state_p_clinic',public.create_clinic('Synthetic state permissions')::text,true);
select set_config('test.state_p_contact',public.reception_create_contact(current_setting('test.state_p_clinic')::uuid,'Synthetic no-case contact','','aa300000-0000-4000-8000-000000000001')::text,true);
select set_config('test.state_p_case_contact',public.reception_create_contact(current_setting('test.state_p_clinic')::uuid,'Synthetic case contact','','aa300000-0000-4000-8000-000000000002')::text,true);
select public.reception_link_patient(current_setting('test.state_p_contact')::uuid,auth.uid(),'aa200000-0000-4000-8000-000000000001','guardian');
select public.reception_link_patient(current_setting('test.state_p_case_contact')::uuid,auth.uid(),'aa200000-0000-4000-8000-000000000001','guardian');
select set_config('test.state_p_case',public.reception_create_case(current_setting('test.state_p_case_contact')::uuid,auth.uid(),'Synthetic scoped case','scheduling','aa300000-0000-4000-8000-000000000003')::text,true);
select public.invite_clinic_doctor(current_setting('test.state_p_clinic')::uuid,'state-permissions-doctor@example.invalid');
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000003';
select public.respond_clinic_invitation(current_setting('test.state_p_clinic')::uuid,true);
do $$ begin
 begin perform public.reception_set_link_active(current_setting('test.state_p_contact')::uuid,'aa200000-0000-4000-8000-000000000001',1,false);raise exception 'Non-admin changed state';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000004';
select public.create_clinic('Synthetic external state clinic');
do $$ begin
 begin perform public.reception_set_link_active(current_setting('test.state_p_contact')::uuid,'aa200000-0000-4000-8000-000000000001',1,false);raise exception 'Foreign admin changed state';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.provision_clinic_receptionist('aa100000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000002','Synthetic state receptionist',array['aa100000-0000-4000-8000-000000000001'::uuid]);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000002';
do $$ begin
 assert public.reception_contact(current_setting('test.state_p_contact')::uuid)->>'id'=current_setting('test.state_p_contact'),'Missing scoped active-link positive control';
 begin perform public.reception_set_link_active(current_setting('test.state_p_contact')::uuid,'aa200000-0000-4000-8000-000000000001',1,false);raise exception 'Reception changed state';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000001';
select public.reception_set_link_active(current_setting('test.state_p_contact')::uuid,'aa200000-0000-4000-8000-000000000001',1,false);
select public.reception_set_link_active(current_setting('test.state_p_case_contact')::uuid,'aa200000-0000-4000-8000-000000000001',1,false);
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000002';
do $$ begin
 begin perform public.reception_contact(current_setting('test.state_p_contact')::uuid);raise exception 'Suspended historical link became an orphan visible to every queue';exception when insufficient_privilege then null;end;
 assert public.reception_contact(current_setting('test.state_p_case_contact')::uuid)->>'id'=current_setting('test.state_p_case_contact'),'Independent scoped case disappeared';
 assert jsonb_array_length(public.reception_case(current_setting('test.state_p_case')::uuid)->'beneficiaries')=0,'Case disclosed suspended beneficiary';
 assert (select count(*) from public.patients)=0,'State widened private charts';
end $$;
reset role;
update public.patients set archived_at=now() where id='aa200000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='aa100000-0000-4000-8000-000000000001';
do $$ begin
 begin perform public.reception_set_link_active(current_setting('test.state_p_contact')::uuid,'aa200000-0000-4000-8000-000000000001',2,true);raise exception 'Archived patient reactivated';exception when insufficient_privilege then null;end;
 assert public.reception_set_link_active(current_setting('test.state_p_contact')::uuid,'aa200000-0000-4000-8000-000000000001',2,false)=2,'Unavailable patient suspension no-op failed';
end $$;
reset role;
-- Owner-built second-doctor fixture; no operational delegation is granted.
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by)
 values(current_setting('test.state_p_clinic')::uuid,current_setting('test.state_p_case_contact')::uuid,'aa200000-0000-4000-8000-000000000002','aa100000-0000-4000-8000-000000000003','self','aa100000-0000-4000-8000-000000000003');
update public.clinic_members set status='inactive' where clinic_id=current_setting('test.state_p_clinic')::uuid and user_id='aa100000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ begin
 assert public.reception_set_link_active(current_setting('test.state_p_case_contact')::uuid,'aa200000-0000-4000-8000-000000000002',1,false)=2,'Inactive doctor could not be suspended';
 begin perform public.reception_set_link_active(current_setting('test.state_p_case_contact')::uuid,'aa200000-0000-4000-8000-000000000002',2,true);raise exception 'Inactive doctor reactivated';exception when insufficient_privilege then null;end;
 begin perform public.reception_set_link_active(current_setting('test.state_p_case_contact')::uuid,'aa200000-0000-4000-8000-000000000002',2,null);raise exception 'Null state accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
insert into auth.mfa_factors(user_id,status,factor_type) values('aa100000-0000-4000-8000-000000000001','verified','totp');
set local role authenticated;
set local request.jwt.claims='{"aal":"aal1"}';
do $$ begin
 begin perform public.reception_set_link_active(current_setting('test.state_p_case_contact')::uuid,'aa200000-0000-4000-8000-000000000002',2,false);raise exception 'State bypassed MFA';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
