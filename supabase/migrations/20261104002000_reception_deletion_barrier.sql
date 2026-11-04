-- Reserved T27/2b: non-waiting version barrier for administrative custody.
-- No network operation may run while holding this transaction.
create schema cortex_private;
revoke all on schema cortex_private from public,anon,authenticated,service_role;
create table cortex_private.custody_epoch (
 singleton boolean primary key default true check(singleton),revision bigint not null default 0
);
insert into cortex_private.custody_epoch default values;
alter table cortex_private.custody_epoch enable row level security;
revoke all on cortex_private.custody_epoch from public,anon,authenticated,service_role;

create function cortex_private.touch_custody_epoch() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from cortex_private.custody_epoch where singleton for update nowait;
 if not found then raise exception 'Missing custody epoch' using errcode='55000';end if;
 update cortex_private.custody_epoch set revision=revision+1 where singleton;
exception when lock_not_available then
 raise exception 'Custody changed concurrently; retry the transaction' using errcode='40001';
end $$;

create function cortex_private.assert_account_reference(p_user uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 -- A parent already absent in this transaction permits genuine auth CASCADE /
 -- SET NULL cleanup. New references to it still fail their ordinary foreign keys.
 if exists(select 1 from auth.users where id=p_user)
  and exists(select 1 from public.account_deletion_requests where user_id=p_user) then
  raise exception 'Account deletion in progress' using errcode='55000';
 end if;
end $$;

create function cortex_private.assert_patient_reference(p_patient uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare p public.patients;
begin
 select * into p from public.patients where id=p_patient;
 if p.deletion_requested_at is not null then raise exception 'Patient deletion in progress' using errcode='55000';end if;
 perform cortex_private.assert_account_reference(p.user_id);
end $$;

create function cortex_private.guard_custody_reference() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new);field text;parent_id uuid;parent_user uuid;parent_patient uuid;
begin
 -- AFTER ROW sees final authors assigned by existing BEFORE triggers. NOWAIT
 -- prevents adding a blocking edge behind their membership/advisory/row locks.
 perform cortex_private.touch_custody_epoch();
 foreach field in array tg_argv loop
  perform cortex_private.assert_account_reference((row_data->>field)::uuid);
 end loop;
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

-- Explicit source/column inventory; values are schema-owned trigger arguments.
do $$ declare r record;begin
 for r in select * from (values
 ('clinic_staff_members','user_id'),('staff_doctor_scopes','staff_user_id,doctor_user_id'),
 ('clinic_contacts','created_by'),('patient_contact_links','doctor_user_id,confirmed_by,updated_by'),
 ('reception_cases','doctor_user_id,created_by,assigned_to'),('reception_case_notes','actor_user_id'),
 ('reception_case_drafts','actor_user_id'),('reception_audit','actor_user_id'),
 ('reception_booking_requests','actor_user_id'),('reception_schedule_blocks','doctor_user_id,created_by'),
 ('appointments','user_id,created_by,updated_by'),('clinics','created_by'),
 ('patient_shares','owner_user_id,recipient_user_id'),('shared_chart_entries','owner_user_id,author_user_id,actor_user_id'),
 ('patients','user_id'),('consultations','user_id'),('patient_files','user_id'),('prescriptions','user_id'),
 ('consultation_drafts','user_id'),('clinical_record_revisions','user_id'),
 ('knowledge_documents','user_id'),('knowledge_chunks','user_id'),('document_templates','user_id'),('user_settings','user_id')
 ) inventory(table_name,user_columns) loop
  execute format('create trigger custody_reference after insert or update on public.%I for each row execute function cortex_private.guard_custody_reference(%s)',
   r.table_name,(select string_agg(quote_literal(c),',') from unnest(string_to_array(r.user_columns,',')) c));
 end loop;
end $$;

create function cortex_private.guard_custody_intent() returns trigger
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
 perform cortex_private.touch_custody_epoch();
 return new;
end $$;
-- Alphabetical BEFORE ROW order: existing account advisory (lock_*), barrier
-- (reception_*), then authoritative shared_custody_deletion_intent precheck.
create trigger reception_custody_epoch before insert or update or delete on public.account_deletion_requests
 for each row execute function cortex_private.guard_custody_intent();
create trigger reception_custody_epoch before update of deletion_requested_at on public.patients
 for each row execute function cortex_private.guard_custody_intent();
revoke truncate on public.account_deletion_requests from public,anon,authenticated,service_role;
revoke all on all functions in schema cortex_private from public,anon,authenticated,service_role;

-- Preserve the public contract and every existing preflight. An independent
-- restrictive actor FK on shared contributions must not be omitted.
create or replace function public.assert_deletion_scope(p_user_id uuid,p_patient_id uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null then raise exception 'Missing deletion owner' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
 if exists(select 1 from public.patient_contact_links where doctor_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id))
 or exists(select 1 from public.appointments a where a.user_id=p_user_id and (p_patient_id is null or a.patient_id=p_patient_id)
  and (a.clinic_id is not null or exists(select 1 from public.reception_audit where resource_id=a.id)
   or exists(select 1 from public.reception_booking_requests where appointment_id=a.id)))
 or (p_patient_id is null and (
  exists(select 1 from public.clinic_staff_members where user_id=p_user_id)
  or exists(select 1 from public.staff_doctor_scopes where doctor_user_id=p_user_id or staff_user_id=p_user_id)
  or exists(select 1 from public.clinic_contacts where created_by=p_user_id)
  or exists(select 1 from public.patient_contact_links where confirmed_by=p_user_id or updated_by=p_user_id)
  or exists(select 1 from public.reception_cases where doctor_user_id=p_user_id or created_by=p_user_id or assigned_to=p_user_id)
  or exists(select 1 from public.reception_case_notes where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_case_drafts where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_audit where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_booking_requests where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_schedule_blocks where doctor_user_id=p_user_id or created_by=p_user_id)
  or exists(select 1 from public.appointments where user_id<>p_user_id and (created_by=p_user_id or updated_by=p_user_id)))) then
  raise exception 'Administrative custody must be resolved before deletion' using errcode='P4092';
 end if;
 if exists(select 1 from public.patient_shares where (owner_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id)) or (p_patient_id is null and recipient_user_id=p_user_id))
 or (p_patient_id is null and exists(select 1 from public.clinics where created_by=p_user_id))
 or exists(select 1 from public.shared_chart_entries where (owner_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id)) or (p_patient_id is null and (author_user_id=p_user_id or actor_user_id=p_user_id))) then
  raise exception 'Shared chart custody must be resolved before deletion' using errcode='P4091';
 end if;
 return public.assert_deletion_scope_legacy(p_user_id,p_patient_id);
end $$;
revoke all on function public.assert_deletion_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_deletion_scope(uuid,uuid) to service_role;
