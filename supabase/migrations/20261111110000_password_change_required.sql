-- Owner: Claude. Temporary passwords become a server-side control (review 2026-11-10, security findings 1-2).
--
-- What was possible: accounts provisioned by the clinic admin got a temporary password and a
-- "must change" flag in user_metadata, which the account itself can edit and which only the React
-- gate read. Whoever held the temporary password (the admin) could clear the flag through the API,
-- keep a working credential for the doctor's account and read the private record at any time.
--
-- What this migration does:
--  1. public.password_change_pending(): true while the caller's JWT carries
--     app_metadata.must_change_password = true (written only by the service role) or the legacy
--     user_metadata flag. It reads the signed claim, so a token issued before the change stays
--     refused until the client refreshes its session.
--  2. The four central guards every RLS policy and authenticated RPC already goes through deny
--     while the change is pending: session_assurance_ok() (restrictive session_assurance policies
--     on clinical tables and storage.objects, reception_scope_ok, assert_reception_scope,
--     reception_contact_admin, reception_delegation_actor, sharing_actor, clinic_access...),
--     assert_session_assurance(), clinical_session_allowed() (restrictive clinical_identity
--     policies, clinical_account_writable) and assert_clinical_actor(). Service role and cron
--     calls carry no user claim and are unaffected. usage_daily (own counters, no restrictive
--     policy until now) gets the same restriction; the reference catalogs stay public reference data.
--  3. Invitations (finding 2): an account provisioned with a temporary password counts as owned
--     only after its owner set a password (app_metadata.password_set_by_owner_at, written by the
--     change-initial-password Edge Function). invite_clinic_doctor and respond_clinic_invitation
--     refuse it before that.
--  4. Backfill: accounts created before this change (legacy user_metadata flag) get the server flag
--     with a 72-hour window from now, or, when the old gate already recorded the change, the
--     owner-set marker so they keep receiving invitations.
-- Signatures, grants and search_path of the replaced functions are unchanged.

create function public.password_change_pending() returns boolean
language sql stable set search_path='' as $$
 select coalesce(auth.jwt()->'app_metadata'->>'must_change_password','')='true'
     or coalesce(auth.jwt()->'user_metadata'->>'must_change_password','')='true';
$$;
revoke all on function public.password_change_pending() from public,anon;
grant execute on function public.password_change_pending() to authenticated,service_role;

create or replace function public.session_assurance_ok() returns boolean language sql stable security definer set search_path='' as $$
 select auth.role()='service_role' or (auth.uid() is not null and not public.password_change_pending() and (
   auth.jwt()->>'aal'='aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified')
 ));
$$;

create or replace function public.assert_session_assurance() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if public.password_change_pending() then
  raise exception 'Troque a senha temporária para continuar' using errcode='42501', hint='password_change_required';
 end if;
 if not coalesce(public.session_assurance_ok(),false) then raise exception 'Verifique o segundo fator da sessão' using errcode='42501'; end if;
end $$;

create or replace function public.clinical_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select not public.password_change_pending() and not public.is_reception_account(auth.uid());
$$;

create or replace function public.assert_clinical_actor() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if public.password_change_pending() then
  raise exception 'Troque a senha temporária para continuar' using errcode='42501', hint='password_change_required';
 end if;
 if public.is_reception_account(auth.uid()) then raise exception 'Operação restrita ao ambiente médico' using errcode='42501'; end if;
end $$;

create policy password_change on public.usage_daily as restrictive for all to authenticated
 using(not public.password_change_pending()) with check(not public.password_change_pending());

-- Live Auth state, not the caller's token: invitations concern another account.
create function public.account_owner_verified(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user
  and coalesce(u.raw_app_meta_data->>'must_change_password','')<>'true'
  and coalesce(u.raw_user_meta_data->>'must_change_password','')<>'true'
  and (coalesce(u.raw_app_meta_data,'{}'::jsonb) ? 'password_set_by_owner_at'
       or not (coalesce(u.raw_app_meta_data,'{}'::jsonb) ? 'provisioned_at'
               or coalesce(u.raw_user_meta_data,'{}'::jsonb) ? 'must_change_password')));
$$;
revoke all on function public.account_owner_verified(uuid) from public,anon,authenticated;

create or replace function public.invite_clinic_doctor(p_clinic_id uuid, p_email text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_actor uuid:=public.sharing_actor(); v_user uuid;
begin
  if not exists(select 1 from public.clinic_members where clinic_id=p_clinic_id and user_id=v_actor and role='admin' and status='active') then raise exception 'Not authorized' using errcode='42501'; end if;
  select id into v_user from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if v_user is null then raise exception 'Nenhuma conta confirmada com este e-mail. O médico precisa ter uma conta ativa antes de receber o convite.' using errcode='22023'; end if;
  if v_user=v_actor then raise exception 'Você já participa desta clínica' using errcode='22023'; end if;
  if not public.account_owner_verified(v_user) then
    raise exception 'Esta conta ainda usa a senha temporária. O convite fica disponível depois que o médico entrar e definir a própria senha.' using errcode='22023', hint='password_change_required';
  end if;
  insert into public.clinic_members(clinic_id,user_id,role,status) values(p_clinic_id,v_user,'doctor','invited')
  on conflict(clinic_id,user_id) do update set status=case when public.clinic_members.status='active' then 'active' else 'invited' end,updated_at=now();
  insert into public.chart_access_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic_id,v_actor,'member_invited',v_user);
  return true;
end $function$;

create or replace function public.respond_clinic_invitation(p_clinic_id uuid, p_accept boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_actor uuid:=public.sharing_actor();
begin
  if p_accept and not public.account_owner_verified(v_actor) then
    raise exception 'Defina a sua própria senha antes de aceitar o convite.' using errcode='42501', hint='password_change_required';
  end if;
  if p_accept and exists(select 1 from public.clinic_members where user_id=v_actor and clinic_id<>p_clinic_id and status='active') then raise exception 'Você já participa de outra clínica' using errcode='22023'; end if;
  update public.clinic_members set status=case when p_accept then 'active' else 'inactive' end,updated_at=now()
    where clinic_id=p_clinic_id and user_id=v_actor and status='invited';
  if not found then raise exception 'Convite indisponível' using errcode='42501'; end if;
  insert into public.chart_access_audit(clinic_id,actor_user_id,action) values(p_clinic_id,v_actor,case when p_accept then 'invitation_accepted' else 'invitation_declined' end);
  return true;
end $function$;

-- Backfill accounts provisioned before this change (they carry the legacy user_metadata key).
update auth.users u set raw_app_meta_data = coalesce(u.raw_app_meta_data,'{}'::jsonb)
  || jsonb_build_object('provisioned_at', to_jsonb(u.created_at))
  || case when u.raw_user_meta_data->>'must_change_password'='true'
       then jsonb_build_object('must_change_password', true,
                               'temporary_password_expires_at', to_jsonb(now() + interval '72 hours'))
       else jsonb_build_object('password_set_by_owner_at', to_jsonb(coalesce(u.updated_at, u.created_at)),
                               'password_set_by_owner_legacy', true)
     end
 where coalesce(u.raw_user_meta_data,'{}'::jsonb) ? 'must_change_password'
   and not (coalesce(u.raw_app_meta_data,'{}'::jsonb) ? 'provisioned_at');
