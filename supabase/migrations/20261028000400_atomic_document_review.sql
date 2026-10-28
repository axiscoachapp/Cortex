-- Append against the latest row under its update lock, never a stale snapshot.
CREATE OR REPLACE FUNCTION public.save_document_review(p_user_id UUID,p_file_id UUID,p_summary TEXT,p_profile_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_file public.patient_files;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  SELECT * INTO v_file FROM public.patient_files WHERE id=p_file_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.patients WHERE id=v_file.patient_id AND user_id=p_user_id AND deletion_requested_at IS NULL) THEN
    RAISE EXCEPTION 'File not found' USING ERRCODE='42501';
  END IF;
  IF length(p_summary)>4000 OR length(p_profile_note)>300 THEN RAISE EXCEPTION 'Review too long'; END IF;
  UPDATE public.patient_files SET ai_summary=p_summary WHERE id=p_file_id AND user_id=p_user_id;
  IF nullif(trim(p_profile_note),'') IS NOT NULL THEN
    UPDATE public.patients SET clinical_notes=concat_ws(E'\n',nullif(clinical_notes,''),
      '['||to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||'] 📎 '||v_file.file_name||': '||p_profile_note)
      WHERE id=v_file.patient_id AND user_id=p_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_document_review(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_document_review(UUID,UUID,TEXT,TEXT) TO service_role;
