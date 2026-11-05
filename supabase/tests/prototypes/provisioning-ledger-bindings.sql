-- Empty disposable lab only. Binding integrity, NOT a production authorizer.
begin;
do $$ begin
 if exists(select 1 from provision_identity_lab.operations) or exists(select 1 from provision_intent_lab.intents) then
  raise exception 'Ledger binding lab requires empty tables' using errcode='42501';
 end if;
end $$;

create function provision_identity_lab.guard_operation_binding() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Ledger history cannot be replaced' using errcode='P4102';end if;
 if tg_op='INSERT' then
  if new.phase is distinct from 'prepared' or new.revision is distinct from 1 or new.birth_transaction is not null then
   raise exception 'Invalid initial ledger identity' using errcode='P4103';
  end if;
 elsif (new.operation_id,new.planned_user_id,new.revision) is distinct from (old.operation_id,old.planned_user_id,old.revision)
  or (old.birth_transaction is not null and new.birth_transaction is distinct from old.birth_transaction) then
  raise exception 'Ledger identity binding is immutable' using errcode='P4101';
 end if;
 return new;
end $$;

create function provision_intent_lab.guard_intent_binding() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare reserved provision_identity_lab.operations;
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Ledger history cannot be replaced' using errcode='P4102';end if;
 if tg_op='INSERT' then
  if new.phase is distinct from 'prepared' then raise exception 'Invalid initial intent' using errcode='P4103';end if;
  select * into reserved from provision_identity_lab.operations where operation_id=new.operation_id for share nowait;
  if not found or reserved.planned_user_id is distinct from new.planned_user_id or reserved.phase<>'prepared' then
   raise exception 'Intent does not match the reserved identity' using errcode='P4104';
  end if;
 elsif (to_jsonb(new)-'phase') is distinct from (to_jsonb(old)-'phase') then
  raise exception 'Intent authority binding is immutable' using errcode='P4101';
 end if;
 return new;
exception when lock_not_available then raise exception 'Reserved identity busy' using errcode='40001';
end $$;

revoke all on function provision_identity_lab.guard_operation_binding(),provision_intent_lab.guard_intent_binding()
 from public,anon,authenticated,service_role;
create trigger operation_binding before insert or update or delete on provision_identity_lab.operations
 for each row execute function provision_identity_lab.guard_operation_binding();
create trigger operation_history before truncate on provision_identity_lab.operations
 for each statement execute function provision_identity_lab.guard_operation_binding();
create trigger intent_binding before insert or update or delete on provision_intent_lab.intents
 for each row execute function provision_intent_lab.guard_intent_binding();
create trigger intent_history before truncate on provision_intent_lab.intents
 for each statement execute function provision_intent_lab.guard_intent_binding();
alter table provision_identity_lab.operations enable always trigger operation_binding;
alter table provision_identity_lab.operations enable always trigger operation_history;
alter table provision_intent_lab.intents enable always trigger intent_binding;
alter table provision_intent_lab.intents enable always trigger intent_history;
commit;
