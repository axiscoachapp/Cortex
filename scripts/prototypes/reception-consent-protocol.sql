-- DISPOSABLE LAB ONLY. Not a migration or a production authorization gate.
-- No public RPC, operational scope or clinical row is changed by this model.
do $$ begin
 if current_setting('cortex.disposable_consent_lab',true) is distinct from 'on' then
  raise exception 'Disposable consent lab only';
 end if;
end $$;
create schema cortex_consent_lab;
revoke all on schema cortex_consent_lab from public,anon,authenticated,service_role;
create table cortex_consent_lab.requests(
 id uuid primary key default gen_random_uuid(),clinic_id uuid not null,
 staff_user_id uuid not null,doctor_user_id uuid not null,
 requested_by uuid not null references auth.users(id) on delete restrict,
 state text not null default 'pending' check(state in ('pending','approved','denied','cancelled','revoked')),
 revision integer not null default 1 check(revision>0),
 foreign key(clinic_id,staff_user_id) references public.clinic_staff_members(clinic_id,user_id) on delete restrict,
 foreign key(clinic_id,doctor_user_id) references public.clinic_members(clinic_id,user_id) on delete restrict
);
create unique index consent_current_pair on cortex_consent_lab.requests(clinic_id,staff_user_id,doctor_user_id)
 where state in ('pending','approved');
create table cortex_consent_lab.grants(
 request_id uuid primary key references cortex_consent_lab.requests(id) on delete restrict
);
create table cortex_consent_lab.operations(
 actor_id uuid not null references auth.users(id) on delete restrict,operation_id uuid not null,
 payload jsonb not null,request_id uuid not null references cortex_consent_lab.requests(id) on delete restrict,
 result_state text not null,primary key(actor_id,operation_id)
);
alter table cortex_consent_lab.requests enable row level security;
alter table cortex_consent_lab.grants enable row level security;
alter table cortex_consent_lab.operations enable row level security;
revoke all on all tables in schema cortex_consent_lab from public,anon,authenticated,service_role;

create function cortex_consent_lab.actor() returns uuid
language plpgsql volatile security definer set search_path='' as $$
begin
 perform public.assert_session_assurance();
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or public.is_reception_account(auth.uid()) or not public.clinical_account_writable() then
  raise exception 'Consent actor unavailable' using errcode='42501';
 end if;
 return auth.uid();
end $$;
create function cortex_consent_lab.eligible(c uuid,s uuid,d uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.clinic_staff_members where clinic_id=c and user_id=s and active)
 and exists(select 1 from public.clinic_members where clinic_id=c and user_id=d and status='active')
 and not exists(select 1 from public.account_deletion_requests where user_id in (s,d));
$$;
create function cortex_consent_lab.snapshot(r cortex_consent_lab.requests) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',r.id,'state',r.state,'revision',r.revision);
$$;
create function cortex_consent_lab.guard_request() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Consent history cannot be deleted' using errcode='22023';end if;
 if tg_op='UPDATE' then
  if (new.id,new.clinic_id,new.staff_user_id,new.doctor_user_id,new.requested_by)
    is distinct from (old.id,old.clinic_id,old.staff_user_id,old.doctor_user_id,old.requested_by)
   or new.revision<>old.revision+1 or old.state not in ('pending','approved')
   or (old.state='pending' and new.state not in ('approved','denied','cancelled'))
   or (old.state='approved' and new.state<>'revoked') then
   raise exception 'Consent identity or transition invalid' using errcode='22023';
  end if;
 else
  if new.state<>'pending' or new.revision<>1 then
   raise exception 'Consent must begin pending' using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger consent_identity before insert or update or delete on cortex_consent_lab.requests
 for each row execute function cortex_consent_lab.guard_request();
create trigger custody_reference after insert or update on cortex_consent_lab.requests
 for each row execute function cortex_private.guard_custody_reference('requested_by','staff_user_id','doctor_user_id');

create function cortex_consent_lab.check_authority() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare a uuid;
begin
 -- Lifecycle can close a request after the member becomes ineligible, without
 -- pretending that the service-role writer is the physician decision-maker.
 if new.state in ('cancelled','revoked') and not cortex_consent_lab.eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id) then return null;end if;
 a:=cortex_consent_lab.actor();
 if not cortex_consent_lab.eligible(new.clinic_id,new.staff_user_id,new.doctor_user_id)
  or not exists(select 1 from public.clinic_members where clinic_id=new.clinic_id and user_id=a and status='active')
  or (new.state in ('approved','denied') and a<>new.doctor_user_id)
  or (new.state in ('pending','cancelled') and not exists(select 1 from public.clinic_members where clinic_id=new.clinic_id and user_id=a and status='active' and role='admin'))
  or (tg_op='INSERT' and new.requested_by<>a)
  or (new.state='revoked' and a<>new.doctor_user_id and not exists(select 1 from public.clinic_members where clinic_id=new.clinic_id and user_id=a and status='active' and role='admin')) then
  raise exception 'Consent unavailable' using errcode='42501';
 end if;
 return null;
end $$;
create trigger zz_consent_authority after insert or update on cortex_consent_lab.requests
 for each row execute function cortex_consent_lab.check_authority();

create function cortex_consent_lab.guard_grant() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare r cortex_consent_lab.requests;
begin
 if tg_op='DELETE' then
  update cortex_consent_lab.requests q set state='revoked',revision=q.revision+1 where q.id=old.request_id and q.state='approved';
  return old;
 end if;
 if tg_op='UPDATE' then raise exception 'Consent grant identity immutable' using errcode='22023';end if;
 select * into r from cortex_consent_lab.requests where id=new.request_id for update;
 if not found then raise exception 'Consent unavailable' using errcode='42501';end if;
 perform cortex_private.touch_custody_epoch(array[r.staff_user_id,r.doctor_user_id,r.requested_by]);
 if cortex_consent_lab.actor()<>r.doctor_user_id or r.state<>'approved'
  or not cortex_consent_lab.eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id) then
  raise exception 'Consent unavailable' using errcode='42501';end if;
 return new;
end $$;
create trigger consent_grant_identity before insert or update or delete on cortex_consent_lab.grants
 for each row execute function cortex_consent_lab.guard_grant();

create function cortex_consent_lab.request(c uuid,s uuid,d uuid,op uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a uuid:=cortex_consent_lab.actor();r cortex_consent_lab.requests;previous cortex_consent_lab.operations;
 body jsonb:=jsonb_build_object('kind','request','clinic',c,'staff',s,'doctor',d);
begin
 if c is null or s is null or d is null or op is null then raise exception 'Invalid consent input' using errcode='22023';end if;
 perform cortex_private.touch_custody_epoch(array[a,s,d]);
 if not exists(select 1 from public.clinic_members where clinic_id=c and user_id=a and role='admin' and status='active')
  or not cortex_consent_lab.eligible(c,s,d) then raise exception 'Consent unavailable' using errcode='42501';end if;
 select * into previous from cortex_consent_lab.operations where actor_id=a and operation_id=op;
 if found then
  if previous.payload<>body then raise exception 'Consent operation mismatch' using errcode='22023';end if;
  select * into r from cortex_consent_lab.requests where id=previous.request_id;
  if r.state not in ('pending','approved') then raise exception 'Consent changed' using errcode='40001';end if;
  return cortex_consent_lab.snapshot(r);
 end if;
 select * into r from cortex_consent_lab.requests where clinic_id=c and staff_user_id=s and doctor_user_id=d and state in ('pending','approved');
 if not found then
  insert into cortex_consent_lab.requests(clinic_id,staff_user_id,doctor_user_id,requested_by)
   values(c,s,d,a) returning * into r;
 end if;
 insert into cortex_consent_lab.operations values(a,op,body,r.id,r.state);
 return cortex_consent_lab.snapshot(r);
end $$;

create function cortex_consent_lab.mutate(id uuid,expected integer,action text,op uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a uuid:=cortex_consent_lab.actor();r cortex_consent_lab.requests;previous cortex_consent_lab.operations;
 body jsonb:=jsonb_build_object('kind',action,'request',id,'expected',expected);target text;
begin
 if id is null or expected is null or expected<1 or action is null or action not in ('approve','deny','withdraw') or op is null then
  raise exception 'Invalid consent input' using errcode='22023';end if;
 select * into r from cortex_consent_lab.requests q where q.id=mutate.id for update;
 if not found then raise exception 'Consent unavailable' using errcode='42501';end if;
 -- Row first, then NOWAIT accounts: never wait for an epoch held by a lifecycle
 -- writer that is waiting for this request row. RR conflicts abort in full.
 perform cortex_private.touch_custody_epoch(array[a,r.staff_user_id,r.doctor_user_id,r.requested_by]);
 if not cortex_consent_lab.eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id)
  or not exists(select 1 from public.clinic_members m where m.clinic_id=r.clinic_id and m.user_id=a and m.status='active')
  or (action in ('approve','deny') and a<>r.doctor_user_id)
  or (action='withdraw' and not exists(select 1 from public.clinic_members m where m.clinic_id=r.clinic_id and m.user_id=a and m.role='admin' and m.status='active')
      and not(a=r.doctor_user_id and r.state in ('approved','revoked'))) then
  raise exception 'Consent unavailable' using errcode='42501';
 end if;
 target:=case action when 'approve' then 'approved' when 'deny' then 'denied' else case r.state when 'pending' then 'cancelled' else 'revoked' end end;
 select * into previous from cortex_consent_lab.operations where actor_id=a and operation_id=op;
 if found then
  if previous.payload<>body then raise exception 'Consent operation mismatch' using errcode='22023';end if;
  if previous.request_id<>r.id or previous.result_state<>r.state then raise exception 'Consent changed' using errcode='40001';end if;
  return cortex_consent_lab.snapshot(r);
 end if;
 if r.revision<>expected or (action in ('approve','deny') and r.state<>'pending') or (action='withdraw' and r.state not in ('pending','approved')) then
  raise exception 'Consent changed' using errcode='40001';end if;
 update cortex_consent_lab.requests q set state=target,revision=q.revision+1 where q.id=r.id returning q.* into r;
 if target='approved' then insert into cortex_consent_lab.grants values(r.id);
 else delete from cortex_consent_lab.grants where request_id=r.id;end if;
 insert into cortex_consent_lab.operations values(a,op,body,r.id,r.state);
 return cortex_consent_lab.snapshot(r);
end $$;

create function cortex_consent_lab.end_membership_requests() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare c uuid;u uuid;
begin
 if tg_op='DELETE' then c:=old.clinic_id;u:=old.user_id;else c:=new.clinic_id;u:=new.user_id;end if;
 perform cortex_private.touch_custody_epoch(array[u]);
 update cortex_consent_lab.requests r set state=case state when 'pending' then 'cancelled' else 'revoked' end,revision=r.revision+1
 where r.clinic_id=c and (case tg_table_name when 'clinic_staff_members' then r.staff_user_id=u else r.doctor_user_id=u end)
 and state in ('pending','approved');
 delete from cortex_consent_lab.grants g using cortex_consent_lab.requests r where r.id=g.request_id and r.state<>'approved';
 -- BEFORE DELETE must return OLD or PostgreSQL suppresses the parent delete,
 -- including unrelated members with no request/history at all.
 if tg_op='DELETE' then return old;end if;
 return null;
end $$;
create trigger consent_staff_inactive after update of active on public.clinic_staff_members
 for each row when(not new.active) execute function cortex_consent_lab.end_membership_requests();
create trigger consent_doctor_inactive after update of status on public.clinic_members
 for each row when(new.status<>'active') execute function cortex_consent_lab.end_membership_requests();
create trigger consent_staff_delete before delete on public.clinic_staff_members
 for each row execute function cortex_consent_lab.end_membership_requests();
create trigger consent_doctor_delete before delete on public.clinic_members
 for each row execute function cortex_consent_lab.end_membership_requests();

-- Fixture predicate on the current command snapshot, NOT a production reader
-- gate. Operational readers and old RR transactions need their own fence proof.
create function cortex_consent_lab.can_operate(id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select auth.role()='authenticated' and public.session_assurance_ok()
 and exists(select 1 from cortex_consent_lab.requests r join cortex_consent_lab.grants g on g.request_id=r.id
 where r.id=can_operate.id and r.staff_user_id=auth.uid() and r.state='approved'
 and cortex_consent_lab.eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id));
$$;
revoke all on all functions in schema cortex_consent_lab from public,anon,authenticated,service_role;
grant usage on schema cortex_consent_lab to authenticated;
grant execute on function cortex_consent_lab.request(uuid,uuid,uuid,uuid),
 cortex_consent_lab.mutate(uuid,integer,text,uuid),cortex_consent_lab.can_operate(uuid) to authenticated;
