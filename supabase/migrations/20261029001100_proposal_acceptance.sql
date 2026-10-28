-- A proposal is consumed only by an explicit physician decision. Receipts make
-- a lost-response retry idempotent while rejecting a conflicting second choice.
alter table public.patient_files add column if not exists ai_review_receipt jsonb;

create or replace function public.review_document_proposal(p_file_id uuid,p_expected_patient_revision integer,p_note text,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_file public.patient_files; v_patient public.patients; v_user uuid:=auth.uid(); v_decision jsonb;
begin
 perform public.assert_session_assurance();
 if v_user is null then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_accept is null then raise exception 'Explicit decision required'; end if;
 v_decision:=jsonb_build_object('accepted',p_accept,'note',case when p_accept then trim(p_note) else '' end,'actor',v_user);
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,123));
 select * into v_file from public.patient_files where id=p_file_id and user_id=v_user for update;
 if not found then raise exception 'Proposal not found' using errcode='42501'; end if;
 if v_file.ai_review_receipt is not null then
  if v_file.ai_review_receipt-'reviewedAt'=v_decision then return; end if;
  raise exception 'Proposal already reviewed differently' using errcode='40001';
 end if;
 if v_file.ai_review_status<>'pending' or v_file.ai_summary is null then raise exception 'Pending proposal not found' using errcode='40001'; end if;
 select * into v_patient from public.patients where id=v_file.patient_id and user_id=v_user and deletion_requested_at is null for update;
 if not found then raise exception 'Patient not found' using errcode='42501'; end if;
 if v_patient.revision is distinct from p_expected_patient_revision then raise exception 'Chart changed; reload before accepting' using errcode='40001'; end if;
 if p_accept then
  if nullif(trim(p_note),'') is null or length(p_note)>4000 then raise exception 'Review note required'; end if;
  update public.patients set clinical_notes=concat_ws(E'\n',nullif(clinical_notes,''),'[Documento '||v_file.id::text||' — revisão médica] '||trim(p_note)) where id=v_patient.id;
 end if;
 update public.patient_files set ai_review_status=case when p_accept then 'accepted' else 'rejected' end,ai_review_receipt=v_decision||jsonb_build_object('reviewedAt',now()) where id=v_file.id;
end;
$$;
revoke all on function public.review_document_proposal(uuid,integer,text,boolean) from public,anon;
grant execute on function public.review_document_proposal(uuid,integer,text,boolean) to authenticated;

create or replace function public.review_history_proposal(p_consultation_id uuid,p_expected_patient_revision integer,p_expected_consultation_revision integer,p_medical_history text,p_social_anamnesis text,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_visit public.consultations; v_patient public.patients; v_user uuid:=auth.uid(); v_decision jsonb;
begin
 perform public.assert_session_assurance();
 if v_user is null then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_accept is null then raise exception 'Explicit decision required'; end if;
 v_decision:=jsonb_build_object('accepted',p_accept,'medicalHistory',case when p_accept then trim(coalesce(p_medical_history,'')) else '' end,'socialAnamnesis',case when p_accept then trim(coalesce(p_social_anamnesis,'')) else '' end,'actor',v_user);
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,123));
 select * into v_visit from public.consultations where id=p_consultation_id and user_id=v_user for update;
 if not found then raise exception 'Consultation not found' using errcode='42501'; end if;
 if v_visit.history_proposals ? 'review' then
  if (v_visit.history_proposals->'review')-'reviewedAt'=v_decision then return; end if;
  raise exception 'Proposal already reviewed differently' using errcode='40001';
 end if;
 if v_visit.revision is distinct from p_expected_consultation_revision or v_visit.history_proposals->>'sourceConsultationId' is distinct from v_visit.id::text then
  raise exception 'Source changed; reload before accepting' using errcode='40001';
 end if;
 select * into v_patient from public.patients where id=v_visit.patient_id and user_id=v_user and deletion_requested_at is null for update;
 if not found then raise exception 'Patient not found' using errcode='42501'; end if;
 if v_patient.revision is distinct from p_expected_patient_revision then raise exception 'Chart changed; reload before accepting' using errcode='40001'; end if;
 if p_accept then
  if length(coalesce(p_medical_history,''))>8000 or length(coalesce(p_social_anamnesis,''))>8000 or (nullif(trim(p_medical_history),'') is null and nullif(trim(p_social_anamnesis),'') is null) then raise exception 'Review text required'; end if;
  update public.patients set
   medical_history=case when nullif(trim(p_medical_history),'') is null then medical_history else concat_ws(E'\n',nullif(medical_history,''),'[Consulta '||v_visit.id::text||' — revisão médica] '||trim(p_medical_history)) end,
   social_anamnesis=case when nullif(trim(p_social_anamnesis),'') is null then social_anamnesis else concat_ws(E'\n',nullif(social_anamnesis,''),'[Consulta '||v_visit.id::text||' — revisão médica] '||trim(p_social_anamnesis)) end
   where id=v_patient.id;
 end if;
 update public.consultations set history_proposals=history_proposals||jsonb_build_object('review',v_decision||jsonb_build_object('reviewedAt',now())) where id=v_visit.id;
end;
$$;
revoke all on function public.review_history_proposal(uuid,integer,integer,text,text,boolean) from public,anon;
grant execute on function public.review_history_proposal(uuid,integer,integer,text,text,boolean) to authenticated;
