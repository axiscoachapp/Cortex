-- Recoverable consultation drafts and optimistic concurrency for clinical writes.
alter table public.patients add column if not exists revision integer not null default 0;
alter table public.consultations add column if not exists revision integer not null default 0;

create table public.consultation_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  chief_complaint text not null default '',
  audio_storage_path text,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  status text not null default 'processing' check (status in ('processing','review','error')),
  updated_at timestamptz not null default now(),
  unique(user_id, patient_id)
);
alter table public.consultation_drafts enable row level security;
create policy draft_owner on public.consultation_drafts for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.patients p where p.id = patient_id and p.user_id = auth.uid()
  ));
grant select,insert,update,delete on public.consultation_drafts to authenticated;

create table public.clinical_record_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  record_id uuid not null,
  record_type text not null check (record_type in ('patients','consultations')),
  revision integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.clinical_record_revisions enable row level security;
create policy revision_owner_read on public.clinical_record_revisions for select to authenticated using(user_id=auth.uid());
grant select on public.clinical_record_revisions to authenticated;
revoke insert,update,delete on public.clinical_record_revisions from anon,authenticated;
create index clinical_revision_record on public.clinical_record_revisions(user_id,record_type,record_id,revision desc);

create or replace function public.record_clinical_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.clinical_record_revisions(user_id,patient_id,record_id,record_type,revision,snapshot)
  values(old.user_id,case when tg_table_name='patients' then old.id else (to_jsonb(old)->>'patient_id')::uuid end,old.id,tg_table_name,old.revision,to_jsonb(old));
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.record_clinical_revision() from public;
create trigger patient_revision before update on public.patients for each row execute function public.record_clinical_revision();
create trigger consultation_revision before update on public.consultations for each row execute function public.record_clinical_revision();

-- Both compare-and-swap operations happen in one transaction. A conflict rolls
-- back the entire comment, including the associated consultation addendum.
create or replace function public.apply_clinical_comment(
  p_user_id uuid, p_patient_id uuid, p_expected_revision integer, p_patient_patch jsonb,
  p_consultation_id uuid default null, p_expected_consultation_revision integer default null,
  p_addendum text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.patients%rowtype; c public.consultations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  select * into p from public.patients where id=p_patient_id and user_id=p_user_id for update;
  if not found then raise exception 'Patient not found' using errcode='42501'; end if;
  if p.revision <> p_expected_revision then raise exception 'Clinical record changed; reload and retry' using errcode='40001'; end if;
  if p_consultation_id is not null then
    select * into c from public.consultations where id=p_consultation_id and patient_id=p_patient_id and user_id=p_user_id for update;
    if not found or c.revision <> p_expected_consultation_revision then raise exception 'Consultation changed; reload and retry' using errcode='40001'; end if;
  end if;
  if p_patient_patch <> '{}'::jsonb then
    update public.patients set
      allergies=case when p_patient_patch ? 'allergies' then array(select jsonb_array_elements_text(p_patient_patch->'allergies')) else allergies end,
      medications=case when p_patient_patch ? 'medications' then p_patient_patch->'medications' else medications end,
      diagnoses=case when p_patient_patch ? 'diagnoses' then p_patient_patch->'diagnoses' else diagnoses end,
      clinical_notes=case when p_patient_patch ? 'clinical_notes' then p_patient_patch->>'clinical_notes' else clinical_notes end
      where id=p_patient_id and user_id=p_user_id;
  end if;
  if p_consultation_id is not null and nullif(trim(p_addendum),'') is not null then
    update public.consultations set soap_note=concat_ws(E'\n\n',nullif(soap_note,''),p_addendum), pre_briefing=null
      where id=p_consultation_id and user_id=p_user_id;
  end if;
  return true;
end;
$$;
revoke all on function public.apply_clinical_comment(uuid,uuid,integer,jsonb,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.apply_clinical_comment(uuid,uuid,integer,jsonb,uuid,integer,text) to service_role;
