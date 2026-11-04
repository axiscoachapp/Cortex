-- T28: private service-origin requests only. No Auth/front-door/grant cutover.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
lock table cortex_private.reception_delegation_requests,cortex_private.reception_delegation_operations in access exclusive mode nowait;

alter table cortex_private.reception_delegation_requests
 add column request_source text not null default 'human_request'
 constraint delegation_request_source check(request_source in ('human_request','staff_provisioning'));

create function cortex_private.guard_delegation_request_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.request_source is distinct from old.request_source then
  raise exception 'Delegation request source immutable' using errcode='22023';end if;
 return new;
end $$;
create trigger aa_delegation_request_source before update on cortex_private.reception_delegation_requests
 for each row execute function cortex_private.guard_delegation_request_source();

create function cortex_private.reception_provisioning_admin(p_clinic uuid,p_admin uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or p_admin is null then
  raise exception 'Delegation provisioning unavailable' using errcode='42501';end if;
 -- Auth metadata UPDATE does not touch the custody epoch: fence that row too.
 perform 1 from auth.users where id=p_admin for share nowait;
 if not found then raise exception 'Delegation administration unavailable' using errcode='42501';end if;
 perform cortex_private.touch_custody_epoch(array[p_admin]);
 if public.is_reception_account(p_admin) or exists(select 1 from public.account_deletion_requests where user_id=p_admin) then
  raise exception 'Delegation administration unavailable' using errcode='42501';end if;
 perform 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_admin and role='admin' and status='active' for share nowait;
 if not found then raise exception 'Delegation administration unavailable' using errcode='42501';end if;
 return p_admin;
exception when lock_not_available then
 raise exception 'Delegation provisioning authority changed concurrently; retry the transaction' using errcode='40001';
end $$;

create function cortex_private.provisioning_request_current(r cortex_private.reception_delegation_requests) returns boolean
language sql volatile security definer set search_path='' as $$
 select coalesce(r.request_source='staff_provisioning' and (
  (r.state='pending' and not exists(select 1 from public.staff_doctor_scopes where clinic_id=r.clinic_id and staff_user_id=r.staff_user_id and doctor_user_id=r.doctor_user_id))
  or (r.state='approved' and exists(select 1 from public.staff_doctor_scopes where delegation_request_id=r.id and clinic_id=r.clinic_id and staff_user_id=r.staff_user_id and doctor_user_id=r.doctor_user_id))),false);
$$;

create or replace function cortex_private.validate_reception_delegation_request() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 -- AFTER custody_reference: account epochs precede fresh authority reads.
 if tg_op='INSERT' then
  if new.request_source='staff_provisioning' then
   actor:=cortex_private.reception_provisioning_admin(new.clinic_id,new.requested_by);
   if exists(select 1 from public.staff_doctor_scopes where clinic_id=new.clinic_id and staff_user_id=new.staff_user_id and doctor_user_id=new.doctor_user_id) then
    raise exception 'Delegation requires reconciliation' using errcode='40001';end if;
  else actor:=cortex_private.reception_delegation_actor(new.clinic_id);end if;
  if new.requested_by<>actor or not cortex_private.reception_delegation_eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id) then
   raise exception 'Delegation member unavailable' using errcode='42501';end if;
 elsif new.end_reason='member_inactive' and new.ended_by is null
  and not cortex_private.reception_delegation_eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id) then null;
 elsif new.state='revoked' and new.end_reason='scope_removed' and new.ended_by is null and not exists(
  select 1 from public.staff_doctor_scopes where delegation_request_id=new.id) then null;
 elsif new.state in ('approved','denied') then
  actor:=cortex_private.reception_delegation_physician(new.clinic_id,new.doctor_user_id);
  if new.decided_by is distinct from actor or not cortex_private.reception_delegation_eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id) then
   raise exception 'Delegation member unavailable' using errcode='42501';end if;
 elsif new.state='cancelled' then
  actor:=cortex_private.reception_delegation_actor(new.clinic_id);
  if new.end_reason is distinct from 'withdrawn' or new.ended_by is distinct from actor then raise exception 'Delegation administration unavailable' using errcode='42501';end if;
 else
  actor:=cortex_private.reception_delegation_withdrawer(new.clinic_id,new.doctor_user_id);
  if new.end_reason is distinct from 'withdrawn' or new.ended_by is distinct from actor then raise exception 'Delegation administration unavailable' using errcode='42501';end if;
 end if;
 -- Keep the effective grant in this very statement, including privileged
 -- updates. Explicit physician approval can adopt an existing legacy grant.
 if new.state='approved' then
  insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id,delegation_request_id)
   values(new.clinic_id,new.staff_user_id,new.doctor_user_id,new.id)
   on conflict(clinic_id,staff_user_id,doctor_user_id) do update set delegation_request_id=excluded.delegation_request_id;
 elsif new.state='denied' then
  delete from public.staff_doctor_scopes where clinic_id=new.clinic_id and staff_user_id=new.staff_user_id and doctor_user_id=new.doctor_user_id;
 elsif new.state='revoked' then
  delete from public.staff_doctor_scopes where delegation_request_id=new.id;
 end if;
 return null;
end $$;

create or replace function cortex_private.guard_reception_delegation_operation() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare r cortex_private.reception_delegation_requests;actor uuid;k text:=new.payload->>'kind';valid boolean:=false;
begin
 if tg_op<>'INSERT' then raise exception 'Delegation history immutable' using errcode='22023';end if;
 select * into r from cortex_private.reception_delegation_requests where id=new.request_id;
 if not found then raise exception 'Delegation unavailable' using errcode='42501';end if;
 if k='provision_request' then
  -- Resolve immutable IDs, fence all references, then reread state in RC.
  perform cortex_private.touch_custody_epoch(array[r.requested_by,r.staff_user_id,r.doctor_user_id]);
  select * into r from cortex_private.reception_delegation_requests where id=new.request_id;
  actor:=cortex_private.reception_provisioning_admin(r.clinic_id,new.actor_user_id);
 elsif k in ('approve','deny') then actor:=cortex_private.reception_delegation_physician(r.clinic_id,r.doctor_user_id);
 elsif k='revoke' then actor:=cortex_private.reception_delegation_withdrawer(r.clinic_id,r.doctor_user_id);
 else actor:=cortex_private.reception_delegation_actor(r.clinic_id);end if;
 if k='provision_request' then valid:=r.requested_by=actor and cortex_private.provisioning_request_current(r)
  and cortex_private.reception_delegation_eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id)
  and new.payload=jsonb_build_object('kind',k,'clinic',r.clinic_id,'staff',r.staff_user_id,'doctor',r.doctor_user_id);
 elsif k='request' then valid:=r.state in ('pending','approved') and new.payload=jsonb_build_object('kind',k,'clinic',r.clinic_id,'staff',r.staff_user_id,'doctor',r.doctor_user_id);
 elsif k='cancel' then valid:=r.state='cancelled' and r.ended_by=actor and new.payload=jsonb_build_object('kind',k,'request',r.id,'expected',r.revision-1);
 elsif k in ('approve','deny') then valid:=r.state=case k when 'approve' then 'approved' else 'denied' end and r.decided_by=actor and new.payload=jsonb_build_object('kind',k,'request',r.id,'expected',r.revision-1);
 elsif k='revoke' then valid:=r.state='revoked' and r.ended_by=actor and r.end_reason='withdrawn' and new.payload=jsonb_build_object('kind',k,'request',r.id,'expected',r.revision-1);
 end if;
 if actor<>new.actor_user_id or new.result_revision<>r.revision or valid is not true then raise exception 'Delegation operation mismatch' using errcode='22023';end if;
 return null;
end $$;

create function cortex_private.request_provisioned_reception_delegation(p_clinic uuid,p_staff uuid,p_doctor uuid,p_admin uuid,p_operation uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;r cortex_private.reception_delegation_requests;previous cortex_private.reception_delegation_operations;
 body jsonb:=jsonb_build_object('kind','provision_request','clinic',p_clinic,'staff',p_staff,'doctor',p_doctor);
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Delegation provisioning unavailable' using errcode='42501';end if;
 if p_clinic is null or p_staff is null or p_doctor is null or p_admin is null or p_operation is null then
  raise exception 'Invalid delegation input' using errcode='22023';end if;
 actor:=cortex_private.reception_provisioning_admin(p_clinic,p_admin);
 if not cortex_private.reception_delegation_eligible(p_clinic,p_staff,p_doctor) then raise exception 'Delegation member unavailable' using errcode='42501';end if;
 perform cortex_private.touch_custody_epoch(array[actor,p_staff,p_doctor]);
 perform cortex_private.reception_provisioning_admin(p_clinic,actor);
 if not cortex_private.reception_delegation_eligible(p_clinic,p_staff,p_doctor) then raise exception 'Delegation member unavailable' using errcode='42501';end if;
 select * into previous from cortex_private.reception_delegation_operations where actor_user_id=actor and operation_id=p_operation;
 if found then
  if previous.payload<>body then raise exception 'Delegation operation mismatch' using errcode='22023';end if;
  select * into r from cortex_private.reception_delegation_requests where id=previous.request_id;
  if not found or r.requested_by<>actor or cortex_private.provisioning_request_current(r) is not true then
   raise exception 'Delegation changed' using errcode='40001';end if;
  return cortex_private.reception_delegation_snapshot(r);
 end if;
 select * into r from cortex_private.reception_delegation_requests where clinic_id=p_clinic and staff_user_id=p_staff and doctor_user_id=p_doctor and state in ('pending','approved');
 if not found then
  if exists(select 1 from public.staff_doctor_scopes where clinic_id=p_clinic and staff_user_id=p_staff and doctor_user_id=p_doctor) then
   raise exception 'Delegation requires reconciliation' using errcode='40001';end if;
  insert into cortex_private.reception_delegation_requests(clinic_id,staff_user_id,doctor_user_id,requested_by,request_source)
   values(p_clinic,p_staff,p_doctor,actor,'staff_provisioning') returning * into r;
 elsif r.requested_by<>actor or cortex_private.provisioning_request_current(r) is not true then
  raise exception 'Delegation changed' using errcode='40001';
 end if;
 insert into cortex_private.reception_delegation_operations values(actor,p_operation,r.id,body,r.revision);
 return cortex_private.reception_delegation_snapshot(r);
end $$;
revoke all on function cortex_private.guard_delegation_request_source(),cortex_private.reception_provisioning_admin(uuid,uuid),
 cortex_private.provisioning_request_current(cortex_private.reception_delegation_requests),
 cortex_private.request_provisioned_reception_delegation(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;
