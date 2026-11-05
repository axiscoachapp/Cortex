-- Empty owned laboratory only. No production entrypoint or grants to clients.
begin;
set transaction isolation level read committed;
lock table provision_identity_lab.operations,provision_intent_lab.intents in share row exclusive mode nowait;
do $$ begin
 if exists(select 1 from provision_identity_lab.operations) or exists(select 1 from provision_intent_lab.intents) then
  raise exception 'Creation producer lab requires empty ledgers' using errcode='42501';
 end if;
end $$;
create role provision_create_writer_lab nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema provision_intent_lab,provision_identity_lab,provision_membership_lab to provision_create_writer_lab;
grant insert(operation_id,planned_user_id) on provision_identity_lab.operations to provision_create_writer_lab;
grant select on provision_intent_lab.intents to provision_create_writer_lab;
grant insert(operation_id,planned_user_id,actor_id,session_id,clinic_id,factor_id,expires_at,membership_generation),update(phase)
 on provision_intent_lab.intents to provision_create_writer_lab;
-- UPDATE(phase) permits the existing FOR UPDATE replay, not confirmation:
-- intent_confirmation_producer continues to accept only its distinct role.
create function provision_identity_lab.target_exists(p_target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_target);
$$;
revoke all on function provision_identity_lab.target_exists(uuid) from public,anon,authenticated,service_role;
grant execute on function provision_identity_lab.target_exists(uuid),
 provision_intent_lab.assert_context(uuid,uuid,uuid,text,bigint),provision_membership_lab.current_generation(uuid,uuid),
 provision_identity_lab.acquire_reservation_keys(uuid,uuid),provision_intent_lab.fence_current_receipt(uuid,uuid),
 provision_intent_lab.assert_final_deadlines(uuid,uuid,bigint,timestamptz) to provision_create_writer_lab;

create or replace function provision_intent_lab.begin_intent(p_operation uuid,p_planned uuid,p_actor uuid,p_session uuid,p_clinic uuid,p_aal text,p_exp bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i provision_intent_lab.intents;supporting uuid;generation uuid;t timestamptz;
begin
 supporting:=provision_intent_lab.assert_context(p_actor,p_session,p_clinic,p_aal,p_exp);
 generation:=provision_membership_lab.current_generation(p_clinic,p_actor);
 perform provision_identity_lab.acquire_reservation_keys(p_operation,p_planned);
 select * into i from provision_intent_lab.intents where operation_id=p_operation for update nowait;
 if found then
  if (i.planned_user_id,i.actor_id,i.session_id,i.clinic_id) is distinct from (p_planned,p_actor,p_session,p_clinic) then
   raise exception 'Clinic intent binding changed' using errcode='22023';end if;
  if i.factor_id is distinct from supporting or i.membership_generation is distinct from generation then
   raise exception 'Clinic intent authority replaced or expired' using errcode='42501';end if;
  if i.phase='confirmed' then perform provision_intent_lab.fence_current_receipt(p_operation,i.planned_user_id);end if;
  perform provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,i.expires_at);
  return to_jsonb(i);
 end if;
 if provision_identity_lab.target_exists(p_planned) then raise exception 'Existing identity is not a new clinic intent' using errcode='42501';end if;
 t:=provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,null);
 insert into provision_identity_lab.operations(operation_id,planned_user_id) values(p_operation,p_planned);
 insert into provision_intent_lab.intents(operation_id,planned_user_id,actor_id,session_id,clinic_id,factor_id,expires_at,membership_generation)
 values(p_operation,p_planned,p_actor,p_session,p_clinic,supporting,least(t+interval '5 minutes',to_timestamp(p_exp)),generation) returning * into i;
 return to_jsonb(i);
exception when lock_not_available then raise exception 'Clinic intent busy' using errcode='40001';
end $$;
alter function provision_intent_lab.begin_intent(uuid,uuid,uuid,uuid,uuid,text,bigint) owner to provision_create_writer_lab;

create function provision_identity_lab.guard_creation_producer() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
begin
 if current_user<>'provision_create_writer_lab' then
  raise exception 'Reservation INSERT requires the private producer' using errcode='P4109';
 end if;
 return new;
end $$;
revoke all on function provision_identity_lab.guard_creation_producer() from public,anon,authenticated,service_role;
-- After binding guards, but always after aa_reservation_keys too.
create trigger operation_creation_producer before insert on provision_identity_lab.operations
 for each row execute function provision_identity_lab.guard_creation_producer();
create trigger intent_creation_producer before insert on provision_intent_lab.intents
 for each row execute function provision_identity_lab.guard_creation_producer();
alter table provision_identity_lab.operations enable always trigger operation_creation_producer;
alter table provision_intent_lab.intents enable always trigger intent_creation_producer;
commit;
