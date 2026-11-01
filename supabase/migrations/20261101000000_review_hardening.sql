-- Fixes from the 2026-10-29 independent review (database layer).
-- Every statement is idempotent so the migration can be re-applied safely.

------------------------------------------------------------------------------
-- 1. Service-only SECURITY DEFINER functions were executable by anon and
--    authenticated. On Supabase, `REVOKE ... FROM PUBLIC` is not enough: the
--    public schema's default privileges grant EXECUTE directly to both roles.
--    These functions trust a p_user_id argument, so anyone with the public anon
--    key could exhaust another doctor's AI quota or probe deletion scopes.
------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_usage(uuid, numeric); -- dead code (edge uses reserve/settle)

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.reserve_usage(uuid,numeric,uuid)',
    'public.settle_usage(uuid,uuid,numeric)',
    'public.consume_google_oauth_transaction(text,uuid,text)',
    'public.validate_security_boundaries()',
    'public.assert_deletion_scope_legacy(uuid,uuid)',
    'public.has_foreign_deletion_children(text,uuid,uuid)',
    'public.storage_parent_is_live(text,text)',
    'public.storage_parent_is_live_before_discard(text,text)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
  -- Client RPCs that check auth.uid() internally: authenticated only, never anon.
  FOREACH fn IN ARRAY ARRAY[
    'public.get_integration_status(uuid)',
    'public.revoke_prescription(uuid)',
    'public.update_user_settings(jsonb)',
    'public.storage_upload_allowed(text,text)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
    END IF;
  END LOOP;
END $$;

------------------------------------------------------------------------------
-- 2. Medical records must be retained (CFM 1.821/2007, Lei 13.787/2018):
--    patients are archived instead of deleted, and clients can no longer
--    hard-delete patients or consultations through the REST API. Permanent
--    deletion (only for charts without clinical records) goes through the
--    delete-patient Edge Function, which runs as service_role.
------------------------------------------------------------------------------
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS archived_at timestamptz;
REVOKE DELETE ON public.patients FROM anon, authenticated;
REVOKE DELETE ON public.consultations FROM anon, authenticated;

------------------------------------------------------------------------------
-- 3. Directory excludes archived patients.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_directory(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; begin
 perform public.assert_session_assurance();
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 with owned as materialized (
   select id,name,age,date_of_birth,profession,last_visit,status,revision,phone,email from public.patients
   where user_id=auth.uid() and deletion_requested_at is null and archived_at is null
 ), chosen as (
   (select id from owned order by name,id limit greatest(1,least(p_limit,200)))
   union (select id from owned order by last_visit desc nulls last,id limit 5)
   union (select id from owned where status='retorno' order by last_visit asc nulls last,id limit 4)
   union (select distinct p.id from owned p join public.appointments a on a.patient_id=p.id and a.user_id=auth.uid()
      where (a.start_time at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date order by p.id limit 200)
 )
 select jsonb_build_object('patients',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from owned p join chosen c using(id)),'[]'::jsonb),
   'counts',jsonb_build_object('total',(select count(*) from owned),'new',(select count(*) from owned where status='novo'),'returns',(select count(*) from owned where status='retorno')))
 into result;
 return result;
end $function$;

------------------------------------------------------------------------------
-- 4. Medication reconciliation matched by name and silently dropped other
--    entries with the same name (e.g. split insulin regimens). Refuse instead.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_medication_reconciliation(p_item_id uuid, p_item_revision integer, p_patient_revision integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item public.clinical_work_items; patient public.patients; entry jsonb; updated_entry jsonb;
 result jsonb:='[]'::jsonb; matched boolean:=false; key text; state text; effective_date text;
begin
 perform public.assert_session_assurance();
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_item_revision is null or p_patient_revision is null then raise exception 'Review revisions required' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,123));
 select * into item from public.clinical_work_items where id=p_item_id and user_id=auth.uid() and kind='medication' for update;
 if not found then raise exception 'Medication entry unavailable' using errcode='42501'; end if;
 select * into patient from public.patients where id=item.patient_id and user_id=auth.uid() and deletion_requested_at is null for update;
 if not found or exists(select 1 from public.account_deletion_requests where user_id=auth.uid()) then raise exception 'Patient unavailable' using errcode='42501'; end if;
 if item.status='approved' and item.details ? 'reconciledAt' then return true; end if;
 if item.revision is distinct from p_item_revision or patient.revision is distinct from p_patient_revision then raise exception 'Clinical source changed; compare before approval' using errcode='40001'; end if;
 if item.status<>'open' or jsonb_typeof(patient.medications) is distinct from 'array' then raise exception 'Medication list unavailable'; end if;
 key:=lower(trim(item.title)); state:=item.details->>'state'; effective_date:=item.details->>'date';
 if key='' or state not in ('active','changed','stopped') or nullif(trim(item.content),'') is null or (state<>'stopped' and nullif(trim(item.details->>'dosage'),'') is null) then raise exception 'Review name, dose, instructions and state'; end if;
 if (select count(*) from jsonb_array_elements(patient.medications) e where lower(trim(e->>'name'))=key) > 1 then
   raise exception 'Há mais de uma entrada com o nome "%" na lista de medicamentos (por exemplo, doses diferentes). Ajuste a lista no perfil do paciente antes de aprovar, para que nenhuma dose seja removida.', trim(item.title) using errcode='22023';
 end if;
 for entry in select value from jsonb_array_elements(patient.medications) loop
  if lower(trim(entry->>'name'))=key then
   if state<>'stopped' and not matched then
    updated_entry:=entry||jsonb_build_object('name',trim(item.title),'dosage',trim(item.details->>'dosage'),'instructions',item.content,
      'startedAt',coalesce(nullif(entry->>'startedAt',''),effective_date),'sourceRecordId',item.id,'lastReconciledAt',now());
    result:=result||jsonb_build_array(updated_entry);
   end if;
   matched:=true;
  else result:=result||jsonb_build_array(entry); end if;
 end loop;
 if not matched and state<>'stopped' then
  result:=result||jsonb_build_array(jsonb_build_object('name',trim(item.title),'dosage',trim(item.details->>'dosage'),'instructions',item.content,'startedAt',effective_date,'sourceRecordId',item.id,'lastReconciledAt',now()));
 end if;
 update public.patients set medications=result where id=patient.id;
 update public.clinical_work_items set status='approved',details=details||jsonb_build_object('reconciledAt',now(),'reconciledBy',auth.uid(),'patientRevisionBefore',patient.revision) where id=item.id;
 return true;
end;
$function$;

------------------------------------------------------------------------------
-- 5. Manual encounters set status 'seguimento' while AI encounters set
--    'retorno', so the returns dashboard missed every manual visit, and
--    last_visit could move backwards. Use the same rule as
--    complete_consultation_metadata.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_manual_encounter(p_item_id uuid, p_revision integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare item public.clinical_work_items; encounter_id uuid; appointment uuid; patient public.patients; next_status text;
begin
  perform public.assert_session_assurance();
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,123));
  select * into item from public.clinical_work_items where id=p_item_id and user_id=auth.uid() for update;
  if not found or item.kind<>'draft' then raise exception 'Draft unavailable'; end if;
  select * into patient from public.patients where id=item.patient_id and user_id=auth.uid() and deletion_requested_at is null for update;
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
    if not found then appointment:=null; end if; -- already completed/cancelled: save the note anyway
  end if;
  insert into public.consultations(user_id,patient_id,chief_complaint,soap_note,transcription,appointment_id)
    values(auth.uid(),item.patient_id,item.title,item.content,'',appointment) returning id into encounter_id;
  next_status:=case when exists(select 1 from public.consultation_drafts where patient_id=item.patient_id and user_id=auth.uid())
                      or exists(select 1 from public.clinical_work_items w where w.patient_id=item.patient_id and w.user_id=auth.uid()
                                and w.kind='draft' and w.status='draft' and w.id<>item.id)
                    then patient.status else 'retorno' end;
  update public.patients set last_visit=greatest(patient.last_visit,(now() at time zone 'America/Sao_Paulo')::date),status=next_status
    where id=item.patient_id and user_id=auth.uid();
  if appointment is not null then update public.appointments set status='realizado' where id=appointment and user_id=auth.uid(); end if;
  update public.clinical_work_items set status='done',details=details||jsonb_build_object('consultationId',encounter_id,'approvedAt',now()) where id=item.id;
  return encounter_id;
end $function$;

------------------------------------------------------------------------------
-- 6. Clinic membership and shares.
--    a) Invitations only resolve accounts whose email was confirmed.
--    b) Re-granting a share refreshes its clinic (was kept stale after a
--       clinic change, so the grant looked active but gave no access).
--    c) Members can leave a clinic (previously impossible, which trapped a
--       doctor who accepted the wrong/look-alike clinic).
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_clinic_doctor(p_clinic_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=public.sharing_actor(); v_user uuid;
begin
  if not exists(select 1 from public.clinic_members where clinic_id=p_clinic_id and user_id=v_actor and role='admin' and status='active') then raise exception 'Not authorized' using errcode='42501'; end if;
  select id into v_user from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if v_user is null then raise exception 'Nenhuma conta confirmada com este e-mail. O médico precisa ter uma conta ativa antes de receber o convite.' using errcode='22023'; end if;
  if v_user=v_actor then raise exception 'Você já participa desta clínica' using errcode='22023'; end if;
  insert into public.clinic_members(clinic_id,user_id,role,status) values(p_clinic_id,v_user,'doctor','invited')
  on conflict(clinic_id,user_id) do update set status=case when public.clinic_members.status='active' then 'active' else 'invited' end,updated_at=now();
  insert into public.chart_access_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic_id,v_actor,'member_invited',v_user);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.grant_patient_share(p_patient_id uuid, p_recipient_user_id uuid, p_permission text, p_allow_download boolean DEFAULT false, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=public.sharing_actor(); v_clinic uuid; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,123));
  if p_permission not in ('read','contribute') or p_recipient_user_id=v_actor or (p_expires_at is not null and p_expires_at<=now()) then raise exception 'Permissão ou validade inválida' using errcode='22023'; end if;
  perform 1 from public.patients where id=p_patient_id and user_id=v_actor and deletion_requested_at is null for update;
  if not found then raise exception 'Patient unavailable' using errcode='42501'; end if;
  select a.clinic_id into v_clinic from public.clinic_members a join public.clinic_members b on b.clinic_id=a.clinic_id where a.user_id=v_actor and b.user_id=p_recipient_user_id and a.status='active' and b.status='active' limit 1 for share of a,b;
  if v_clinic is null then raise exception 'Ambos os médicos precisam estar ativos na mesma clínica' using errcode='42501'; end if;
  insert into public.patient_shares(patient_id,owner_user_id,recipient_user_id,clinic_id,permission,allow_download,expires_at)
  values(p_patient_id,v_actor,p_recipient_user_id,v_clinic,p_permission,coalesce(p_allow_download,false),p_expires_at)
  on conflict(patient_id,recipient_user_id) do update set clinic_id=excluded.clinic_id,permission=excluded.permission,allow_download=excluded.allow_download,expires_at=excluded.expires_at,revoked_at=null,revision=public.patient_shares.revision+1,updated_at=now() returning id into v_id;
  insert into public.chart_access_audit(patient_id,owner_user_id,actor_user_id,action,resource_id) values(p_patient_id,v_actor,v_actor,'share_granted',v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.grant_protocol_share(p_document_id uuid, p_recipient_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=public.sharing_actor(); v_clinic uuid; v_id uuid;
begin
  if p_recipient_user_id=v_actor or p_recipient_user_id is null then raise exception 'Selecione outro médico' using errcode='22023'; end if;
  perform 1 from public.knowledge_documents where id=p_document_id and user_id=v_actor and review_status='approved' and status='ready' and source_text is not null for update;
  if not found then raise exception 'A fonte precisa estar revisada e indexada antes de compartilhar' using errcode='42501'; end if;
  select o.clinic_id into v_clinic from public.clinic_members o join public.clinic_members r on r.clinic_id=o.clinic_id
    where o.user_id=v_actor and r.user_id=p_recipient_user_id and o.status='active' and r.status='active' limit 1 for share of o,r;
  if v_clinic is null then raise exception 'Ambos os médicos precisam estar ativos na mesma clínica' using errcode='42501'; end if;
  insert into public.protocol_shares(document_id,owner_user_id,recipient_user_id,clinic_id) values(p_document_id,v_actor,p_recipient_user_id,v_clinic)
    on conflict(document_id,recipient_user_id) do update set clinic_id=excluded.clinic_id,revoked_at=null,revision=public.protocol_shares.revision+1,updated_at=now() returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.leave_clinic(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=public.sharing_actor(); v_member public.clinic_members;
begin
  select * into v_member from public.clinic_members where clinic_id=p_clinic_id and user_id=v_actor and status in ('active','invited') for update;
  if not found then raise exception 'Você não participa desta clínica' using errcode='42501'; end if;
  if v_member.role='admin' and v_member.status='active' and not exists(
    select 1 from public.clinic_members where clinic_id=p_clinic_id and user_id<>v_actor and role='admin' and status='active') then
    raise exception 'Você é o único administrador. Promova outro administrador antes de sair.' using errcode='22023';
  end if;
  update public.clinic_members set status='inactive',updated_at=now() where clinic_id=p_clinic_id and user_id=v_actor;
  -- Same effect as offboarding: shares to/from this doctor in this clinic stop.
  update public.patient_shares set revoked_at=now(),revision=revision+1,updated_at=now()
    where clinic_id=p_clinic_id and (recipient_user_id=v_actor or owner_user_id=v_actor) and revoked_at is null;
  update public.protocol_shares set revoked_at=now(),revision=revision+1,updated_at=now()
    where clinic_id=p_clinic_id and (recipient_user_id=v_actor or owner_user_id=v_actor) and revoked_at is null;
  insert into public.chart_access_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic_id,v_actor,'member_left',v_actor);
  return true;
end $function$;
REVOKE ALL ON FUNCTION public.leave_clinic(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_clinic(uuid) TO authenticated;

------------------------------------------------------------------------------
-- 7. Knowledge sources.
--    a) A superseded version can no longer be re-approved (two versions of
--       the same protocol ended up in AI retrieval).
--    b) The latest version of an owned source can be deleted again (the
--       2026-10-29 revoke made accidental PHI uploads permanent).
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_knowledge_source(p_document_id uuid, p_approve boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_doc public.knowledge_documents; v_name text;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public.assert_session_assurance();
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,123));
  if exists(select 1 from public.account_deletion_requests where user_id=v_actor) then raise exception 'Account unavailable' using errcode='42501'; end if;
  select * into v_doc from public.knowledge_documents where id=p_document_id and user_id=v_actor for update;
  if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
  if p_approve is null then raise exception 'Review decision required' using errcode='22023'; end if;
  if p_approve and exists(select 1 from public.knowledge_documents s where s.supersedes_document_id=p_document_id) then
    raise exception 'Esta versão foi substituída por uma versão mais recente e não pode voltar a ser usada.' using errcode='22023';
  end if;
  if p_approve and (v_doc.source_text is null or length(v_doc.source_text)<20 or nullif(trim(v_doc.source_reference),'') is null or nullif(trim(v_doc.source_version),'') is null) then raise exception 'O original desta fonte não foi preservado. Crie uma nova versão com o texto original antes de aprovar.' using errcode='22023'; end if;
  select coalesce(nullif(s.doctor_name,''),u.email,'Médico') into v_name from auth.users u left join public.user_settings s on s.user_id=u.id where u.id=v_actor;
  update public.knowledge_documents set review_status=case when p_approve then 'approved' else 'retired' end,reviewed_at=now(),reviewed_by=v_actor,reviewer_name=v_name where id=p_document_id;
  insert into public.knowledge_review_events(document_id,user_id,actor_user_id,actor_name,action) values(p_document_id,v_actor,v_actor,v_name,case when p_approve then 'approved' else 'retired' end);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_knowledge_source(p_document_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public.assert_session_assurance();
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,123));
  perform 1 from public.knowledge_documents where id=p_document_id and user_id=v_actor for update;
  if not found then raise exception 'Fonte indisponível' using errcode='42501'; end if;
  if exists(select 1 from public.knowledge_documents where supersedes_document_id=p_document_id) then
    raise exception 'Exclua primeiro a versão mais recente desta fonte.' using errcode='22023';
  end if;
  delete from public.protocol_shares where document_id=p_document_id;
  delete from public.knowledge_documents where id=p_document_id and user_id=v_actor;
  return true;
end $function$;
REVOKE ALL ON FUNCTION public.delete_knowledge_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_knowledge_source(uuid) TO authenticated;

------------------------------------------------------------------------------
-- 8. Indexes for tenant columns used by RLS predicates, list views and the
--    deletion preflight. Vector index: HNSW instead of an IVFFlat built on an
--    empty table (lists=100, probes=1 gave poor recall).
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_patients_user_name ON public.patients (user_id, name) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patients_user ON public.patients (user_id);
CREATE INDEX IF NOT EXISTS idx_consultations_user_created ON public.consultations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_revisions_patient ON public.clinical_record_revisions (patient_id);
CREATE INDEX IF NOT EXISTS idx_work_revisions_item ON public.clinical_work_revisions (user_id, item_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_usage_reservations_open ON public.usage_reservations (created_at) WHERE NOT settled;
CREATE INDEX IF NOT EXISTS idx_patient_shares_owner ON public.patient_shares (owner_user_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments (patient_id);
DROP INDEX IF EXISTS public.idx_knowledge_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops);

------------------------------------------------------------------------------
-- 9. Evaluate session_assurance_ok() once per statement (initplan) instead of
--    once per row in every restrictive policy.
------------------------------------------------------------------------------
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
           WHERE schemaname='public' AND policyname='session_assurance' LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I %s %s', p.policyname, p.schemaname, p.tablename,
      CASE WHEN p.qual IS NOT NULL THEN 'USING ((SELECT public.session_assurance_ok()))' ELSE '' END,
      CASE WHEN p.with_check IS NOT NULL THEN 'WITH CHECK ((SELECT public.session_assurance_ok()))' ELSE '' END);
  END LOOP;
END $$;

------------------------------------------------------------------------------
-- 10. Validate the tenant/path constraints that were added NOT VALID (the
--     diagnostic reports zero violations). A violation is reported, not fatal.
------------------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
           WHERE NOT convalidated AND connamespace='public'::regnamespace LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Constraint %.% not validated: %', c.tbl, c.conname, SQLERRM;
    END;
  END LOOP;
END $$;

------------------------------------------------------------------------------
-- 11. Scheduled housekeeping (pg_cron).
--     a) Full-account export snapshots (complete PHI copies) were kept past
--        their 1-hour expiry because the daily purge was never scheduled.
--     b) Reservations left unsettled by a crashed function blocked the
--        doctor's AI quota until the next day. After 10 minutes (well past
--        the 150 s function limit) they are released at zero cost.
------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('purge-expired-export-snapshots', '*/30 * * * *',
      $job$DELETE FROM public.data_export_snapshots WHERE expires_at < now()$job$);
    PERFORM cron.schedule('release-stale-usage-reservations', '*/5 * * * *', $job$
      WITH stale AS (
        UPDATE public.usage_reservations SET settled = true, actual = 0
        WHERE NOT settled AND created_at < now() - interval '10 minutes'
        RETURNING user_id, day, reserved
      )
      UPDATE public.usage_daily u
      SET credits_reserved = greatest(0, u.credits_reserved - s.total), updated_at = now()
      FROM (SELECT user_id, day, sum(reserved) AS total FROM stale GROUP BY 1, 2) s
      WHERE u.user_id = s.user_id AND u.day = s.day
    $job$);
  END IF;
END $$;

------------------------------------------------------------------------------
-- 12. Caching the pre-consultation summary (consultations.pre_briefing) is not
--     a clinical change: it no longer snapshots the record, bumps its
--     revision, or invalidates a SOAP edit that is in progress. A no-op update
--     no longer creates a revision either.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_clinical_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (to_jsonb(new) - array['pre_briefing','updated_at']) = (to_jsonb(old) - array['pre_briefing','updated_at']) then
    return new;
  end if;
  insert into public.clinical_record_revisions(user_id,patient_id,record_id,record_type,revision,snapshot)
  values(old.user_id,case when tg_table_name='patients' then old.id else (to_jsonb(old)->>'patient_id')::uuid end,old.id,tg_table_name,old.revision,to_jsonb(old));
  new.revision := old.revision + 1;
  return new;
end;
$function$;

------------------------------------------------------------------------------
-- 13. Patient consent to audio recording and the consultation modality
--     (presencial / online), confirmed by the doctor before capture and kept
--     with the record (LGPD art. 11; CFM 2.314/2022 for teleconsultations).
------------------------------------------------------------------------------
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS recording_consent jsonb;
COMMENT ON COLUMN public.consultations.recording_consent IS
  'Doctor-confirmed patient consent to recording: {"mode":"presencial"|"online","consentedAt":ISO-8601}. Null when nothing was recorded.';
