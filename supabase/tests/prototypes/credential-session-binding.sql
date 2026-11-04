-- LAB ONLY: candidate protocol, not an application migration or deployment.
drop trigger lab_observe_password_rotation on auth.users;
drop function password_lab.observe_password_rotation();
create table password_lab.credentials (
 user_id uuid primary key references auth.users(id) on delete cascade,
 credential_epoch uuid not null,
 pending boolean not null,
 rotation_xid xid8
);
create table password_lab.session_bindings (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 credential_epoch uuid not null,
 purpose text not null check(purpose in ('password','repair'))
);
revoke all on password_lab.credentials,password_lab.session_bindings from public,anon,authenticated,service_role;
grant usage on schema password_lab to supabase_auth_admin;
grant select on password_lab.credentials to supabase_auth_admin;
grant select,insert on password_lab.session_bindings to supabase_auth_admin;

create function password_lab.register_credential() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.raw_app_meta_data ? 'credential_epoch' then
  insert into password_lab.credentials values(new.id,(new.raw_app_meta_data->>'credential_epoch')::uuid,true,null)
   on conflict(user_id) do nothing;
  if found then update auth.users set raw_app_meta_data=raw_app_meta_data||'{"initial_password_required":true}'::jsonb where id=new.id;end if;
 end if;
 return new;
end $$;
create trigger lab_register_credential after insert or update of raw_app_meta_data on auth.users
 for each row execute function password_lab.register_credential();

-- Native provider/profile writes may carry stale app_metadata snapshots.
create function password_lab.preserve_credential_metadata() returns trigger
language plpgsql security definer set search_path='' as $$
declare state password_lab.credentials;
begin
 select * into state from password_lab.credentials where user_id=new.id;
 if found then new.raw_app_meta_data:=new.raw_app_meta_data||jsonb_build_object(
  'credential_epoch',state.credential_epoch::text,'initial_password_required',state.pending);end if;
 return new;
end $$;
create trigger lab_preserve_credential_metadata before update on auth.users for each row execute function password_lab.preserve_credential_metadata();

create function password_lab.bind_access_token(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare claims jsonb:=event->'claims'; actor uuid:=(event->>'user_id')::uuid;
 sid uuid:=(claims->>'session_id')::uuid; bound_epoch uuid; method text:=event->>'authentication_method'; state password_lab.credentials;
begin
 -- Serialize token issuance with native user/password writes before canonical state.
 perform 1 from auth.users where id=actor for no key update nowait;
 select * into state from password_lab.credentials where user_id=actor for share;
 if not found or claims->>'sub' is distinct from actor::text
  or not exists(select 1 from auth.sessions where id=sid and user_id=actor)
  or claims->'app_metadata'->>'credential_epoch' is distinct from state.credential_epoch::text then
  raise exception 'Session requires a new authenticated login';
 end if;
 if method in ('password','recovery','otp') then
  insert into password_lab.session_bindings(session_id,user_id,credential_epoch,purpose)
   values(sid,actor,(claims->'app_metadata'->>'credential_epoch')::uuid,case when method='password' then 'password' else 'repair' end)
   on conflict(session_id) do nothing;
 end if;
 select credential_epoch into bound_epoch from password_lab.session_bindings where session_id=sid and user_id=actor;
 if bound_epoch is distinct from state.credential_epoch then raise exception 'Session requires a new authenticated login'; end if;
 claims:=jsonb_set(claims,'{cortex_credential_epoch}',to_jsonb(bound_epoch::text));
 return jsonb_build_object('claims',claims);
end $$;
revoke all on function password_lab.bind_access_token(jsonb) from public,anon,authenticated,service_role;
grant execute on function password_lab.bind_access_token(jsonb) to supabase_auth_admin;

create function password_lab.rotate_credential_epoch() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; state password_lab.credentials;
begin
 if new.payload->>'action'='user_updated_password' then
  select user_id into actor from password_lab.credentials where user_id::text=new.payload->>'actor_id';
  if actor is null then return new;end if;
  select * into state from password_lab.credentials where user_id=actor for update;
  -- Native UpdatePassword has removed the other sessions. Its surviving caller
  -- must still exist with the current binding; revoked cached callers cannot rotate.
  if not exists(select 1 from auth.sessions s join password_lab.session_bindings b on b.session_id=s.id
   where s.user_id=actor and b.user_id=actor and b.credential_epoch=state.credential_epoch) then
   raise exception 'Password rotation requires a live credential-bound session';
  end if;
  update password_lab.credentials set credential_epoch=pg_catalog.gen_random_uuid(),pending=false,
   rotation_xid=pg_catalog.pg_current_xact_id() where user_id=actor;
  update auth.users set raw_app_meta_data=raw_app_meta_data where id=actor;
  delete from auth.sessions where user_id=actor;
 end if;
 return new;
end $$;
create trigger lab_rotate_credential_epoch after insert on auth.audit_log_entries
 for each row execute function password_lab.rotate_credential_epoch();

-- At commit, completed accounts permit password-field writes only in a native
-- password-event transaction. No password/hash copy is persisted.
create function password_lab.check_password_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare state password_lab.credentials;
begin
 select * into state from password_lab.credentials where user_id=new.id;
 if found and not state.pending and state.rotation_xid is distinct from pg_catalog.pg_current_xact_id() then
  raise exception 'Password representation change requires credential rotation';
 end if;
 return null;
end $$;
create constraint trigger lab_check_password_write after update on auth.users deferrable initially deferred
 for each row when(new.encrypted_password is distinct from old.encrypted_password)
 execute function password_lab.check_password_write();

revoke all on function password_lab.register_credential(),password_lab.preserve_credential_metadata(),
 password_lab.rotate_credential_epoch(),password_lab.check_password_write() from public,anon,authenticated,service_role;
create or replace function password_lab.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from password_lab.credentials c join auth.sessions s on s.user_id=c.user_id
  join password_lab.session_bindings b on b.session_id=s.id and b.user_id=c.user_id
  where c.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and not c.pending and b.purpose='password'
  and b.credential_epoch=c.credential_epoch and auth.jwt()->>'cortex_credential_epoch'=c.credential_epoch::text
  and (auth.jwt()->>'aal'='aal2' or not exists(
   select 1 from auth.mfa_factors where user_id=c.user_id and status='verified')))
$$;
-- Make a deadlock regression slower than the explicit non-waiting hook check.
alter role supabase_auth_admin set deadlock_timeout='15s';
