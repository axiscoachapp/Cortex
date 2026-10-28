-- Physician-authored work remains usable without an AI provider.
create table public.clinical_work_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  kind text not null check (kind in ('draft','task','observation','pregnancy','medication','instruction','intake')),
  title text not null check (length(trim(title)) between 1 and 200),
  content text not null default '' check (length(content) <= 100000),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 20000),
  status text not null default 'open' check (status in ('open','done','cancelled','draft','approved')),
  due_date date,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id,user_id) references public.patients(id,user_id) on delete cascade
);
create index clinical_work_patient on public.clinical_work_items(user_id,patient_id,created_at desc,id);
alter table public.clinical_work_items enable row level security;
create function public.clinical_account_writable() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists(select 1 from public.account_deletion_requests where user_id=auth.uid());
$$;
revoke all on function public.clinical_account_writable() from public,anon;
grant execute on function public.clinical_account_writable() to authenticated;
create policy work_read on public.clinical_work_items for select to authenticated using (user_id=auth.uid());
create policy work_insert on public.clinical_work_items for insert to authenticated with check (
  user_id=auth.uid() and (kind<>'draft' or status='draft') and (kind<>'medication' or status='open') and public.clinical_account_writable() and exists(select 1 from public.patients p where p.id=patient_id and p.user_id=auth.uid() and p.deletion_requested_at is null)
);
create policy work_update on public.clinical_work_items for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.patients p where p.id=patient_id and p.user_id=auth.uid() and p.deletion_requested_at is null));
create policy work_delete on public.clinical_work_items for delete to authenticated using(user_id=auth.uid() and status not in ('approved','done'));

create table public.clinical_work_revisions (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 patient_id uuid not null references public.patients(id) on delete cascade,
 item_id uuid not null references public.clinical_work_items(id) on delete cascade,
 revision integer not null, snapshot jsonb not null, created_at timestamptz not null default now()
);
alter table public.clinical_work_revisions enable row level security;
create policy work_revision_owner on public.clinical_work_revisions for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on public.clinical_work_revisions from anon,authenticated;
grant select on public.clinical_work_revisions to authenticated;
create function public.record_work_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.clinical_work_revisions(user_id,patient_id,item_id,revision,snapshot) values(old.user_id,old.patient_id,old.id,old.revision,to_jsonb(old));
 return new;
end $$;
revoke all on function public.record_work_revision() from public;
create trigger work_revision after update on public.clinical_work_items for each row execute function public.record_work_revision();

create function public.validate_clinical_work_item() returns trigger language plpgsql set search_path='' as $$
declare v_date date;
begin
 if new.details ? 'previousVersionId' and not exists(select 1 from public.clinical_work_items source where source.id=(new.details->>'previousVersionId')::uuid and source.user_id=new.user_id and source.patient_id=new.patient_id and source.kind=new.kind and source.status='approved') then raise exception 'Approved source version unavailable' using errcode='23514'; end if;
 if new.kind in ('observation','pregnancy','medication') then
  if coalesce(new.details->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Valid clinical date required' using errcode='23514'; end if;
  begin v_date:=(new.details->>'date')::date; exception when others then raise exception 'Valid clinical date required' using errcode='23514'; end;
 end if;
 if new.kind='observation' and (coalesce(new.details->>'value','') !~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)$' or nullif(trim(new.details->>'unit'),'') is null) then raise exception 'Measurement value and unit required' using errcode='23514'; end if;
 if new.kind='pregnancy' and nullif(trim(new.details->>'source'),'') is null then raise exception 'Dating source required' using errcode='23514'; end if;
 if new.kind='medication' and coalesce(new.details->>'state','') not in ('active','changed','stopped') then raise exception 'Medication state required' using errcode='23514'; end if;
 if new.kind in ('draft','instruction','intake','medication') and nullif(trim(new.content),'') is null then raise exception 'Physician text required' using errcode='23514'; end if;
 return new;
end $$;
create trigger validate_work_input before insert or update on public.clinical_work_items for each row execute function public.validate_clinical_work_item();

create function public.guard_clinical_work_item() returns trigger language plpgsql set search_path=public as $$
begin
  if new.user_id<>old.user_id or new.patient_id<>old.patient_id or new.kind<>old.kind or new.id<>old.id or new.created_at is distinct from old.created_at then
    raise exception 'Clinical identity is immutable';
  end if;
  if old.kind in ('draft','instruction','medication') and old.status in ('approved','done') and
    (new.content is distinct from old.content or new.details is distinct from old.details or new.title is distinct from old.title or new.status is distinct from old.status or new.due_date is distinct from old.due_date) then
    raise exception 'Approved content requires a new version';
  end if;
  if new.kind='draft' and new.status='done' and old.status<>'done' and current_user in ('authenticated','anon') then raise exception 'Finalize through the reviewed encounter operation'; end if;
  if new.kind='medication' and new.status='approved' and old.status<>'approved' and current_user in ('authenticated','anon') then raise exception 'Approve through the reviewed reconciliation operation'; end if;
  new.revision:=old.revision+1; new.updated_at:=now();
  return new;
end $$;
create trigger guard_work_update before update on public.clinical_work_items for each row execute function public.guard_clinical_work_item();

create function public.finalize_manual_encounter(p_item_id uuid,p_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare item public.clinical_work_items; encounter_id uuid; appointment uuid;
begin
  perform public.assert_session_assurance();
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,123));
  select * into item from public.clinical_work_items where id=p_item_id and user_id=auth.uid() for update;
  if not found or item.kind<>'draft' then raise exception 'Draft unavailable'; end if;
  perform 1 from public.patients where id=item.patient_id and user_id=auth.uid() and deletion_requested_at is null for update;
  if not found or exists(select 1 from public.account_deletion_requests where user_id=auth.uid()) then raise exception 'Patient or account unavailable'; end if;
  if item.status='done' and item.details ? 'consultationId' then
    select id into encounter_id from public.consultations where id=(item.details->>'consultationId')::uuid and patient_id=item.patient_id and user_id=auth.uid();
    if encounter_id is null then raise exception 'Finalized source unavailable'; end if;
    return encounter_id;
  end if;
  if item.status<>'draft' then raise exception 'Draft unavailable'; end if;
  if item.revision is distinct from p_revision then raise exception 'Draft changed; reload before approval' using errcode='40001'; end if;
  if length(trim(item.content))<1 then raise exception 'Reviewed text required'; end if;
  if item.details ? 'appointmentId' and item.details->>'appointmentId'<>'' then
    appointment:=(item.details->>'appointmentId')::uuid;
    perform 1 from public.appointments where id=appointment and patient_id=item.patient_id and user_id=auth.uid()
      and status in ('agendado','confirmado') for update;
    if not found then raise exception 'Appointment unavailable'; end if;
  end if;
  insert into public.consultations(user_id,patient_id,chief_complaint,soap_note,transcription,appointment_id)
    values(auth.uid(),item.patient_id,item.title,item.content,'',appointment) returning id into encounter_id;
  update public.patients set last_visit=(now() at time zone 'America/Sao_Paulo')::date,status='seguimento'
    where id=item.patient_id and user_id=auth.uid();
  if appointment is not null then update public.appointments set status='realizado' where id=appointment and user_id=auth.uid(); end if;
  update public.clinical_work_items set status='done',details=details||jsonb_build_object('consultationId',encounter_id,'approvedAt',now()) where id=item.id;
  return encounter_id;
end $$;
revoke all on function public.finalize_manual_encounter(uuid,integer) from public,anon;
grant execute on function public.finalize_manual_encounter(uuid,integer) to authenticated;
