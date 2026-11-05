begin;
insert into auth.users(id,email) values
 ('a8100000-0000-4000-8000-000000000001','links-page-admin@example.invalid'),
 ('a8100000-0000-4000-8000-000000000002','links-page-doctor@example.invalid'),
 ('a8100000-0000-4000-8000-000000000003','links-page-staff@example.invalid'),
 ('a8100000-0000-4000-8000-000000000004','links-page-foreign@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000001',true);
select set_config('test.links_page_clinic',public.create_clinic('Synthetic contact links page')::text,true);
select set_config('test.links_page_contact',public.reception_create_contact(current_setting('test.links_page_clinic')::uuid,'Synthetic page contact','','a8300000-0000-4000-8000-000000000001')::text,true);
select set_config('test.links_page_empty',public.reception_create_contact(current_setting('test.links_page_clinic')::uuid,'Synthetic empty contact','','a8300000-0000-4000-8000-000000000002')::text,true);
do $$ begin
 assert public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid)=jsonb_build_object('items','[]'::jsonb,'nextCursor',null),'Empty page contract';
end $$;
reset role;
insert into public.patients(id,user_id,name,status,medical_history)
 select ('a8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a8100000-0000-4000-8000-000000000001','Synthetic page patient '||n,'novo','SYNTHETIC PRIVATE HISTORY' from generate_series(1,53) n;
set local role authenticated;
do $$ declare patient uuid;begin
 for patient in select id from public.patients where user_id=auth.uid() order by id loop
  perform public.reception_link_patient(current_setting('test.links_page_contact')::uuid,auth.uid(),patient,'guardian');
 end loop;
end $$;
do $$ declare a jsonb;b jsonb;last_page jsonb;cursor uuid;entry jsonb;expected text[]:=array['contactId','patientId','doctorId','patientName','dateOfBirth','doctorName','relationship','revision','active','patientAvailable','doctorActive'];begin
 a:=public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid);
 assert jsonb_array_length(a->'items')=50 and a->>'nextCursor'='a8200000-0000-4000-8000-000000000050','Bounded default page';
 assert a#>>'{items,0,patientId}'='a8200000-0000-4000-8000-000000000001','Stable ascending order';
 cursor:=(a->>'nextCursor')::uuid;
 b:=public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,cursor,50);
 assert jsonb_array_length(b->'items')=3 and b->'nextCursor'='null'::jsonb,'Final page cursor';
 assert b#>>'{items,0,patientId}'='a8200000-0000-4000-8000-000000000051','No repeated boundary';
 last_page:=public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,'a8200000-0000-4000-8000-000000000053',1);
 assert last_page=jsonb_build_object('items','[]'::jsonb,'nextCursor',null),'Exhausted page';
 for entry in select value from jsonb_array_elements(a->'items') loop
  assert (select count(*) from jsonb_object_keys(entry))=cardinality(expected) and entry ?& expected,'Minimal projection only';
  assert entry=public.reception_link_edit(current_setting('test.links_page_contact')::uuid,(entry->>'patientId')::uuid),'Existing editor projection differs';
 end loop;
 assert position('PRIVATE HISTORY' in a::text)=0,'Clinical text leaked';
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,null,0);raise exception 'Zero limit accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,null,51);raise exception 'Large limit accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,null,null);raise exception 'Null limit accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_empty')::uuid,cursor,50);raise exception 'Foreign contact cursor accepted';exception when invalid_parameter_value then null;end;
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,null);raise exception 'Null contact accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.patients set archived_at=now() where id='a8200000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 assert public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,null,1)#>>'{items,0,patientAvailable}'='false','Unavailable patient hidden or incorrectly enabled';
end $$;
select public.invite_clinic_doctor(current_setting('test.links_page_clinic')::uuid,'links-page-doctor@example.invalid');
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation(current_setting('test.links_page_clinic')::uuid,true);
insert into public.patients(id,user_id,name,status) values('a8200000-0000-4000-8000-000000000055',auth.uid(),'Synthetic second doctor patient','novo');
-- Owner-built synthetic fixture: this doctor cannot view the other doctor's contact.
-- Do not add a grant just to construct the administrative reader's availability case.
reset role;
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by)
 values(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,'a8200000-0000-4000-8000-000000000055','a8100000-0000-4000-8000-000000000002','self','a8100000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_empty')::uuid);raise exception 'Doctor read admin list';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.clinic_members set status='inactive' where clinic_id=current_setting('test.links_page_clinic')::uuid and user_id='a8100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000001',true);
do $$ begin
 assert public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,'a8200000-0000-4000-8000-000000000053',1)#>>'{items,0,doctorActive}'='false','Inactive doctor flag missing';
 assert public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,'a8200000-0000-4000-8000-000000000053',1)#>>'{items,0,patientId}'='a8200000-0000-4000-8000-000000000055','Inactive physician beneficiary changed';
end $$;
reset role;
insert into public.clinic_staff_members(user_id,clinic_id,name) values('a8100000-0000-4000-8000-000000000003',current_setting('test.links_page_clinic')::uuid,'Synthetic staff');
set local role authenticated;
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_empty')::uuid);raise exception 'Staff read admin list';exception when insufficient_privilege then null;end;
 assert (select count(*) from public.patients)=0,'List widened clinical RLS';
end $$;
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000004',true);
select set_config('test.links_page_foreign',public.create_clinic('Synthetic external clinic')::text,true);
do $$ begin
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid);raise exception 'Foreign admin read links';exception when insufficient_privilege then null;end;
 begin perform public.reception_contact_links(current_setting('test.links_page_foreign')::uuid,current_setting('test.links_page_contact')::uuid);raise exception 'Contact escaped clinic';exception when insufficient_privilege then null;end;
 begin perform public.reception_contact_links(null,current_setting('test.links_page_contact')::uuid);raise exception 'Null clinic bypassed admin';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into auth.mfa_factors(user_id,status,factor_type) values('a8100000-0000-4000-8000-000000000001','verified','totp');
set local role authenticated;
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_empty')::uuid);raise exception 'Page bypassed MFA';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
do $$ begin assert jsonb_array_length(public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_contact')::uuid,null,1)->'items')=1,'AAL2 positive control';end $$;
reset role;
update public.clinic_members set status='inactive' where clinic_id=current_setting('test.links_page_clinic')::uuid and user_id='a8100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_empty')::uuid);raise exception 'Inactive admin read list';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.reception_contact_links(uuid,uuid,uuid,integer)','execute'),'Anon execute leaked';
 assert not has_function_privilege('service_role','public.reception_contact_links(uuid,uuid,uuid,integer)','execute'),'Service execute leaked';
end $$;
insert into auth.users(id,email) values('a8100000-0000-4000-8000-000000000005','links-page-deleting-admin@example.invalid');
insert into public.clinic_members(clinic_id,user_id,role,status) values(current_setting('test.links_page_clinic')::uuid,'a8100000-0000-4000-8000-000000000005','admin','active');
insert into public.account_deletion_requests(user_id) values('a8100000-0000-4000-8000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000005',true);
do $$ begin
 begin perform public.reception_contact_links(current_setting('test.links_page_clinic')::uuid,current_setting('test.links_page_empty')::uuid);raise exception 'Deleting admin read list';exception when insufficient_privilege then null;end;
end $$;
rollback;
