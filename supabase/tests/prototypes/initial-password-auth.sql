-- LAB ONLY. Applied to an owned, empty Auth/PostgREST test stack, never as an
-- application migration. Does not authorize an implementation or legacy backfill.
-- REJECTED CANDIDATE: native hash re-encryption and an in-flight password login
-- bypass these proposed guards. Keep only as a regression counterexample.
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid(),auth.jwt() to authenticated;

create schema password_lab;
create function password_lab.observe_password_rotation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.raw_app_meta_data->>'initial_password_required'='true'
  and new.encrypted_password is distinct from old.encrypted_password then
  new.raw_app_meta_data:=new.raw_app_meta_data||'{"initial_password_required":false}'::jsonb;
 end if;
 return new;
end $$;
revoke all on function password_lab.observe_password_rotation() from public,anon,authenticated;
create trigger lab_observe_password_rotation before update on auth.users
 for each row execute function password_lab.observe_password_rotation();

create function password_lab.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=auth.uid()
  and u.raw_app_meta_data->>'initial_password_required'='false'
  and auth.jwt()->'app_metadata'->>'initial_password_required'='false'
  and s.id::text=auth.jwt()->>'session_id')
$$;
revoke all on function password_lab.session_ready() from public,anon;
grant usage on schema password_lab to authenticated;
grant execute on function password_lab.session_ready() to authenticated;

create table public.lab_owner_only(user_id uuid primary key references auth.users(id),payload text not null);
create table public.lab_guarded(user_id uuid primary key references auth.users(id),payload text not null);
alter table public.lab_owner_only enable row level security;
alter table public.lab_guarded enable row level security;
grant usage on schema public to authenticated;
grant select on public.lab_owner_only,public.lab_guarded to authenticated;
create policy lab_owner_read on public.lab_owner_only for select to authenticated using(user_id=auth.uid());
create policy lab_guarded_read on public.lab_guarded for select to authenticated using(user_id=auth.uid() and password_lab.session_ready());
