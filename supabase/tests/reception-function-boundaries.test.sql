-- Catalog coverage is deliberately explicit: a new callable SECURITY DEFINER
-- function needs a boundary review, even when its name resembles an existing RPC.
begin;

-- Supabase grants EXECUTE directly as well as through PUBLIC. A plain PostgreSQL
-- bootstrap would miss leaks caused by revoking only PUBLIC.
create function public.test_default_function_acl() returns boolean language sql as $$ select true $$;
do $$ begin
 assert has_function_privilege('anon','public.test_default_function_acl()','execute'), 'Bootstrap must reproduce the Supabase anon function default';
 assert has_function_privilege('authenticated','public.test_default_function_acl()','execute'), 'Bootstrap must reproduce the Supabase authenticated function default';
 -- Remove PUBLIC separately to prove the direct grants are really present.
end $$;
revoke execute on function public.test_default_function_acl() from public;
do $$ begin
 assert has_function_privilege('anon','public.test_default_function_acl()','execute'), 'Missing direct anon default grant';
 assert has_function_privilege('authenticated','public.test_default_function_acl()','execute'), 'Missing direct authenticated default grant';
 assert has_function_privilege('service_role','public.test_default_function_acl()','execute'), 'Missing direct service default grant';
end $$;
drop function public.test_default_function_acl();

create temporary table reviewed_definer_api(signature regprocedure primary key, boundary text not null);
insert into reviewed_definer_api values
 ('public.append_shared_chart_entry(uuid,integer,text,text,uuid)', 'clinical'),
 ('public.approve_medication_reconciliation(uuid,integer,integer)', 'clinical'),
 ('public.archive_document_snippet(uuid,integer)', 'clinical'),
 ('public.assert_session_assurance()', 'session'),
 ('public.check_shared_patient_access(uuid)', 'clinical'),
 ('public.check_shared_protocol_access(uuid)', 'clinical'),
 ('public.clinic_access()', 'access'),
 ('public.clinical_account_writable()', 'clinical_predicate'),
 ('public.clinical_session_allowed()', 'clinical_predicate'),
 ('public.create_clinic(text)', 'clinical'),
 ('public.create_knowledge_source(text,text,text,text,uuid)', 'clinical'),
 ('public.delete_knowledge_source(uuid)', 'clinical'),
 ('public.finalize_manual_encounter(uuid,integer)', 'clinical'),
 ('public.get_integration_status(uuid)', 'clinical'),
 ('public.get_shared_patient_chart(uuid,integer)', 'clinical'),
 ('public.get_shared_protocol(uuid)', 'clinical'),
 ('public.grant_patient_share(uuid,uuid,text,boolean,timestamptz)', 'clinical'),
 ('public.grant_protocol_share(uuid,uuid)', 'clinical'),
 ('public.invite_clinic_doctor(uuid,text)', 'clinical'),
 ('public.leave_clinic(uuid)', 'clinical'),
 ('public.list_patient_chat_turns(uuid,uuid,integer)', 'clinical'),
 ('public.match_knowledge(uuid,vector,integer)', 'knowledge_search'),
 ('public.offboard_clinic_doctor(uuid,uuid)', 'clinical'),
 ('public.patient_sharing_audit(uuid)', 'clinical'),
 ('public.protocol_sharing_overview(uuid,text,integer)', 'clinical'),
 ('public.reception_add_note(uuid,text,uuid)', 'reception'),
 ('public.reception_appointments(uuid,timestamptz,timestamptz,uuid)', 'reception'),
 ('public.reception_block_time(uuid,uuid,timestamptz,timestamptz,text,uuid)', 'reception'),
 ('public.reception_book_appointment(uuid,jsonb,uuid)', 'reception'),
 ('public.reception_case(uuid,uuid)', 'reception'),
 ('public.reception_change_appointment(uuid,uuid,integer,text,timestamptz,timestamptz)', 'reception'),
 ('public.reception_contact_edit(uuid)', 'reception'),
 ('public.reception_contacts(uuid,text,uuid)', 'reception'),
 ('public.reception_contact(uuid)', 'reception'),
 ('public.reception_create_case(uuid,uuid,text,text,uuid)', 'reception'),
 ('public.reception_create_contact(uuid,text,text,uuid)', 'reception'),
 ('public.reception_link_edit(uuid,uuid)', 'reception'),
 ('public.reception_link_patient(uuid,uuid,uuid,text)', 'reception'),
 ('public.reception_patient_search(uuid,uuid,text)', 'reception'),
 ('public.reception_queue(uuid,text,boolean,uuid,uuid)', 'reception'),
 ('public.reception_save_draft(uuid,text,integer)', 'reception'),
 ('public.reception_team_doctors(uuid)', 'administration'),
 ('public.reception_unblock_time(uuid,integer)', 'reception'),
 ('public.reception_update_case(uuid,integer,text,jsonb)', 'reception'),
 ('public.reception_update_contact(uuid,integer,text,text)', 'reception'),
 ('public.reception_update_link_relationship(uuid,uuid,integer,text)', 'reception'),
 ('public.respond_clinic_invitation(uuid,boolean)', 'clinical'),
 ('public.review_document_proposal(uuid,integer,text,boolean)', 'clinical'),
 ('public.review_history_proposal(uuid,integer,integer,text,text,boolean)', 'clinical'),
 ('public.review_knowledge_source(uuid,boolean)', 'clinical'),
 ('public.revoke_patient_share(uuid)', 'clinical'),
 ('public.revoke_prescription(uuid)', 'clinical'),
 ('public.revoke_protocol_share(uuid)', 'clinical'),
 ('public.save_document_snippet(uuid,integer,text,jsonb)', 'clinical'),
 ('public.session_assurance_ok()', 'session'),
 ('public.sharing_overview()', 'clinical'),
 ('public.storage_upload_allowed(text,text)', 'storage'),
 ('public.update_reception_staff(uuid,uuid[],boolean)', 'administration'),
 ('public.update_user_settings(jsonb)', 'clinical'),
 ('public.workspace_directory(integer)', 'clinical');

do $$ declare unexpected text; begin
 -- Trigger functions cannot be invoked as ordinary RPCs; row-trigger behavior
 -- is covered in the workflow/custody suites instead of this callable API list.
 select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into unexpected
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype
 and has_function_privilege('anon',p.oid,'execute');
 assert unexpected is null, 'Anonymous SECURITY DEFINER API: ' || unexpected;

 select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into unexpected
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype
 and has_function_privilege('authenticated',p.oid,'execute')
 and not exists(select 1 from reviewed_definer_api r where r.signature=p.oid);
 assert unexpected is null, 'Unreviewed authenticated SECURITY DEFINER API: ' || unexpected;

 assert not exists(select 1 from reviewed_definer_api r join pg_proc p on p.oid=r.signature
  where not p.prosecdef or not has_function_privilege('authenticated',p.oid,'execute')),
  'Reviewed API disappeared or changed its security/ACL contract';
end $$;

insert into auth.users(id,email) values
 ('b9100000-0000-4000-8000-000000000001','catalog-doctor@example.invalid'),
 ('b9100000-0000-4000-8000-000000000002','catalog-reception@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b9100000-0000-4000-8000-000000000001',true);
select set_config('test.catalog_clinic',public.create_clinic('Synthetic catalog fixture')::text,true);
insert into public.patients(id,user_id,name,status) values
 ('b9200000-0000-4000-8000-000000000001',auth.uid(),'Synthetic catalog patient','novo');
select set_config('test.catalog_path','patients/'||auth.uid()||'/b9200000-0000-4000-8000-000000000001/file.pdf',true);
select set_config('test.catalog_source',public.create_knowledge_source('Synthetic catalog source','Synthetic approved source content.','Synthetic source','v1')::text,true);
select public.review_knowledge_source(current_setting('test.catalog_source')::uuid,true);
select set_config('test.catalog_vector','[1,'||repeat('0,',766)||'0]',true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_knowledge_index('b9100000-0000-4000-8000-000000000001',current_setting('test.catalog_source')::uuid);
select public.finish_knowledge_index('b9100000-0000-4000-8000-000000000001',current_setting('test.catalog_source')::uuid,1,
 jsonb_build_array(jsonb_build_object('content','Synthetic approved source content.','embedding',current_setting('test.catalog_vector')::jsonb)));
select public.provision_clinic_receptionist('b9100000-0000-4000-8000-000000000001',
 'b9100000-0000-4000-8000-000000000002','Synthetic reception',array['b9100000-0000-4000-8000-000000000001'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
do $$ begin
 assert public.storage_upload_allowed(current_setting('test.catalog_path'),'patient-files'), 'Owned storage positive control missing';
 assert (select count(*) from public.match_knowledge(auth.uid(),current_setting('test.catalog_vector')::public.vector,5))=1,
  'Approved knowledge positive control missing';
end $$;
reset role;
grant select on reviewed_definer_api to authenticated;

-- Keep the assertion helper invoker-only. Exercise the installed definitions,
-- including indirect guards and future CREATE OR REPLACE changes, rather than
-- accepting a guard's name in a comment/string as proof of protection.
create function pg_temp.assert_reception_clinical_boundaries() returns void language plpgsql as $$
declare fn record; arguments text; blocked boolean; checked integer:=0;
begin
 for fn in select p.*,r.boundary from pg_proc p join reviewed_definer_api r on r.signature=p.oid
  where r.boundary in ('clinical','administration') loop
  select string_agg(format('NULL::%s',t::regtype),',' order by position) into arguments
   from unnest(fn.proargtypes::oid[]) with ordinality a(t,position);
  blocked:=false;
  begin
   execute format('select public.%I(%s)',fn.proname,coalesce(arguments,''));
  exception when insufficient_privilege then
   -- Missing/null resources can independently produce 42501. Require the
   -- dedicated identity rejection for clinical RPCs, not an unrelated denial.
   blocked:=fn.boundary='administration' or sqlerrm='Operação restrita ao ambiente médico';
  end;
  assert blocked, 'Reception reached clinical RPC: ' || fn.oid::regprocedure::text;
  checked:=checked+1;
 end loop;
 assert checked=(select count(*) from reviewed_definer_api where boundary in ('clinical','administration')), 'Clinical matrix incomplete';
 assert not public.clinical_session_allowed(), 'Reception passed clinical session predicate';
 assert not public.clinical_account_writable(), 'Reception passed clinical write predicate';
 assert public.session_assurance_ok(), 'Reception lost its own session assurance helper';
 perform public.assert_session_assurance();
 assert not public.storage_upload_allowed(current_setting('test.catalog_path'),'patient-files'),
  'Reception storage helper authorized an unowned chart';
 assert (select count(*) from public.match_knowledge('b9100000-0000-4000-8000-000000000001',current_setting('test.catalog_vector')::public.vector,5))=0,
  'Reception retrieved another doctor knowledge';
 assert public.clinic_access()->>'kind'='reception', 'Reception identity lost';
end $$;
grant execute on function pg_temp.assert_reception_clinical_boundaries() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b9100000-0000-4000-8000-000000000002',true);
do $$ begin assert (public.clinic_access()->>'active')::boolean, 'Active fixture missing'; end $$;
select pg_temp.assert_reception_clinical_boundaries();
reset role;
update public.clinic_staff_members set active=false where user_id='b9100000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin assert not (public.clinic_access()->>'active')::boolean, 'Inactive fixture missing'; end $$;
select pg_temp.assert_reception_clinical_boundaries();
reset role;
-- Auth creation may commit while provisioning is absent or unconfirmed. The
-- trusted reception marker must deny clinical access even without membership.
insert into auth.users(id,email,raw_app_meta_data) values
 ('b9100000-0000-4000-8000-000000000003','unconfirmed-reception@example.invalid','{"account_type":"reception"}');
do $$ begin
 assert not exists(select 1 from public.clinic_staff_members where user_id='b9100000-0000-4000-8000-000000000003'),
  'Unconfirmed fixture unexpectedly has staff membership';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','b9100000-0000-4000-8000-000000000003',true);
do $$ begin
 assert not (public.clinic_access()->>'active')::boolean, 'Unconfirmed account became active';
 assert public.clinic_access()->'clinic'='null'::jsonb, 'Unconfirmed account gained a clinic';
 begin
  insert into public.patients(id,user_id,name,status)
   values('b9200000-0000-4000-8000-000000000003',auth.uid(),'Synthetic unconfirmed write','novo');
  raise exception 'Unconfirmed reception created a clinical chart';
 exception when insufficient_privilege then null;
 end;
end $$;
select pg_temp.assert_reception_clinical_boundaries();
reset role;
-- Deliberately inconsistent trusted metadata fixture: a formerly clinical
-- identity still owns valid indexed content. Provisioning forbids this state;
-- force it only here to prove the search guard rather than an empty library.
update auth.users set raw_app_meta_data=raw_app_meta_data||'{"account_type":"reception"}'::jsonb
 where id='b9100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b9100000-0000-4000-8000-000000000001',true);
do $$ begin
 assert (select count(*) from public.match_knowledge(auth.uid(),current_setting('test.catalog_vector')::public.vector,5))=0,
  'Reception retrieved previously owned knowledge';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 assert (select count(*) from public.match_knowledge('b9100000-0000-4000-8000-000000000001',current_setting('test.catalog_vector')::public.vector,5))=0,
  'Service search accepted a reception target';
end $$;
rollback;
