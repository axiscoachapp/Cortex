-- T33/2: replace global contention with account/resource version barriers.
-- Apply atomically. Busy installation fails and must be retried as a whole.
begin;
set transaction isolation level read committed;
do $bridge$ begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Custody installation requires read committed' using errcode='55000';end if;
 perform 1 from cortex_private.custody_epoch where singleton for update nowait;
 if not found then raise exception 'Missing previous custody epoch' using errcode='55000';end if;
 update cortex_private.custody_epoch set revision=revision+1 where singleton;
exception when lock_not_available then
 raise exception 'Custody installation busy; retry the migration transaction' using errcode='40001';
end $bridge$;
-- Drain pre-barrier writers without adding DDL waits behind their other locks.
-- Include non-resource entrypoints and Auth initialization as well as all row
-- guards. Existing holders beyond the old barrier already exclude the bridge.
do $install$ declare targets text;begin
 select string_agg(format('%I.%I',n.nspname,c.relname),',' order by c.oid) into targets
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid in (
  select tgrelid from pg_trigger where tgname='custody_reference' and not tgisinternal
  union select 'public.account_deletion_requests'::regclass
  union select 'public.clinic_members'::regclass
  union select 'public.document_snippets'::regclass
  union select 'auth.users'::regclass
 );
 execute 'lock table '||targets||' in share row exclusive mode nowait';
end $install$;

create table cortex_private.account_custody_epochs(
 user_id uuid primary key,revision bigint not null default 0
);
alter table cortex_private.account_custody_epochs enable row level security;
revoke all on cortex_private.account_custody_epochs from public,anon,authenticated,service_role;

create function cortex_private.initialize_account_custody_epoch() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into cortex_private.account_custody_epochs(user_id) values(new.id) on conflict do nothing;
 return new;
end $$;
-- Install first: CREATE TRIGGER waits out prior writers; the following fill
-- then includes accounts committed before the trigger existed.
create trigger cortex_account_custody_epoch before insert on auth.users
 for each row execute function cortex_private.initialize_account_custody_epoch();
insert into cortex_private.account_custody_epochs(user_id) select id from auth.users on conflict do nothing;

create function cortex_private.touch_custody_epoch(p_accounts uuid[]) returns void
language plpgsql volatile security definer set search_path='' as $$
declare account_id uuid;
begin
 for account_id in select distinct a from unnest(p_accounts) a where a is not null order by a loop
  perform 1 from cortex_private.account_custody_epochs where user_id=account_id for update nowait;
  if not found then raise exception 'Missing account custody epoch' using errcode='55000';end if;
  update cortex_private.account_custody_epochs set revision=revision+1 where user_id=account_id;
 end loop;
exception when lock_not_available then
 raise exception 'Custody changed concurrently; retry the transaction' using errcode='40001';
end $$;

-- Compatibility for own-document writers only. No current/legacy fallback.
create or replace function cortex_private.touch_custody_epoch() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Missing custody account' using errcode='55000';end if;
 perform cortex_private.touch_custody_epoch(array[auth.uid()]);
end $$;

create function cortex_private.custody_reference_accounts(row_data jsonb,fields text[],table_name text) returns uuid[]
language plpgsql volatile security definer set search_path='' as $$
declare accounts uuid[]:='{}';field text;parent_id uuid;parent_user uuid;parent_patient uuid;
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
 return accounts;
end $$;

create or replace function cortex_private.guard_custody_reference() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new);accounts uuid[];observed uuid[];field text;parent_id uuid;parent_user uuid;parent_patient uuid;
begin
 accounts:=cortex_private.custody_reference_accounts(row_data,tg_argv,tg_table_name);
 if tg_op='UPDATE' then
  accounts:=accounts||cortex_private.custody_reference_accounts(to_jsonb(old),tg_argv,tg_table_name);
 end if;
 perform cortex_private.touch_custody_epoch(accounts);
 -- RECHECK START: a mutable parent's owner may have committed between the
 -- first lookup and its account lock. Never validate an unfenced new owner.
 observed:=cortex_private.custody_reference_accounts(row_data,tg_argv,tg_table_name);
 if tg_op='UPDATE' then
  observed:=observed||cortex_private.custody_reference_accounts(to_jsonb(old),tg_argv,tg_table_name);
 end if;
 if array(select distinct a from unnest(accounts) a where a is not null order by a)
  is distinct from array(select distinct a from unnest(observed) a where a is not null order by a) then
  raise exception 'Custody reference changed concurrently; retry the transaction' using errcode='40001';
 end if;
 -- RECHECK END
 -- Preserve the authoritative checks on final references, after the barrier.
 foreach field in array tg_argv loop perform cortex_private.assert_account_reference((row_data->>field)::uuid);end loop;
 perform cortex_private.assert_patient_reference((row_data->>'patient_id')::uuid);
 parent_id:=(row_data->>'appointment_id')::uuid;
 if tg_table_name='reception_audit' then parent_id:=(row_data->>'resource_id')::uuid;end if;
 if parent_id is not null then
  select user_id,patient_id into parent_user,parent_patient from public.appointments where id=parent_id;
  perform cortex_private.assert_account_reference(parent_user);
  perform cortex_private.assert_patient_reference(parent_patient);
 end if;
 if tg_table_name='knowledge_chunks' then
  select user_id into parent_user from public.knowledge_documents where id=(row_data->>'document_id')::uuid;
  perform cortex_private.assert_account_reference(parent_user);
 end if;
 if tg_table_name='user_settings' then
  select user_id into parent_user from public.document_templates where id=(row_data->>'active_template_id')::uuid;
  perform cortex_private.assert_account_reference(parent_user);
 end if;
 if tg_table_name='prescriptions' then
  select user_id,patient_id into parent_user,parent_patient from public.consultations where id=(row_data->>'consultation_id')::uuid;
  perform cortex_private.assert_account_reference(parent_user);
  perform cortex_private.assert_patient_reference(parent_patient);
 end if;
 return new;
end $$;

create or replace function cortex_private.guard_custody_intent() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_table_name='account_deletion_requests' then
  if tg_op='DELETE' then
   if exists(select 1 from auth.users where id=old.user_id) then raise exception 'Deletion intent is immutable' using errcode='55000';end if;
   return old;
  end if;
  if tg_op='UPDATE' then
   if new.user_id is distinct from old.user_id then raise exception 'Deletion intent is immutable' using errcode='55000';end if;
   new.requested_at:=old.requested_at;
  end if;
 else
  if old.deletion_requested_at is not null and (new.deletion_requested_at,new.id,new.user_id)
   is distinct from (old.deletion_requested_at,old.id,old.user_id) then raise exception 'Deletion intent is immutable' using errcode='55000';end if;
  if new.deletion_requested_at is null then return new;end if;
 end if;
 perform cortex_private.touch_custody_epoch(array[new.user_id]);
 return new;
end $$;

create or replace function cortex_private.revoke_inactive_doctor_scopes() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare removed integer;
begin
 perform cortex_private.touch_custody_epoch(array[new.user_id]);
 delete from public.staff_doctor_scopes where clinic_id=new.clinic_id and doctor_user_id=new.user_id;
 get diagnostics removed=row_count;
 if removed>0 then
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(new.clinic_id,auth.uid(),'doctor_scopes_revoked',new.user_id,jsonb_build_object('count',removed));
 end if;
 return null;
end $$;
revoke all on all functions in schema cortex_private from public,anon,authenticated,service_role;


create table cortex_private.custody_resource_epochs(
 resource_key text primary key check(resource_key ~ '^(patient|appointment|consultation|knowledge_document|document_template):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 revision bigint not null default 0
);
alter table cortex_private.custody_resource_epochs enable row level security;
revoke all on cortex_private.custody_resource_epochs from public,anon,authenticated,service_role;

create function cortex_private.touch_custody_resources(p_keys text[]) returns void
language plpgsql volatile security definer set search_path='' as $$
declare resource text;
begin
 for resource in select distinct k from unnest(p_keys) k where k is not null order by k loop
  -- The transaction advisory protects first insertion too: ON CONFLICT must
  -- never introduce a wait behind another cooperating writer's new tuple.
  if not pg_try_advisory_xact_lock(hashtextextended(resource,124)) then
   raise exception 'Custody changed concurrently; retry the transaction' using errcode='40001';
  end if;
  insert into cortex_private.custody_resource_epochs(resource_key) values(resource) on conflict do nothing;
  perform 1 from cortex_private.custody_resource_epochs where resource_key=resource for update nowait;
  if not found then raise exception 'Missing custody resource epoch' using errcode='55000';end if;
  update cortex_private.custody_resource_epochs set revision=revision+1 where resource_key=resource;
 end loop;
exception when lock_not_available then
 raise exception 'Custody changed concurrently; retry the transaction' using errcode='40001';
end $$;

create function cortex_private.direct_custody_resources(row_data jsonb,row_table text) returns text[]
language sql immutable set search_path='' as $$
 select array[
  case when row_table in ('patients','appointments','consultations','knowledge_documents','document_templates') then
   (case row_table when 'patients' then 'patient' when 'appointments' then 'appointment'
    when 'consultations' then 'consultation' when 'knowledge_documents' then 'knowledge_document'
    when 'document_templates' then 'document_template' end)||':'||(row_data->>'id')::uuid::text end,
  'patient:'||(row_data->>'patient_id')::uuid::text,
  'appointment:'||(row_data->>'appointment_id')::uuid::text,
  case when row_table='reception_audit' then 'appointment:'||(row_data->>'resource_id')::uuid::text end,
  case when row_table='knowledge_chunks' then 'knowledge_document:'||(row_data->>'document_id')::uuid::text end,
  case when row_table='user_settings' then 'document_template:'||(row_data->>'active_template_id')::uuid::text end,
  case when row_table='prescriptions' then 'consultation:'||(row_data->>'consultation_id')::uuid::text end
 ]
$$;

create function cortex_private.indirect_custody_resources(row_data jsonb,row_table text) returns text[]
language plpgsql volatile security definer set search_path='' as $$
declare parent_id uuid;patient uuid;keys text[]:='{}';
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
 return keys;
end $$;

create function cortex_private.guard_custody_resources() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare row_data jsonb;old_data jsonb:='{}';keys text[];indirect text[];
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_op='UPDATE' then old_data:=to_jsonb(old);end if;
 keys:=cortex_private.direct_custody_resources(row_data,tg_table_name)
  ||cortex_private.direct_custody_resources(old_data,tg_table_name);
 perform cortex_private.touch_custody_resources(keys);
 -- Read second-level identities only after the first-level parents are fenced.
 indirect:=cortex_private.indirect_custody_resources(row_data,tg_table_name)
  ||cortex_private.indirect_custody_resources(old_data,tg_table_name);
 perform cortex_private.touch_custody_resources(indirect);
 if tg_op='DELETE' then
  -- Preserve cascade/SET NULL semantics: references already removed in this
  -- transaction are not new references. Account tombstones survive auth DELETE.
  perform cortex_private.touch_custody_epoch(array[(row_data->>'user_id')::uuid]);
  return old;
 end if;
 return new;
end $$;

-- Alphabetical AFTER order is part of the contract: protect identities before
-- custody_reference performs its account lookup/revalidation/intent checks.
do $$ declare target regclass;begin
 for target in select tgrelid::regclass from pg_trigger where tgname='custody_reference' and not tgisinternal loop
  execute format('create trigger custody_00_resources after insert or update on %s for each row execute function cortex_private.guard_custody_resources()',target);
 end loop;
 for target in select unnest(array['public.patients'::regclass,'public.appointments'::regclass,'public.consultations'::regclass,
  'public.knowledge_documents'::regclass,'public.document_templates'::regclass]) loop
  execute format('create trigger custody_00_resource_delete after delete on %s for each row execute function cortex_private.guard_custody_resources()',target);
 end loop;
end $$;

-- The account initializer above is installed BEFORE exactly once.

-- Fill existing parents; future missing polymorphic identities initialize in
-- the non-waiting helper, not by inventing a parent row or patient association.
insert into cortex_private.custody_resource_epochs(resource_key)
 select 'patient:'||id::text from public.patients union select 'appointment:'||id::text from public.appointments
 union select 'consultation:'||id::text from public.consultations union select 'knowledge_document:'||id::text from public.knowledge_documents
 union select 'document_template:'||id::text from public.document_templates on conflict do nothing;
revoke all on all functions in schema cortex_private from public,anon,authenticated,service_role;
commit;
