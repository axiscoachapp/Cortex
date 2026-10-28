-- Additive boundary repair. NOT VALID constraints protect new writes immediately
-- without deleting historic records. Operators must repair rows reported by
-- validate_security_boundaries() before validating the constraints.
CREATE UNIQUE INDEX IF NOT EXISTS patients_id_user_key ON public.patients(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS consultations_id_user_key ON public.consultations(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_id_user_key ON public.knowledge_documents(id, user_id);

ALTER TABLE public.consultations ADD CONSTRAINT consultations_patient_owner_fk
  FOREIGN KEY (patient_id, user_id) REFERENCES public.patients(id, user_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_patient_owner_fk
  FOREIGN KEY (patient_id, user_id) REFERENCES public.patients(id, user_id) ON DELETE SET NULL (patient_id) NOT VALID;
ALTER TABLE public.patient_files ADD CONSTRAINT patient_files_patient_owner_fk
  FOREIGN KEY (patient_id, user_id) REFERENCES public.patients(id, user_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_patient_owner_fk
  FOREIGN KEY (patient_id, user_id) REFERENCES public.patients(id, user_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_consultation_owner_fk
  FOREIGN KEY (consultation_id, user_id) REFERENCES public.consultations(id, user_id) ON DELETE SET NULL (consultation_id) NOT VALID;
ALTER TABLE public.knowledge_chunks ADD CONSTRAINT knowledge_chunks_document_owner_fk
  FOREIGN KEY (document_id, user_id) REFERENCES public.knowledge_documents(id, user_id) ON DELETE CASCADE NOT VALID;

CREATE OR REPLACE FUNCTION public.is_canonical_storage_path(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT length(p_path) BETWEEN 1 AND 1024
    AND p_path !~ '[%\\?#[:cntrl:]]'
    AND p_path !~ '(^/|/$|//|(^|/)\.{1,2}(/|$))';
$$;
ALTER TABLE public.patient_files ADD CONSTRAINT patient_files_owned_path CHECK (
  public.is_canonical_storage_path(storage_path)
  AND starts_with(storage_path, 'patients/' || user_id::text || '/' || patient_id::text || '/')
) NOT VALID;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_owned_path CHECK (
  storage_path = 'rx/' || user_id::text || '/' || id::text || '.pdf'
) NOT VALID;

-- Clients may read prescriptions, but only the generation/signing services
-- control content, storage pointers, access codes and lifecycle metadata.
DROP POLICY IF EXISTS "Users manage own prescriptions" ON public.prescriptions;
CREATE POLICY "Users read own prescriptions" ON public.prescriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.prescriptions FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.revoke_prescription(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.prescriptions SET status = 'revoked'
    WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_prescription(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_prescription(UUID) TO authenticated;

-- Preference updates cannot raise the billing limit or change row ownership.
CREATE OR REPLACE FUNCTION public.update_user_settings(p_patch JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID := auth.uid(); v_template UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Não autorizado' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN (
      'specialty','live_copilot_enabled','doctor_name','crm_number','crm_uf','professional_address','active_template_id'
    )
  ) THEN RAISE EXCEPTION 'Configuração inválida' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_patch) e WHERE
    (e.key IN ('specialty','doctor_name','crm_number','crm_uf','professional_address') AND
      (jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > 1000)) OR
    (e.key = 'live_copilot_enabled' AND jsonb_typeof(e.value) <> 'boolean') OR
    (e.key = 'active_template_id' AND jsonb_typeof(e.value) NOT IN ('string','null'))
  ) THEN RAISE EXCEPTION 'Tipo de configuração inválido' USING ERRCODE='22023'; END IF;
  IF p_patch ? 'active_template_id' THEN
    v_template := (p_patch->>'active_template_id')::uuid;
    IF v_template IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.document_templates WHERE id=v_template AND (user_id IS NULL OR user_id=v_user)
    ) THEN RAISE EXCEPTION 'Modelo não autorizado' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.user_settings(user_id) VALUES(v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_settings SET
    specialty = CASE WHEN p_patch ? 'specialty' THEN p_patch->>'specialty' ELSE specialty END,
    live_copilot_enabled = CASE WHEN p_patch ? 'live_copilot_enabled' THEN (p_patch->>'live_copilot_enabled')::boolean ELSE live_copilot_enabled END,
    doctor_name = CASE WHEN p_patch ? 'doctor_name' THEN trim(p_patch->>'doctor_name') ELSE doctor_name END,
    crm_number = CASE WHEN p_patch ? 'crm_number' THEN trim(p_patch->>'crm_number') ELSE crm_number END,
    crm_uf = CASE WHEN p_patch ? 'crm_uf' THEN upper(trim(p_patch->>'crm_uf')) ELSE crm_uf END,
    professional_address = CASE WHEN p_patch ? 'professional_address' THEN trim(p_patch->>'professional_address') ELSE professional_address END,
    active_template_id = CASE WHEN p_patch ? 'active_template_id' THEN v_template ELSE active_template_id END,
    updated_at = now()
  WHERE user_id=v_user;
END;
$$;
REVOKE ALL ON FUNCTION public.update_user_settings(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_settings(JSONB) TO authenticated;

-- OAuth transactions are only visible to the edge service. DELETE ... RETURNING
-- consumes a transaction atomically; a code cannot be replayed or moved to a user.
CREATE TABLE public.google_oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);
ALTER TABLE public.google_oauth_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_oauth_transactions FROM anon, authenticated;
GRANT ALL ON public.google_oauth_transactions TO service_role;
CREATE OR REPLACE FUNCTION public.consume_google_oauth_transaction(p_state_hash TEXT, p_user_id UUID, p_redirect_uri TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_verifier TEXT;
BEGIN
  DELETE FROM public.google_oauth_transactions
    WHERE state_hash=p_state_hash AND user_id=p_user_id AND redirect_uri=p_redirect_uri AND expires_at > now()
    RETURNING code_verifier INTO v_verifier;
  RETURN v_verifier;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_google_oauth_transaction(TEXT,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_google_oauth_transaction(TEXT,UUID,TEXT) TO service_role;

-- Storage cleanup is a resumable operation. Block new clinical writes/uploads
-- while cleanup is in progress, so a concurrent request cannot recreate files.
ALTER TABLE public.patients ADD COLUMN deletion_requested_at TIMESTAMPTZ;
CREATE TABLE public.account_deletion_requests (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM anon, authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
REVOKE DELETE ON public.patients FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_clinical_write() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,123));
  -- Foreign-key SET NULL actions during auth.users CASCADE must be allowed to
  -- finish; the owning user is already gone within that deletion transaction.
  IF pg_trigger_depth() > 1 AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=NEW.user_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Exclusão de conta em andamento' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='patients' THEN
    IF TG_OP='UPDATE' AND OLD.deletion_requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'Exclusão de paciente em andamento' USING ERRCODE='55000';
    END IF;
    IF NEW.deletion_requested_at IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Não autorizado' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME IN ('consultations','appointments','patient_files','prescriptions','consultation_drafts','clinical_record_revisions') THEN
    IF EXISTS (SELECT 1 FROM public.patients WHERE id=NEW.patient_id AND deletion_requested_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Exclusão de paciente em andamento' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['patients','consultations','appointments','patient_files','prescriptions','user_settings','knowledge_documents','knowledge_chunks','document_templates','user_integrations','google_oauth_transactions'] LOOP
    EXECUTE format('CREATE TRIGGER guard_clinical_write BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_clinical_write()',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.storage_upload_allowed(p_name TEXT, p_bucket TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_parts TEXT[] := string_to_array(p_name,'/'); v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.is_canonical_storage_path(p_name) OR
    EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id=v_user) THEN RETURN false; END IF;
  IF p_bucket='audio-recordings' THEN
    RETURN v_parts[1]='consultations' AND v_parts[2]=v_user::text;
  ELSIF p_bucket='patient-files' THEN
    RETURN v_parts[1]='patients' AND v_parts[2]=v_user::text AND EXISTS (
      SELECT 1 FROM public.patients WHERE id::text=v_parts[3] AND user_id=v_user AND deletion_requested_at IS NULL
    );
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.storage_upload_allowed(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_upload_allowed(TEXT,TEXT) TO authenticated;
CREATE POLICY "Block unsafe uploads and deletion races" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.storage_upload_allowed(name,bucket_id));

-- Read-only operator diagnostic: report, never silently delete incompatible data.
CREATE OR REPLACE FUNCTION public.validate_security_boundaries()
RETURNS TABLE(table_name TEXT, invalid_rows BIGINT) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT 'patient_files', count(*) FROM public.patient_files f WHERE NOT public.is_canonical_storage_path(f.storage_path)
    OR NOT starts_with(f.storage_path,'patients/'||f.user_id::text||'/'||f.patient_id::text||'/')
    OR NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.id=f.patient_id AND p.user_id=f.user_id)
  UNION ALL SELECT 'prescriptions',count(*) FROM public.prescriptions r WHERE r.storage_path <> 'rx/'||r.user_id::text||'/'||r.id::text||'.pdf'
    OR NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.id=r.patient_id AND p.user_id=r.user_id)
    OR (r.consultation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.consultations c WHERE c.id=r.consultation_id AND c.user_id=r.user_id))
  UNION ALL SELECT 'appointments',count(*) FROM public.appointments a WHERE a.patient_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.id=a.patient_id AND p.user_id=a.user_id)
  UNION ALL SELECT 'consultations',count(*) FROM public.consultations c WHERE c.patient_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.id=c.patient_id AND p.user_id=c.user_id)
  UNION ALL SELECT 'knowledge_chunks',count(*) FROM public.knowledge_chunks c
    WHERE NOT EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.id=c.document_id AND d.user_id=c.user_id);
$$;
REVOKE ALL ON FUNCTION public.validate_security_boundaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_security_boundaries() TO service_role;
