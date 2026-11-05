-- Disposable synthetic proof. NOT a production authorizer or migration.
create schema provision_intent_lab;
revoke all on schema provision_intent_lab from public,anon,authenticated,service_role;
create table provision_intent_lab.members(
 clinic_id uuid not null,user_id uuid not null,role text not null,status text not null,
 primary key(clinic_id,user_id)
);
create table provision_intent_lab.intents(
 operation_id uuid primary key references provision_identity_lab.operations(operation_id),
 planned_user_id uuid not null unique,actor_id uuid not null,clinic_id uuid not null,session_id uuid not null,factor_id uuid not null,
 expires_at timestamptz not null,phase text not null default 'prepared' check(phase in ('prepared','confirmed'))
);
revoke all on all tables in schema provision_intent_lab from public,anon,authenticated,service_role;

-- Shared by the native-only and real-clinic gates. A historical snapshot is
-- not evidence of a currently existing target. Fence the reserved identity.
create function provision_intent_lab.fence_current_receipt(p_operation uuid,p_target uuid,p_require_birth boolean default true) returns void
language plpgsql volatile security definer set search_path='' as $$
declare receipt_operation provision_identity_lab.operations;
begin
 -- Fence the phase even when Auth has not been born yet. An old RR snapshot
 -- must not mistake a subsequently born/deleted identity for an unused UUID.
 select * into receipt_operation from provision_identity_lab.operations
  where operation_id=p_operation and planned_user_id=p_target for share nowait;
 if not found then raise exception 'Identity reservation unavailable' using errcode='40001';end if;
 if not p_require_birth and receipt_operation.phase='prepared' and receipt_operation.birth_transaction is null then return;end if;
 perform 1 from auth.users u join provision_identity_lab.operations o on o.planned_user_id=u.id
  where u.id=p_target and o.operation_id=p_operation for share of u nowait;
 if not found or not provision_identity_lab.has_birth_receipt(p_operation) then
  raise exception 'Current identity receipt unavailable' using errcode='40001';
 end if;
exception when lock_not_available then raise exception 'Identity receipt busy' using errcode='40001';
end $$;

-- Read the clock after the final acquisition. Session time can elapse even
-- while its row is fenced against concurrent changes.
create function provision_intent_lab.assert_final_deadlines(p_actor uuid,p_session uuid,p_exp bigint,p_deadline timestamptz) returns timestamptz
language plpgsql volatile security definer set search_path='' as $$
declare session_deadline timestamptz;t timestamptz;
begin
 select not_after into session_deadline from auth.sessions where id=p_session and user_id=p_actor for share nowait;
 if not found then raise exception 'Human intent session unavailable' using errcode='42501';end if;
 t:=clock_timestamp();
 if p_exp is null or to_timestamp(p_exp)<=t or (session_deadline is not null and session_deadline<=t)
  or (p_deadline is not null and p_deadline<=t) then
  raise exception 'Human intent expired' using errcode='42501';
 end if;
 return t;
exception when lock_not_available then raise exception 'Human intent session busy' using errcode='40001';
end $$;

-- Context is trusted only after native bearer validation by the server.
-- Recheck current native rows: cached verification is not authority forever.
create function provision_intent_lab.assert_context(p_actor uuid,p_session uuid,p_clinic uuid,p_aal text,p_exp bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare u record;s record;f record;m provision_intent_lab.members;t timestamptz;
begin
 select raw_app_meta_data,deleted_at,banned_until into u from auth.users where id=p_actor for share nowait;
 if not found then raise exception 'Human intent account unavailable' using errcode='42501';end if;
 select factor_id,aal,not_after into s from auth.sessions where id=p_session and user_id=p_actor for share nowait;
 if not found then raise exception 'Human intent session unavailable' using errcode='42501';end if;
 select id,factor_type,status into f from auth.mfa_factors where id=s.factor_id and user_id=p_actor for share nowait;
 if not found then raise exception 'Human intent factor unavailable' using errcode='42501';end if;
 select * into m from provision_intent_lab.members where clinic_id=p_clinic and user_id=p_actor for share nowait;
 if not found then raise exception 'Human intent membership unavailable' using errcode='42501';end if;
 t:=clock_timestamp();
 if p_aal is distinct from 'aal2' or s.aal is distinct from 'aal2'
  or p_exp is null or to_timestamp(p_exp)<=t or (s.not_after is not null and s.not_after<=t)
  or coalesce(u.raw_app_meta_data->>'account_type','')='reception' or u.deleted_at is not null or (u.banned_until is not null and u.banned_until>t)
  or f.factor_type<>'totp' or f.status<>'verified' or m.role<>'admin' or m.status<>'active' then
  raise exception 'Human intent context unavailable' using errcode='42501';
 end if;
 return f.id;
exception when lock_not_available then
 raise exception 'Human intent context busy' using errcode='40001';
end $$;

create function provision_intent_lab.begin_intent(p_operation uuid,p_planned uuid,p_actor uuid,p_session uuid,p_clinic uuid,p_aal text,p_exp bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i provision_intent_lab.intents;supporting uuid;t timestamptz;
begin
 supporting:=provision_intent_lab.assert_context(p_actor,p_session,p_clinic,p_aal,p_exp);
 select * into i from provision_intent_lab.intents where operation_id=p_operation for update nowait;
 if found then
  if (i.planned_user_id,i.actor_id,i.session_id,i.clinic_id) is distinct from (p_planned,p_actor,p_session,p_clinic) then
   raise exception 'Human intent binding changed' using errcode='22023';end if;
  if i.factor_id is distinct from supporting then raise exception 'Human intent supporting factor changed' using errcode='42501';end if;
  perform provision_intent_lab.fence_current_receipt(p_operation,i.planned_user_id,i.phase='confirmed');
  perform provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,i.expires_at);
  return to_jsonb(i);
 end if;
 if exists(select 1 from auth.users where id=p_planned) then raise exception 'Existing identity is not a new intent' using errcode='42501';end if;
 t:=provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,null);
 insert into provision_identity_lab.operations(operation_id,planned_user_id) values(p_operation,p_planned);
 insert into provision_intent_lab.intents(operation_id,planned_user_id,actor_id,session_id,clinic_id,factor_id,expires_at)
 values(p_operation,p_planned,p_actor,p_session,p_clinic,supporting,least(t+interval '5 minutes',to_timestamp(p_exp))) returning * into i;
 return to_jsonb(i);
end $$;

create function provision_intent_lab.check_intent(p_operation uuid,p_actor uuid,p_session uuid,p_clinic uuid,p_aal text,p_exp bigint,p_finish boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i provision_intent_lab.intents;supporting uuid;
begin
 supporting:=provision_intent_lab.assert_context(p_actor,p_session,p_clinic,p_aal,p_exp);
 select * into i from provision_intent_lab.intents where operation_id=p_operation for update nowait;
 if not found or (i.actor_id,i.session_id,i.clinic_id) is distinct from (p_actor,p_session,p_clinic) then
  raise exception 'Human intent unavailable' using errcode='42501';end if;
 if i.factor_id is distinct from supporting then raise exception 'Human intent supporting factor changed' using errcode='42501';end if;
 perform provision_intent_lab.fence_current_receipt(p_operation,i.planned_user_id,p_finish or i.phase='confirmed');
 perform provision_intent_lab.assert_final_deadlines(p_actor,p_session,p_exp,i.expires_at);
 if p_finish then
  update provision_intent_lab.intents set phase='confirmed' where operation_id=p_operation returning * into i;
 end if;
 return to_jsonb(i);
end $$;
revoke all on all functions in schema provision_intent_lab from public,anon,authenticated,service_role;
