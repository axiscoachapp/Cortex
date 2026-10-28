-- Unknown demographics and encounter identity are explicit, never inferred.
alter table public.patients alter column age drop not null;
alter table public.patients alter column last_visit drop not null;
alter table public.patients add column if not exists date_of_birth date;
alter table public.patients add constraint patient_birth_date_valid check(date_of_birth is null or date_of_birth <= current_date);

create unique index appointments_patient_owner_id_key on public.appointments(user_id,patient_id,id);
alter table public.consultation_drafts add column if not exists appointment_id uuid;
alter table public.consultations add column if not exists appointment_id uuid;
alter table public.consultations add column if not exists history_proposals jsonb not null default '{}'::jsonb check(jsonb_typeof(history_proposals)='object');
alter table public.consultation_drafts add constraint draft_linked_appointment foreign key(user_id,patient_id,appointment_id)
 references public.appointments(user_id,patient_id,id) on delete set null(appointment_id);
alter table public.consultations add constraint consultation_linked_appointment foreign key(user_id,patient_id,appointment_id)
 references public.appointments(user_id,patient_id,id) on delete set null(appointment_id);

alter table public.patient_files add column if not exists ai_profile_proposal text;
alter table public.patient_files add column if not exists ai_review_receipt jsonb;
alter table public.patient_files add column if not exists ai_review_status text not null default 'pending' check(ai_review_status in ('pending','accepted','rejected'));

-- Analysis produces proposals, never longitudinal facts. The old function
-- signature is kept so a rolling deployment cannot restore silent chart writes.
create or replace function public.save_document_review(p_user_id uuid,p_file_id uuid,p_summary text,p_profile_note text)
returns void language plpgsql security definer set search_path='' as $$
declare v_file public.patient_files;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  select * into v_file from public.patient_files where id=p_file_id and user_id=p_user_id for update;
  if not found or not exists(select 1 from public.patients where id=v_file.patient_id and user_id=p_user_id and deletion_requested_at is null) then
    raise exception 'File not found' using errcode='42501';
  end if;
  if v_file.ai_review_receipt is not null then raise exception 'Reviewed analysis is immutable; use a new document version' using errcode='40001'; end if;
  if length(p_summary)>4000 or length(p_profile_note)>300 then raise exception 'Review too long'; end if;
  update public.patient_files set ai_summary=p_summary,ai_profile_proposal=nullif(trim(p_profile_note),''),ai_review_status='pending'
    where id=p_file_id and user_id=p_user_id;
end;
$$;
revoke all on function public.save_document_review(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_document_review(uuid,uuid,text,text) to service_role;

create or replace function public.review_document_proposal(p_file_id uuid,p_expected_patient_revision integer,p_note text,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_file public.patient_files; v_patient public.patients; v_user uuid:=auth.uid();
begin
  perform public.assert_session_assurance();
  if v_user is null then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,123));
  select * into v_file from public.patient_files where id=p_file_id and user_id=v_user for update;
  if not found or v_file.ai_review_status <> 'pending' then raise exception 'Pending proposal not found' using errcode='40001'; end if;
  select * into v_patient from public.patients where id=v_file.patient_id and user_id=v_user and deletion_requested_at is null for update;
  if not found then raise exception 'Patient not found' using errcode='42501'; end if;
  if v_patient.revision is distinct from p_expected_patient_revision then raise exception 'Chart changed; reload before accepting' using errcode='40001'; end if;
  if p_accept then
    if nullif(trim(p_note),'') is null or length(p_note)>4000 then raise exception 'Review note required'; end if;
    update public.patients set clinical_notes=concat_ws(E'\n',nullif(clinical_notes,''),'[Documento '||v_file.id::text||' — revisão médica] '||trim(p_note)) where id=v_patient.id;
  end if;
  update public.patient_files set ai_review_status=case when p_accept then 'accepted' else 'rejected' end where id=v_file.id;
end;
$$;
revoke all on function public.review_document_proposal(uuid,integer,text,boolean) from public,anon;
grant execute on function public.review_document_proposal(uuid,integer,text,boolean) to authenticated;

alter table public.appointments add column if not exists google_sync_status text not null default 'idle' check(google_sync_status in ('idle','pending','synced','failed'));
alter table public.appointments add column if not exists google_sync_error text;
alter table public.appointments add column if not exists google_sync_revision integer not null default 0;
alter table public.appointments add column if not exists google_sync_claim uuid;
alter table public.appointments add column if not exists google_sync_lease_until timestamptz;

create or replace function public.queue_calendar_sync() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and row(new.title,new.notes,new.start_time,new.end_time,new.status) is distinct from row(old.title,old.notes,old.start_time,old.end_time,old.status) then
  new.google_sync_revision:=old.google_sync_revision+1;
  new.google_sync_status:='pending'; new.google_sync_error:=null;
 end if;
 return new;
end;
$$;
create trigger appointment_sync_queue before update on public.appointments for each row execute function public.queue_calendar_sync();
create or replace function public.claim_calendar_sync(p_user_id uuid,p_appointment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.appointments; v_claim uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.appointments set google_sync_claim=v_claim,google_sync_lease_until=now()+interval '5 minutes',google_sync_status='pending',google_sync_error=null
 where id=p_appointment_id and user_id=p_user_id and (google_sync_lease_until is null or google_sync_lease_until<now()) returning * into v_row;
 if not found then return null; end if;
 return jsonb_build_object('claim',v_claim,'appointment',to_jsonb(v_row));
end;
$$;
create or replace function public.finish_calendar_sync(p_user_id uuid,p_appointment_id uuid,p_claim uuid,p_revision integer,p_status text,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if auth.role() is distinct from 'service_role' or p_status not in ('synced','failed') then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.appointments set google_sync_status=case when google_sync_revision=p_revision then p_status else 'pending' end,
 google_sync_error=case when p_status='failed' then left(p_error,160) else null end,google_sync_claim=null,google_sync_lease_until=null
 where id=p_appointment_id and user_id=p_user_id and google_sync_claim=p_claim;
 get diagnostics changed=row_count;
 return changed=1;
end;
$$;
revoke all on function public.claim_calendar_sync(uuid,uuid),public.finish_calendar_sync(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.claim_calendar_sync(uuid,uuid),public.finish_calendar_sync(uuid,uuid,uuid,integer,text,text) to service_role;

-- Question-aware retrieval scans the authorized chart, then bounds excerpts.
-- Counts expose the scope; absent retrieved evidence never proves chart absence.
create or replace function public.retrieve_patient_context(p_user_id uuid,p_patient_id uuid,p_question text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_query tsquery; v_consultations jsonb; v_documents jsonb; v_consultation_count integer; v_document_count integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
 if not exists(select 1 from public.patients where id=p_patient_id and user_id=p_user_id and deletion_requested_at is null) then raise exception 'Patient not found' using errcode='42501'; end if;
 v_query := websearch_to_tsquery('portuguese',left(coalesce(p_question,''),4000));
 select count(*) into v_consultation_count from public.consultations where patient_id=p_patient_id and user_id=p_user_id;
 select count(*) into v_document_count from public.patient_files where patient_id=p_patient_id and user_id=p_user_id;
 select coalesce(jsonb_agg(to_jsonb(r)-'score'),'[]'::jsonb) into v_consultations from (
  select id,created_at,chief_complaint,left(ts_headline('portuguese',coalesce(soap_note,''),v_query,'MaxWords=400,MinWords=100,MaxFragments=3,StartSel=[,StopSel=]'),5000) as soap_note,
    length(coalesce(soap_note,''))>5000 as truncated,
    ts_rank_cd(to_tsvector('portuguese',coalesce(chief_complaint,'')||' '||coalesce(soap_note,'')),v_query) as score
  from public.consultations where patient_id=p_patient_id and user_id=p_user_id
  order by score desc,created_at desc,id limit 12
 ) r;
 select coalesce(jsonb_agg(to_jsonb(r)-'score'),'[]'::jsonb) into v_documents from (
  select id,created_at,file_name,left(ts_headline('portuguese',coalesce(case when ai_review_status='accepted' then ai_review_receipt->>'note' when ai_review_status='pending' then ai_summary else null end,''),v_query,'MaxWords=200,MinWords=50,MaxFragments=3,StartSel=[,StopSel=]'),2000) as ai_summary,ai_review_status,
    length(coalesce(ai_summary,''))>2000 as truncated,
    ts_rank_cd(to_tsvector('portuguese',file_name||' '||coalesce(case when ai_review_status='accepted' then ai_review_receipt->>'note' when ai_review_status='pending' then ai_summary else null end,'')),v_query) as score
  from public.patient_files where patient_id=p_patient_id and user_id=p_user_id
  order by score desc,created_at desc,id limit 12
 ) r;
 return jsonb_build_object('consultations',v_consultations,'documents',v_documents,'coverage',jsonb_build_object(
  'consultationsTotal',v_consultation_count,'documentsTotal',v_document_count,
  'consultationsRetrieved',jsonb_array_length(v_consultations),'documentsRetrieved',jsonb_array_length(v_documents),'limited',true));
end;
$$;
revoke all on function public.retrieve_patient_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.retrieve_patient_context(uuid,uuid,text) to service_role;
