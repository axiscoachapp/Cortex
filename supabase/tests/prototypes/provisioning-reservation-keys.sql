-- Empty owned laboratory only. No production migration or new authority.
begin;
set transaction isolation level read committed;
lock table provision_identity_lab.operations,provision_intent_lab.intents in share row exclusive mode nowait;
do $$ begin
 if exists(select 1 from provision_identity_lab.operations) or exists(select 1 from provision_intent_lab.intents) then
  raise exception 'Reservation key lab requires empty ledgers' using errcode='42501';
 end if;
end $$;

create function provision_identity_lab.acquire_reservation_keys(p_operation uuid,p_target uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_operation is null or p_target is null then raise exception 'Reservation keys required' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provisioning-lab:operation:'||p_operation::text,0)) then
  raise exception 'Reservation keys busy; retry the transaction' using errcode='40001';
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provisioning-lab:target:'||p_target::text,0)) then
  raise exception 'Reservation keys busy; retry the transaction' using errcode='40001';
 end if;
end $$;
create function provision_identity_lab.guard_reservation_keys() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  perform provision_identity_lab.acquire_reservation_keys(old.operation_id,old.planned_user_id);
 else perform provision_identity_lab.acquire_reservation_keys(new.operation_id,new.planned_user_id);end if;
 return new;
end $$;
revoke all on function provision_identity_lab.acquire_reservation_keys(uuid,uuid),provision_identity_lab.guard_reservation_keys()
 from public,anon,authenticated,service_role;
-- Alphabetically before intent_binding: an uncommitted parent is invisible.
create trigger aa_reservation_keys before insert or update on provision_identity_lab.operations
 for each row execute function provision_identity_lab.guard_reservation_keys();
create trigger aa_reservation_keys before insert or update on provision_intent_lab.intents
 for each row execute function provision_identity_lab.guard_reservation_keys();
alter table provision_identity_lab.operations enable always trigger aa_reservation_keys;
alter table provision_intent_lab.intents enable always trigger aa_reservation_keys;

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
 if exists(select 1 from auth.users where id=p_planned) then raise exception 'Existing identity is not a new clinic intent' using errcode='42501';end if;
 t:=provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,null);
 insert into provision_identity_lab.operations(operation_id,planned_user_id) values(p_operation,p_planned);
 insert into provision_intent_lab.intents(operation_id,planned_user_id,actor_id,session_id,clinic_id,factor_id,expires_at,membership_generation)
 values(p_operation,p_planned,p_actor,p_session,p_clinic,supporting,least(t+interval '5 minutes',to_timestamp(p_exp)),generation) returning * into i;
 return to_jsonb(i);
exception when lock_not_available then raise exception 'Clinic intent busy' using errcode='40001';
end $$;
create or replace function provision_intent_lab.check_intent(p_operation uuid,p_actor uuid,p_session uuid,p_clinic uuid,p_aal text,p_exp bigint,p_finish boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i provision_intent_lab.intents;supporting uuid;generation uuid;
begin
 supporting:=provision_intent_lab.assert_context(p_actor,p_session,p_clinic,p_aal,p_exp);
 generation:=provision_membership_lab.current_generation(p_clinic,p_actor);
 select * into i from provision_intent_lab.intents where operation_id=p_operation for update nowait;
 if not found or (i.actor_id,i.session_id,i.clinic_id) is distinct from (p_actor,p_session,p_clinic) then
  raise exception 'Clinic intent unavailable' using errcode='42501';end if;
 perform provision_identity_lab.acquire_reservation_keys(i.operation_id,i.planned_user_id);
 if i.factor_id is distinct from supporting or i.membership_generation is distinct from generation then
  raise exception 'Clinic intent authority replaced or expired' using errcode='42501';end if;
 if p_finish or i.phase='confirmed' then perform provision_intent_lab.fence_current_receipt(p_operation,i.planned_user_id);end if;
 perform provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,i.expires_at);
 if p_finish then
  update provision_intent_lab.intents set phase='confirmed' where operation_id=p_operation returning * into i;
 end if;
 return to_jsonb(i);
exception when lock_not_available then raise exception 'Clinic intent busy' using errcode='40001';
end $$;
commit;
