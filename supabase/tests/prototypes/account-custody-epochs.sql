-- T33 LAB ONLY: account-scoped replacement, not an application migration.
-- INCOMPLETE/REJECTED as a production fix: absent polymorphic parents and
-- NULL-owned templates need a resource fence too. Retain as counterexample.
-- Keep the former singleton untouched to compare the predecessor separately.
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
create trigger cortex_account_custody_epoch after insert on auth.users
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
