-- T28 partial cut: the authenticated legacy array may retain/remove existing
-- scopes, but cannot create or restore a scope without physician approval.
-- Service provisioning and reconciliation are a separately verified cut.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
lock table public.clinic_staff_members,public.staff_doctor_scopes in share row exclusive mode nowait;

create function cortex_private.guard_authenticated_legacy_scope() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if new.delegation_request_id is null and auth.role()='authenticated' then
  raise exception 'Authenticated legacy delegation requires physician approval' using errcode='42501';
 end if;
 return null;
end $$;
-- AFTER runs only for an actual inserted row, not ON CONFLICT DO NOTHING.
-- Existing identity, eligibility, custody and reviewed-pair checks run first.
create trigger zzz_authenticated_legacy_scope after insert on public.staff_doctor_scopes
 for each row execute function cortex_private.guard_authenticated_legacy_scope();
revoke all on function cortex_private.guard_authenticated_legacy_scope() from public,anon,authenticated,service_role;
commit;
