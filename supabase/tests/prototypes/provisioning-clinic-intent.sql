-- Composition proof only. No production migration, API, team membership or grant.
begin;
alter table provision_intent_lab.intents add column membership_generation uuid not null;
-- Reuse fence_current_receipt from the native intent prototype for every
-- current confirmation/replay; keep the final clock after that acquisition.
create or replace function provision_intent_lab.begin_intent(p_operation uuid,p_planned uuid,p_actor uuid,p_session uuid,p_clinic uuid,p_aal text,p_exp bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i provision_intent_lab.intents;supporting uuid;generation uuid;t timestamptz;
begin
 supporting:=provision_intent_lab.assert_context(p_actor,p_session,p_clinic,p_aal,p_exp);
 generation:=provision_membership_lab.current_generation(p_clinic,p_actor);
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
