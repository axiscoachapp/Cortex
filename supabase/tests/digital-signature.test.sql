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
 assert (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'signature\_%')=12,
  'Unexpected D17 service API size';
 assert not has_table_privilege('service_role','cortex_private.signature_sessions','select'),'Sessions readable directly';
 assert not has_table_privilege('authenticated','cortex_private.prescription_signatures','select'),'Audit readable by clients';
 assert not has_function_privilege('anon','public.storage_parent_is_live(text,text)','execute'),'Storage liveness exposed';
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

-- OAuth state: CPF required, single use, owner and PSC bound, sealed shape.
do $$ declare v jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','c2VhbGVk');begin
 begin perform public.signature_begin_authorization('d1700000-0000-4000-8000-000000000002','vidaas',repeat('1',64),v);
  raise exception 'State without prescriber CPF accepted';exception when sqlstate 'P4031' then null;end;
 perform public.signature_begin_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('1',64),v);
 begin perform public.signature_consume_authorization('d1700000-0000-4000-8000-000000000003','vidaas',repeat('1',64));
  raise exception 'Another doctor consumed the state';exception when sqlstate 'P4031' then null;end;
 assert public.signature_consume_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('1',64))=v,'Verifier not returned';
 begin perform public.signature_consume_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('1',64));
  raise exception 'State used twice';exception when sqlstate 'P4031' then null;end;
 begin perform public.signature_begin_authorization('d1700000-0000-4000-8000-000000000001','vidaas',repeat('2',64),'{"v":2}'::jsonb);
  raise exception 'Unsealed verifier accepted';exception when check_violation then null;end;
end $$;

-- Session: at most 12 h, one active, token only for the right owner and generation.
do $$ declare t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 begin perform public.signature_activate_session('d1700000-0000-4000-8000-000000000001','vidaas','d1730000-0000-4000-8000-000000000001',now()+interval '13 hours',repeat('c',64),t);
  raise exception 'Session over 12 hours accepted';exception when sqlstate '22023' then null;end;
 perform public.signature_activate_session('d1700000-0000-4000-8000-000000000001','vidaas','d1730000-0000-4000-8000-000000000001',now()+interval '8 hours',repeat('c',64),t);
 assert public.signature_session_token('d1700000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000001',1)=t,'Token not returned';
 begin perform public.signature_session_token('d1700000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000001',2);
  raise exception 'Wrong generation opened the token';exception when sqlstate 'P4031' then null;end;
 begin perform public.signature_session_token('d1700000-0000-4000-8000-000000000003','d1730000-0000-4000-8000-000000000001',1);
  raise exception 'Another doctor read the token';exception when sqlstate 'P4031' then null;end;
 assert public.signature_session_state('d1700000-0000-4000-8000-000000000001')->>'active'='true','Session not active';
 assert public.signature_session_state('d1700000-0000-4000-8000-000000000002')->>'active'='false','Phantom session';
end $$;

-- Reservation rules and idempotency.
do $$ declare r jsonb;begin
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000001',repeat('b',64));
  raise exception 'Hash not shown accepted';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000003',repeat('a',64));
  raise exception 'Antimicrobial signed in Phase 1';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000009',repeat('a',64));
  raise exception 'Foreign document reserved';exception when insufficient_privilege then null;end;
 r:=public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000001',repeat('a',64));
 assert r->>'state'='reserved' and r->>'session_generation'='1' and r->>'cert_sha256'=repeat('c',64),'Reservation incomplete';
 assert public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000001',repeat('a',64))->>'signing_time'=r->>'signing_time',
  'Repeated operation changed';
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000002',repeat('a',64));
  raise exception 'Operation id reused for another payload';exception when sqlstate '22023' then null;end;
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000002','d1720000-0000-4000-8000-000000000001',repeat('a',64));
  raise exception 'Second open operation on one document';exception when sqlstate 'P4093' then null;end;
end $$;

-- Preparation is fixed; ambiguous blocks new ids and resumes only by a human retry.
do $$ declare d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');
 op uuid:='d1740000-0000-4000-8000-000000000001';u uuid:='d1700000-0000-4000-8000-000000000001';begin
 assert public.signature_advance(u,op,'prepared',d)->>'state'='prepared','Not prepared';
 assert public.signature_advance(u,op,'prepared',d)->>'state'='prepared','Same preparation not idempotent';
 begin perform public.signature_advance(u,op,'prepared',d||'{"toBeSignedSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}');
  raise exception 'Prepared bytes changed';exception when sqlstate '22023' then null;end;
 assert public.signature_advance(u,op,'psc_requested',d)->>'psc_attempts'='1','PSC attempt not counted';
 begin perform public.signature_advance(u,op,'psc_requested',d);
  raise exception 'Attempt in flight authorized twice';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}');
  raise exception 'Human retry skipped reconciliation of an attempt in flight';exception when sqlstate 'P4093' then null;end;
 assert public.signature_advance(u,op,'ambiguous',jsonb_build_object('attempt',1))->>'state'='ambiguous','Not ambiguous';
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000003','d1720000-0000-4000-8000-000000000001',repeat('a',64));
  raise exception 'New id bypassed an unreconciled attempt';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_advance(u,op,'psc_requested',d);
  raise exception 'Ambiguous retried automatically';exception when sqlstate 'P4093' then null;end;
 begin perform public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true,"toBeSignedSha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}');
  raise exception 'Retry with other bytes';exception when sqlstate '22023' then null;end;
 assert public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}')->>'psc_attempts'='2','Human retry not counted';
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
 assert public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',2))->>'state'='stored','Not stored';
 assert public.signature_complete(u,op,'00AB12','CN=AC Sintetica')->>'state'='completed','Not completed';
 assert public.signature_complete(u,op,'00AB12','CN=AC Sintetica')->>'state'='completed','Completion not idempotent';
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
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000011','d1720000-0000-4000-8000-000000000002',repeat('a',64));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000011','prepared',d);
 assert public.signature_revoke_session(u)=1,'Session not revoked';
 assert public.signature_advance(u,'d1740000-0000-4000-8000-000000000011','psc_requested',d)->>'state'='cancelled_by_revocation','Revoked session reached the PSC';
 begin perform public.signature_session_token(u,'d1730000-0000-4000-8000-000000000001',2);
  raise exception 'Token after revocation';exception when sqlstate 'P4031' then null;end;
 -- New session; revoke between storing and completing.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000002',now()+interval '8 hours',repeat('c',64),t);
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000012','d1720000-0000-4000-8000-000000000004',repeat('a',64));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000012','prepared',d);
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000012','psc_requested',d);
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000012','stored',jsonb_build_object('stagedPath',
  'rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000004/signed-d1740000-0000-4000-8000-000000000012.pdf','signedSha256',repeat('f',64),'attempt',1));
 perform public.signature_revoke_session(u);
 r:=public.signature_complete(u,'d1740000-0000-4000-8000-000000000012','01','CN=AC Sintetica');
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean,'Revocation lost the race to completion';
 perform public.signature_cleanup_done(u,'d1740000-0000-4000-8000-000000000012');
 -- Document changed during the operation (revoked by the doctor): never published.
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000003',now()+interval '8 hours',repeat('c',64),t);
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000013','d1720000-0000-4000-8000-000000000005',repeat('a',64));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000013','prepared',d);
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000013','psc_requested',d);
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000013','stored',jsonb_build_object('stagedPath',
  'rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000005/signed-d1740000-0000-4000-8000-000000000013.pdf','signedSha256',repeat('f',64),'attempt',1));
 update public.prescriptions set status='revoked' where id='d1720000-0000-4000-8000-000000000005';
 r:=public.signature_complete(u,'d1740000-0000-4000-8000-000000000013','01','CN=AC Sintetica');
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
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000004',now()+interval '8 hours',repeat('c',64),t);
 perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000021','d1720000-0000-4000-8000-000000000021',repeat('a',64));
 perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000021','prepared',d);
end $$;
reset role;
update public.patients set deletion_requested_at=now() where id='d1710000-0000-4000-8000-000000000002';
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000001';
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');begin
 begin perform public.signature_reserve(u,'d1740000-0000-4000-8000-000000000022','d1720000-0000-4000-8000-000000000022',repeat('a',64));
  raise exception 'Reserved for a patient being deleted';exception when insufficient_privilege then null;end;
 begin perform public.signature_advance(u,'d1740000-0000-4000-8000-000000000021','psc_requested',d);
  raise exception 'Patient being deleted reached the PSC';exception when insufficient_privilege then null;end;
 begin perform public.signature_complete(u,'d1740000-0000-4000-8000-000000000021','01','CN=AC Sintetica');
  raise exception 'Completed for a patient being deleted';exception when sqlstate 'P4093' or insufficient_privilege then null;end;
 assert public.signature_advance(u,'d1740000-0000-4000-8000-000000000021','cancelled',jsonb_build_object('code','patient_deleting'))->>'state'='cancelled',
  'Operation of a deleting patient cannot be closed';
end $$;
reset role;

-- The patient of the prescription's consultation (E) is part of the chain:
-- E's deletion intent stops the reservation even though D is not leaving.
update public.patients set deletion_requested_at=now() where id='d1710000-0000-4000-8000-000000000005';
set local role service_role;
do $$ begin
 begin perform public.signature_reserve('d1700000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000031','d1720000-0000-4000-8000-000000000031',repeat('a',64));
  raise exception 'Reserved while the consultation patient is being deleted';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Rate limit: 60 reservations per doctor per hour; the 61st suspends the session.
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000003';op uuid;r jsonb;
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000009',now()+interval '1 hour',repeat('c',64),t);
 for i in 1..60 loop
  op:=('d1750000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000009',repeat('a',64));
  perform public.signature_advance(u,op,'failed',jsonb_build_object('code','test_release'));
 end loop;
 r:=public.signature_reserve(u,'d1750000-0000-4000-8000-000000000999','d1720000-0000-4000-8000-000000000009',repeat('a',64));
 assert r->>'error'='rate_limited','Rate limit not applied';
 assert public.signature_session_state(u)->>'active'='false','Session not suspended';
 -- A repeated operation id still answers without consuming.
 assert public.signature_reserve(u,'d1750000-0000-4000-8000-000000000001','d1720000-0000-4000-8000-000000000009',repeat('a',64))->>'state'='failed','Repeat consumed or changed';
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
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000041',now()+interval '8 hours',repeat('c',64),t);
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000041',repeat('a',64));
 perform public.signature_advance(u,op,'prepared',d);
 perform public.signature_advance(u,op,'psc_requested',d); -- attempt 1 (request A)
 begin perform public.signature_advance(u,op,'ambiguous');
  raise exception 'Ambiguous without the attempt';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_advance(u,op,'ambiguous',jsonb_build_object('attempt',0));
  raise exception 'Ambiguous for another attempt';exception when sqlstate 'P4094' then null;end;
 -- Request B (human retry) reconciles attempt 1, idempotently.
 assert public.signature_advance(u,op,'ambiguous',jsonb_build_object('attempt',1))->>'state'='ambiguous','Attempt 1 not reconciled';
 assert public.signature_advance(u,op,'ambiguous',jsonb_build_object('attempt',1))->>'state'='ambiguous','Reconciliation not idempotent';
 begin perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1));
  raise exception 'Late answer of a reconciled attempt stored';exception when sqlstate 'P4094' then null;end;
 assert public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}')->>'psc_attempts'='2','Human retry not counted'; -- attempt 2
 begin perform public.signature_advance(u,op,'ambiguous',jsonb_build_object('attempt',1));
  raise exception 'Late timeout of attempt 1 marked attempt 2';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1));
  raise exception 'Late answer of attempt 1 stored over attempt 2';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_advance(u,op,'failed',jsonb_build_object('code','psc_rejected','attempt',1));
  raise exception 'Late failure of attempt 1 failed attempt 2';exception when sqlstate 'P4094' then null;end;
 begin perform public.signature_advance(u,op,'failed',jsonb_build_object('code','psc_rejected'));
  raise exception 'Failure after a PSC call without the attempt';exception when sqlstate 'P4094' then null;end;
 assert public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',2))->>'state'='stored','Attempt 2 not stored';
 assert public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',2))->>'state'='stored','Store not idempotent';
 assert public.signature_complete(u,op,'01','CN=AC Sintetica')->>'state'='completed','Attempt 2 not completed';

 -- A failure after a PSC call schedules the cleanup without the caller's flag.
 op:='d1740000-0000-4000-8000-000000000042';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000042',repeat('a',64));
 perform public.signature_advance(u,op,'prepared',d);
 perform public.signature_advance(u,op,'psc_requested',d);
 r:=public.signature_advance(u,op,'failed',jsonb_build_object('code','invalid_signature','attempt',1));
 assert r->>'state'='failed' and (r->>'cleanup_pending')::boolean,'Failure after a PSC call left its candidate';

 -- An ambiguous operation ended by revocation schedules the cleanup too.
 op:='d1740000-0000-4000-8000-000000000043';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000043',repeat('a',64));
 perform public.signature_advance(u,op,'prepared',d);
 perform public.signature_advance(u,op,'psc_requested',d);
 perform public.signature_advance(u,op,'ambiguous',jsonb_build_object('attempt',1));
 perform public.signature_revoke_session(u);
 r:=public.signature_advance(u,op,'psc_requested',d||'{"humanRetry":true}');
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean,'Revoked ambiguous operation left its candidate';

 -- Stored answer, then revocation: the next step ends it (Codex 19:49, case 1).
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000042',now()+interval '8 hours',repeat('c',64),t);
 op:='d1740000-0000-4000-8000-000000000044';
 path:='rx/d1700000-0000-4000-8000-000000000001/d1720000-0000-4000-8000-000000000044/signed-d1740000-0000-4000-8000-000000000044.pdf';
 perform public.signature_reserve(u,op,'d1720000-0000-4000-8000-000000000044',repeat('a',64));
 perform public.signature_advance(u,op,'prepared',d);
 perform public.signature_advance(u,op,'psc_requested',d);
 perform public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1));
 perform public.signature_revoke_session(u);
 r:=public.signature_advance(u,op,'stored',jsonb_build_object('stagedPath',path,'signedSha256',repeat('f',64),'attempt',1));
 assert r->>'state'='cancelled_by_revocation' and (r->>'cleanup_pending')::boolean,'Revoked stored operation kept open';
end $$;
reset role;
do $$ begin
 assert (select psc_attempts=2 from cortex_private.prescription_signatures where operation_id='d1740000-0000-4000-8000-000000000041'),'Audit of attempt 2 missing';
 assert (select status='generated' from public.prescriptions where id='d1720000-0000-4000-8000-000000000044'),'Revoked stored operation published';
end $$;

-- Account deletion intent: neither the sealed token nor the OAuth verifier leaves.
insert into public.user_settings(user_id,prescriber_cpf) values('d1700000-0000-4000-8000-000000000004','52998224725')
 on conflict(user_id) do update set prescriber_cpf=excluded.prescriber_cpf;
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000004';
 t jsonb:=jsonb_build_object('v',1,'keyId','k1','nonce','bm9uY2U=','ciphertext','dG9rZW4=');begin
 perform public.signature_begin_authorization(u,'vidaas',repeat('3',64),t);
 perform public.signature_activate_session(u,'vidaas','d1730000-0000-4000-8000-000000000007',now()+interval '8 hours',repeat('c',64),t);
end $$;
reset role;
insert into public.account_deletion_requests(user_id) values('d1700000-0000-4000-8000-000000000004');
set local role service_role;
do $$ declare u uuid:='d1700000-0000-4000-8000-000000000004';begin
 begin perform public.signature_session_token(u,'d1730000-0000-4000-8000-000000000007',1);
  raise exception 'Token left after the deletion intent';exception when insufficient_privilege then null;end;
 begin perform public.signature_consume_authorization(u,'vidaas',repeat('3',64));
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
rollback;
