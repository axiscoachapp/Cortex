-- D17: ICP-Brasil signature of Cortex documents (contract:
-- docs/prescriptions/ASSINATURA_DIGITAL.md, v2 accepted by Codex on 04/11
-- 13:21 with the conditions of that message).
--
-- Private tables, reachable only through SECURITY DEFINER functions that only
-- service_role may execute (the Edge Functions call them after requireUser),
-- plus one status RPC for the signed-in doctor. The PSC session token and the
-- OAuth verifier arrive here already sealed (AES-256-GCM in the Edge); the
-- database never sees them in clear.
--
-- Runs after 20261104240000: it extends three T33 custody helpers (authorized
-- by Codex for this increment), keeping their previous rules verbatim.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
lock table public.prescriptions in share row exclusive mode nowait;

-- ---------------------------------------------------------------------------
-- 1. Tables

create table cortex_private.signature_oauth_states(
 state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 psc text not null check(psc in ('vidaas')),
 verifier jsonb not null check(jsonb_typeof(verifier)='object' and verifier->>'v'='1' and verifier ?& array['keyId','nonce','ciphertext']),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);
create index signature_oauth_states_user on cortex_private.signature_oauth_states(user_id);

create table cortex_private.signature_sessions(
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 psc text not null check(psc in ('vidaas')),
 status text not null check(status in ('active','revoked','expired','suspended','replaced')),
 generation integer not null check(generation>0),
 cert_sha256 text not null check(cert_sha256 ~ '^[0-9a-f]{64}$'),
 token jsonb check(token is null or (jsonb_typeof(token)='object' and token->>'v'='1' and token ?& array['keyId','nonce','ciphertext'])),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 ended_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '12 hours'),
 -- Only an active session keeps a (sealed) token; ending it drops the token.
 check((status='active' and token is not null and ended_at is null) or (status<>'active' and token is null and ended_at is not null))
);
create unique index signature_one_active_session on cortex_private.signature_sessions(user_id) where status='active';

create table cortex_private.signature_operations(
 operation_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 prescription_id uuid not null references public.prescriptions(id) on delete cascade,
 session_id uuid not null references cortex_private.signature_sessions(id) on delete cascade,
 session_generation integer not null check(session_generation>0),
 shown_pdf_sha256 text not null check(shown_pdf_sha256 ~ '^[0-9a-f]{64}$'),
 cert_sha256 text not null check(cert_sha256 ~ '^[0-9a-f]{64}$'),
 signing_time timestamptz not null,
 state text not null check(state in ('reserved','prepared','psc_requested','ambiguous','stored','completed','failed','cancelled','cancelled_by_revocation')),
 prepared_pdf_sha256 text check(prepared_pdf_sha256 ~ '^[0-9a-f]{64}$'),
 to_be_signed_sha256 text check(to_be_signed_sha256 ~ '^[0-9a-f]{64}$'),
 policy_oid text check(policy_oid ~ '^[0-9]+(\.[0-9]+)+$'),
 psc_attempts integer not null default 0 check(psc_attempts between 0 and 5),
 staged_path text,
 signed_pdf_sha256 text check(signed_pdf_sha256 ~ '^[0-9a-f]{64}$'),
 cleanup_pending boolean not null default false,
 error_code text check(error_code ~ '^[a-z_]{1,40}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(staged_path is null or staged_path='rx/'||user_id::text||'/'||prescription_id::text||'/signed-'||operation_id::text||'.pdf'),
 check(state not in ('prepared','psc_requested','ambiguous','stored','completed') or (prepared_pdf_sha256 is not null and to_be_signed_sha256 is not null and policy_oid is not null)),
 check(state not in ('stored','completed') or (staged_path is not null and signed_pdf_sha256 is not null))
);
-- An unreconciled attempt (ambiguous included) blocks any new operation id
-- on the same document.
create unique index signature_one_open_operation on cortex_private.signature_operations(prescription_id)
 where state in ('reserved','prepared','psc_requested','ambiguous','stored');
create index signature_operations_rate on cortex_private.signature_operations(user_id,created_at);
create index signature_operations_session on cortex_private.signature_operations(session_id);

-- Append-only audit. Its only FK is the prescription: one cascade path, so a
-- deletion never depends on the order of RI triggers. user_id is copied from
-- the prescription and checked on insert.
create table cortex_private.prescription_signatures(
 id uuid primary key default gen_random_uuid(),
 prescription_id uuid not null references public.prescriptions(id) on delete cascade,
 user_id uuid not null,
 operation_id uuid not null unique,
 psc text not null check(psc in ('vidaas')),
 pdf_sha256_before text not null check(pdf_sha256_before ~ '^[0-9a-f]{64}$'),
 pdf_sha256_after text not null check(pdf_sha256_after ~ '^[0-9a-f]{64}$'),
 cert_sha256 text not null check(cert_sha256 ~ '^[0-9a-f]{64}$'),
 cert_serial text not null check(cert_serial ~ '^[0-9a-f]{1,64}$'),
 cert_issuer text not null check(length(cert_issuer) between 1 and 512),
 policy_oid text not null check(policy_oid ~ '^[0-9]+(\.[0-9]+)+$'),
 psc_attempts integer not null check(psc_attempts between 1 and 5),
 signed_at timestamptz not null default now()
);
create index prescription_signatures_prescription on cortex_private.prescription_signatures(prescription_id);

alter table cortex_private.signature_oauth_states enable row level security;
alter table cortex_private.signature_sessions enable row level security;
alter table cortex_private.signature_operations enable row level security;
alter table cortex_private.prescription_signatures enable row level security;
revoke all on cortex_private.signature_oauth_states,cortex_private.signature_sessions,
 cortex_private.signature_operations,cortex_private.prescription_signatures from public,anon,authenticated,service_role;

-- The signed copy is a new object; the original storage_path never changes.
alter table public.prescriptions add column signed_storage_path text unique;
alter table public.prescriptions add constraint prescription_signed_path check(
 signed_storage_path is null or signed_storage_path ~ ('^rx/'||user_id::text||'/'||id::text||'/signed-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'));

-- ---------------------------------------------------------------------------
-- 2. Integrity triggers

create function cortex_private.guard_signature_operation() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare allowed boolean;
begin
 if tg_op='DELETE' then return old;end if; -- only cascades reach here (no grants)
 if tg_op='INSERT' then
  if new.state<>'reserved' or new.psc_attempts<>0 or new.prepared_pdf_sha256 is not null or new.staged_path is not null
   or new.cleanup_pending then raise exception 'Signature operation must start reserved' using errcode='22023';end if;
  return new;
 end if;
 if (new.operation_id,new.user_id,new.prescription_id,new.session_id,new.session_generation,new.shown_pdf_sha256,new.cert_sha256,new.signing_time,new.created_at)
  is distinct from (old.operation_id,old.user_id,old.prescription_id,old.session_id,old.session_generation,old.shown_pdf_sha256,old.cert_sha256,old.signing_time,old.created_at)
 then raise exception 'Signature operation identity is immutable' using errcode='22023';end if;
 -- Fixed on the first preparation; a retry must reuse exactly the same bytes.
 if old.prepared_pdf_sha256 is not null and (new.prepared_pdf_sha256,new.to_be_signed_sha256,new.policy_oid)
  is distinct from (old.prepared_pdf_sha256,old.to_be_signed_sha256,old.policy_oid)
 then raise exception 'Prepared signature data is immutable' using errcode='22023';end if;
 if old.signed_pdf_sha256 is not null and (new.staged_path,new.signed_pdf_sha256) is distinct from (old.staged_path,old.signed_pdf_sha256)
 then raise exception 'Stored signature data is immutable' using errcode='22023';end if;
 allowed:=new.state=old.state or (old.state,new.state) in (
  ('reserved','prepared'),('reserved','failed'),('reserved','cancelled'),('reserved','cancelled_by_revocation'),
  ('prepared','psc_requested'),('prepared','failed'),('prepared','cancelled'),('prepared','cancelled_by_revocation'),
  ('psc_requested','ambiguous'),('psc_requested','stored'),('psc_requested','failed'),('psc_requested','cancelled_by_revocation'),
  ('ambiguous','psc_requested'),('ambiguous','failed'),('ambiguous','cancelled_by_revocation'),
  ('stored','completed'),('stored','cancelled'),('stored','cancelled_by_revocation'));
 if not allowed then raise exception 'Signature operation transition % -> % refused',old.state,new.state using errcode='22023';end if;
 -- Terminal states only clear the cleanup flag.
 if old.state in ('completed','failed','cancelled','cancelled_by_revocation') and
  (new.state<>old.state or new.cleanup_pending and not old.cleanup_pending) then
  raise exception 'Terminal signature operation' using errcode='22023';end if;
 if new.cleanup_pending and new.state not in ('failed','cancelled','cancelled_by_revocation') then
  raise exception 'Only an abandoned operation has cleanup' using errcode='22023';end if;
 if new.psc_attempts<>old.psc_attempts and not (new.state='psc_requested' and old.state in ('prepared','ambiguous')
  and new.psc_attempts=old.psc_attempts+1) then
  raise exception 'A PSC attempt is authorized only once, from prepared or by a human retry' using errcode='22023';end if;
 if new.state='psc_requested' and old.state='psc_requested' and new.psc_attempts=old.psc_attempts and new is distinct from old then
  raise exception 'An attempt in flight cannot change' using errcode='22023';end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
create trigger signature_operation_rules before insert or update or delete on cortex_private.signature_operations
 for each row execute function cortex_private.guard_signature_operation();

create function cortex_private.guard_signature_audit() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare owner uuid;
begin
 if tg_op='UPDATE' then raise exception 'Signature audit is append-only' using errcode='22023';end if;
 if tg_op='DELETE' then
  -- Only the cascade from a prescription that is already gone may remove it.
  if exists(select 1 from public.prescriptions where id=old.prescription_id) then
   raise exception 'Signature audit is append-only' using errcode='22023';end if;
  return old;
 end if;
 select user_id into owner from public.prescriptions where id=new.prescription_id;
 if owner is distinct from new.user_id then raise exception 'Signature audit owner mismatch' using errcode='42501';end if;
 return new;
end $$;
create trigger signature_audit_rules before insert or update or delete on cortex_private.prescription_signatures
 for each row execute function cortex_private.guard_signature_audit();

-- Ownership of every reference, validated after the custody triggers.
create function cortex_private.validate_signature_references() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_table_name='signature_operations' then
  if not exists(select 1 from public.prescriptions where id=new.prescription_id and user_id=new.user_id)
   or not exists(select 1 from cortex_private.signature_sessions where id=new.session_id and user_id=new.user_id) then
   raise exception 'Signature reference not owned' using errcode='42501';end if;
 end if;
 return null;
end $$;
create trigger zz_signature_references after insert or update on cortex_private.signature_operations
 for each row execute function cortex_private.validate_signature_references();

-- Signature fields of a prescription are written only by signature_complete.
create function cortex_private.guard_prescription_signature_fields() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if ((new.status='signed' and old.status is distinct from 'signed')
  or new.signed_storage_path is distinct from old.signed_storage_path
  or (new.signature_verified_at is distinct from old.signature_verified_at)
  or (new.status='signed' and new.signed_at is distinct from old.signed_at))
  and coalesce(current_setting('cortex.signature_writer',true),'')<>'on' then
  raise exception 'Signature fields are written only by the signature service' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_signature_fields before update on public.prescriptions
 for each row execute function cortex_private.guard_prescription_signature_fields();

-- ---------------------------------------------------------------------------
-- 3. T33 custody: prescription identity (authorized by Codex on 04/11 13:21).
-- Bodies copied from 20261104200000; only the prescription branches are new.

-- The resource namespace gains 'prescription'; the earlier ones are unchanged.
alter table cortex_private.custody_resource_epochs drop constraint custody_resource_epochs_resource_key_check;
alter table cortex_private.custody_resource_epochs add constraint custody_resource_epochs_resource_key_check check(
 resource_key ~ '^(patient|appointment|consultation|knowledge_document|document_template|prescription):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

create or replace function cortex_private.custody_reference_accounts(row_data jsonb,fields text[],table_name text) returns uuid[]
language plpgsql volatile security definer set search_path='' as $$
declare accounts uuid[]:='{}';field text;parent_id uuid;parent_user uuid;parent_patient uuid;rx_consultation uuid;
begin
 foreach field in array fields loop accounts:=array_append(accounts,(row_data->>field)::uuid);end loop;
 select user_id into parent_user from public.patients where id=(row_data->>'patient_id')::uuid;
 accounts:=array_append(accounts,parent_user);
 parent_id:=(row_data->>'appointment_id')::uuid;
 if table_name='reception_audit' then parent_id:=(row_data->>'resource_id')::uuid;end if;
 if parent_id is not null then
  select user_id,patient_id into parent_user,parent_patient from public.appointments where id=parent_id;
  accounts:=array_append(accounts,parent_user);
  select user_id into parent_user from public.patients where id=parent_patient;
  accounts:=array_append(accounts,parent_user);
 end if;
 if table_name='knowledge_chunks' then
  select user_id into parent_user from public.knowledge_documents where id=(row_data->>'document_id')::uuid;
  accounts:=array_append(accounts,parent_user);
 end if;
 if table_name='user_settings' then
  select user_id into parent_user from public.document_templates where id=(row_data->>'active_template_id')::uuid;
  accounts:=array_append(accounts,parent_user);
 end if;
 if table_name='prescriptions' then
  select user_id,patient_id into parent_user,parent_patient from public.consultations where id=(row_data->>'consultation_id')::uuid;
  accounts:=array_append(accounts,parent_user);
  select user_id into parent_user from public.patients where id=parent_patient;
  accounts:=array_append(accounts,parent_user);
 end if;
 -- D17: a row that points at a prescription answers to its doctor, its
 -- patient's owner and its consultation (and that consultation's patient).
 if table_name<>'prescriptions' and row_data ? 'prescription_id' then
  select user_id,patient_id,consultation_id into parent_user,parent_patient,rx_consultation
   from public.prescriptions where id=(row_data->>'prescription_id')::uuid;
  accounts:=array_append(accounts,parent_user);
  select user_id into parent_user from public.patients where id=parent_patient;
  accounts:=array_append(accounts,parent_user);
  if rx_consultation is not null then
   select user_id,patient_id into parent_user,parent_patient from public.consultations where id=rx_consultation;
   accounts:=array_append(accounts,parent_user);
   select user_id into parent_user from public.patients where id=parent_patient;
   accounts:=array_append(accounts,parent_user);
  end if;
 end if;
 return accounts;
end $$;

create or replace function cortex_private.direct_custody_resources(row_data jsonb,row_table text) returns text[]
language sql immutable set search_path='' as $$
 select array[
  case when row_table in ('patients','appointments','consultations','knowledge_documents','document_templates','prescriptions') then
   (case row_table when 'patients' then 'patient' when 'appointments' then 'appointment'
    when 'consultations' then 'consultation' when 'knowledge_documents' then 'knowledge_document'
    when 'document_templates' then 'document_template' when 'prescriptions' then 'prescription' end)||':'||(row_data->>'id')::uuid::text end,
  'patient:'||(row_data->>'patient_id')::uuid::text,
  'appointment:'||(row_data->>'appointment_id')::uuid::text,
  case when row_table='reception_audit' then 'appointment:'||(row_data->>'resource_id')::uuid::text end,
  case when row_table='knowledge_chunks' then 'knowledge_document:'||(row_data->>'document_id')::uuid::text end,
  case when row_table='user_settings' then 'document_template:'||(row_data->>'active_template_id')::uuid::text end,
  case when row_table='prescriptions' then 'consultation:'||(row_data->>'consultation_id')::uuid::text end,
  -- D17: the prescription is fenced before any lookup through it.
  case when row_table<>'prescriptions' then 'prescription:'||(row_data->>'prescription_id')::uuid::text end
 ]
$$;

create or replace function cortex_private.indirect_custody_resources(row_data jsonb,row_table text) returns text[]
language plpgsql volatile security definer set search_path='' as $$
declare parent_id uuid;patient uuid;keys text[]:='{}';rx_consultation uuid;
begin
 parent_id:=(row_data->>'appointment_id')::uuid;
 if row_table='reception_audit' then parent_id:=(row_data->>'resource_id')::uuid;end if;
 if parent_id is not null then
  select patient_id into patient from public.appointments where id=parent_id;
  keys:=array_append(keys,'patient:'||patient::text);
 end if;
 if row_table='prescriptions' then
  select patient_id into patient from public.consultations where id=(row_data->>'consultation_id')::uuid;
  keys:=array_append(keys,'patient:'||patient::text);
 end if;
 -- D17: read through the prescription only after it is fenced (direct key).
 if row_table<>'prescriptions' and row_data ? 'prescription_id' then
  select patient_id,consultation_id into patient,rx_consultation from public.prescriptions where id=(row_data->>'prescription_id')::uuid;
  keys:=array_append(keys,'patient:'||patient::text);
  keys:=array_append(keys,'consultation:'||rx_consultation::text);
  select patient_id into patient from public.consultations where id=rx_consultation;
  keys:=array_append(keys,'patient:'||patient::text);
 end if;
 return keys;
end $$;

-- Alphabetical AFTER order: resources before references, then ownership.
create trigger custody_00_resources after insert or update on cortex_private.signature_operations
 for each row execute function cortex_private.guard_custody_resources();
create trigger custody_reference after insert or update on cortex_private.signature_operations
 for each row execute function cortex_private.guard_custody_reference('user_id');
create trigger custody_00_resources after insert or update on cortex_private.prescription_signatures
 for each row execute function cortex_private.guard_custody_resources();
create trigger custody_reference after insert or update on cortex_private.prescription_signatures
 for each row execute function cortex_private.guard_custody_reference('user_id');
create trigger custody_reference after insert or update on cortex_private.signature_sessions
 for each row execute function cortex_private.guard_custody_reference('user_id');
create trigger custody_reference after insert or update on cortex_private.signature_oauth_states
 for each row execute function cortex_private.guard_custody_reference('user_id');
-- Deleting a prescription fences its identity too (children insert against it).
create trigger custody_00_resource_delete after delete on public.prescriptions
 for each row execute function cortex_private.guard_custody_resources();
insert into cortex_private.custody_resource_epochs(resource_key)
 select 'prescription:'||id::text from public.prescriptions on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Storage: the signed candidate lives next to the original, under a path
-- no client policy reaches; it is served only after signature_complete.

alter function public.storage_parent_is_live(text,text) rename to storage_parent_is_live_before_signature;
create function public.storage_parent_is_live(p_name text,p_bucket text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_parts text[]:=string_to_array(p_name,'/');
begin
 if public.storage_parent_is_live_before_signature(p_name,p_bucket) then return true;end if;
 -- rx/<user>/<prescription>/signed-<operation>.pdf: only while its operation
 -- is storing it or after it completed, for a live prescription and patient.
 return p_bucket='prescriptions' and public.is_canonical_storage_path(p_name) and array_length(v_parts,1)=4
  and not exists(select 1 from public.account_deletion_requests where user_id::text=v_parts[2])
  and exists(select 1 from cortex_private.signature_operations o
   join public.prescriptions r on r.id=o.prescription_id and r.user_id=o.user_id
   join public.patients p on p.id=r.patient_id and p.user_id=r.user_id
   where p_name='rx/'||o.user_id::text||'/'||o.prescription_id::text||'/signed-'||o.operation_id::text||'.pdf'
    and o.user_id::text=v_parts[2] and o.state in ('psc_requested','stored','completed')
    and p.deletion_requested_at is null);
end $$;
revoke all on function public.storage_parent_is_live(text,text) from public,anon,authenticated;
revoke all on function public.storage_parent_is_live_before_signature(text,text) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 5. Service functions (service_role only; p_user comes from requireUser)

create function cortex_private.signature_lock(p_user uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_user is null then raise exception 'Missing signature account' using errcode='42501';end if;
 -- One serialization point per doctor for every signature state change.
 perform pg_advisory_xact_lock(hashtextextended('signature:'||p_user::text,125));
 -- The clinical write lock that guard_clinical_write (20261028000000) and the
 -- account deletion intent take: held from here, the UPDATE of prescriptions
 -- in signature_complete re-enters it instead of waiting after the checks.
 -- Order everywhere: 125, 123, custody epochs (NOWAIT), then rows (NOWAIT).
 -- Holding 123, no signature function ever waits on a tuple: an ordinary
 -- clinical UPDATE takes its tuple before waiting on 123 in its BEFORE trigger
 -- (PostgreSQL locks the tuple before BEFORE ROW triggers), so a wait here
 -- would close a cycle. A busy row is a retryable 40001 instead.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,123));
 -- The account row, NOWAIT, before any other lock (Codex 04/11 16:46). Every
 -- INSERT of a signature row takes an implicit KEY SHARE on auth.users through
 -- its FK; an account DELETE locks that tuple before waiting on 123 in
 -- guard_parent_deletion, so waiting on it here would close a cycle. FOR SHARE
 -- also conflicts with a non-key UPDATE, so an account_type change (reception
 -- classification read below) cannot slip past an older RR snapshot either.
 begin
  perform 1 from auth.users where id=p_user for share nowait;
 exception when lock_not_available then
  raise exception 'Conta em alteração por outra operação; tente de novo.' using errcode='40001';
 end;
 -- T33 barrier before reading intent: an older RR snapshot or a concurrent
 -- deletion intent fails here (40001) instead of reading a stale "no intent".
 perform cortex_private.touch_custody_epoch(array[p_user]);
 if not exists(select 1 from auth.users where id=p_user) or public.is_reception_account(p_user)
  or exists(select 1 from public.account_deletion_requests where user_id=p_user) then
  raise exception 'Signature account unavailable' using errcode='42501';end if;
end $$;

-- Locks taken under 123 by the signature functions, all NOWAIT or re-entrant
-- (inventory for the Codex review of 04/11 16:46):
--  * auth.users row: FOR SHARE NOWAIT above; covers the implicit FK KEY SHARE of
--    every INSERT into signature_oauth_states, signature_sessions and
--    signature_operations, and the account_type read.
--  * custody epochs (account, prescription, patient, consultation): T33 touch
--    helpers, NOWAIT, 40001 on contention.
--  * signature_sessions / signature_operations rows: FOR UPDATE NOWAIT before
--    any UPDATE or INSERT referencing them (session FK of an operation).
--  * prescriptions row: FOR SHARE/UPDATE NOWAIT before the operation INSERT
--    (prescription FK), the completion UPDATE and the audit INSERT (its FK).
--  * the completion UPDATE of prescriptions re-enters 123 in
--    guard_clinical_write; its custody triggers touch epochs NOWAIT.
--  * oauth state rows: private, written only under the same doctor's 125.

-- Authoritative check of the document's parents, after their T33 barriers:
-- prescription identity first, then its patient and consultation. Never
-- blocks (the touches are NOWAIT); a confirmed deletion intent refuses.
create function cortex_private.signature_document(p_user uuid,p_prescription uuid) returns public.prescriptions
language plpgsql volatile security definer set search_path='' as $$
declare r public.prescriptions;deleting timestamptz;consultation_patient uuid;
begin
 if p_prescription is null then raise exception 'Documento indisponível.' using errcode='42501';end if;
 perform cortex_private.touch_custody_resources(array['prescription:'||p_prescription::text]);
 select * into r from public.prescriptions where id=p_prescription;
 if not found or r.user_id<>p_user then raise exception 'Documento indisponível.' using errcode='42501';end if;
 perform cortex_private.touch_custody_resources(array['patient:'||r.patient_id::text,'consultation:'||r.consultation_id::text]);
 select deletion_requested_at into deleting from public.patients where id=r.patient_id and user_id=r.user_id;
 if not found or deleting is not null then raise exception 'Documento indisponível.' using errcode='42501';end if;
 -- The consultation is fenced above; only now read its patient, which the
 -- schema does not force to equal the prescription's, fence it and check it.
 if r.consultation_id is not null then
  select patient_id into consultation_patient from public.consultations where id=r.consultation_id;
  if consultation_patient is not null and consultation_patient<>r.patient_id then
   perform cortex_private.touch_custody_resources(array['patient:'||consultation_patient::text]);
   if exists(select 1 from public.patients where id=consultation_patient and deletion_requested_at is not null) then
    raise exception 'Documento indisponível.' using errcode='42501';end if;
  end if;
 end if;
 return r;
end $$;

create function cortex_private.signature_session_usable(s cortex_private.signature_sessions) returns boolean
language sql volatile set search_path='' as $$
 select s.status='active' and s.expires_at>clock_timestamp();
$$;

create function public.signature_begin_authorization(p_user uuid,p_psc text,p_state_hash text,p_verifier jsonb) returns timestamptz
language plpgsql volatile security definer set search_path='' as $$
declare expires timestamptz:=now()+interval '10 minutes';
begin
 perform cortex_private.signature_lock(p_user);
 if not exists(select 1 from public.user_settings where user_id=p_user and prescriber_cpf is not null) then
  raise exception 'Informe o seu CPF em Configurações para assinar.' using errcode='P4031';end if;
 delete from cortex_private.signature_oauth_states where user_id=p_user and expires_at<=now();
 insert into cortex_private.signature_oauth_states(state_hash,user_id,psc,verifier,expires_at)
  values(p_state_hash,p_user,p_psc,p_verifier,expires);
 return expires;
end $$;

-- Single use: the row is deleted while it is read.
create function public.signature_consume_authorization(p_user uuid,p_psc text,p_state_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v jsonb;
begin
 perform cortex_private.signature_lock(p_user);
 delete from cortex_private.signature_oauth_states
  where state_hash=p_state_hash and user_id=p_user and psc=p_psc and expires_at>now()
  returning verifier into v;
 if v is null then raise exception 'Autorização vencida ou já usada. Inicie de novo.' using errcode='P4031';end if;
 return v;
end $$;

create function public.signature_activate_session(p_user uuid,p_psc text,p_session uuid,p_expires_at timestamptz,
 p_cert_sha256 text,p_token jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform cortex_private.signature_lock(p_user);
 if p_session is null or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '12 hours' then
  raise exception 'Invalid signature session' using errcode='22023';end if;
 update cortex_private.signature_sessions set status='replaced',generation=generation+1,token=null,ended_at=now()
  where user_id=p_user and status='active';
 insert into cortex_private.signature_sessions(id,user_id,psc,status,generation,cert_sha256,token,created_at,expires_at)
  values(p_session,p_user,p_psc,'active',1,p_cert_sha256,p_token,now(),p_expires_at);
 return jsonb_build_object('sessionId',p_session,'generation',1,'expiresAt',p_expires_at);
end $$;

-- Local revocation is canonical and immediate; the PSC is told afterwards.
create function public.signature_revoke_session(p_user uuid) returns integer
language plpgsql volatile security definer set search_path='' as $$
declare n integer;
begin
 perform cortex_private.signature_lock(p_user);
 update cortex_private.signature_sessions set status='revoked',generation=generation+1,token=null,ended_at=now()
  where user_id=p_user and status='active';
 get diagnostics n=row_count;
 return n;
end $$;

-- The sealed token, only for the active session in the asked generation.
create function public.signature_session_token(p_user uuid,p_session uuid,p_generation integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s cortex_private.signature_sessions;
begin
 perform cortex_private.signature_lock(p_user);
 select * into s from cortex_private.signature_sessions where id=p_session and user_id=p_user for update nowait;
 if not found or s.generation<>p_generation or not cortex_private.signature_session_usable(s) then
  raise exception 'Sessão de assinatura encerrada. Abra uma nova no aplicativo do certificado.' using errcode='P4031';end if;
 return s.token;
exception when lock_not_available then
 raise exception 'Documento ou sessão em uso por outra operação; tente de novo.' using errcode='40001';
end $$;

create function public.signature_reserve(p_user uuid,p_operation uuid,p_prescription uuid,p_shown_sha256 text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o cortex_private.signature_operations;s cortex_private.signature_sessions;r public.prescriptions;recent integer;
begin
 perform cortex_private.signature_lock(p_user);
 if p_operation is null or p_prescription is null or p_shown_sha256 !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid signature request' using errcode='22023';end if;
 select * into o from cortex_private.signature_operations where operation_id=p_operation;
 if found then
  -- The same operation must carry the same payload; it never counts twice.
  if o.user_id<>p_user or o.prescription_id<>p_prescription or o.shown_pdf_sha256<>p_shown_sha256 then
   raise exception 'Signature operation mismatch' using errcode='22023';end if;
  return to_jsonb(o)-'staged_path';
 end if;
 -- Barriers (NOWAIT) before row locks; row locks in the order session, prescription.
 perform cortex_private.signature_document(p_user,p_prescription);
 select * into s from cortex_private.signature_sessions where user_id=p_user and status='active' for update nowait;
 select * into r from public.prescriptions where id=p_prescription for share nowait;
 -- Every check after the locks, with the current clock.
 if s.id is null or not cortex_private.signature_session_usable(s) then
  raise exception 'Sessão de assinatura encerrada. Abra uma nova no aplicativo do certificado.' using errcode='P4031';end if;
 if not found or r.user_id<>p_user then raise exception 'Documento indisponível.' using errcode='42501';end if;
 if r.status<>'generated' or r.signed_storage_path is not null then
  raise exception 'O documento não está pronto para assinar.' using errcode='P4093';end if;
 if r.doc_type not in ('receita_simples','atestado','solicitacao_exames') then
  raise exception 'Este tipo de documento ainda não é assinado digitalmente.' using errcode='P4093';end if;
 if r.issuance_snapshot is null or r.issuance_snapshot->>'pdf_sha256' is distinct from p_shown_sha256 then
  raise exception 'O documento mudou depois de mostrado. Abra de novo antes de assinar.' using errcode='P4093';end if;
 if exists(select 1 from cortex_private.signature_operations where prescription_id=p_prescription
  and state in ('reserved','prepared','psc_requested','ambiguous','stored')) then
  raise exception 'Há uma assinatura em andamento ou sem resposta para este documento.' using errcode='P4093';end if;
 select count(*) into recent from cortex_private.signature_operations where user_id=p_user and created_at>now()-interval '60 minutes';
 if recent>=60 then
  -- Over the limit: suspend the session (committed), then refuse.
  update cortex_private.signature_sessions set status='suspended',generation=generation+1,token=null,ended_at=now() where id=s.id;
  return jsonb_build_object('error','rate_limited');
 end if;
 insert into cortex_private.signature_operations(operation_id,user_id,prescription_id,session_id,session_generation,
  shown_pdf_sha256,cert_sha256,signing_time,state)
  values(p_operation,p_user,p_prescription,s.id,s.generation,p_shown_sha256,s.cert_sha256,date_trunc('second',clock_timestamp()),'reserved')
  returning * into o;
 return to_jsonb(o)-'staged_path';
exception when lock_not_available then
 raise exception 'Documento ou sessão em uso por outra operação; tente de novo.' using errcode='40001';
end $$;

-- One step of the state machine. Barriers first, then session, operation and
-- prescription rows, then every check with the current clock.
create function public.signature_advance(p_user uuid,p_operation uuid,p_to text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o cortex_private.signature_operations;s cortex_private.signature_sessions;
begin
 perform cortex_private.signature_lock(p_user);
 select * into o from cortex_private.signature_operations where operation_id=p_operation and user_id=p_user;
 if not found then raise exception 'Signature operation unavailable' using errcode='42501';end if;
 if p_to in ('prepared','psc_requested','stored') then
  -- A document whose patient or account is going away never reaches the PSC.
  perform cortex_private.signature_document(p_user,o.prescription_id);
 end if;
 select * into s from cortex_private.signature_sessions where id=o.session_id for update nowait;
 select * into o from cortex_private.signature_operations where operation_id=p_operation for update nowait;
 if p_to in ('prepared','psc_requested','stored') then
  perform 1 from public.prescriptions where id=o.prescription_id for share nowait;
  -- Revocation or expiry wins every step before the answer is stored.
  if s.generation<>o.session_generation or not cortex_private.signature_session_usable(s) then
   if o.state in ('reserved','prepared','psc_requested','ambiguous') then
    update cortex_private.signature_operations set state='cancelled_by_revocation',
     cleanup_pending=(p_to='stored' or coalesce((p_data->>'uploaded')::boolean,false))
     where operation_id=p_operation returning * into o;
   end if;
   return to_jsonb(o)-'staged_path';
  end if;
 end if;
 if p_to='prepared' then
  if o.state='prepared' and (o.prepared_pdf_sha256,o.to_be_signed_sha256,o.policy_oid)
   is not distinct from (p_data->>'preparedSha256',p_data->>'toBeSignedSha256',p_data->>'policyOid') then
   return to_jsonb(o)-'staged_path';
  end if;
  update cortex_private.signature_operations set state='prepared',prepared_pdf_sha256=p_data->>'preparedSha256',
   to_be_signed_sha256=p_data->>'toBeSignedSha256',policy_oid=p_data->>'policyOid' where operation_id=p_operation returning * into o;
 elsif p_to='psc_requested' then
  -- One permission per PSC call. An attempt already in flight is never
  -- authorized again: its caller reconciles it as ambiguous first, and only
  -- a new explicit human action resumes from there.
  if o.state='psc_requested' then
   raise exception 'Tentativa já em andamento ou sem resposta: marque como sem resposta antes de repetir.' using errcode='P4093';end if;
  if o.state='ambiguous' and coalesce((p_data->>'humanRetry')::boolean,false) is not true then
   raise exception 'Tentativa sem resposta: só o médico pode repetir.' using errcode='P4093';end if;
  if o.state not in ('prepared','ambiguous') then
   raise exception 'Signature operation not ready for the PSC' using errcode='P4093';end if;
  if o.to_be_signed_sha256 is distinct from p_data->>'toBeSignedSha256' then
   raise exception 'Prepared signature data changed' using errcode='22023';end if;
  update cortex_private.signature_operations set state='psc_requested',psc_attempts=psc_attempts+1
   where operation_id=p_operation returning * into o;
 elsif p_to='ambiguous' then
  update cortex_private.signature_operations set state='ambiguous' where operation_id=p_operation returning * into o;
 elsif p_to='stored' then
  update cortex_private.signature_operations set state='stored',staged_path=p_data->>'stagedPath',signed_pdf_sha256=p_data->>'signedSha256'
   where operation_id=p_operation returning * into o;
 elsif p_to in ('failed','cancelled') then
  update cortex_private.signature_operations set state=p_to,error_code=p_data->>'code',
   cleanup_pending=(o.staged_path is not null or coalesce((p_data->>'uploaded')::boolean,false)) where operation_id=p_operation returning * into o;
 else
  raise exception 'Invalid signature step' using errcode='22023';
 end if;
 return to_jsonb(o)-'staged_path';
exception when lock_not_available then
 raise exception 'Documento ou sessão em uso por outra operação; tente de novo.' using errcode='40001';
end $$;

-- Commit point. Barriers, then session, operation and prescription rows; the
-- session's state and the clock are read only after all of them are held.
create function public.signature_complete(p_user uuid,p_operation uuid,p_cert_serial text,p_cert_issuer text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o cortex_private.signature_operations;s cortex_private.signature_sessions;r public.prescriptions;
begin
 perform cortex_private.signature_lock(p_user);
 select * into o from cortex_private.signature_operations where operation_id=p_operation and user_id=p_user;
 if not found then raise exception 'Signature operation unavailable' using errcode='42501';end if;
 if o.state='completed' then return to_jsonb(o);end if;
 perform cortex_private.signature_document(p_user,o.prescription_id);
 select * into s from cortex_private.signature_sessions where id=o.session_id for update nowait;
 select * into o from cortex_private.signature_operations where operation_id=p_operation for update nowait;
 select * into r from public.prescriptions where id=o.prescription_id for update nowait;
 if o.state='completed' then return to_jsonb(o);end if;
 if o.state<>'stored' then raise exception 'Signature operation not ready' using errcode='P4093';end if;
 if s.generation<>o.session_generation or not cortex_private.signature_session_usable(s) then
  update cortex_private.signature_operations set state='cancelled_by_revocation',cleanup_pending=true
   where operation_id=p_operation returning * into o;
  return to_jsonb(o);
 end if;
 if r.id is null or r.user_id<>p_user or r.status<>'generated' or r.signed_storage_path is not null
  or r.issuance_snapshot->>'pdf_sha256' is distinct from o.shown_pdf_sha256 then
  update cortex_private.signature_operations set state='cancelled',error_code='document_changed',cleanup_pending=true
   where operation_id=p_operation returning * into o;
  return to_jsonb(o);
 end if;
 perform set_config('cortex.signature_writer','on',true);
 update public.prescriptions set status='signed',signed_at=now(),signature_verified_at=now(),signed_storage_path=o.staged_path
  where id=r.id;
 perform set_config('cortex.signature_writer','',true);
 insert into cortex_private.prescription_signatures(prescription_id,user_id,operation_id,psc,pdf_sha256_before,pdf_sha256_after,
  cert_sha256,cert_serial,cert_issuer,policy_oid,psc_attempts)
  values(r.id,p_user,o.operation_id,s.psc,o.shown_pdf_sha256,o.signed_pdf_sha256,o.cert_sha256,lower(p_cert_serial),p_cert_issuer,o.policy_oid,o.psc_attempts);
 update cortex_private.signature_operations set state='completed' where operation_id=p_operation returning * into o;
 return to_jsonb(o);
exception when lock_not_available then
 raise exception 'Documento ou sessão em uso por outra operação; tente de novo.' using errcode='40001';
end $$;

-- Reconciliation discovery for the Edge (service only): abandoned candidates
-- to remove, and operations stuck in a non-terminal state. The Edge decides
-- with the stored object's hash; a completed operation's file is never removed.
create function public.signature_pending_work(p_limit integer default 100) returns jsonb
language sql volatile security definer set search_path='' as $$
 select coalesce(jsonb_agg(w order by w->>'updatedAt'),'[]'::jsonb) from (
  select jsonb_build_object('operationId',o.operation_id,'userId',o.user_id,'prescriptionId',o.prescription_id,'state',o.state,
   'kind',case when o.cleanup_pending then 'remove_candidate' else 'stuck' end,
   'candidatePath','rx/'||o.user_id::text||'/'||o.prescription_id::text||'/signed-'||o.operation_id::text||'.pdf',
   'signedSha256',o.signed_pdf_sha256,'updatedAt',o.updated_at) w
  from cortex_private.signature_operations o
  where o.cleanup_pending or (o.state in ('reserved','prepared','psc_requested','stored') and o.updated_at<now()-interval '15 minutes')
  order by o.updated_at limit least(greatest(coalesce(p_limit,100),1),500)) x;
$$;

-- After the Edge removed an abandoned candidate from Storage.
create function public.signature_cleanup_done(p_user uuid,p_operation uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform cortex_private.signature_lock(p_user);
 update cortex_private.signature_operations set cleanup_pending=false
  where operation_id=p_operation and user_id=p_user and cleanup_pending;
end $$;

-- Ends expired sessions and drops expired authorization states.
create function public.signature_expire_sessions() returns integer
language plpgsql volatile security definer set search_path='' as $$
declare n integer;
begin
 delete from cortex_private.signature_oauth_states where expires_at<=now();
 update cortex_private.signature_sessions set status='expired',generation=generation+1,token=null,ended_at=now()
  where status='active' and expires_at<=now();
 get diagnostics n=row_count;
 return n;
end $$;

-- Whether the doctor has a usable session, never the token. Served by the
-- signature-session Edge Function after requireUser (MFA), not as a client RPC.
create function public.signature_session_state(p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s cortex_private.signature_sessions;
begin
 if p_user is null then raise exception 'Missing signature account' using errcode='42501';end if;
 select * into s from cortex_private.signature_sessions where user_id=p_user and status='active';
 if not found or not cortex_private.signature_session_usable(s) then
  return jsonb_build_object('active',false);
 end if;
 return jsonb_build_object('active',true,'expiresAt',s.expires_at,'psc',s.psc);
end $$;

revoke all on function public.signature_begin_authorization(uuid,text,text,jsonb),public.signature_consume_authorization(uuid,text,text),
 public.signature_activate_session(uuid,text,uuid,timestamptz,text,jsonb),public.signature_revoke_session(uuid),
 public.signature_session_token(uuid,uuid,integer),public.signature_reserve(uuid,uuid,uuid,text),
 public.signature_advance(uuid,uuid,text,jsonb),public.signature_complete(uuid,uuid,text,text),
 public.signature_cleanup_done(uuid,uuid),public.signature_expire_sessions(),public.signature_session_state(uuid),
 public.signature_pending_work(integer) from public,anon,authenticated;
grant execute on function public.signature_begin_authorization(uuid,text,text,jsonb),public.signature_consume_authorization(uuid,text,text),
 public.signature_activate_session(uuid,text,uuid,timestamptz,text,jsonb),public.signature_revoke_session(uuid),
 public.signature_session_token(uuid,uuid,integer),public.signature_reserve(uuid,uuid,uuid,text),
 public.signature_advance(uuid,uuid,text,jsonb),public.signature_complete(uuid,uuid,text,text),
 public.signature_cleanup_done(uuid,uuid),public.signature_expire_sessions(),public.signature_session_state(uuid),
 public.signature_pending_work(integer) to service_role;
revoke all on all functions in schema cortex_private from public,anon,authenticated,service_role;
commit;
