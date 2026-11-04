-- LAB ONLY: proves a reserved native password write; NEVER grants data access.
drop trigger lab_observe_password_rotation on auth.users;
create table password_lab.setup_operations(
 user_id uuid primary key references auth.users(id) on delete cascade,
 phase text not null default 'pending' check(phase in ('pending','applying','password_set')),
 revision integer not null default 0,reservation_revision integer,operation_id uuid,caller_session_id uuid,password_write_xid xid8
);
alter table password_lab.setup_operations enable row level security;
revoke all on password_lab.setup_operations from public,anon,authenticated,service_role;

create function password_lab.begin_setup(p_user uuid,p_session uuid,p_operation uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state password_lab.setup_operations;
begin
 if p_operation is null or p_revision is null or not exists(
  select 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>clock_timestamp())) then
  raise exception 'Setup requires an owned live session' using errcode='42501';end if;
 select * into state from password_lab.setup_operations where user_id=p_user for update nowait;
 if not found then raise exception 'Missing setup state' using errcode='55000';end if;
 if state.phase='password_set' then
  return jsonb_build_object('phase',state.phase,'revision',state.revision,'reservation_revision',state.reservation_revision,'mutation_allowed',false);
 end if;
 if state.operation_id=p_operation then
  return jsonb_build_object('phase',state.phase,'revision',state.revision,'reservation_revision',state.reservation_revision,'mutation_allowed',false);
 end if;
 if state.revision<>p_revision then raise exception 'Setup revision changed' using errcode='40001';end if;
 update password_lab.setup_operations set phase='applying',reservation_revision=revision+1,revision=revision+1,operation_id=p_operation,
  caller_session_id=p_session,password_write_xid=null where user_id=p_user returning * into state;
 return jsonb_build_object('phase',state.phase,'revision',state.revision,'reservation_revision',state.reservation_revision,'mutation_allowed',true);
exception when lock_not_available then
 raise exception 'Setup changed concurrently' using errcode='40001';
end $$;

create function password_lab.observe_setup_password_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare state password_lab.setup_operations;
begin
 select * into state from password_lab.setup_operations where user_id=new.id for update nowait;
 if not found then return new;end if;
 if state.phase<>'applying' then raise exception 'No writable setup reservation' using errcode='40001';end if;
 update password_lab.setup_operations set password_write_xid=pg_current_xact_id() where user_id=new.id;
 return new;
exception when lock_not_available then
 raise exception 'Setup changed concurrently' using errcode='40001';
end $$;
create trigger lab_setup_password_write after update of encrypted_password on auth.users for each row
 when(new.encrypted_password is distinct from old.encrypted_password)
 execute function password_lab.observe_setup_password_write();

create function password_lab.confirm_setup_password_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare state password_lab.setup_operations;marker text;marker_revision text;
begin
 select * into state from password_lab.setup_operations where user_id=new.id for update nowait;
 if not found then return null;end if;
 select raw_app_meta_data->>'setup_operation_id',raw_app_meta_data->>'setup_reservation_revision' into marker,marker_revision from auth.users where id=new.id;
 if state.operation_id is null or marker is distinct from state.operation_id::text
  or marker_revision is distinct from state.reservation_revision::text
  or state.password_write_xid is distinct from pg_current_xact_id()
  or state.phase not in ('applying','password_set') then
  raise exception 'Setup write lacks its reserved native transaction' using errcode='40001';end if;
 if state.phase='applying' then
  update password_lab.setup_operations set phase='password_set',revision=revision+1 where user_id=new.id;
 end if;
 return null;
exception when lock_not_available then
 raise exception 'Setup changed concurrently' using errcode='40001';
end $$;
create constraint trigger lab_confirm_setup_password after update on auth.users deferrable initially deferred for each row
 when(new.encrypted_password is distinct from old.encrypted_password
  or new.raw_app_meta_data->'setup_operation_id' is distinct from old.raw_app_meta_data->'setup_operation_id'
  or new.raw_app_meta_data->'setup_reservation_revision' is distinct from old.raw_app_meta_data->'setup_reservation_revision')
 execute function password_lab.confirm_setup_password_write();
revoke all on all functions in schema password_lab from public,anon,authenticated,service_role;
-- Deliberately closed: completion and session fencing are a later contract.
create or replace function password_lab.session_ready() returns boolean language sql stable as $$ select false $$;
grant execute on function password_lab.session_ready() to authenticated;
