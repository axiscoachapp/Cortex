-- Empty owned lab only. Does not authorize reservation/intent INSERTs.
begin;
do $$ begin
 if exists(select 1 from provision_identity_lab.operations) or exists(select 1 from provision_intent_lab.intents) then
  raise exception 'Birth producer lab requires empty ledgers' using errcode='42501';
 end if;
end $$;
create role provision_birth_writer_lab nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema provision_identity_lab to provision_birth_writer_lab;
grant select on provision_identity_lab.operations to provision_birth_writer_lab;
grant update(phase,birth_transaction) on provision_identity_lab.operations to provision_birth_writer_lab;

-- The producer gets no Auth table privilege/BYPASSRLS. The installer-owned
-- reader exposes only the final fields needed by the deferred trigger. A
-- missing user returns zero rows, preserving the trigger's NOT FOUND check.
create function provision_identity_lab.read_birth_metadata(p_target uuid)
returns table(has_operation boolean,account_type text,operation text,revision text)
language sql volatile security definer set search_path='' as $$
 select u.raw_app_meta_data ? 'cortex_provision_operation',u.raw_app_meta_data->>'account_type',
  u.raw_app_meta_data->>'cortex_provision_operation',u.raw_app_meta_data->>'cortex_provision_revision'
 from auth.users u where u.id=p_target;
$$;
revoke all on function provision_identity_lab.read_birth_metadata(uuid) from public,anon,authenticated,service_role;
grant execute on function provision_identity_lab.read_birth_metadata(uuid) to provision_birth_writer_lab;

create or replace function provision_identity_lab.confirm_birth() returns trigger
language plpgsql security definer set search_path='' as $$
declare o provision_identity_lab.operations;u record;
begin
 select * into u from provision_identity_lab.read_birth_metadata(new.id);
 if not found then raise exception 'Provisioning identity disappeared' using errcode='42501';end if;
 select * into o from provision_identity_lab.operations where planned_user_id=new.id for update nowait;
 if not found then
  if u.has_operation then raise exception 'Unreserved provisioning identity' using errcode='42501';end if;
  return new;
 end if;
 if o.phase<>'inserting' or o.birth_transaction is distinct from pg_current_xact_id()
  or u.operation is distinct from o.operation_id::text or u.revision is distinct from o.revision::text
  or u.account_type is distinct from 'reception' then
  raise exception 'Provisioning identity mismatch' using errcode='42501';
 end if;
 update provision_identity_lab.operations set phase='auth_created' where operation_id=o.operation_id;
 return new;
exception when lock_not_available then raise exception 'Provisioning identity busy' using errcode='40001';
end $$;
alter function provision_identity_lab.capture_birth() owner to provision_birth_writer_lab;
alter function provision_identity_lab.confirm_birth() owner to provision_birth_writer_lab;

-- INVOKER matters: a DEFINER trigger here would inspect its own owner instead
-- of the caller restored after the preceding binding trigger returns.
create function provision_identity_lab.guard_birth_producer() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
begin
 if (new.phase,new.birth_transaction) is not distinct from (old.phase,old.birth_transaction) then return new;end if;
 if current_user<>'provision_birth_writer_lab' then
  raise exception 'Unauthorized birth producer' using errcode='P4105';
 end if;
 if not ((old.phase='prepared' and old.birth_transaction is null and new.phase='inserting' and new.birth_transaction=pg_current_xact_id())
  or (old.phase='inserting' and new.phase='auth_created' and old.birth_transaction=pg_current_xact_id() and new.birth_transaction=old.birth_transaction)) then
  raise exception 'Invalid birth producer transition' using errcode='P4106';
 end if;
 return new;
end $$;
revoke all on function provision_identity_lab.guard_birth_producer() from public,anon,authenticated,service_role;
create trigger operation_native_producer before update on provision_identity_lab.operations
 for each row execute function provision_identity_lab.guard_birth_producer();
alter table provision_identity_lab.operations enable always trigger operation_native_producer;
commit;
