BEGIN;
INSERT INTO auth.users(id,email) VALUES('92000000-0000-4000-8000-000000000001','privacy@example.invalid');
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.patients(id,user_id,name,age,status) VALUES
 ('92000000-0000-4000-8000-000000000011','92000000-0000-4000-8000-000000000001','Synthetic privacy',30,'novo');
INSERT INTO public.consultation_drafts(id,user_id,patient_id,audio_storage_path) VALUES
 ('92000000-0000-4000-8000-000000000021','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011',
 'consultations/92000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000021.webm');
INSERT INTO storage.objects(bucket_id,name) VALUES('audio-recordings','consultations/92000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000021.webm');
SET LOCAL ROLE service_role;
DO $$ DECLARE s jsonb; export_id uuid; BEGIN
  s:=public.create_data_export_snapshot('92000000-0000-4000-8000-000000000001'); export_id:=(s->>'exportId')::uuid;
  ASSERT jsonb_array_length(s->'tables'->'patients')=1,'Snapshot omitted owned patient';
  ASSERT jsonb_array_length(s->'files')=1,'Snapshot omitted source audio';
  ASSERT public.check_export_file('92000000-0000-4000-8000-000000000001',export_id,'audio-recordings',s->'files'->0->>'path'),'Snapshot file version rejected';
  ASSERT NOT public.check_export_file('92000000-0000-4000-8000-000000000099',export_id,'audio-recordings',s->'files'->0->>'path'),'Foreign snapshot accessible';
  ASSERT public.complete_data_export_snapshot('92000000-0000-4000-8000-000000000001',export_id),'Unchanged snapshot rejected';
  UPDATE public.patients SET name='Changed while exporting' WHERE id='92000000-0000-4000-8000-000000000011';
  ASSERT NOT public.complete_data_export_snapshot('92000000-0000-4000-8000-000000000001',export_id),'Concurrent update reported complete';
  ASSERT s->'tables'->'patients'->0->>'name'='Synthetic privacy','Captured snapshot mutated';
  DELETE FROM storage.objects WHERE name=s->'files'->0->>'path';
  ASSERT NOT public.check_export_file('92000000-0000-4000-8000-000000000001',export_id,'audio-recordings',s->'files'->0->>'path'),'Deleted file version accepted';
END $$;
SELECT public.begin_consultation_discard('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000021');
DO $$ BEGIN
  ASSERT (SELECT discard_requested_at IS NOT NULL FROM public.consultation_drafts WHERE id='92000000-0000-4000-8000-000000000021'),'Discard intent missing';
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('audio-recordings','consultations/92000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000021.webm');
    RAISE EXCEPTION 'Discard still allows late upload';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.consultation_drafts SET content='{"late":true}' WHERE id='92000000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'Delayed processing overwrote discarding draft';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
INSERT INTO public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,issuance_snapshot) VALUES
 ('92000000-0000-4000-8000-000000000031','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011',
 'rx/92000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000031.pdf','SYNTHETIC',now()+interval '1 day',
 '{"prescriber":{"doctor_name":"Original"},"patient":{"name":"Synthetic"},"pdf_sha256":"synthetic","template_version":"v1","issued_at":"2026-10-28"}');
DO $$ BEGIN
  BEGIN
    UPDATE public.prescriptions SET issuance_snapshot=jsonb_set(issuance_snapshot,'{prescriber,doctor_name}','"Changed"') WHERE id='92000000-0000-4000-8000-000000000031';
    RAISE EXCEPTION 'Historical issuer snapshot was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  BEGIN
    DELETE FROM public.consultation_drafts WHERE id='92000000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'Client can erase audio cleanup identity';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.create_data_export_snapshot(auth.uid());
    RAISE EXCEPTION 'Client invoked privileged export snapshot';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT public.create_data_export_snapshot('92000000-0000-4000-8000-000000000001');
UPDATE public.patients SET deletion_requested_at=now() WHERE id='92000000-0000-4000-8000-000000000011';
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.data_export_snapshots WHERE user_id='92000000-0000-4000-8000-000000000001'),'Patient deletion retained an export copy';
  BEGIN
    PERFORM public.create_data_export_snapshot('92000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Export started during patient deletion';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
