BEGIN;
INSERT INTO auth.users(id,email) VALUES('a1000000-0000-4000-8000-000000000001','synthetic@example.invalid');
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.patients(id,user_id,name,age,last_visit,status,clinical_notes)
VALUES('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Synthetic',30,current_date,'novo','Original note');
INSERT INTO public.document_templates(id,user_id,name,content)
VALUES('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Synthetic template','content');
INSERT INTO public.user_settings(user_id,daily_credit_limit,active_template_id)
VALUES('a1000000-0000-4000-8000-000000000001',40,'a3000000-0000-4000-8000-000000000001');
INSERT INTO public.appointments(user_id,patient_id,title,start_time,end_time)
VALUES('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Synthetic',now(),now()+interval '1 hour');
INSERT INTO public.patient_files(id,user_id,patient_id,storage_path,file_name)
VALUES('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
 'patients/a1000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000001/file.pdf','file.pdf');
SET LOCAL ROLE service_role;
SELECT public.save_document_review('a1000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','Summary','First finding');
SELECT public.save_document_review('a1000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','Summary 2','Second finding');
DO $$ BEGIN
  ASSERT (SELECT clinical_notes LIKE '%Original note%First finding%Second finding%' FROM public.patients
    WHERE id='a2000000-0000-4000-8000-000000000001'),'Document review overwrote notes';
  ASSERT (public.reserve_usage('a1000000-0000-4000-8000-000000000001',30,'a5000000-0000-4000-8000-000000000001')->>'allowed')::boolean,'Initial reservation denied';
  ASSERT NOT (public.reserve_usage('a1000000-0000-4000-8000-000000000001',20,'a5000000-0000-4000-8000-000000000002')->>'allowed')::boolean,'Reserved spend ignored';
  PERFORM public.settle_usage('a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',10);
  PERFORM public.settle_usage('a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',10);
  ASSERT (SELECT credits_used=10 AND credits_reserved=0 AND calls=1 FROM public.usage_daily
    WHERE user_id='a1000000-0000-4000-8000-000000000001'),'Settlement replay charged twice';
  ASSERT (public.reserve_usage('a1000000-0000-4000-8000-000000000001',20,'a5000000-0000-4000-8000-000000000002')->>'allowed')::boolean,'Unused reservation was not released';
END $$;
UPDATE public.patients SET deletion_requested_at=now() WHERE id='a2000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('patient-files','patients/a1000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000001/new.pdf');
    RAISE EXCEPTION 'Service upload during patient deletion accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
INSERT INTO public.account_deletion_requests(user_id) VALUES('a1000000-0000-4000-8000-000000000001');
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('audio-recordings','consultations/a1000000-0000-4000-8000-000000000001/orphan.webm');
    RAISE EXCEPTION 'Service upload during account deletion accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
-- Must not be blocked by the deletion guard on FK-generated SET NULL updates.
DELETE FROM auth.users WHERE id='a1000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.patients WHERE user_id='a1000000-0000-4000-8000-000000000001'),'Patient not cascaded';
  ASSERT NOT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id='a1000000-0000-4000-8000-000000000001'),'Settings not cascaded';
  ASSERT NOT EXISTS(SELECT 1 FROM public.clinical_record_revisions WHERE user_id='a1000000-0000-4000-8000-000000000001'),'Revisions not cascaded';
END $$;
ROLLBACK;
