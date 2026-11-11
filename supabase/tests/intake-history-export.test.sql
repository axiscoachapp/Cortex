-- Migration 20261111140000: pre-consultation history and reviews, and the LGPD export coverage.
-- Synthetic clinic, people, phones and ids only.
begin;
create function pg_temp.sqlstate_of(command text) returns text language plpgsql as $$
begin execute command; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users(id,email) values
 ('e8a10000-0000-4000-8000-000000000001','history-admin@example.invalid'),
 ('e8a10000-0000-4000-8000-000000000002','history-doctor@example.invalid'),
 ('e8a10000-0000-4000-8000-000000000003','history-reception@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('e8a20000-0000-4000-8000-000000000001','Clínica sintética histórico','e8a10000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('e8a20000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000001','admin','active'),
 ('e8a20000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000002','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('e8a20000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000003','Recepção sintética');
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('e8a20000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000003','e8a10000-0000-4000-8000-000000000002');
insert into public.patients(id,user_id,name,status,phone) values
 ('e8a50000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000002','Paciente Histórico','novo','(41) 99999-0101');
insert into public.clinic_contacts(id,clinic_id,name,phone,phone_normalized,created_by,request_id) values
 ('e8a30000-0000-4000-8000-000000000001','e8a20000-0000-4000-8000-000000000001','Paciente Histórico','(41) 99999-7101','5541999997101',
  'e8a10000-0000-4000-8000-000000000001',gen_random_uuid());
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values
 ('e8a20000-0000-4000-8000-000000000001','e8a30000-0000-4000-8000-000000000001','e8a50000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000002','self','e8a10000-0000-4000-8000-000000000001');
insert into public.appointments(id,user_id,patient_id,clinic_id,contact_id,title,start_time,end_time,status,type) values
 ('e8a70000-0000-4000-8000-000000000001','e8a10000-0000-4000-8000-000000000002','e8a50000-0000-4000-8000-000000000001','e8a20000-0000-4000-8000-000000000001','e8a30000-0000-4000-8000-000000000001','Consulta',
  date_trunc('minute',now())+interval '3 days',date_trunc('minute',now())+interval '3 days 30 minutes','agendado','novo');

-- Privileges: nobody reads the history directly; even the service role can only read and append.
do $$ begin
  assert (select relrowsecurity from pg_class where oid='public.intake_submissions'::regclass), 'history without RLS';
  assert not has_table_privilege('authenticated','public.intake_submissions','select') and not has_table_privilege('anon','public.intake_submissions','select'), 'history readable';
  assert has_table_privilege('service_role','public.intake_submissions','select') and has_table_privilege('service_role','public.intake_submissions','insert'), 'service cannot append';
  assert not has_table_privilege('service_role','public.intake_submissions','update') and not has_table_privilege('service_role','public.intake_submissions','delete'), 'service can rewrite history';
  assert not has_function_privilege('authenticated','public.intake_changed_since_review(public.intake_requests,text)','execute'), 'change check exposed';
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

do $$ declare r jsonb; req uuid:='e8a90000-0000-4000-8000-000000000001'; rq public.intake_requests; l jsonb;
  c uuid:='e8a20000-0000-4000-8000-000000000001'; admin uuid:='e8a10000-0000-4000-8000-000000000001';
  doctor uuid:='e8a10000-0000-4000-8000-000000000002'; rec uuid:='e8a10000-0000-4000-8000-000000000003';
  h text:=repeat('a',64);
  reg jsonb:='[{"id":"nome","label":"Nome","value":"Paciente Histórico","field":"name"}]';
begin
  perform public.intake_form_save(c, admin, 0, true, '{"intro":"Oi","thanks":"Obrigado","sections":[{"id":"dados","title":"Dados","audience":"registration","questions":[]}]}');
  r := public.intake_request_ensure(c,'e8a70000-0000-4000-8000-000000000001',rec,req,'hhhhhhhhhhhhhhhhhhhhhh',h);

  -- First submission, reviewed by the doctor (health) and the reception (registration).
  perform public.intake_public_submit(h, 1, reg, '[{"id":"alergias","label":"Alergias","value":"Nenhuma"}]', false, 'v1');
  select * into rq from public.intake_requests where id=req;
  r := public.intake_review(c, req, doctor, 'health', rq.revision);
  r := public.intake_review(c, req, rec, 'registration', (r->>'revision')::int);
  select * into rq from public.intake_requests where id=req;
  assert rq.health_reviewed_submission=1 and rq.registration_reviewed_submission=1, 'review did not record the submission: '||to_jsonb(rq)::text;
  assert not public.intake_changed_since_review(rq,'health') and not public.intake_changed_since_review(rq,'registration'), 'changed right after review';

  -- A second submission after both reviews is accepted (the patient corrects through the same link),
  -- keeps the marks, and the doctor sees that health changed; same registration is not a change.
  assert public.intake_public_open(h)->>'state'='answered', 'reviewed form not correctable';
  perform public.intake_public_submit(h, 1, reg, '[{"id":"alergias","label":"Alergias","value":"Dipirona"}]', false, 'v1');
  select * into rq from public.intake_requests where id=req;
  assert rq.submissions=2 and rq.health_reviewed_at is not null and rq.health_reviewed_by=doctor and rq.registration_reviewed_at is not null,
    'resubmission reset a review: '||to_jsonb(rq)::text;
  assert rq.health->0->>'value'='Dipirona', 'new answers not current';
  assert (select count(*) from public.intake_submissions where request_id=req)=2, 'history not appended';
  assert (select health->0->>'value' from public.intake_submissions where request_id=req and submission=1)='Nenhuma', 'first answers destroyed';
  assert public.intake_changed_since_review(rq,'health') and not public.intake_changed_since_review(rq,'registration'), 'change flags';

  -- The list carries the flags; the health flag only for the appointment's doctor.
  l := public.intake_list(c, doctor, now(), now()+interval '7 days');
  assert (l->0->>'healthChangedAfterReview')::boolean and not (l->0->>'registrationChangedAfterReview')::boolean, 'doctor list: '||l::text;
  l := public.intake_list(c, rec, now(), now()+interval '7 days');
  assert l->0->'healthChangedAfterReview'='null'::jsonb and not (l->0->>'registrationChangedAfterReview')::boolean, 'reception list: '||l::text;

  -- Reviewing again covers the latest submission.
  r := public.intake_review(c, req, doctor, 'health', rq.revision);
  select * into rq from public.intake_requests where id=req;
  assert rq.health_reviewed_submission=2 and not public.intake_changed_since_review(rq,'health'), 'second review';

  -- A registration change shows for the reception.
  perform public.intake_public_submit(h, 1, '[{"id":"nome","label":"Nome","value":"Paciente Histórico Corrigida","field":"name"}]',
    '[{"id":"alergias","label":"Alergias","value":"Dipirona"}]', false, 'v1');
  select * into rq from public.intake_requests where id=req;
  assert public.intake_changed_since_review(rq,'registration') and not public.intake_changed_since_review(rq,'health'), 'registration change';
  l := public.intake_list(c, rec, now(), now()+interval '7 days');
  assert (l->0->>'registrationChangedAfterReview')::boolean, 'reception does not see the registration change';

  -- The service role cannot rewrite or remove history.
  assert pg_temp.sqlstate_of(format($q$update public.intake_submissions set health='[]' where request_id=%L$q$, req))='42501', 'service rewrote history';
  assert pg_temp.sqlstate_of(format($q$delete from public.intake_submissions where request_id=%L$q$, req))='42501', 'service deleted history';
end $$;

-- LGPD export: the owner-keyed tables are present, the link material is not, and only for the owner.
do $$ declare m jsonb; doctor uuid:='e8a10000-0000-4000-8000-000000000002'; begin
  m := public.build_data_export_manifest(doctor);
  assert m->'tables' ?& array['document_snippets','intake_requests','intake_submissions','prescription_signatures','patient_chat_turns','patients'],
    'export keys: '||(select string_agg(k,',') from jsonb_object_keys(m->'tables') k);
  assert jsonb_array_length(m#>'{tables,intake_requests}')=1 and jsonb_array_length(m#>'{tables,intake_submissions}')=3, 'pre-consultation not exported';
  assert not (m#>'{tables,intake_requests,0}' ? 'token_hash') and not (m#>'{tables,intake_requests,0}' ? 'link_nonce'), 'link material exported';
  assert m#>>'{tables,intake_requests,0,health,0,value}'='Dipirona', 'answers missing from the export';
  m := public.build_data_export_manifest('e8a10000-0000-4000-8000-000000000003');
  assert jsonb_array_length(m#>'{tables,intake_requests}')=0 and jsonb_array_length(m#>'{tables,intake_submissions}')=0, 'another person''s pre-consultation exported';
end $$;

-- Every table keyed by a person (owner column or a cascade from auth.users) is in the export or in this
-- list, with the reason it stays out. A new table fails here until someone decides.
do $$ declare keys text[]; missing text;
  excluded text[] := array[
    'cortex_private.account_custody_epochs',          -- deletion bookkeeping, no personal content
    'cortex_private.signature_oauth_states',          -- 10-minute sealed OAuth verifier (credential)
    'cortex_private.signature_sessions',              -- sealed signing-service token (credential)
    'cortex_private.signature_operations',            -- technical attempt log; the evidence is prescription_signatures
    'cortex_private.reception_delegation_requests',   -- clinic access governance, kept by the clinic
    'public.data_export_snapshots',                   -- the export itself
    'public.google_oauth_transactions',               -- short-lived OAuth state (credential)
    'public.user_integrations',                       -- tokens; exported without them as user_integration_status
    'public.billing_charges',                         -- clinic financial record (the clinic is the controller)
    'public.billing_professionals',                   -- clinic billing setup kept by the Cortex team
    'public.clinic_staff_members',                    -- reception membership; reception accounts have no export
    'public.patient_contact_links',                   -- reception contact data, kept by the clinic
    'public.reception_calendar_versions',             -- reception agenda bookkeeping
    'public.reception_cases',                         -- reception workflow, kept by the clinic
    'public.reception_schedule_blocks',               -- reception agenda, kept by the clinic
    'public.staff_doctor_scopes',                     -- clinic access governance
    'public.whatsapp_conversations'                   -- user_id is the WhatsApp BSUID, not an account
  ];
begin
  select array_agg(k) into keys from jsonb_object_keys(public.build_data_export_manifest('00000000-0000-4000-8000-000000000000')->'tables') k;
  select string_agg(q, ', ' order by q) into missing from (
    select format('%s.%s', n.nspname, c.relname) q, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition and n.nspname in ('public', 'cortex_private')
      and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
             and a.attname in ('user_id', 'owner_user_id', 'doctor_id', 'doctor_user_id'))
        or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
             and k.confrelid = 'auth.users'::regclass and k.confdeltype = 'c'))) t
  where not (t.relname = any (keys)) and not (t.q = any (excluded));
  assert missing is null, 'person-keyed tables neither exported nor excluded: '||missing;
end $$;

-- Deleting the request (an appointment or account deletion cascades here) removes its history.
reset role;
select set_config('request.jwt.claim.role','',true);
do $$ begin
  assert pg_temp.sqlstate_of($q$update public.intake_submissions set health='[]' where request_id='e8a90000-0000-4000-8000-000000000001'$q$)='42501', 'owner rewrote history';
  delete from public.intake_requests where id='e8a90000-0000-4000-8000-000000000001';
  assert not exists (select 1 from public.intake_submissions where request_id='e8a90000-0000-4000-8000-000000000001'), 'history survived its request';
end $$;
rollback;
