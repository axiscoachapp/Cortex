-- Serialize deletion intent with writes, including service-role storage writes
-- (storage RLS alone cannot constrain a service-role upload).
CREATE OR REPLACE FUNCTION public.lock_account_deletion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,123));
  RETURN NEW;
END;
$$;
CREATE TRIGGER lock_account_deletion BEFORE INSERT OR UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.lock_account_deletion();

CREATE OR REPLACE FUNCTION public.guard_storage_write() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_parts TEXT[] := string_to_array(NEW.name,'/');
BEGIN
  IF NEW.bucket_id NOT IN ('patient-files','audio-recordings','prescriptions') THEN RETURN NEW; END IF;
  IF NOT public.is_canonical_storage_path(NEW.name) OR array_length(v_parts,1)<3 THEN
    RAISE EXCEPTION 'Invalid storage path' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_parts[2],123));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id::text=v_parts[2]) THEN
    RAISE EXCEPTION 'Account deletion in progress' USING ERRCODE='55000';
  END IF;
  IF NEW.bucket_id='patient-files' AND EXISTS(
    SELECT 1 FROM public.patients WHERE id::text=v_parts[3] AND deletion_requested_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Patient deletion in progress' USING ERRCODE='55000'; END IF;
  IF NEW.bucket_id='audio-recordings' AND EXISTS(
    SELECT 1 FROM public.consultation_drafts d JOIN public.patients p ON p.id=d.patient_id
      WHERE d.audio_storage_path=NEW.name AND p.deletion_requested_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Patient deletion in progress' USING ERRCODE='55000'; END IF;
  IF NEW.bucket_id='prescriptions' AND EXISTS(
    SELECT 1 FROM public.prescriptions r JOIN public.patients p ON p.id=r.patient_id
      WHERE r.storage_path=NEW.name AND p.deletion_requested_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Patient deletion in progress' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_storage_write BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.guard_storage_write();
-- Clinical drafts were introduced after the base security migration.
CREATE TRIGGER guard_clinical_write BEFORE INSERT OR UPDATE ON public.consultation_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_clinical_write();
CREATE TRIGGER guard_clinical_write BEFORE INSERT OR UPDATE ON public.clinical_record_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_clinical_write();
ALTER TABLE public.consultation_drafts ADD CONSTRAINT draft_patient_owner_fk
  FOREIGN KEY(patient_id,user_id) REFERENCES public.patients(id,user_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.consultation_drafts ADD CONSTRAINT draft_audio_owned_path CHECK(
  audio_storage_path IS NULL OR (public.is_canonical_storage_path(audio_storage_path)
    AND starts_with(audio_storage_path,'consultations/'||user_id::text||'/'))
) NOT VALID;
