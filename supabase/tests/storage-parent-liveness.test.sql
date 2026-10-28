BEGIN;
INSERT INTO auth.users(id,email) VALUES('c1000000-0000-4000-8000-000000000001','synthetic@example.invalid');
INSERT INTO public.patients(id,user_id,name,age,last_visit,status) VALUES
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Synthetic',30,current_date,'novo');
INSERT INTO public.consultation_drafts(id,user_id,patient_id,audio_storage_path) VALUES
 ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 'consultations/c1000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001.webm');
INSERT INTO public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,status) VALUES
 ('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 'rx/c1000000-0000-4000-8000-000000000001/c4000000-0000-4000-8000-000000000001.pdf','synthetic',now()+interval '1 day','revoked');
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
-- Valid parents permit their registered uploads.
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('patient-files','patients/c1000000-0000-4000-8000-000000000001/c2000000-0000-4000-8000-000000000001/file.pdf'),
 ('audio-recordings','consultations/c1000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001.webm'),
 ('prescriptions','rx/c1000000-0000-4000-8000-000000000001/c4000000-0000-4000-8000-000000000001.pdf');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE changed INTEGER; BEGIN
  UPDATE storage.objects SET name=name WHERE bucket_id='audio-recordings';
  GET DIAGNOSTICS changed=ROW_COUNT;
  ASSERT changed=1,'Registered draft upload could not be retried';
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('audio-recordings','consultations/c1000000-0000-4000-8000-000000000001/unregistered.webm');
    RAISE EXCEPTION 'Unregistered audio upload accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DELETE FROM storage.objects;
DELETE FROM public.patients WHERE id='c2000000-0000-4000-8000-000000000001';
DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('patient-files','patients/c1000000-0000-4000-8000-000000000001/c2000000-0000-4000-8000-000000000001/late.pdf'),
    ('audio-recordings','consultations/c1000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001.webm'),
    ('prescriptions','rx/c1000000-0000-4000-8000-000000000001/c4000000-0000-4000-8000-000000000001.pdf')
  ) paths(bucket,path) LOOP
    BEGIN
      INSERT INTO storage.objects(bucket_id,name) VALUES(item.bucket,item.path);
      RAISE EXCEPTION 'Upload resurrected deleted patient data in %',item.bucket;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
DELETE FROM auth.users WHERE id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('audio-recordings','consultations/c1000000-0000-4000-8000-000000000001/stale-jwt.webm');
    RAISE EXCEPTION 'Stale JWT recreated account audio';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
