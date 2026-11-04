-- T33/2 LAB ONLY, applied after account-custody-epochs.sql in an owned DB.
-- Not a migration or approval of the rejected account-only predecessor.
begin;
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

-- BEFORE is independent of the alphabetical order of future AFTER hooks.
drop trigger cortex_account_custody_epoch on auth.users;
create trigger cortex_account_custody_epoch before insert on auth.users
 for each row execute function cortex_private.initialize_account_custody_epoch();

-- Fill existing parents; future missing polymorphic identities initialize in
-- the non-waiting helper, not by inventing a parent row or patient association.
insert into cortex_private.custody_resource_epochs(resource_key)
 select 'patient:'||id::text from public.patients union select 'appointment:'||id::text from public.appointments
 union select 'consultation:'||id::text from public.consultations union select 'knowledge_document:'||id::text from public.knowledge_documents
 union select 'document_template:'||id::text from public.document_templates on conflict do nothing;
revoke all on all functions in schema cortex_private from public,anon,authenticated,service_role;
commit;
