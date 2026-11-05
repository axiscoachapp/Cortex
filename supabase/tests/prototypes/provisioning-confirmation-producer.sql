-- Empty owned laboratory only. Does not authorize reservation/intent INSERT.
begin;
set transaction isolation level read committed;
lock table provision_identity_lab.operations,provision_intent_lab.intents in share row exclusive mode nowait;
do $$ begin
 if exists(select 1 from provision_identity_lab.operations) or exists(select 1 from provision_intent_lab.intents) then
  raise exception 'Confirmation producer lab requires empty ledgers' using errcode='42501';
 end if;
end $$;

create role provision_confirm_writer_lab nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema provision_intent_lab,provision_identity_lab,provision_membership_lab to provision_confirm_writer_lab;
grant select on provision_intent_lab.intents to provision_confirm_writer_lab;
grant update(phase) on provision_intent_lab.intents to provision_confirm_writer_lab;
grant execute on function provision_intent_lab.assert_context(uuid,uuid,uuid,text,bigint),
 provision_membership_lab.current_generation(uuid,uuid),
 provision_identity_lab.acquire_reservation_keys(uuid,uuid),
 provision_intent_lab.fence_current_receipt(uuid,uuid,boolean),
 provision_intent_lab.assert_final_deadlines(uuid,uuid,bigint,timestamptz) to provision_confirm_writer_lab;

-- The body still performs every native context/receipt/deadline check. The
-- private role receives no Auth SELECT or broad permission to alter bindings.
alter function provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean) owner to provision_confirm_writer_lab;

create function provision_intent_lab.guard_confirmation_producer() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
begin
 if new.phase is not distinct from old.phase then return new;end if;
 if current_user<>'provision_confirm_writer_lab' then
  raise exception 'Confirmation requires the private producer' using errcode='P4107';
 end if;
 if old.phase is distinct from 'prepared' or new.phase is distinct from 'confirmed' then
  raise exception 'Invalid confirmation sequence' using errcode='P4108';
 end if;
 return new;
end $$;
revoke all on function provision_intent_lab.guard_confirmation_producer() from public,anon,authenticated,service_role;
create trigger intent_confirmation_producer before update on provision_intent_lab.intents
 for each row execute function provision_intent_lab.guard_confirmation_producer();
alter table provision_intent_lab.intents enable always trigger intent_confirmation_producer;
commit;
