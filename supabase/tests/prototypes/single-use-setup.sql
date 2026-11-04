-- LAB ONLY. A comparison fixture, NOT a setup completion protocol/migration.
-- No hash observation, Auth hook, copied credential, client completion RPC or
-- legacy-account backfill. Only the test owner can change this private state.
drop trigger lab_observe_password_rotation on auth.users;
create table password_lab.setup_state(
 user_id uuid primary key references auth.users(id) on delete cascade,
 pending boolean not null default true
);
alter table password_lab.setup_state enable row level security;
revoke all on password_lab.setup_state from public,anon,authenticated,service_role;
create or replace function password_lab.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from password_lab.setup_state p
 join auth.sessions s on s.user_id=p.user_id
 where p.user_id=auth.uid() and not p.pending
 and s.id::text=auth.jwt()->>'session_id')
$$;
