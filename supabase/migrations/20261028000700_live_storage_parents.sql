-- A missing deletion marker is not proof that an account still exists.
-- Require live server metadata even for service-role uploads finishing late.
CREATE OR REPLACE FUNCTION public.storage_parent_is_live(p_name TEXT,p_bucket TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_parts TEXT[]:=string_to_array(p_name,'/');
BEGIN
  IF NOT public.is_canonical_storage_path(p_name) OR array_length(v_parts,1)<3
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id::text=v_parts[2])
    OR EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id::text=v_parts[2]) THEN RETURN false; END IF;
  IF p_bucket='patient-files' THEN
    RETURN v_parts[1]='patients' AND array_length(v_parts,1)>=4 AND EXISTS(
      SELECT 1 FROM public.patients p WHERE p.id::text=v_parts[3] AND p.user_id::text=v_parts[2] AND p.deletion_requested_at IS NULL);
  ELSIF p_bucket='audio-recordings' THEN
    RETURN v_parts[1]='consultations' AND EXISTS(
      SELECT 1 FROM public.consultation_drafts d JOIN public.patients p ON p.id=d.patient_id AND p.user_id=d.user_id
      WHERE d.user_id::text=v_parts[2] AND d.audio_storage_path=p_name AND p.deletion_requested_at IS NULL);
  ELSIF p_bucket='prescriptions' THEN
    RETURN v_parts[1]='rx' AND EXISTS(
      SELECT 1 FROM public.prescriptions r JOIN public.patients p ON p.id=r.patient_id AND p.user_id=r.user_id
      WHERE r.user_id::text=v_parts[2] AND r.storage_path=p_name AND p_name='rx/'||r.user_id::text||'/'||r.id::text||'.pdf'
        AND p.deletion_requested_at IS NULL);
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.storage_parent_is_live(TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.storage_upload_allowed(p_name TEXT,p_bucket TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND split_part(p_name,'/',2)=auth.uid()::text
    AND public.storage_parent_is_live(p_name,p_bucket);
$$;

CREATE OR REPLACE FUNCTION public.guard_storage_write() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_parts TEXT[]:=string_to_array(NEW.name,'/');
BEGIN
  IF NEW.bucket_id NOT IN ('patient-files','audio-recordings','prescriptions') THEN RETURN NEW; END IF;
  IF NOT public.is_canonical_storage_path(NEW.name) OR array_length(v_parts,1)<3 THEN
    RAISE EXCEPTION 'Invalid storage path' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_parts[2],123));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id::text=v_parts[2]) OR
    (NEW.bucket_id='patient-files' AND EXISTS(SELECT 1 FROM public.patients WHERE id::text=v_parts[3] AND deletion_requested_at IS NOT NULL)) OR
    (NEW.bucket_id='audio-recordings' AND EXISTS(SELECT 1 FROM public.consultation_drafts d JOIN public.patients p ON p.id=d.patient_id WHERE d.audio_storage_path=NEW.name AND p.deletion_requested_at IS NOT NULL)) OR
    (NEW.bucket_id='prescriptions' AND EXISTS(SELECT 1 FROM public.prescriptions r JOIN public.patients p ON p.id=r.patient_id WHERE r.storage_path=NEW.name AND p.deletion_requested_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Deletion in progress' USING ERRCODE='55000';
  END IF;
  IF NOT public.storage_parent_is_live(NEW.name,NEW.bucket_id) THEN
    RAISE EXCEPTION 'Storage object requires a live owned parent' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Resuming/retrying an owned persisted audio draft requires SELECT and UPDATE
-- for Storage upsert. Both paths retain the exact draft/owner boundary.
CREATE POLICY "Read registered live audio drafts" ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='audio-recordings' AND public.storage_upload_allowed(name,bucket_id));
CREATE POLICY "Retry registered live audio drafts" ON storage.objects FOR UPDATE TO authenticated
  USING(bucket_id='audio-recordings' AND public.storage_upload_allowed(name,bucket_id))
  WITH CHECK(bucket_id='audio-recordings' AND public.storage_upload_allowed(name,bucket_id));
