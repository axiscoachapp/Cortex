-- T28: private request foundation. No approval, operational grant or client API.
-- The legacy scope setter is unchanged until the separately verified cutover.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
lock table public.clinics,public.clinic_members,public.clinic_staff_members,
 auth.users,public.account_deletion_requests in share row exclusive mode nowait;

create table cortex_private.reception_delegation_requests(
 id uuid primary key default gen_random_uuid(),
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 staff_user_id uuid not null,doctor_user_id uuid not null,
 requested_by uuid not null references auth.users(id) on delete restrict,
 capability_version text not null default 'clinic_reception_v1' check(capability_version='clinic_reception_v1'),
 state text not null default 'pending' check(state in ('pending','cancelled')),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 ended_at timestamptz,ended_by uuid references auth.users(id) on delete restrict,
 end_reason text check(end_reason in ('withdrawn','member_inactive')),
 foreign key(clinic_id,staff_user_id) references public.clinic_staff_members(clinic_id,user_id) on delete restrict,
 foreign key(clinic_id,doctor_user_id) references public.clinic_members(clinic_id,user_id) on delete restrict,
 check((state='pending' and revision=1 and ended_at is null and ended_by is null and end_reason is null)
  or (state='cancelled' and revision=2 and ended_at>=created_at and ended_at is not null and end_reason is not null))
);
create unique index reception_pending_delegation_pair on cortex_private.reception_delegation_requests(clinic_id,staff_user_id,doctor_user_id)
 where state='pending';
create index reception_delegation_doctor on cortex_private.reception_delegation_requests(doctor_user_id);
create index reception_delegation_staff on cortex_private.reception_delegation_requests(staff_user_id);
create table cortex_private.reception_delegation_operations(
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 operation_id uuid not null,request_id uuid not null references cortex_private.reception_delegation_requests(id) on delete restrict,
 payload jsonb not null check(jsonb_typeof(payload)='object'),result_revision integer not null check(result_revision>0),
 primary key(actor_user_id,operation_id)
);
alter table cortex_private.reception_delegation_requests enable row level security;
alter table cortex_private.reception_delegation_operations enable row level security;
revoke all on cortex_private.reception_delegation_requests,cortex_private.reception_delegation_operations from public,anon,authenticated,service_role;

create function cortex_private.reception_delegation_actor(p_clinic uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
begin
 perform public.assert_session_assurance();
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or public.is_reception_account(auth.uid())
  or not public.clinical_account_writable() then raise exception 'Delegation actor unavailable' using errcode='42501';end if;
 if p_clinic is not null then
  -- Role changes while status stays active do not use the inactivity epoch.
  -- Lock the actual authority row, NOWAIT even from an AFTER-row validator.
  perform 1 from public.clinic_members where clinic_id=p_clinic and user_id=auth.uid() and role='admin' and status='active' for share nowait;
  if not found then raise exception 'Delegation administration unavailable' using errcode='42501';end if;
 end if;
 return auth.uid();
exception when lock_not_available then
 raise exception 'Delegation authority changed concurrently; retry the transaction' using errcode='40001';
end $$;
create function cortex_private.reception_delegation_eligible(p_clinic uuid,p_staff uuid,p_doctor uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.clinic_staff_members where clinic_id=p_clinic and user_id=p_staff and active)
 and exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_doctor and status='active')
 and not exists(select 1 from public.account_deletion_requests where user_id in (p_staff,p_doctor));
$$;
create function cortex_private.reception_delegation_snapshot(r cortex_private.reception_delegation_requests) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',r.id,'state',r.state,'revision',r.revision,'capabilityVersion',r.capability_version);
$$;
create function cortex_private.guard_reception_delegation_request() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Delegation history immutable' using errcode='22023';end if;
 if tg_op='UPDATE' then
  if (new.id,new.clinic_id,new.staff_user_id,new.doctor_user_id,new.requested_by,new.capability_version,new.created_at)
    is distinct from (old.id,old.clinic_id,old.staff_user_id,old.doctor_user_id,old.requested_by,old.capability_version,old.created_at)
   or old.state<>'pending' or new.state<>'cancelled' or new.revision<>old.revision+1 then
   raise exception 'Delegation identity or transition invalid' using errcode='22023';end if;
 elsif new.state<>'pending' or new.revision<>1 or new.created_at is distinct from transaction_timestamp()
  or new.capability_version<>'clinic_reception_v1' then
  raise exception 'Delegation identity or transition invalid' using errcode='22023';
 end if;
 return new;
end $$;
create trigger delegation_identity before insert or update or delete on cortex_private.reception_delegation_requests
 for each row execute function cortex_private.guard_reception_delegation_request();
create trigger custody_reference after insert or update on cortex_private.reception_delegation_requests
 for each row execute function cortex_private.guard_custody_reference('staff_user_id','doctor_user_id','requested_by','ended_by');
create function cortex_private.validate_reception_delegation_request() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 -- After custody_reference: fresh eligibility in RC; old RR epochs abort.
 if tg_op='UPDATE' and new.end_reason='member_inactive' and new.ended_by is null
  and not cortex_private.reception_delegation_eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id) then return null;end if;
 actor:=cortex_private.reception_delegation_actor(new.clinic_id);
 if tg_op='INSERT' then
  if new.requested_by<>actor or not cortex_private.reception_delegation_eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id) then
   raise exception 'Delegation member unavailable' using errcode='42501';end if;
 elsif new.end_reason is distinct from 'withdrawn' or new.ended_by is distinct from actor then
  raise exception 'Delegation administration unavailable' using errcode='42501';
 end if;
 return null;
end $$;
create trigger zz_delegation_authority after insert or update on cortex_private.reception_delegation_requests
 for each row execute function cortex_private.validate_reception_delegation_request();

create function cortex_private.guard_reception_delegation_operation() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare r cortex_private.reception_delegation_requests;actor uuid;
begin
 if tg_op<>'INSERT' then raise exception 'Delegation history immutable' using errcode='22023';end if;
 select * into r from cortex_private.reception_delegation_requests where id=new.request_id;
 if not found then raise exception 'Delegation unavailable' using errcode='42501';end if;
 actor:=cortex_private.reception_delegation_actor(r.clinic_id);
 if actor<>new.actor_user_id or new.result_revision<>r.revision
  or (new.payload->>'kind'='request' and (r.state<>'pending' or new.payload<>jsonb_build_object('kind','request','clinic',r.clinic_id,'staff',r.staff_user_id,'doctor',r.doctor_user_id)))
  or (new.payload->>'kind'='cancel' and (r.state<>'cancelled' or r.ended_by is distinct from actor or new.payload<>jsonb_build_object('kind','cancel','request',r.id,'expected',r.revision-1)))
  or coalesce(new.payload->>'kind','') not in ('request','cancel') then
  raise exception 'Delegation operation mismatch' using errcode='22023';end if;
 return null;
end $$;
create trigger custody_reference after insert or update on cortex_private.reception_delegation_operations
 for each row execute function cortex_private.guard_custody_reference('actor_user_id');
create trigger zz_delegation_operation after insert or update or delete on cortex_private.reception_delegation_operations
 for each row execute function cortex_private.guard_reception_delegation_operation();

create function cortex_private.request_reception_delegation(p_clinic uuid,p_staff uuid,p_doctor uuid,p_operation uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=cortex_private.reception_delegation_actor(p_clinic);r cortex_private.reception_delegation_requests;
 previous cortex_private.reception_delegation_operations;
 body jsonb:=jsonb_build_object('kind','request','clinic',p_clinic,'staff',p_staff,'doctor',p_doctor);
begin
 if p_clinic is null or p_staff is null or p_doctor is null or p_operation is null then raise exception 'Invalid delegation input' using errcode='22023';end if;
 perform cortex_private.touch_custody_epoch(array[actor,p_staff,p_doctor]);
 perform cortex_private.reception_delegation_actor(p_clinic);
 if not cortex_private.reception_delegation_eligible(p_clinic,p_staff,p_doctor) then raise exception 'Delegation member unavailable' using errcode='42501';end if;
 select * into previous from cortex_private.reception_delegation_operations where actor_user_id=actor and operation_id=p_operation;
 if found then
  if previous.payload<>body then raise exception 'Delegation operation mismatch' using errcode='22023';end if;
  select * into r from cortex_private.reception_delegation_requests where id=previous.request_id;
  if r.state<>'pending' then raise exception 'Delegation changed' using errcode='40001';end if;
  return cortex_private.reception_delegation_snapshot(r);
 end if;
 select * into r from cortex_private.reception_delegation_requests where clinic_id=p_clinic and staff_user_id=p_staff and doctor_user_id=p_doctor and state='pending';
 if not found then
  insert into cortex_private.reception_delegation_requests(clinic_id,staff_user_id,doctor_user_id,requested_by)
   values(p_clinic,p_staff,p_doctor,actor) returning * into r;
 end if;
 insert into cortex_private.reception_delegation_operations values(actor,p_operation,r.id,body,r.revision);
 return cortex_private.reception_delegation_snapshot(r);
end $$;
create function cortex_private.cancel_reception_delegation(p_request uuid,p_revision integer,p_operation uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=cortex_private.reception_delegation_actor(null);r cortex_private.reception_delegation_requests;
 previous cortex_private.reception_delegation_operations;body jsonb:=jsonb_build_object('kind','cancel','request',p_request,'expected',p_revision);
begin
 if p_request is null or p_revision is null or p_revision<1 or p_operation is null then raise exception 'Invalid delegation input' using errcode='22023';end if;
 select * into r from cortex_private.reception_delegation_requests where id=p_request;
 if not found then raise exception 'Delegation unavailable' using errcode='42501';end if;
 perform cortex_private.reception_delegation_actor(r.clinic_id);
 select * into r from cortex_private.reception_delegation_requests where id=p_request for update;
 perform cortex_private.touch_custody_epoch(array[actor,r.staff_user_id,r.doctor_user_id,r.requested_by]);
 perform cortex_private.reception_delegation_actor(r.clinic_id);
 select * into previous from cortex_private.reception_delegation_operations where actor_user_id=actor and operation_id=p_operation;
 if found then
  if previous.payload<>body then raise exception 'Delegation operation mismatch' using errcode='22023';end if;
  if previous.request_id<>r.id or previous.result_revision<>r.revision or r.state<>'cancelled' then raise exception 'Delegation changed' using errcode='40001';end if;
  return cortex_private.reception_delegation_snapshot(r);
 end if;
 if r.state<>'pending' or r.revision<>p_revision then raise exception 'Delegation changed' using errcode='40001';end if;
 update cortex_private.reception_delegation_requests set state='cancelled',revision=revision+1,ended_at=clock_timestamp(),ended_by=actor,end_reason='withdrawn'
  where id=p_request returning * into r;
 insert into cortex_private.reception_delegation_operations values(actor,p_operation,r.id,body,r.revision);
 return cortex_private.reception_delegation_snapshot(r);
end $$;
create function cortex_private.close_reception_delegation_requests() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 perform cortex_private.touch_custody_epoch(array[new.user_id]);
 update cortex_private.reception_delegation_requests r set state='cancelled',revision=revision+1,ended_at=clock_timestamp(),ended_by=null,end_reason='member_inactive'
 where r.clinic_id=new.clinic_id and r.state='pending'
 and (case tg_table_name when 'clinic_staff_members' then r.staff_user_id=new.user_id else r.doctor_user_id=new.user_id end);
 return null;
end $$;
create trigger delegation_staff_inactive after update of active on public.clinic_staff_members
 for each row when(not new.active) execute function cortex_private.close_reception_delegation_requests();
create trigger delegation_doctor_inactive after update of status on public.clinic_members
 for each row when(new.status<>'active') execute function cortex_private.close_reception_delegation_requests();

-- Preserve the public preflight's OID, all previous checks and grants. New
-- history references are account custody, not a reason to block private-chart
-- deletion. Existing account epochs serialize this with every new reference.
do $preflight$ declare definition text;needle text:='perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));';begin
 definition:=pg_get_functiondef('public.assert_deletion_scope(uuid,uuid)'::regprocedure);
 if array_length(string_to_array(definition,needle),1) is distinct from 2 then raise exception 'Missing or ambiguous delegation custody preflight point';end if;
 execute replace(definition,needle,needle||$checks$
 if p_patient_id is null and (
  exists(select 1 from cortex_private.reception_delegation_requests where p_user_id in (staff_user_id,doctor_user_id,requested_by,ended_by))
  or exists(select 1 from cortex_private.reception_delegation_operations where actor_user_id=p_user_id)) then
  raise exception 'Administrative custody must be resolved before deletion' using errcode='P4092';
 end if;
 $checks$);
end $preflight$;
revoke all on function cortex_private.reception_delegation_actor(uuid),cortex_private.reception_delegation_eligible(uuid,uuid,uuid),
 cortex_private.reception_delegation_snapshot(cortex_private.reception_delegation_requests),cortex_private.guard_reception_delegation_request(),
 cortex_private.validate_reception_delegation_request(),cortex_private.guard_reception_delegation_operation(),
 cortex_private.request_reception_delegation(uuid,uuid,uuid,uuid),cortex_private.cancel_reception_delegation(uuid,integer,uuid),
 cortex_private.close_reception_delegation_requests() from public,anon,authenticated,service_role;
commit;
