-- Inactivity ends delegation, including direct privileged account updates.
-- Reactivating only the account flag must not restore old calendar permissions.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
do $$ begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Staff scope installation requires read committed' using errcode='55000';
 end if;
end $$;
create function cortex_private.revoke_inactive_staff_scopes() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare removed integer;
begin
 perform cortex_private.touch_custody_epoch(array[new.user_id]);
 delete from public.staff_doctor_scopes where clinic_id=new.clinic_id and staff_user_id=new.user_id;
 get diagnostics removed=row_count;
 if removed>0 then
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(new.clinic_id,auth.uid(),'staff_scopes_revoked',new.user_id,jsonb_build_object('count',removed));
 end if;
 return null;
end $$;
create trigger reception_staff_scopes_revoke after update of active on public.clinic_staff_members
 for each row when(not new.active) execute function cortex_private.revoke_inactive_staff_scopes();

create function cortex_private.guard_active_scope_staff() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 -- Alphabetically after custody_reference: fence the staff account before a
 -- fresh membership read, including privileged INSERT/UPDATE and old snapshots.
 if not exists(select 1 from public.clinic_staff_members where clinic_id=new.clinic_id and user_id=new.staff_user_id and active) then
  raise exception 'Recepção indisponível na clínica' using errcode='42501';
 end if;
 return null;
end $$;
create trigger reception_scope_active_staff after insert or update on public.staff_doctor_scopes
 for each row execute function cortex_private.guard_active_scope_staff();
revoke all on function cortex_private.revoke_inactive_staff_scopes(),cortex_private.guard_active_scope_staff()
 from public,anon,authenticated,service_role;

-- Only objectively inactive accounts are repaired. Active historical grants
-- still need provenance/consent review; never infer the doctor's approval.
do $$ declare r record;begin
 for r in with removed as (
  delete from public.staff_doctor_scopes d using public.clinic_staff_members s
  where s.clinic_id=d.clinic_id and s.user_id=d.staff_user_id and not s.active
  returning d.clinic_id,d.staff_user_id
 ) select clinic_id,staff_user_id,count(*) as count from removed group by clinic_id,staff_user_id loop
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(r.clinic_id,null,'staff_scopes_revoked',r.staff_user_id,jsonb_build_object('count',r.count));
 end loop;
end $$;
commit;
