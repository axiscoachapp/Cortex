-- NOT VALID tenant FKs preserve historical data. Before deleting any parent,
-- refuse cascades/SET NULL actions that would modify a different owner's row.
CREATE OR REPLACE FUNCTION public.has_foreign_deletion_children(p_table TEXT,p_id UUID,p_owner UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE p_table
    WHEN 'patients' THEN
      EXISTS(SELECT 1 FROM public.consultations WHERE patient_id=p_id AND user_id IS DISTINCT FROM p_owner) OR
      EXISTS(SELECT 1 FROM public.appointments WHERE patient_id=p_id AND user_id IS DISTINCT FROM p_owner) OR
      EXISTS(SELECT 1 FROM public.patient_files WHERE patient_id=p_id AND user_id IS DISTINCT FROM p_owner) OR
      EXISTS(SELECT 1 FROM public.prescriptions WHERE patient_id=p_id AND user_id IS DISTINCT FROM p_owner) OR
      EXISTS(SELECT 1 FROM public.consultation_drafts WHERE patient_id=p_id AND user_id IS DISTINCT FROM p_owner) OR
      EXISTS(SELECT 1 FROM public.clinical_record_revisions WHERE patient_id=p_id AND user_id IS DISTINCT FROM p_owner)
    WHEN 'consultations' THEN
      EXISTS(SELECT 1 FROM public.prescriptions WHERE consultation_id=p_id AND user_id IS DISTINCT FROM p_owner)
    WHEN 'knowledge_documents' THEN
      EXISTS(SELECT 1 FROM public.knowledge_chunks WHERE document_id=p_id AND user_id IS DISTINCT FROM p_owner)
    WHEN 'document_templates' THEN
      p_owner IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_settings WHERE active_template_id=p_id AND user_id IS DISTINCT FROM p_owner)
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.has_foreign_deletion_children(TEXT,UUID,UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_deletion_scope(p_user_id UUID,p_patient_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Missing deletion owner' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  IF EXISTS(SELECT 1 FROM public.patients p WHERE p.user_id=p_user_id
      AND (p_patient_id IS NULL OR p.id=p_patient_id)
      AND public.has_foreign_deletion_children('patients',p.id,p_user_id))
    OR EXISTS(SELECT 1 FROM public.consultations c WHERE c.user_id=p_user_id
      AND (p_patient_id IS NULL OR c.patient_id=p_patient_id)
      AND public.has_foreign_deletion_children('consultations',c.id,p_user_id))
    OR (p_patient_id IS NULL AND (
      EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.user_id=p_user_id
        AND public.has_foreign_deletion_children('knowledge_documents',d.id,p_user_id)) OR
      EXISTS(SELECT 1 FROM public.document_templates t WHERE t.user_id=p_user_id
        AND public.has_foreign_deletion_children('document_templates',t.id,p_user_id))
    )) THEN
    RAISE EXCEPTION 'Historical ownership inconsistency requires operator remediation before deletion' USING ERRCODE='P4090';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_deletion_scope(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_deletion_scope(UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_parent_deletion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner UUID;
BEGIN
  IF TG_TABLE_SCHEMA='auth' AND TG_TABLE_NAME='users' THEN
    PERFORM public.assert_deletion_scope(OLD.id,NULL);
  ELSE
    v_owner := OLD.user_id;
    IF v_owner IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text,123)); END IF;
    IF TG_TABLE_NAME='patients' THEN
      PERFORM public.assert_deletion_scope(v_owner,OLD.id);
    ELSIF public.has_foreign_deletion_children(TG_TABLE_NAME,OLD.id,v_owner) THEN
      RAISE EXCEPTION 'Historical ownership inconsistency requires operator remediation before deletion' USING ERRCODE='P4090';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_parent_deletion() FROM PUBLIC;
CREATE TRIGGER guard_parent_deletion BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.guard_parent_deletion();
CREATE TRIGGER guard_parent_deletion BEFORE DELETE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.guard_parent_deletion();
CREATE TRIGGER guard_parent_deletion BEFORE DELETE ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.guard_parent_deletion();
CREATE TRIGGER guard_parent_deletion BEFORE DELETE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.guard_parent_deletion();
CREATE TRIGGER guard_parent_deletion BEFORE DELETE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION public.guard_parent_deletion();
