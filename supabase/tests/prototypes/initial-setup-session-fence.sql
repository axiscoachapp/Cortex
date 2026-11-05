-- LAB ONLY: compose the existing reserved write with private session bindings.
-- Not a production migration or a policy for existing/reset/MFA accounts.
alter table password_lab.setup_operations
 add column credential_generation uuid not null default pg_catalog.gen_random_uuid(),
 add column authorized_generation uuid;
create table password_lab.setup_session_bindings(
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 generation uuid not null,purpose text not null check(purpose in ('password','repair')),
 operation_id uuid,reservation_revision integer
);
alter table password_lab.setup_session_bindings enable row level security;
revoke all on password_lab.setup_session_bindings from public,anon,authenticated,service_role;

create function password_lab.advance_setup_generation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.credential_generation:=pg_catalog.gen_random_uuid();new.authorized_generation:=null;return new;
end $$;
create trigger lab_advance_setup_generation before update of phase on password_lab.setup_operations
 for each row when(old.phase='applying' and new.phase='password_set') execute function password_lab.advance_setup_generation();

create function password_lab.bind_setup_token(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare claims jsonb:=event->'claims';actor uuid:=(event->>'user_id')::uuid;sid uuid:=(claims->>'session_id')::uuid;
 method text:=event->>'authentication_method';state password_lab.setup_operations;bound password_lab.setup_session_bindings;purpose text;
begin
 perform 1 from auth.users where id=actor for no key update nowait;
 if not found or claims->>'sub' is distinct from actor::text or claims->>'role' is distinct from 'authenticated' then raise exception 'Setup session unavailable' using errcode='42501';end if;
 select * into state from password_lab.setup_operations where user_id=actor for share nowait;
 if not found or not exists(select 1 from auth.sessions where id=sid and user_id=actor and (not_after is null or not_after>clock_timestamp())) then
  raise exception 'Setup session unavailable' using errcode='42501';end if;
 if method='password' then
  if state.phase<>'password_set' or state.password_write_xid is null
   or claims->'app_metadata'->>'setup_operation_id' is distinct from state.operation_id::text
   or claims->'app_metadata'->>'setup_reservation_revision' is distinct from state.reservation_revision::text then
   raise exception 'New reserved-password login required' using errcode='42501';end if;
  purpose:='password';
 elsif method in ('otp','recovery') then purpose:='repair';
 end if;
 if purpose is not null then
  insert into password_lab.setup_session_bindings values(sid,actor,state.credential_generation,purpose,state.operation_id,state.reservation_revision)
   on conflict(session_id) do nothing;
 end if;
 select * into bound from password_lab.setup_session_bindings where session_id=sid and user_id=actor;
 if not found or bound.generation is distinct from state.credential_generation
  or (bound.purpose='password' and (state.phase<>'password_set' or bound.operation_id is distinct from state.operation_id
   or bound.reservation_revision is distinct from state.reservation_revision)) then
  raise exception 'Setup session unavailable' using errcode='42501';end if;
 claims:=jsonb_set(claims,'{cortex_setup_generation}',to_jsonb(bound.generation::text));
 claims:=jsonb_set(claims,'{cortex_setup_purpose}',to_jsonb(bound.purpose));
 return jsonb_build_object('claims',claims);
exception when lock_not_available then raise exception 'Setup changed concurrently' using errcode='40001';
end $$;
revoke all on function password_lab.advance_setup_generation(),password_lab.bind_setup_token(jsonb) from public,anon,authenticated,service_role;
grant usage on schema password_lab to supabase_auth_admin;
grant execute on function password_lab.bind_setup_token(jsonb) to supabase_auth_admin;

create function password_lab.complete_reserved_setup(p_user uuid,p_session uuid,p_operation uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state password_lab.setup_operations;
begin
 perform 1 from auth.users where id=p_user for no key update nowait;
 if not found then raise exception 'Setup completion unavailable' using errcode='42501';end if;
 select * into state from password_lab.setup_operations where user_id=p_user for update nowait;
 if not found then raise exception 'Setup completion unavailable' using errcode='42501';end if;
 perform 1 from auth.sessions s join password_lab.setup_session_bindings b on b.session_id=s.id and b.user_id=s.user_id
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>clock_timestamp())
  and b.purpose='password' and b.generation=state.credential_generation
  and b.operation_id=state.operation_id and b.reservation_revision=state.reservation_revision for key share of s nowait;
 if not found or exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified') then
  raise exception 'Setup completion unavailable' using errcode='42501';end if;
 if state.phase<>'password_set' or state.operation_id is distinct from p_operation then
  raise exception 'Setup revision changed' using errcode='40001';end if;
 if state.authorized_generation=state.credential_generation then
  return jsonb_build_object('revision',state.revision,'mutation_allowed',false);
 end if;
 if p_revision is null or state.revision<>p_revision then raise exception 'Setup revision changed' using errcode='40001';end if;
 update password_lab.setup_operations set authorized_generation=credential_generation,revision=revision+1 where user_id=p_user returning * into state;
 return jsonb_build_object('revision',state.revision,'mutation_allowed',true);
exception when lock_not_available then raise exception 'Setup changed concurrently' using errcode='40001';
end $$;
revoke all on function password_lab.complete_reserved_setup(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role,supabase_auth_admin;

create or replace function password_lab.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from password_lab.setup_operations o join auth.sessions s on s.user_id=o.user_id
  join password_lab.setup_session_bindings b on b.session_id=s.id and b.user_id=o.user_id
  where o.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp())
  and o.phase='password_set' and o.authorized_generation=o.credential_generation and b.generation=o.credential_generation
  and b.purpose='password' and b.operation_id=o.operation_id and b.reservation_revision=o.reservation_revision
  and auth.jwt()->>'cortex_setup_generation'=o.credential_generation::text and auth.jwt()->>'cortex_setup_purpose'=b.purpose
  and (auth.jwt()->>'aal'='aal2' or not exists(select 1 from auth.mfa_factors where user_id=o.user_id and status='verified')))
$$;
