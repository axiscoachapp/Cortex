-- D17 (migration 20261105100000): signature sessions, operation state machine,
-- audit, ACL, storage and cascades. Synthetic data only; the "sealed" values
-- are opaque fixtures, never real tokens. Service calls run as service_role;
-- direct table checks run as the owner (the tables have no client grants).
begin;
insert into auth.users(id,email) values
 ('d1700000-0000-4000-8000-000000000001','signer@example.invalid'),
 ('d1700000-0000-4000-8000-000000000002','other@example.invalid'),
 ('d1700000-0000-4000-8000-000000000003','solo@example.invalid'),
 ('d1700000-0000-4000-8000-000000000004','leaving@example.invalid');
-- Cortex sessions (Codex fixture, bootstrap): one live aal2 session with a
-- verified factor per test user; pg_temp.a() is the context the Edge would
-- have verified for it (never a request body).
insert into auth.mfa_factors(id,user_id,status,factor_type)
 select ('d1790000-0000-4000-8000-1'||right(u::text,11))::uuid,u,'verified','totp'
 from unnest(array['d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000002',
  'd1700000-0000-4000-8000-000000000003','d1700000-0000-4000-8000-000000000004']::uuid[]) u;
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal,not_after)
 select ('d1790000-0000-4000-8000-0'||right(u::text,11))::uuid,u,now(),now(),('d1790000-0000-4000-8000-1'||right(u::text,11))::uuid,'aal2',null
 from unnest(array['d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000002',
  'd1700000-0000-4000-8000-000000000003','d1700000-0000-4000-8000-000000000004']::uuid[]) u;
create function pg_temp.a(p_user uuid,p_session uuid default null,p_exp timestamptz default null) returns jsonb
language sql as $$
 select jsonb_build_object('sessionId',coalesce(p_session,('d1790000-0000-4000-8000-0'||right(p_user::text,11))::uuid)::text,
  'aal','aal2','exp',floor(extract(epoch from coalesce(p_exp,clock_timestamp()+interval '1 hour')))::bigint);
$$;
insert into public.user_settings(user_id,prescriber_cpf) values
 ('d1700000-0000-4000-8000-000000000001','52998224725'),
 ('d1700000-0000-4000-8000-000000000003','11144477735');
insert into public.patients(id,user_id,name,age,last_visit,status) values
 ('d1710000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000001','Paciente sintética A',30,current_date,'novo'),
 ('d1710000-0000-4000-8000-000000000002','d1700000-0000-4000-8000-000000000001','Paciente sintética B',31,current_date,'novo'),
 ('d1710000-0000-4000-8000-000000000004','d1700000-0000-4000-8000-000000000001','Paciente sintética D',32,current_date,'novo'),
 ('d1710000-0000-4000-8000-000000000005','d1700000-0000-4000-8000-000000000001','Paciente sintética E',33,current_date,'novo'),
 ('d1710000-0000-4000-8000-000000000003','d1700000-0000-4000-8000-000000000003','Paciente sintética S',40,current_date,'novo');

create function pg_temp.rx(p_id uuid,p_user uuid,p_patient uuid,p_doc text default 'receita_simples') returns void
language sql as $$
 insert into public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,doc_type,issuance_snapshot)
 values(p_id,p_user,p_patient,'rx/'||p_user::text||'/'||p_id::text||'.pdf','synthetic',now()+interval '30 days',p_doc,
  jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',repeat('a',64),'template_version','test','issued_at',now()));
$$;
select pg_temp.rx(('d1720000-0000-4000-8000-00000000000'||n)::uuid,'d1700000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001',
 case n when 3 then 'receita_antimicrobiano' else 'receita_simples' end) from generate_series(1,5) n;
select pg_temp.rx(('d1720000-0000-4000-8000-00000000002'||n)::uuid,'d1700000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000002') from generate_series(1,2) n;
-- Schema-valid legacy shape: a prescription for D whose consultation is E's.
insert into public.consultations(id,user_id,patient_id,soap_note) values
 ('d1780000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000005','Consulta sintética de E');
select pg_temp.rx('d1720000-0000-4000-8000-000000000031','d1700000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000004');
update public.prescriptions set consultation_id='d1780000-0000-4000-8000-000000000001' where id='d1720000-0000-4000-8000-000000000031';
select pg_temp.rx('d1720000-0000-4000-8000-000000000009','d1700000-0000-4000-8000-000000000003','d1710000-0000-4000-8000-000000000003');

-- ACL: nothing of D17 is reachable by anon or authenticated; tables not even by service_role.
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'signature\_%' loop
  assert not has_function_privilege('anon',fn,'execute') and not has_function_privilege('authenticated',fn,'execute'),
   'Client can execute '||fn::text;
  assert has_function_privilege('service_role',fn,'execute'),'Service cannot execute '||fn::text;
 end loop;
 assert (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'signature\_%')=14,
  'Unexpected D17 service API size';
 assert not has_table_privilege('service_role','cortex_private.signature_sessions','select'),'Sessions readable directly';
 assert not has_table_privilege('authenticated','cortex_private.prescription_signatures','select'),'Audit readable by clients';
 assert not has_function_privilege('anon','public.storage_parent_is_live(text,text)','execute'),'Storage liveness exposed';
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

-- OAuth state: CPF required, single use, owner and PSC bound, sealed shape.
do $$ declare v jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','c2VhbGVk');begin
 begin perform public.signature_begin_authorization('d1700000-0000-4000-8000-000000000002','vidaas',repeat('1',64),v,pg_temp.a('d1700000-0000-4000-8000-000000000002'));
  raise exception 'State without prescriber CPF accepted';exception when sqlstate 'P4031' then null;end;
 perform public.signature_begin_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('1',64),v,pg_temp.a('d1700000-0000-4000-8000-000000000001'));
 begin perform public.signature_consume_authorization('d1700000-0000-4000-8000-000000000003','vidaas',repeat('1',64),pg_temp.a('d1700000-0000-4000-8000-000000000003'));
  raise exception 'Another doctor consumed the state';exception when sqlstate 'P4031' then null;end;
 assert public.signature_consume_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('1',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'))=v,'Verifier not returned';
 begin perform public.signature_consume_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('1',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'State used twice';exception when sqlstate 'P4031' then null;end;
 begin perform public.signature_begin_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('2',64),'{"v":2}'::jsonb,pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Unsealed verifier accepted';exception when check_violation then null;end;
end $$;

-- Session: at most 12 h, one active, token only for the right owner and generation.
do $$ declare t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 begin perform public.signature_activate_session('d1700000-0000-4000-8000-000000000001','vidaas','d1730000-0000-4000-8000-000000000001',now()+interval '13 hours',repeat('c',64),t,pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Session over 12 hours accepted';exception when sqlstate '22023' then null;end;
 perform public.signature_activate_session('d1700000-0000-4000-8000-000000000001','vidaas','d1730000-0000-4000-8000-000000000001',now()+interval '8 hours',repeat('c',64),t,pg_temp.a('d1700000-0000-4000-8000-000000000001'));
 assert public.signature_session_token('d1700000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000001',1,pg_temp.a('d1700000-0000-4000-8000-000000000001'))=t,'Token not returned';
 begin perform public.signature_session_token('d1700000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000001',2,pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Wrong generation opened the token';exception when sqlstate 'P4031' then null;end;
 begin perform public.signature_session_token('d1700000-0000-4000-8000-000000000003','d1730000-0000-4000-8000-000000000001',1,pg_temp.a('d1700000-0000-4000-8000-000000000003'));
  raise exception 'Another doctor read the token';exception when sqlstate 'P4031' then null;end;
 assert public.signature_session_state('d1700000-0000-4000-8000-000000000001')->>'active'='true','Session not active';
 assert public.signature_session_state('d1700000-0000-4000-8000-000000000002')->>'active'='false','Phantom session';
end $$;

-- Reservation rules and idempotency.
do $$ declare r jsonb;begin
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000001',repeat('b',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Hash not shown accepted';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000003',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Antimicrobial signed in Phase 1';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000009',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Foreign document reserved';exception when insufficient_privilege then null;end;
 r:=public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000001',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
 assert r->>'state'='reserved' and r->>'session_generation'='1' and r->>'cert_sha256'=repeat('c',64),'Reservation incomplete';
 assert public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000001',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'))->>'signing_time'=r->>'signing_time',
  'Repeated operation changed';
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000002',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Operation id reused for another payload';exception when sqlstate '22023' then null;end;
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000002','d1720000-0000-4000-8000-000000000001',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Second open operation on one document';exception when sqlstate 'P4093' then null;end;
end $$;

-- Preparation is fixed; ambiguous blocks new ids and resumes only by a human retry.
do $$ declare d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 op uuid:='d1740000-0000-4000-8000-000000000001';u uuid:='d1700000-0000-4000-8000-000000000001';begin
 assert public.signature_advance(u,op,'prepared',d,pg_temp.a(u))->>'state'='prepared','Not prepared';
 assert public.signature_advance(u,op,'prepared',d,pg_temp.a(u))->>'state'='prepared','Same preparation not idempotent';
 begin perform public.signature_advance(u,op,'prepared',d||'{"toBeSignedSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}',pg_temp.a(u));
  raise exception 'Prepared bytes changed';exception when sqlstate '22023' then null;end;
 assert public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u))->>'psc_attempts'='1','PSC attempt not counted';
 begin perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
  raise exception 'Attempt in flight authorized twice';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',0),pg_temp.a(u));
  raise exception 'Human retry skipped reconciliation of an attempt in flight';exception when sqlstate 'P4093' then null;end;
 assert public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1))->>'state'='ambiguous','Not ambiguous';
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000003','d1720000-0000-4000-8000-000000000001',repeat('a',64),pg_temp.a(u));
  raise exception 'New id bypassed an unreconciled attempt';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',1),pg_temp.a(u));
  raise exception 'Ambiguous retried automatically';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true,"toBeSignedSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}'||jsonb_build_object('attempt',1),pg_temp.a(u));
  raise exception 'Retry with other bytes';exception when sqlstate '22023' then null;end;
 assert public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),pg_temp.a(u))->>'psc_attempts'='2','Human retry not counted';
end $$;

-- Storage: the candidate path is writable only for its in-flight operation.
insert into storage.objects(bucket_id,name) values
 ('prescriptions','rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000001/signed-d1740000-0000-4000-8000-000000000001.pdf');
do $$ begin
 insert into storage.objects(bucket_id,name) values
  ('prescriptions','rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000002/signed-d1740000-0000-4000-8000-000000000001.pdf');
 raise exception 'Unrelated signed path accepted';
exception when insufficient_privilege then null;end $$;

-- Completion, idempotent; signature fields cannot be written any other way.
do $$ declare op uuid:='d1740000-0000-4000-8000-000000000001';u uuid:='d1700000-0000-4000-8000-000000000001';
 path text:='rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000001/signed-d1740000-0000-4000-8000-000000000001.pdf';begin
 assert public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',2),pg_temp.a(u))->>'state'='stored','Not stored';
 assert public.signature_complete(u,op,'00AB12','CN=AC Sintetica',pg_temp.a(u))->>'state'='completed','Not completed';
 assert public.signature_complete(u,op,'00AB12','CN=AC Sintetica',pg_temp.a(u))->>'state'='completed','Completion not idempotent';
 -- Codex 04/11 23:29: the replay of a completed operation goes through the
 -- reservation. It returns the history (owner and payload checked) although
 -- the prescription is already signed, and must keep doing so under the
 -- session fence; another payload is still refused.
 assert public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000001',repeat('a',64),pg_temp.a(u))->>'state'='completed','Replay of a completed operation refused';
 begin perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000001',repeat('b',64),pg_temp.a(u));
  raise exception 'Replay with another payload accepted';exception when sqlstate '22023' then null;end;
 begin update public.prescriptions set status='signed',signature_verified_at=now() where id='d1720000-0000-4000-8000-000000000002';
  raise exception 'Generic writer marked a document signed';exception when insufficient_privilege then null;end;
 begin update public.prescriptions set signed_storage_path=null where id='d1720000-0000-4000-8000-000000000001';
  raise exception 'Generic writer changed the signed path';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 assert (select status='signed' and signed_at is not null and signature_verified_at is not null and signed_storage_path like '%/signed-d1740000-%'
  from public.prescriptions where id='d1720000-0000-4000-8000-000000000001'),'Prescription not marked signed';
 assert (select psc_attempts=2 and pdf_sha256_before=repeat('a',64) and pdf_sha256_after=repeat('f',64) and cert_serial='00ab12' and policy_oid='2.16.76.1.7.1.11.1.1'
  from cortex_private.prescription_signatures where operation_id='d1740000-0000-4000-8000-000000000001'),'Audit row incomplete';
 begin update cortex_private.prescription_signatures set cert_issuer='x';
  raise exception 'Audit updated';exception when sqlstate '22023' then null;end;
 begin delete from cortex_private.prescription_signatures;
  raise exception 'Audit deleted while its document exists';exception when sqlstate '22023' then null;end;
 begin update cortex_private.signature_operations set state='stored' where operation_id='d1740000-0000-4000-8000-000000000001';
  raise exception 'Terminal operation reopened';exception when sqlstate '22023' then null;end;
end $$;
set local role service_role;

-- Revocation wins every step before completion, and never undoes a completed signature.
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');
 r jsonb;begin
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000011','d1720000-0000-4000-8000-000000000002',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000011','prepared',d,pg_temp.a(u));
 assert public.signature_revoke_session(u)=1,'Session not revoked';
 assert public.signature_advance(u,'d1740000-0000-4000-8000-000000000011','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u))->>'state'='cancelled_by_revocation','Revoked session reached the PSC';
 begin perform public.signature_session_token(u,'d1730000-0000-4000-8000-000000000001',2,pg_temp.a(u));
  raise exception 'Token after revocation';exception when sqlstate 'P4031' then null;end;
 -- New session; revoke between storing and completing.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000002',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000012','d1720000-0000-4000-8000-000000000004',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000012','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000012','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000012','stored',jsonb_build_object('stagedPath',
  'rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000004/signed-d1740000-0000-4000-8000-000000000012.pdf','signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 perform public.signature_revoke_session(u);
 r:=public.signature_complete(u,'d1740000-0000-4000-8000-000000000012','01','CN=AC Sintetica',pg_temp.a(u));
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean,'Revocation lost the race to completion';
 perform public.signature_cleanup_done(u,'d1740000-0000-4000-8000-000000000012');
 -- Document changed during the operation (revoked by the doctor): never published.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000003',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000013','d1720000-0000-4000-8000-000000000005',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000013','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000013','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000013','stored',jsonb_build_object('stagedPath',
  'rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000005/signed-d1740000-0000-4000-8000-000000000013.pdf','signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 update public.prescriptions set status='revoked' where id='d1720000-0000-4000-8000-000000000005';
 r:=public.signature_complete(u,'d1740000-0000-4000-8000-000000000013','01','CN=AC Sintetica',pg_temp.a(u));
 assert r->>'state'='cancelled' and r->>'error_code'='document_changed' and (r->>'cleanup_pending')::boolean,'Changed document completed';
end $$;
reset role;
do $$ begin
 assert (select status='signed' from public.prescriptions where id='d1720000-0000-4000-8000-000000000001'),'Revocation undid a completed signature';
 assert (select status='generated' and signed_storage_path is null from public.prescriptions where id='d1720000-0000-4000-8000-000000000004'),'Revoked operation published';
 assert not (select cleanup_pending from cortex_private.signature_operations where operation_id='d1740000-0000-4000-8000-000000000012'),'Cleanup not recorded';
 assert (select token is null and generation=2 from cortex_private.signature_sessions where id='d1730000-0000-4000-8000-000000000001'),'Revoked token kept';
end $$;

-- A confirmed patient deletion intent stops a new reservation and an existing
-- operation before the PSC; the doctor's other patients are unaffected.
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000004',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000021','d1720000-0000-4000-8000-000000000021',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000021','prepared',d,pg_temp.a(u));
end $$;
reset role;
update public.patients set deletion_requested_at=now() where id='d1710000-0000-4000-8000-000000000002';
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');begin
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000022','d1720000-0000-4000-8000-000000000022',repeat('a',64),pg_temp.a(u));
  raise exception 'Reserved for a patient being deleted';exception when insufficient_privilege then null;end;
 begin perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000021','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
  raise exception 'Patient being deleted reached the PSC';exception when insufficient_privilege then null;end;
 begin perform public.signature_complete(u,'d1740000-0000-4000-8000-000000000021','01','CN=AC Sintetica',pg_temp.a(u));
  raise exception 'Completed for a patient being deleted';exception when sqlstate 'P4093' or insufficient_privilege then null;end;
 assert public.signature_close(u,'d1740000-0000-4000-8000-000000000021','cancelled',jsonb_build_object('code','patient_deleting'))->>'state'='cancelled',
  'Operation of a deleting patient cannot be closed';
end $$;
reset role;

-- The patient of the prescription's consultation (E) is part of the chain:
-- E's deletion intent stops the reservation even though D is not leaving.
update public.patients set deletion_requested_at=now() where id='d1710000-0000-4000-8000-000000000005';
set local role service_role;
do $$ begin
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000031','d1720000-0000-4000-8000-000000000031',repeat('a',64),pg_temp.a('d1700000-0000-4000-8000-000000000001'));
  raise exception 'Reserved while the consultation patient is being deleted';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Rate limit: 60 reservations per doctor per hour; the 61st suspends the session.
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000003';op uuid;r jsonb;
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000009',now()+interval '1 hour',repeat('c',64),t,pg_temp.a(u));
 for i in 1..60 loop
  op:=('d1750000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000009',repeat('a',64),pg_temp.a(u));
  perform public.signature_close(u,op,'failed',jsonb_build_object('code','test_release'));
 end loop;
 r:=public.signature_reserve(u,'d1750000-0000-4000-8000-000000000999','d1720000-0000-4000-8000-000000000009',repeat('a',64),pg_temp.a(u));
 assert r->>'error'='rate_limited','Rate limit not applied';
 assert public.signature_session_state(u)->>'active'='false','Session not suspended';
 -- A repeated operation id still answers without consuming.
 assert public.signature_reserve(u,'d1750000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000009',repeat('a',64),pg_temp.a(u))->>'state'='failed','Repeat consumed or changed';
end $$;
reset role;

-- Codex 04/11 19:49: what follows a PSC call belongs to one attempt. A late
-- timeout, answer or failure of an older attempt never moves the operation;
-- a terminal step after any PSC call schedules the candidate's cleanup by
-- itself; revocation also ends an operation whose answer is already stored.
select pg_temp.rx(('d1720000-0000-4000-8000-00000000004'||n)::uuid,'d1700000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001')
 from generate_series(1,4) n;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';op uuid:='d1740000-0000-4000-8000-000000000041';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');
 path text:='rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000041/signed-d1740000-0000-4000-8000-000000000041.pdf';
 r jsonb;begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000041',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000041',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u)); -- attempt 1 (request A)
 begin perform public.signature_close(u,op,'ambiguous','{}'::jsonb);
  raise exception 'Ambiguous without the attempt';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',0));
  raise exception 'Ambiguous for another attempt';exception when sqlstate 'P4094' then null;end;
 -- Request B (human retry) reconciles attempt 1, idempotently.
 assert public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1))->>'state'='ambiguous','Attempt 1 not reconciled';
 assert public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1))->>'state'='ambiguous','Reconciliation not idempotent';
 begin perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
  raise exception 'Late answer of a reconciled attempt stored';exception when sqlstate 'P4094' then null;end;
 assert public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),pg_temp.a(u))->>'psc_attempts'='2','Human retry not counted'; -- attempt 2
 begin perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1));
  raise exception 'Late timeout of attempt 1 marked attempt 2';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
  raise exception 'Late answer of attempt 1 stored over attempt 2';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_close(u,op,'failed',jsonb_build_object('code','psc_rejected','attempt',1));
  raise exception 'Late failure of attempt 1 failed attempt 2';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_close(u,op,'failed',jsonb_build_object('code','psc_rejected'));
  raise exception 'Failure after a PSC call without the attempt';exception when sqlstate 'P4094' then null;end;
 assert public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',2),pg_temp.a(u))->>'state'='stored','Attempt 2 not stored';
 assert public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',2),pg_temp.a(u))->>'state'='stored','Store not idempotent';
 insert into storage.objects(bucket_id,name) values('prescriptions',path); -- the stored answer's object
 assert public.signature_complete(u,op,'01','CN=AC Sintetica',pg_temp.a(u))->>'state'='completed','Attempt 2 not completed';

 -- A failure after a PSC call schedules the cleanup without the caller's flag.
 op:='d1740000-0000-4000-8000-000000000042';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000042',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 r:=public.signature_close(u,op,'failed',jsonb_build_object('code','invalid_signature','attempt',1));
 assert r->>'state'='failed' and (r->>'cleanup_pending')::boolean,'Failure after a PSC call left its candidate';

 -- An ambiguous operation ended by revocation schedules the cleanup too.
 op:='d1740000-0000-4000-8000-000000000043';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000043',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1));
 perform public.signature_revoke_session(u);
 r:=public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),pg_temp.a(u));
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean,'Revoked ambiguous operation left its candidate';

 -- Stored answer, then revocation: the next step ends it (Codex 19:49, case 1).
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000042',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 op:='d1740000-0000-4000-8000-000000000044';
 path:='rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000044/signed-d1740000-0000-4000-8000-000000000044.pdf';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000044',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 perform public.signature_revoke_session(u);
 r:=public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean,'Revoked stored operation kept open';
end $$;
reset role;
do $$ begin
 assert (select psc_attempts=2 from cortex_private.prescription_signatures where operation_id='d1740000-0000-4000-8000-000000000041'),'Audit of attempt 2 missing';
 assert (select status='generated' from public.prescriptions where id='d1720000-0000-4000-8000-000000000044'),'Revoked stored operation published';
end $$;

-- Codex 04/11 20:55: a late failure of an older attempt never ends a newer
-- one without answer; a terminal operation is never rewritten; no candidate
-- appears after the end; a leftover object of a terminal operation is found.
select pg_temp.rx(('d1720000-0000-4000-8000-00000000005'||n)::uuid,'d1700000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001')
 from generate_series(1,3) n;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';op uuid:='d1740000-0000-4000-8000-000000000051';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');
 r jsonb;begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000051',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000051',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));                                  -- attempt 1
 perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1));
 perform public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),pg_temp.a(u));          -- attempt 2
 perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',2));       -- attempt 2 without answer
 begin perform public.signature_close(u,op,'failed',jsonb_build_object('code','psc_rejected','attempt',1));
  raise exception 'Late failure of attempt 1 ended attempt 2 without answer';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_close(u,op,'failed',jsonb_build_object('code','abandoned'));
  raise exception 'Ambiguous operation ended without naming its attempt';exception when sqlstate 'P4094' then null;end;
 r:=public.signature_close(u,op,'failed',jsonb_build_object('code','abandoned','attempt',2)); -- the doctor gives up on attempt 2
 assert r->>'state'='failed' and r->>'error_code'='abandoned' and (r->>'cleanup_pending')::boolean,'Current attempt could not be ended';
 -- A terminal operation is never rewritten by a late step.
 r:=public.signature_close(u,op,'failed',jsonb_build_object('code','upload_failed','attempt',1));
 assert r->>'state'='failed' and r->>'error_code'='abandoned','Terminal failure rewritten';
 r:=public.signature_close(u,op,'cancelled',jsonb_build_object('code','other'));
 assert r->>'state'='failed' and r->>'error_code'='abandoned','Terminal operation cancelled again';
 perform public.signature_cleanup_done(u,op);
end $$;
reset role;
-- No candidate is accepted once its operation ended.
do $$ begin
 insert into storage.objects(bucket_id,name) values
  ('prescriptions','rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000051/signed-d1740000-0000-4000-8000-000000000051.pdf');
 raise exception 'Candidate stored after its operation ended';
exception when insufficient_privilege then null;end $$;
-- A leftover object of a terminal operation is found even after cleanup_done.
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';op uuid:='d1740000-0000-4000-8000-000000000052';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 begin
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000052',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
end $$;
reset role;
insert into storage.objects(bucket_id,name) values
 ('prescriptions','rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000052/signed-d1740000-0000-4000-8000-000000000052.pdf');
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';op uuid:='d1740000-0000-4000-8000-000000000052';w jsonb;begin
 perform public.signature_close(u,op,'failed',jsonb_build_object('code','invalid_signature','attempt',1));
 perform public.signature_cleanup_done(u,op); -- marked done although the object is still there
 w:=public.signature_pending_work(500);
 assert exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'=op::text and e->>'kind'='remove_candidate'),
  'Leftover object of a terminal operation not found';
 assert not exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'='d1740000-0000-4000-8000-000000000051'),
  'Terminal operation without object listed';
end $$;
reset role;

-- Cortex session fence (ASSINATURA_HANDLERS.md v3.1 §3). Doctor F has one live
-- session and one variant per way a session can be ended. The service role
-- cannot read the private tables; these owner helpers read them for the asserts.
create function pg_temp.op(p_op uuid) returns cortex_private.signature_operations
language sql security definer as $$ select * from cortex_private.signature_operations where operation_id=p_op $$;
create function pg_temp.has_state(p_hash text) returns boolean
language sql security definer as $$ select exists(select 1 from cortex_private.signature_oauth_states where state_hash=p_hash) $$;
insert into auth.users(id,email) values('d1700000-0000-4000-8000-000000000006','fence@example.invalid');
insert into public.user_settings(user_id,prescriber_cpf) values('d1700000-0000-4000-8000-000000000006','52998224725');
insert into public.patients(id,user_id,name,age,last_visit,status) values
 ('d1710000-0000-4000-8000-000000000006','d1700000-0000-4000-8000-000000000006','Paciente sintética F',35,current_date,'novo');
select pg_temp.rx(('d1720000-0000-4000-8000-00000000006'||n)::uuid,'d1700000-0000-4000-8000-000000000006','d1710000-0000-4000-8000-000000000006')
 from generate_series(1,9) n;
insert into auth.mfa_factors(id,user_id,status,factor_type) values
 ('d1790000-0000-4000-8000-100000000006','d1700000-0000-4000-8000-000000000006','verified','totp'),
 ('d1790000-0000-4000-8000-100000000066','d1700000-0000-4000-8000-000000000006','unverified','totp');
insert into auth.sessions(id,user_id,factor_id,aal,not_after) values
 ('d1790000-0000-4000-8000-000000000006','d1700000-0000-4000-8000-000000000006','d1790000-0000-4000-8000-100000000006','aal2',null),
 ('d1790000-0000-4000-8000-0000000000a1','d1700000-0000-4000-8000-000000000006','d1790000-0000-4000-8000-100000000006','aal1',null),
 ('d1790000-0000-4000-8000-0000000000a2','d1700000-0000-4000-8000-000000000006',null,'aal2',null),
 ('d1790000-0000-4000-8000-0000000000a3','d1700000-0000-4000-8000-000000000006','d1790000-0000-4000-8000-100000000066','aal2',null),
 ('d1790000-0000-4000-8000-0000000000a4','d1700000-0000-4000-8000-000000000006','d1790000-0000-4000-8000-100000000001','aal2',null),
 ('d1790000-0000-4000-8000-0000000000a5','d1700000-0000-4000-8000-000000000006','d1790000-0000-4000-8000-100000000006','aal2',now()-interval '1 minute'),
 ('d1790000-0000-4000-8000-0000000000a6','d1700000-0000-4000-8000-000000000006','d1790000-0000-4000-8000-c00000000099','aal2',null);
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 ended jsonb[]; bad jsonb[]; e jsonb; r jsonb;
begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000061',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 -- Malformed context: refused before any lock.
 bad:=array[
  null::jsonb,'[]'::jsonb,'{}'::jsonb,
  pg_temp.a(u)||'{"extra":1}', pg_temp.a(u)-'exp', pg_temp.a(u)-'sessionId', pg_temp.a(u)-'aal',
  pg_temp.a(u)||'{"aal":"aal1"}', pg_temp.a(u)||'{"aal":null}', pg_temp.a(u)||'{"sessionId":"not-a-uuid"}',
  pg_temp.a(u)||'{"sessionId":1}', pg_temp.a(u)||'{"exp":"1999999999"}', pg_temp.a(u)||'{"exp":1.5}',
  pg_temp.a(u)||'{"exp":-1}', pg_temp.a(u)||'{"exp":0}', pg_temp.a(u)||'{"exp":null}'];
 foreach e in array bad loop
  begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000061','d1720000-0000-4000-8000-000000000061',repeat('a',64),e);
   raise exception 'Malformed auth context accepted: %',coalesce(e::text,'null');exception when sqlstate '22023' then null;end;
 end loop;
 -- Ended sessions: missing, aal1, no factor, unverified factor, factor of
 -- another user, not_after passed, factor gone, JWT exp passed.
 ended:=array[pg_temp.a(u,'d1790000-0000-4000-8000-0000000000ff'),pg_temp.a(u,'d1790000-0000-4000-8000-0000000000a1'),
  pg_temp.a(u,'d1790000-0000-4000-8000-0000000000a2'),pg_temp.a(u,'d1790000-0000-4000-8000-0000000000a3'),
  pg_temp.a(u,'d1790000-0000-4000-8000-0000000000a4'),pg_temp.a(u,'d1790000-0000-4000-8000-0000000000a5'),
  pg_temp.a(u,'d1790000-0000-4000-8000-0000000000a6'),pg_temp.a(u,null,clock_timestamp()-interval '1 second'),
  pg_temp.a('d1700000-0000-4000-8000-000000000001')||jsonb_build_object('sessionId','d1790000-0000-4000-8000-000000000001')];
 foreach e in array ended loop
  begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000061','d1720000-0000-4000-8000-000000000061',repeat('a',64),e);
   raise exception 'Reserved with an ended session: %',e::text;exception when sqlstate 'P4011' then null;end;
  begin perform public.signature_begin_authorization(u,'vidaas',repeat('7',64),t,e);
   raise exception 'Authorization begun with an ended session';exception when sqlstate 'P4011' then null;end;
  begin perform public.signature_session_token(u,'d1730000-0000-4000-8000-000000000061',1,e);
   raise exception 'Token left with an ended session';exception when sqlstate 'P4011' then null;end;
  begin perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000062',now()+interval '8 hours',repeat('c',64),t,e);
   raise exception 'Session activated with an ended Cortex session';exception when sqlstate 'P4011' then null;end;
 end loop;
 assert (pg_temp.op('d1740000-0000-4000-8000-000000000061')).operation_id is null,'Refusal left an operation';
 assert not pg_temp.has_state(repeat('7',64)),'Refusal left an OAuth state';
 assert public.signature_session_token(u,'d1730000-0000-4000-8000-000000000061',1,pg_temp.a(u))=t,'Live session refused';
 -- consume_authorization: every refusal leaves the state; the live one consumes it.
 perform public.signature_begin_authorization(u,'vidaas',repeat('8',64),t,pg_temp.a(u));
 foreach e in array ended loop
  begin perform public.signature_consume_authorization(u,'vidaas',repeat('8',64),e);
   raise exception 'Verifier released with an ended session';exception when sqlstate 'P4011' then null;end;
 end loop;
 assert pg_temp.has_state(repeat('8',64)),'Refused consumption used the state';
 assert public.signature_consume_authorization(u,'vidaas',repeat('8',64),pg_temp.a(u))=t,'Live consumption refused';

 -- Pertinent step with an ended session: the operation is ended and RETURNED
 -- (no exception after the UPDATE), and the effect persists.
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000061','d1720000-0000-4000-8000-000000000061',repeat('a',64),pg_temp.a(u));
 r:=public.signature_advance(u,'d1740000-0000-4000-8000-000000000061','prepared',d,ended[8]);
 assert r->>'state'='cancelled' and r->>'error_code'='auth_session_ended' and not (r->>'cleanup_pending')::boolean,'Pertinent prepare with an ended session not ended';
 -- Before any PSC call: no candidate to clean. After it: cleanup by the database.
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000062','d1720000-0000-4000-8000-000000000062',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000062','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000062','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 -- Not pertinent (an older attempt's answer): nothing changes, even with an ended session.
 begin perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000062','stored',
   jsonb_build_object('stagedPath','x','signedSha256',repeat('f',64),'attempt',0),ended[1]);
  raise exception 'Stale answer with an ended session moved the operation';exception when sqlstate 'P4094' then null;end;
 assert (pg_temp.op('d1740000-0000-4000-8000-000000000062')).state='psc_requested' and (pg_temp.op('d1740000-0000-4000-8000-000000000062')).psc_attempts=1,
  'Stale step changed the operation';
 r:=public.signature_advance(u,'d1740000-0000-4000-8000-000000000062','stored',jsonb_build_object('stagedPath',
   'rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000062/signed-d1740000-0000-4000-8000-000000000062.pdf',
   'signedSha256',repeat('f',64),'attempt',1),ended[2]);
 assert r->>'state'='cancelled' and r->>'error_code'='auth_session_ended' and (r->>'cleanup_pending')::boolean,'Pertinent store with an ended session kept its candidate';

 -- Codex 23:29, case 1: A observed ambiguous/1; B (another device) made the
 -- attempt 2 and is back to ambiguous/2; A's psc_requested with attempt 1 is
 -- refused without touching B, with an ended or a live session.
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000063','d1720000-0000-4000-8000-000000000063',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000063','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000063','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_close(u,'d1740000-0000-4000-8000-000000000063','ambiguous',jsonb_build_object('attempt',1));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000063','psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),pg_temp.a(u));
 perform public.signature_close(u,'d1740000-0000-4000-8000-000000000063','ambiguous',jsonb_build_object('attempt',2));
 foreach e in array array[ended[1],pg_temp.a(u)] loop
  begin perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000063','psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),e);
   raise exception 'Stale observation promoted or cancelled the newer attempt';exception when sqlstate 'P4094' then null;end;
 end loop;
 begin perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000063','psc_requested',d||'{"humanRetry":true}',pg_temp.a(u));
  raise exception 'Retry without the observed attempt accepted';exception when sqlstate 'P4094' then null;end;
 assert (pg_temp.op('d1740000-0000-4000-8000-000000000063')).state='ambiguous' and (pg_temp.op('d1740000-0000-4000-8000-000000000063')).psc_attempts=2,
  'Newer attempt touched';
 -- The pertinent retry with an ended session ends it (the doctor's own attempt).
 r:=public.signature_advance(u,'d1740000-0000-4000-8000-000000000063','psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',2),ended[3]);
 assert r->>'state'='cancelled' and r->>'error_code'='auth_session_ended' and (r->>'cleanup_pending')::boolean,'Pertinent retry with an ended session not ended';
end $$;
reset role;
-- The candidate of operation 64 exists; 65 never gets one.
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
begin
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000064','d1720000-0000-4000-8000-000000000064',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000064','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000064','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000065','d1720000-0000-4000-8000-000000000065',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000065','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000065','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
end $$;
reset role;
insert into storage.objects(bucket_id,name) values
 ('prescriptions','rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000064/signed-d1740000-0000-4000-8000-000000000064.pdf');
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';r jsonb;stored timestamptz;
 p64 text:='rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000064/signed-d1740000-0000-4000-8000-000000000064.pdf';
 p65 text:='rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000065/signed-d1740000-0000-4000-8000-000000000065.pdf';
begin
 r:=public.signature_advance(u,'d1740000-0000-4000-8000-000000000064','stored',jsonb_build_object('stagedPath',p64,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 stored:=(pg_temp.op('d1740000-0000-4000-8000-000000000064')).stored_at;
 assert stored is not null,'stored_at not set';
 perform pg_sleep(0.01);
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000064','stored',jsonb_build_object('stagedPath',p64,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 assert (pg_temp.op('d1740000-0000-4000-8000-000000000064')).stored_at=stored,'Repeated store moved stored_at';
 -- Commit point with an ended session: ended and returned, nothing published.
 r:=public.signature_complete(u,'d1740000-0000-4000-8000-000000000064','01','CN=AC Sintetica',pg_temp.a(u,null,clock_timestamp()-interval '1 second'));
 assert r->>'state'='cancelled' and r->>'error_code'='auth_session_ended' and (r->>'cleanup_pending')::boolean,'Completed after the session ended';
 -- Commit point without the signed object: never published.
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000065','stored',jsonb_build_object('stagedPath',p65,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 r:=public.signature_complete(u,'d1740000-0000-4000-8000-000000000065','01','CN=AC Sintetica',pg_temp.a(u));
 assert r->>'state'='cancelled' and r->>'error_code'='stored_object_missing' and (r->>'cleanup_pending')::boolean,'Completed without the signed object';
 -- Terminal replay through the reservation: history, with an ended session too.
 assert public.signature_reserve(u,'d1740000-0000-4000-8000-000000000064','d1720000-0000-4000-8000-000000000064',repeat('a',64),
  pg_temp.a(u,'d1790000-0000-4000-8000-0000000000ff'))->>'error_code'='auth_session_ended','Terminal replay refused';
end $$;
reset role;
do $$ begin
 assert (select status='generated' and signed_storage_path is null from public.prescriptions where id='d1720000-0000-4000-8000-000000000064'),'Ended session published';
 assert not exists(select 1 from cortex_private.prescription_signatures where operation_id in
  ('d1740000-0000-4000-8000-000000000064','d1740000-0000-4000-8000-000000000065')),'Audit without publication';
 -- stored_at is set once.
 begin update cortex_private.signature_operations set stored_at=now() where operation_id='d1740000-0000-4000-8000-000000000064';
  raise exception 'stored_at rewritten';exception when sqlstate '22023' then null;end;
end $$;

-- Reconciliation CAS (§9): discovery is not proof; state, attempt and age are
-- rechecked under the barrier. Ages are set with triggers off (owner only).
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
begin
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000066','d1720000-0000-4000-8000-000000000066',repeat('a',64),pg_temp.a(u));
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000067','d1720000-0000-4000-8000-000000000067',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000067','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000067','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000068','d1720000-0000-4000-8000-000000000068',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000068','prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000068','psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
end $$;
reset role;
insert into storage.objects(bucket_id,name) values
 ('prescriptions','rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000068/signed-d1740000-0000-4000-8000-000000000068.pdf');
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';begin
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000068','stored',jsonb_build_object('stagedPath',
  'rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000068/signed-d1740000-0000-4000-8000-000000000068.pdf',
  'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 -- Fresh: nothing to close yet.
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000066','reserved',0)->>'state'='reserved','Fresh reservation closed';
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000067','psc_requested',1)->>'state'='psc_requested','Fresh attempt closed';
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000068','stored',1)->>'state'='stored','Fresh stored answer closed';
end $$;
reset role;
set session_replication_role=replica;
update cortex_private.signature_operations set updated_at=now()-interval '16 minutes'
 where operation_id in ('d1740000-0000-4000-8000-000000000066','d1740000-0000-4000-8000-000000000067','d1740000-0000-4000-8000-000000000068');
set session_replication_role=origin;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';r jsonb;begin
 -- CAS with another expected state or attempt: no effect.
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000066','prepared',0)->>'state'='reserved','CAS ignored the state';
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000067','psc_requested',2)->>'state'='psc_requested','CAS ignored the attempt';
 r:=public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000066','reserved',0);
 assert r->>'state'='failed' and r->>'error_code'='abandoned' and not (r->>'cleanup_pending')::boolean,'Abandoned reservation not closed';
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000067','psc_requested',1)->>'state'='ambiguous','Stuck attempt not reconciled as ambiguous';
 -- Stored: 16 minutes is not the 24 h of stored_at; never completed here.
 assert public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000068','stored',1)->>'state'='stored','Stored closed before 24 h of stored_at';
end $$;
reset role;
set session_replication_role=replica;
update cortex_private.signature_operations set stored_at=now()-interval '25 hours' where operation_id='d1740000-0000-4000-8000-000000000068';
set session_replication_role=origin;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';r jsonb;begin
 r:=public.signature_reconcile(u,'d1740000-0000-4000-8000-000000000068','stored',1);
 assert r->>'state'='cancelled' and r->>'error_code'='stored_expired' and (r->>'cleanup_pending')::boolean,'Expired stored candidate not closed';
end $$;
reset role;
do $$ begin
 assert (select status='generated' and signed_storage_path is null from public.prescriptions where id='d1720000-0000-4000-8000-000000000068'),'Reconciliation published';
end $$;

-- Codex 05/11 03:24, R2 and R3: pertinence is decided before any session
-- check, and a step that no longer applies returns the operation as it is.
select pg_temp.rx(('d1720000-0000-4000-8000-00000000007'||n)::uuid,'d1700000-0000-4000-8000-000000000006','d1710000-0000-4000-8000-000000000006')
 from generate_series(1,3) n;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';op uuid:='d1740000-0000-4000-8000-000000000071';
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 r jsonb;
 p72 text:='rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000072/signed-d1740000-0000-4000-8000-000000000072.pdf';
 p73 text:='rx/d1700000-0000-4000-8000-000000000006/d1720000-0000-4000-8000-000000000073/signed-d1740000-0000-4000-8000-000000000073.pdf';
begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000071',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 -- R2: attempt 2 without answer; the PSC session is revoked; the late answer
 -- of attempt 1 is refused without touching attempt 2.
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000071',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',1));
 perform public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}'||jsonb_build_object('attempt',1),pg_temp.a(u));
 perform public.signature_close(u,op,'ambiguous',jsonb_build_object('attempt',2));
 perform public.signature_revoke_session(u);
 begin perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath','x','signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
  raise exception 'Late answer after a PSC revocation ended the newer attempt';exception when sqlstate 'P4094' then null;end;
 assert (pg_temp.op(op)).state='ambiguous' and (pg_temp.op(op)).psc_attempts=2 and not (pg_temp.op(op)).cleanup_pending,'Newer attempt touched by a stale answer';
 -- R3: prepare over ambiguous/2 is history, not an error, with or without a session.
 r:=public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 assert r->>'state'='ambiguous' and r->>'psc_attempts'='2','Prepare over a newer attempt did not return it';
 r:=public.signature_advance(u,op,'prepared',d,pg_temp.a(u,'d1790000-0000-4000-8000-0000000000ff'));
 assert r->>'state'='ambiguous','Prepare with an ended session changed a no longer pertinent operation';

 -- R3 at the commit point: an operation already ended is returned as it is.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000072',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 op:='d1740000-0000-4000-8000-000000000072';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000072',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 insert into storage.objects(bucket_id,name) values('prescriptions',p72);
 perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',p72,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 perform public.signature_revoke_session(u);
 assert public.signature_complete(u,op,'01','CN=AC Sintetica',pg_temp.a(u))->>'state'='cancelled_by_revocation','Revocation lost at the commit point';
 r:=public.signature_complete(u,op,'01','CN=AC Sintetica',pg_temp.a(u));
 assert r->>'state'='cancelled_by_revocation','Ended operation not returned at the commit point';
 -- A PSC permission over a completed operation returns it (the replay of a late request).
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000073',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 op:='d1740000-0000-4000-8000-000000000073';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000073',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 insert into storage.objects(bucket_id,name) values('prescriptions',p73);
 perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',p73,'signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
 assert public.signature_complete(u,op,'01','CN=AC Sintetica',pg_temp.a(u))->>'state'='completed','Commit point refused';
 r:=public.signature_advance(u,op,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 assert r->>'state'='completed','PSC permission over a completed operation did not return it';
 r:=public.signature_advance(u,op,'prepared',d,pg_temp.a(u));
 assert r->>'state'='completed','Prepare over a completed operation did not return it';
end $$;
reset role;

-- Codex 05/11 05:09, R1: an operation whose PSC session ended is closed by
-- the database (signature_close 'cancelled_by_revocation': a CAS on the state
-- and attempt observed, decided by the session row), and its document is free
-- for a new operation; an open one in the live session still blocks.
select pg_temp.rx(('d1720000-0000-4000-8000-00000000008'||n)::uuid,'d1700000-0000-4000-8000-000000000006','d1710000-0000-4000-8000-000000000006')
 from generate_series(1,4) n;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000006';
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 o81 uuid:='d1740000-0000-4000-8000-000000000081';o82 uuid:='d1740000-0000-4000-8000-000000000082';
 o83 uuid:='d1740000-0000-4000-8000-000000000083';o84 uuid:='d1740000-0000-4000-8000-000000000084';
 r jsonb;
begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000081',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 -- o81 prepared; o82 without answer (attempt 1); o83 in flight (attempt 1); o84 prepared.
 perform public.signature_reserve(u,o81,'d1720000-0000-4000-8000-000000000081',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,o81,'prepared',d,pg_temp.a(u));
 perform public.signature_reserve(u,o82,'d1720000-0000-4000-8000-000000000082',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,o82,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,o82,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_close(u,o82,'ambiguous',jsonb_build_object('attempt',1));
 perform public.signature_reserve(u,o83,'d1720000-0000-4000-8000-000000000083',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,o83,'prepared',d,pg_temp.a(u));
 perform public.signature_advance(u,o83,'psc_requested',d||jsonb_build_object('attempt',0),pg_temp.a(u));
 perform public.signature_reserve(u,o84,'d1720000-0000-4000-8000-000000000084',repeat('a',64),pg_temp.a(u));
 perform public.signature_advance(u,o84,'prepared',d,pg_temp.a(u));
 -- Live session: no effect, and the observed state is required and open.
 assert public.signature_close(u,o81,'cancelled_by_revocation',jsonb_build_object('expectedState','prepared','attempt',0))->>'state'='prepared',
  'Closed an operation whose session is live';
 begin perform public.signature_close(u,o81,'cancelled_by_revocation','{"attempt":0}'::jsonb);
  raise exception 'Revocation close without the observed state';exception when sqlstate '22023' then null;end;
 begin perform public.signature_close(u,o81,'cancelled_by_revocation','{"expectedState":"completed","attempt":0}'::jsonb);
  raise exception 'Revocation close expecting a terminal state';exception when sqlstate '22023' then null;end;
 begin perform public.signature_close(u,o81,'cancelled_by_revocation','{"expectedState":"prepared"}'::jsonb);
  raise exception 'Revocation close without the observed attempt';exception when sqlstate '22023' then null;end;
 -- Live session: a new operation over an open one is still refused.
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000085','d1720000-0000-4000-8000-000000000081',repeat('a',64),pg_temp.a(u));
  raise exception 'New operation over one in the live session';exception when sqlstate 'P4093' then null;end;
 -- A new PSC session replaces the old one.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000082',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 -- CAS: another state or attempt than the one held changes nothing.
 assert public.signature_close(u,o81,'cancelled_by_revocation',jsonb_build_object('expectedState','reserved','attempt',0))->>'state'='prepared','CAS ignored the state';
 assert public.signature_close(u,o82,'cancelled_by_revocation',jsonb_build_object('expectedState','ambiguous','attempt',0))->>'state'='ambiguous','CAS ignored the attempt';
 -- Prepared: closed without cleanup, its prepared data kept.
 r:=public.signature_close(u,o81,'cancelled_by_revocation',jsonb_build_object('expectedState','prepared','attempt',0));
 assert r->>'state'='cancelled_by_revocation' and not (r->>'cleanup_pending')::boolean and r->>'prepared_pdf_sha256'=repeat('d',64),
  'Prepared operation of a replaced session not closed';
 -- Without answer: closed with the cleanup scheduled.
 r:=public.signature_close(u,o82,'cancelled_by_revocation',jsonb_build_object('expectedState','ambiguous','attempt',1));
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean and r->>'psc_attempts'='1',
  'Operation without answer of a replaced session not closed';
 -- Terminal: history, for a repeated close and for a late failure.
 assert public.signature_close(u,o82,'cancelled_by_revocation',jsonb_build_object('expectedState','ambiguous','attempt',1))->>'state'='cancelled_by_revocation',
  'Repeated close not history';
 r:=public.signature_close(u,o81,'failed','{"code":"late"}');
 assert r->>'state'='cancelled_by_revocation' and r->>'error_code' is null,'Terminal operation rewritten';
 -- The documents are free for new operations in the new session.
 assert public.signature_reserve(u,'d1740000-0000-4000-8000-000000000085','d1720000-0000-4000-8000-000000000081',repeat('a',64),pg_temp.a(u))->>'state'='reserved',
  'Document of the closed prepared operation not freed';
 assert public.signature_reserve(u,'d1740000-0000-4000-8000-000000000086','d1720000-0000-4000-8000-000000000082',repeat('a',64),pg_temp.a(u))->>'state'='reserved',
  'Document of the closed operation without answer not freed';
 -- A new operation id closes an open operation of an ended session by
 -- itself: in flight, with the cleanup scheduled.
 assert public.signature_reserve(u,'d1740000-0000-4000-8000-000000000087','d1720000-0000-4000-8000-000000000083',repeat('a',64),pg_temp.a(u))->>'state'='reserved',
  'Document of an in-flight operation of an ended session not freed';
 assert (pg_temp.op(o83)).state='cancelled_by_revocation' and (pg_temp.op(o83)).cleanup_pending and (pg_temp.op(o83)).psc_attempts=1,
  'In-flight operation of an ended session not closed with cleanup';
 -- Its late answer never brings it back (an attempt step: P4094).
 begin perform public.signature_advance(u,o83,'stored',jsonb_build_object('stagedPath','x','signedSha256',repeat('f',64),'attempt',1),pg_temp.a(u));
  raise exception 'Late answer revived a closed operation';exception when sqlstate 'P4094' then null;end;
 -- No PSC session: nothing is reserved nor closed.
 perform public.signature_revoke_session(u);
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000088','d1720000-0000-4000-8000-000000000084',repeat('a',64),pg_temp.a(u));
  raise exception 'Reserved without a PSC session';exception when sqlstate 'P4031' then null;end;
 assert (pg_temp.op(o84)).state='prepared','Closed by a reservation without a PSC session';
 -- Cortex session ended: the refusal (P4011) takes the closing back with it.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000083',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000088','d1720000-0000-4000-8000-000000000084',repeat('a',64),
  pg_temp.a(u,'d1790000-0000-4000-8000-0000000000ff'));
  raise exception 'Reserved after the Cortex session ended';exception when sqlstate 'P4011' then null;end;
 assert (pg_temp.op(o84)).state='prepared','Closed by a reservation refused at the Cortex session';
 -- A closing step: no Cortex session needed.
 r:=public.signature_close(u,o84,'cancelled_by_revocation',jsonb_build_object('expectedState','prepared','attempt',0));
 assert r->>'state'='cancelled_by_revocation' and not (r->>'cleanup_pending')::boolean,'Closing step refused';
end $$;
reset role;
do $$ begin
 assert not exists(select 1 from public.prescriptions where id::text like 'd1720000-0000-4000-8000-00000000008_' and status<>'generated'),
  'A closed operation published';
end $$;

-- The API: every productive function needs the verified context, without
-- default or overload; only the closing and service functions have none.
do $$ declare fn record;begin
 for fn in select p.proname,p.oid::regprocedure sig,p.pronargdefaults,coalesce('p_auth'=any(p.proargnames),false) has_auth
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'signature\_%' loop
  if fn.proname in ('signature_close','signature_revoke_session','signature_cleanup_done','signature_expire_sessions',
   'signature_session_state','signature_pending_work','signature_reconcile') then
   assert not fn.has_auth,'Closing function takes a session context: '||fn.sig::text;
  else
   assert fn.has_auth and fn.pronargdefaults=0,'Productive function without a required context: '||fn.sig::text;
  end if;
 end loop;
 assert (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('signature_advance','signature_reserve','signature_complete','signature_session_token'))=4,
  'An old overload survived';
end $$;

-- Account deletion intent: neither the sealed token nor the OAuth verifier leaves.
insert into public.user_settings(user_id,prescriber_cpf) values('d1700000-0000-4000-8000-000000000004','52998224725')
 on conflict(user_id) do update set prescriber_cpf=excluded.prescriber_cpf;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000004';
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 perform public.signature_begin_authorization(u,'vidaas',repeat('3',64),t,pg_temp.a(u));
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000007',now()+interval '8 hours',repeat('c',64),t,pg_temp.a(u));
end $$;
reset role;
insert into public.account_deletion_requests(user_id) values('d1700000-0000-4000-8000-000000000004');
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000004';begin
 begin perform public.signature_session_token(u,'d1730000-0000-4000-8000-000000000007',1,pg_temp.a(u));
  raise exception 'Token left after the deletion intent';exception when insufficient_privilege then null;end;
 begin perform public.signature_consume_authorization(u,'vidaas',repeat('3',64),pg_temp.a(u));
  raise exception 'Verifier consumed after the deletion intent';exception when insufficient_privilege then null;end;
 assert exists(select 1 from jsonb_array_elements(public.signature_pending_work(50)) w
  where w->>'operationId'='d1740000-0000-4000-8000-000000000013' and w->>'kind'='remove_candidate'),'Pending cleanup not discoverable';
end $$;
reset role;

-- Expiry ends the session and drops the token, without a client.
insert into cortex_private.signature_sessions(id,user_id,psc,status,generation,cert_sha256,token,created_at,expires_at)
 values('d1730000-0000-4000-8000-000000000008','d1700000-0000-4000-8000-000000000002','vidaas','active',1,repeat('c',64),
  '{"v":1,"keyId":"k1","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}',now()-interval '2 hours',now()-interval '1 hour');
set local role service_role;
do $$ begin assert public.signature_expire_sessions()>=1,'Expired session kept';end $$;
reset role;
do $$ begin
 assert (select status='expired' and token is null from cortex_private.signature_sessions where id='d1730000-0000-4000-8000-000000000008'),'Expired token kept';
end $$;

-- Cascades: private patient deletion and solo account deletion stay allowed and
-- take the signature rows with them; no new deletion blocker.
set local role service_role;
do $$ begin assert public.assert_deletion_scope('d1700000-0000-4000-8000-000000000003'),'Signature rows block account deletion';end $$;
reset role;
delete from public.patients where id='d1710000-0000-4000-8000-000000000001';
delete from auth.users where id='d1700000-0000-4000-8000-000000000003';
do $$ begin
 assert not exists(select 1 from cortex_private.prescription_signatures where user_id='d1700000-0000-4000-8000-000000000001'),'Audit survived its prescription';
 assert not exists(select 1 from cortex_private.signature_operations where user_id='d1700000-0000-4000-8000-000000000003'),'Operations survived the account';
 assert not exists(select 1 from cortex_private.signature_operations where prescription_id='d1720000-0000-4000-8000-000000000001'),'Operation survived its prescription';
 assert not exists(select 1 from cortex_private.signature_sessions where user_id='d1700000-0000-4000-8000-000000000003'),'Session survived the account';
 assert exists(select 1 from cortex_private.signature_sessions where user_id='d1700000-0000-4000-8000-000000000001'),'Session lost with a patient';
end $$;
-- P4 (20261107100000): what the executor discovers. Rows are written directly (triggers and FKs
-- off, inside a block that is rolled back) only to set ages; every row is a state the writers can
-- reach (cleanup_pending only on an abandoned terminal state).
do $$ declare w jsonb; u uuid:='d1700000-0000-4000-8000-000000000001';
 ins text:='insert into cortex_private.signature_operations(operation_id,user_id,prescription_id,session_id,session_generation,shown_pdf_sha256,cert_sha256,
  signing_time,state,prepared_pdf_sha256,to_be_signed_sha256,policy_oid,psc_attempts,staged_path,signed_pdf_sha256,stored_at,cleanup_pending,updated_at) values ';
begin
 perform set_config('session_replication_role','replica',true);
 execute ins||format($v$
  ('e1740000-0000-4000-8000-000000000001',%1$L,'e1720000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000003',1,repeat('a',64),repeat('c',64),now(),
   'stored',repeat('d',64),repeat('e',64),'2.16.76.1.7.1.11.1.1',1,'rx/'||%1$L||'/e1720000-0000-4000-8000-000000000001/signed-e1740000-0000-4000-8000-000000000001.pdf',repeat('f',64),now()-interval '1 hour',false,now()-interval '1 hour'),
  ('e1740000-0000-4000-8000-000000000002',%1$L,'e1720000-0000-4000-8000-000000000002','d1730000-0000-4000-8000-000000000003',1,repeat('a',64),repeat('c',64),now(),
   'stored',repeat('d',64),repeat('e',64),'2.16.76.1.7.1.11.1.1',2,'rx/'||%1$L||'/e1720000-0000-4000-8000-000000000002/signed-e1740000-0000-4000-8000-000000000002.pdf',repeat('f',64),now()-interval '25 hours',false,now()-interval '25 hours'),
  ('e1740000-0000-4000-8000-000000000003',%1$L,'e1720000-0000-4000-8000-000000000003','d1730000-0000-4000-8000-000000000003',1,repeat('a',64),repeat('c',64),now(),
   'completed',repeat('d',64),repeat('e',64),'2.16.76.1.7.1.11.1.1',1,'rx/'||%1$L||'/e1720000-0000-4000-8000-000000000003/signed-e1740000-0000-4000-8000-000000000003.pdf',repeat('f',64),now()-interval '2 days',false,now()-interval '2 days'),
  ('e1740000-0000-4000-8000-000000000004',%1$L,'e1720000-0000-4000-8000-000000000004','d1730000-0000-4000-8000-000000000003',1,repeat('a',64),repeat('c',64),now(),
   'ambiguous',repeat('d',64),repeat('e',64),'2.16.76.1.7.1.11.1.1',3,null,null,null,false,now()-interval '2 days'),
  ('e1740000-0000-4000-8000-000000000005',%1$L,'e1720000-0000-4000-8000-000000000005','d1730000-0000-4000-8000-000000000003',1,repeat('a',64),repeat('c',64),now(),
   'psc_requested',repeat('d',64),repeat('e',64),'2.16.76.1.7.1.11.1.1',4,null,null,null,false,now()-interval '20 minutes')
 $v$, u);
 -- An abandoned candidate of an account being deleted is skipped (signature_lock refuses it), while
 -- the same case for another account is listed.
 execute ins||$v$
  ('e1740000-0000-4000-8000-000000000006','d1700000-0000-4000-8000-000000000004','e1720000-0000-4000-8000-000000000006','d1730000-0000-4000-8000-000000000007',1,repeat('a',64),repeat('c',64),now(),
   'failed',null,null,null,0,null,null,null,true,now()-interval '1 hour'),
  ('e1740000-0000-4000-8000-000000000007','d1700000-0000-4000-8000-000000000001','e1720000-0000-4000-8000-000000000007','d1730000-0000-4000-8000-000000000003',1,repeat('a',64),repeat('c',64),now(),
   'failed',null,null,null,0,null,null,null,true,now()-interval '1 hour')
 $v$;
 w:=public.signature_pending_work(500);
 assert exists(select 1 from public.account_deletion_requests where user_id='d1700000-0000-4000-8000-000000000004'),'fixture: no deletion request';
 assert not exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'='e1740000-0000-4000-8000-000000000006'),'Account being deleted listed';
 assert exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'='e1740000-0000-4000-8000-000000000007' and e->>'kind'='remove_candidate'),'Abandoned candidate not listed';
 assert not exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'='e1740000-0000-4000-8000-000000000001'),'Stored candidate waiting for the doctor listed';
 assert exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'='e1740000-0000-4000-8000-000000000002' and e->>'kind'='stuck' and (e->>'attempt')::int=2),
  'Stored for 24 h not listed as stuck with its attempt';
 assert not exists(select 1 from jsonb_array_elements(w) e where e->>'operationId' in ('e1740000-0000-4000-8000-000000000003','e1740000-0000-4000-8000-000000000004')),
  'Completed or ambiguous operation listed';
 assert exists(select 1 from jsonb_array_elements(w) e where e->>'operationId'='e1740000-0000-4000-8000-000000000005' and e->>'kind'='stuck' and (e->>'attempt')::int=4),
  'PSC request untouched for 15 min not listed with its attempt';
 assert not exists(select 1 from jsonb_array_elements(w) e where not (e ? 'attempt')),'Item without attempt';
 raise exception using errcode='P0099', message='p4_rollback';
exception when sqlstate 'P0099' then null;
end $$;
rollback;
