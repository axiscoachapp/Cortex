-- Storage obligations remain attached to their patient until confirmed cleanup.
ALTER TABLE public.consultation_drafts ADD COLUMN discard_requested_at timestamptz;
REVOKE DELETE ON public.consultation_drafts FROM authenticated;
CREATE FUNCTION public.guard_draft_discard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.discard_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'Draft discard in progress' USING ERRCODE='55000';
  END IF;
  IF NEW.discard_requested_at IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_draft_discard BEFORE INSERT OR UPDATE ON public.consultation_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_draft_discard();

CREATE FUNCTION public.begin_consultation_discard(p_user_id uuid,p_draft_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.consultation_drafts%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  SELECT * INTO d FROM public.consultation_drafts WHERE id=p_draft_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF d.discard_requested_at IS NULL THEN
    UPDATE public.consultation_drafts SET discard_requested_at=now() WHERE id=d.id;
  END IF;
  RETURN jsonb_build_object('id',d.id,'patient_id',d.patient_id,'audio_storage_path',d.audio_storage_path);
END $$;
REVOKE ALL ON FUNCTION public.begin_consultation_discard(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_consultation_discard(uuid,uuid) TO service_role;

ALTER FUNCTION public.storage_parent_is_live(text,text) RENAME TO storage_parent_is_live_before_discard;
CREATE FUNCTION public.storage_parent_is_live(p_name text,p_bucket text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.storage_parent_is_live_before_discard(p_name,p_bucket)
    AND NOT (p_bucket='audio-recordings' AND EXISTS(
      SELECT 1 FROM public.consultation_drafts WHERE audio_storage_path=p_name AND discard_requested_at IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION public.storage_parent_is_live(text,text) FROM PUBLIC;

ALTER TABLE public.prescriptions ADD COLUMN issuance_snapshot jsonb;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescription_snapshot_shape CHECK(issuance_snapshot IS NULL OR
  (jsonb_typeof(issuance_snapshot)='object' AND issuance_snapshot ?& ARRAY['prescriber','patient','pdf_sha256','template_version','issued_at']));
CREATE FUNCTION public.guard_issuance_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.issuance_snapshot IS NOT NULL AND NEW.issuance_snapshot IS DISTINCT FROM OLD.issuance_snapshot THEN
    RAISE EXCEPTION 'Issuance snapshot is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_issuance_snapshot BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_issuance_snapshot();

CREATE TABLE public.provider_file_cleanup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK(provider='gemini'),
  file_name text NOT NULL CHECK(file_name ~ '^files/[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,provider,file_name),
  FOREIGN KEY(patient_id,user_id) REFERENCES public.patients(id,user_id) ON DELETE RESTRICT
);
ALTER TABLE public.provider_file_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_file_cleanup FROM anon,authenticated;
GRANT ALL ON public.provider_file_cleanup TO service_role;

-- Register the upload before contacting the provider. An interrupted upload
-- with no returned file ID must not race a successful account/patient deletion.
CREATE TABLE public.provider_upload_leases (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(patient_id,user_id) REFERENCES public.patients(id,user_id) ON DELETE RESTRICT
);
ALTER TABLE public.provider_upload_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_upload_leases FROM anon,authenticated;
GRANT ALL ON public.provider_upload_leases TO service_role;
CREATE FUNCTION public.guard_provider_upload_lease() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,123));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id=NEW.user_id) OR
    NOT EXISTS(SELECT 1 FROM public.patients WHERE id=NEW.patient_id AND user_id=NEW.user_id AND deletion_requested_at IS NULL) THEN
    RAISE EXCEPTION 'Deletion in progress' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_provider_upload_lease BEFORE INSERT OR UPDATE ON public.provider_upload_leases
  FOR EACH ROW EXECUTE FUNCTION public.guard_provider_upload_lease();

CREATE TABLE public.data_export_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour'
);
ALTER TABLE public.data_export_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_export_snapshots FROM anon,authenticated;
GRANT ALL ON public.data_export_snapshots TO service_role;
CREATE FUNCTION public.purge_patient_export_snapshots() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
  IF TG_OP='DELETE' OR NEW.deletion_requested_at IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text,123));
    DELETE FROM public.data_export_snapshots WHERE user_id=v_user;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purge_export_snapshots_on_intent BEFORE UPDATE OF deletion_requested_at ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.purge_patient_export_snapshots();
CREATE TRIGGER purge_export_snapshots_on_delete AFTER DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.purge_patient_export_snapshots();

-- STABLE fixes one MVCC snapshot for all reads inside the invoking statement.
CREATE FUNCTION public.build_data_export_manifest(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t text; rows jsonb; tables jsonb:='{}'; files jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  FOREACH t IN ARRAY ARRAY['patients','consultations','appointments','patient_files','prescriptions','user_settings',
    'usage_daily','document_templates','knowledge_documents','knowledge_chunks','consultation_drafts',
    'clinical_record_revisions','usage_reservations','account_deletion_requests','clinical_work_items','clinical_work_revisions','knowledge_review_events',
    'provider_file_cleanup','provider_upload_leases','operation_rate_windows','clinic_members'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT coalesce(jsonb_agg(v ORDER BY v::text),''[]''::jsonb) FROM (SELECT to_jsonb(r) v FROM public.%I r WHERE user_id=$1) s',t)
        INTO rows USING p_user_id;
      tables:=tables||jsonb_build_object(t,rows);
    END IF;
  END LOOP;
  IF to_regclass('public.clinics') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),''[]''::jsonb) FROM public.clinics c WHERE created_by=$1'
      INTO rows USING p_user_id;
    tables:=tables||jsonb_build_object('clinics',rows);
  END IF;
  -- Owned shared charts include attributed contributions. Being a recipient or
  -- author never grants whole-chart export of another doctor's patient.
  FOREACH t IN ARRAY ARRAY['patient_shares','shared_chart_entries','chart_access_audit','protocol_shares'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT coalesce(jsonb_agg(v ORDER BY v::text),''[]''::jsonb) FROM (SELECT to_jsonb(r) v FROM public.%I r WHERE owner_user_id=$1) s',t)
        INTO rows USING p_user_id;
      tables:=tables||jsonb_build_object(t,rows);
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.bucket,s.path),'[]') INTO files FROM (
    SELECT o.bucket_id bucket,o.name path,split_part(o.name,'/',array_length(string_to_array(o.name,'/'),1)) name,
      (to_jsonb(o)->'metadata'->>'size')::bigint size,md5(to_jsonb(o)::text) "objectVersion"
    FROM storage.objects o WHERE
      (o.bucket_id='patient-files' AND starts_with(o.name,'patients/'||p_user_id::text||'/')) OR
      (o.bucket_id='audio-recordings' AND starts_with(o.name,'consultations/'||p_user_id::text||'/')) OR
      (o.bucket_id='prescriptions' AND starts_with(o.name,'rx/'||p_user_id::text||'/'))
  ) s;
  SELECT coalesce(jsonb_agg(jsonb_build_object('google_connected',google_connected,'google_calendar_id',google_calendar_id,
    'created_at',created_at,'updated_at',updated_at)),'[]') INTO rows FROM public.user_integration_status WHERE user_id=p_user_id;
  tables:=tables||jsonb_build_object('user_integration_status',rows);
  RETURN jsonb_build_object('tables',tables,'files',files);
END $$;
REVOKE ALL ON FUNCTION public.build_data_export_manifest(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.build_data_export_manifest(uuid) TO service_role;

CREATE FUNCTION public.create_data_export_snapshot(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.data_export_snapshots%rowtype; v_id uuid:=gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id=p_user_id) OR
    EXISTS(SELECT 1 FROM public.patients WHERE user_id=p_user_id AND deletion_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Deletion in progress; complete it before exporting' USING ERRCODE='55000';
  END IF;
  DELETE FROM public.data_export_snapshots WHERE expires_at<=now();
  IF to_regclass('public.chart_access_audit') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.chart_access_audit(owner_user_id,actor_user_id,action,resource_id) VALUES($1,$1,''account_export_requested'',$2)'
      USING p_user_id,v_id;
  END IF;
  INSERT INTO public.data_export_snapshots(id,user_id,manifest) VALUES(v_id,p_user_id,public.build_data_export_manifest(p_user_id)) RETURNING * INTO s;
  RETURN s.manifest||jsonb_build_object('version',2,'exportId',s.id,'exportedAt',s.created_at,'expiresAt',s.expires_at,'userId',p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.create_data_export_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_data_export_snapshot(uuid) TO service_role;

CREATE FUNCTION public.check_export_file(p_user_id uuid,p_export_id uuid,p_bucket text,p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.role()='service_role' AND EXISTS(SELECT 1 FROM public.data_export_snapshots s
    CROSS JOIN LATERAL jsonb_array_elements(s.manifest->'files') f
    JOIN storage.objects o ON o.bucket_id=f->>'bucket' AND o.name=f->>'path'
    WHERE s.id=p_export_id AND s.user_id=p_user_id AND s.expires_at>now() AND f->>'bucket'=p_bucket AND f->>'path'=p_path
      AND f->>'objectVersion'=md5(to_jsonb(o)::text));
$$;
REVOKE ALL ON FUNCTION public.check_export_file(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_export_file(uuid,uuid,text,text) TO service_role;
CREATE FUNCTION public.complete_data_export_snapshot(p_user_id uuid,p_export_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.role()='service_role' AND EXISTS(SELECT 1 FROM public.data_export_snapshots s
    WHERE s.id=p_export_id AND s.user_id=p_user_id AND s.expires_at>now()
      AND s.manifest=public.build_data_export_manifest(p_user_id));
$$;
REVOKE ALL ON FUNCTION public.complete_data_export_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_data_export_snapshot(uuid,uuid) TO service_role;
