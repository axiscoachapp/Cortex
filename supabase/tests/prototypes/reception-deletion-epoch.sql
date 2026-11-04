-- TEST-ONLY MECHANISM PROTOTYPE. Not a migration, not a complete H2 fix.
-- Loaded only by --prototype in a newly owned disposable database.
-- Covers contacts/cases/account intent for the four directed race regressions.
create schema cortex_custody_prototype;
revoke all on schema cortex_custody_prototype from public,anon,authenticated,service_role;
create table cortex_custody_prototype.epoch (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 0
);
insert into cortex_custody_prototype.epoch default values;
alter table cortex_custody_prototype.epoch enable row level security;
revoke all on cortex_custody_prototype.epoch from public,anon,authenticated,service_role;

create function cortex_custody_prototype.touch_epoch() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from cortex_custody_prototype.epoch where singleton for update nowait;
 if not found then raise exception 'Missing custody epoch' using errcode='55000';end if;
 update cortex_custody_prototype.epoch set revision=revision+1 where singleton;
exception when lock_not_available then
 raise exception 'Custody changed concurrently; retry the transaction' using errcode='40001';
end $$;
revoke all on function cortex_custody_prototype.touch_epoch() from public,anon,authenticated,service_role;

create function cortex_custody_prototype.guard_intent() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 perform cortex_custody_prototype.touch_epoch();
 return new;
end $$;
revoke all on function cortex_custody_prototype.guard_intent() from public,anon,authenticated,service_role;
-- Alphabetical row-trigger order: existing advisory, this epoch, existing precheck.
create trigger reception_custody_epoch before insert or update on public.account_deletion_requests
 for each row execute function cortex_custody_prototype.guard_intent();

create function cortex_custody_prototype.guard_reference() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare field text; candidate uuid;
begin
 perform cortex_custody_prototype.touch_epoch();
 foreach field in array tg_argv loop
  candidate:=(to_jsonb(new)->>field)::uuid;
  if exists(select 1 from public.account_deletion_requests where user_id=candidate) then
   raise exception 'Account deletion in progress' using errcode='55000';
  end if;
 end loop;
 return new;
end $$;
revoke all on function cortex_custody_prototype.guard_reference() from public,anon,authenticated,service_role;
create trigger custody_prototype_reference after insert or update on public.clinic_contacts
 for each row execute function cortex_custody_prototype.guard_reference('created_by');
create trigger custody_prototype_reference after insert or update on public.reception_cases
 for each row execute function cortex_custody_prototype.guard_reference('doctor_user_id','created_by','assigned_to');
