-- Disposable SQL proof only. Not a production migration or Auth/session gate.
begin;
set transaction isolation level read committed;
lock table public.clinic_members in access exclusive mode nowait;
create schema provision_membership_lab;
revoke all on schema provision_membership_lab from public,anon,authenticated,service_role;
alter table public.clinic_members add column provisioning_authority_generation uuid not null default gen_random_uuid();

-- Derive, never accept, the generation on every ordinary writer path.
create function provision_membership_lab.rotate_generation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then new.provisioning_authority_generation:=gen_random_uuid();
 elsif (new.clinic_id,new.user_id,new.role,new.status) is distinct from (old.clinic_id,old.user_id,old.role,old.status) then
  new.provisioning_authority_generation:=gen_random_uuid();
 else new.provisioning_authority_generation:=old.provisioning_authority_generation;
 end if;
 return new;
end $$;
create trigger aa_provisioning_authority_generation before insert or update on public.clinic_members
 for each row execute function provision_membership_lab.rotate_generation();

create function provision_membership_lab.current_generation(p_clinic uuid,p_admin uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare generation uuid;
begin
 -- The existing guard fences Auth, actual T33 and the current membership.
 perform cortex_private.reception_provisioning_admin(p_clinic,p_admin);
 select provisioning_authority_generation into generation from public.clinic_members
  where clinic_id=p_clinic and user_id=p_admin for share nowait;
 if generation is null then raise exception 'Membership authority unavailable' using errcode='42501';end if;
 return generation;
exception when lock_not_available then raise exception 'Membership authority busy' using errcode='40001';
end $$;
create function provision_membership_lab.assert_generation(p_clinic uuid,p_admin uuid,p_expected uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_expected is null or provision_membership_lab.current_generation(p_clinic,p_admin) is distinct from p_expected then
  raise exception 'Membership authority replaced' using errcode='42501';
 end if;
end $$;
revoke all on all functions in schema provision_membership_lab from public,anon,authenticated,service_role;
commit;
