BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('b1000000-0000-4000-8000-000000000001','owner@example.invalid'),
 ('b1000000-0000-4000-8000-000000000002','other@example.invalid');
INSERT INTO public.patients(id,user_id,name,age,last_visit,status) VALUES
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Owner patient',30,current_date,'novo');
-- Simulate rows accepted by the historical schema. This switch exists ONLY in
-- this disposable test transaction, never in a production migration or fix.
SET LOCAL session_replication_role = replica;
INSERT INTO public.consultations(id,user_id,patient_id,soap_note) VALUES
 ('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','Foreign record must survive');
INSERT INTO public.appointments(id,user_id,patient_id,title,start_time,end_time) VALUES
 ('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','Foreign appointment',now(),now()+interval '1 hour');
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
  BEGIN
    DELETE FROM public.patients WHERE id='b2000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Legacy foreign records were cascaded by patient deletion';
  EXCEPTION WHEN SQLSTATE 'P4090' THEN NULL; END;
  BEGIN
    DELETE FROM auth.users WHERE id='b1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Legacy foreign records were cascaded by account deletion';
  EXCEPTION WHEN SQLSTATE 'P4090' THEN NULL; END;
  ASSERT EXISTS(SELECT 1 FROM public.consultations WHERE id='b3000000-0000-4000-8000-000000000001'),'Foreign consultation lost';
  ASSERT (SELECT patient_id='b2000000-0000-4000-8000-000000000001' FROM public.appointments WHERE id='b4000000-0000-4000-8000-000000000001'),'Foreign appointment changed';
END $$;
-- Exercise independent SET NULL/CASCADE parent paths as well.
INSERT INTO public.patients(id,user_id,name,age,last_visit,status) VALUES
 ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Other patient',30,current_date,'novo');
INSERT INTO public.consultations(id,user_id,patient_id,soap_note) VALUES
 ('b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Owned consultation');
INSERT INTO public.knowledge_documents(id,user_id,title) VALUES
 ('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Owned knowledge');
SET LOCAL session_replication_role = replica;
INSERT INTO public.prescriptions(id,user_id,patient_id,consultation_id,storage_path,secret_code,expires_at) VALUES
 ('b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002',
 'rx/b1000000-0000-4000-8000-000000000002/b6000000-0000-4000-8000-000000000001.pdf','synthetic',now()+interval '1 day');
INSERT INTO public.knowledge_chunks(document_id,user_id,content) VALUES
 ('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','Foreign chunk');
SET LOCAL session_replication_role = origin;
DO $$ BEGIN
  BEGIN
    DELETE FROM public.consultations WHERE id='b3000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'Foreign prescription consultation was cleared';
  EXCEPTION WHEN SQLSTATE 'P4090' THEN NULL; END;
  BEGIN
    DELETE FROM public.knowledge_documents WHERE id='b5000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Foreign knowledge chunk was cascaded';
  EXCEPTION WHEN SQLSTATE 'P4090' THEN NULL; END;
  ASSERT (SELECT consultation_id IS NOT NULL FROM public.prescriptions WHERE id='b6000000-0000-4000-8000-000000000001');
  ASSERT EXISTS(SELECT 1 FROM public.knowledge_chunks WHERE document_id='b5000000-0000-4000-8000-000000000001');
END $$;
ROLLBACK;
