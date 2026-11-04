-- Synthetic owned laboratory only. NOT a production migration or authorizer.
create schema provision_identity_lab;
revoke all on schema provision_identity_lab from public,anon,authenticated,service_role;
create table provision_identity_lab.operations(
 operation_id uuid primary key,
 planned_user_id uuid not null unique,
 revision integer not null default 1 check(revision=1),
 phase text not null default 'prepared' check(phase in ('prepared','inserting','auth_created')),
 birth_transaction xid8,
 check((phase='prepared')=(birth_transaction is null))
);
revoke all on provision_identity_lab.operations from public,anon,authenticated,service_role;

-- Only native INSERT can produce birth evidence. An Admin metadata UPDATE
-- cannot attach a pre-existing identity to a prepared operation.
create function provision_identity_lab.capture_birth() returns trigger
language plpgsql security definer set search_path='' as $$
declare o provision_identity_lab.operations;
begin
 select * into o from provision_identity_lab.operations where planned_user_id=new.id for update nowait;
 if not found then return new; end if;
 if o.phase<>'prepared' then raise exception 'Provisioning identity already used' using errcode='42501'; end if;
 update provision_identity_lab.operations set phase='inserting',birth_transaction=pg_current_xact_id()
  where operation_id=o.operation_id;
 return new;
exception when lock_not_available then
 raise exception 'Provisioning identity busy' using errcode='40001';
end $$;
revoke all on function provision_identity_lab.capture_birth() from public,anon,authenticated,service_role;
create trigger provision_identity_lab_birth after insert on auth.users
 for each row execute function provision_identity_lab.capture_birth();

-- Native Admin inserts the user BEFORE applying app_metadata. Re-read the
-- final row at commit and require an INSERT event in this same transaction.
create function provision_identity_lab.confirm_birth() returns trigger
language plpgsql security definer set search_path='' as $$
declare o provision_identity_lab.operations; u auth.users;
begin
 select * into u from auth.users where id=new.id;
 if not found then raise exception 'Provisioning identity disappeared' using errcode='42501'; end if;
 select * into o from provision_identity_lab.operations where planned_user_id=new.id for update nowait;
 if not found then
  if u.raw_app_meta_data ? 'cortex_provision_operation' then
   raise exception 'Unreserved provisioning identity' using errcode='42501';
  end if;
  return new;
 end if;
 if o.phase<>'inserting' or o.birth_transaction is distinct from pg_current_xact_id()
  or (u.raw_app_meta_data->>'cortex_provision_operation') is distinct from o.operation_id::text
  or (u.raw_app_meta_data->>'cortex_provision_revision') is distinct from o.revision::text
  or (u.raw_app_meta_data->>'account_type') is distinct from 'reception' then
  raise exception 'Provisioning identity mismatch' using errcode='42501';
 end if;
 update provision_identity_lab.operations set phase='auth_created' where operation_id=o.operation_id;
 return new;
exception when lock_not_available then
 raise exception 'Provisioning identity busy' using errcode='40001';
end $$;
revoke all on function provision_identity_lab.confirm_birth() from public,anon,authenticated,service_role;
create constraint trigger provision_identity_lab_confirm after insert on auth.users
 deferrable initially deferred for each row execute function provision_identity_lab.confirm_birth();

create function provision_identity_lab.has_birth_receipt(p_operation uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from provision_identity_lab.operations o join auth.users u on u.id=o.planned_user_id
  where o.operation_id=p_operation and o.phase='auth_created' and o.birth_transaction is not null
  and u.raw_app_meta_data->>'account_type'='reception'
  and u.raw_app_meta_data->>'cortex_provision_operation'=o.operation_id::text
  and u.raw_app_meta_data->>'cortex_provision_revision'=o.revision::text);
$$;
revoke all on function provision_identity_lab.has_birth_receipt(uuid) from public,anon,authenticated,service_role;
