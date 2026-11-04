-- T28: legacy grants cannot be retargeted while INSERT/provisioning and
-- reconciliation are being cut over. Explicit approval may adopt the same row.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
lock table public.staff_doctor_scopes in share row exclusive mode nowait;

create function cortex_private.guard_legacy_scope_identity() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if (new.clinic_id,new.staff_user_id,new.doctor_user_id) is distinct from
    (old.clinic_id,old.staff_user_id,old.doctor_user_id) then
  raise exception 'Legacy delegation identity immutable' using errcode='22023';
 end if;
 return null;
end $$;
-- Preserve existing eligibility/consent refusals. NULL -> approved request is
-- allowed only on the same identity and still validated by zz_delegation_scope.
create trigger zzz_legacy_scope_identity after update on public.staff_doctor_scopes
 for each row execute function cortex_private.guard_legacy_scope_identity();
revoke all on function cortex_private.guard_legacy_scope_identity() from public,anon,authenticated,service_role;
commit;
