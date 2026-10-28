BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('90000000-0000-4000-8000-000000000001','clinical-a@example.invalid'),
 ('90000000-0000-4000-8000-000000000002','clinical-b@example.invalid');
INSERT INTO public.patients(id,user_id,name,age,last_visit,status) VALUES
 ('90000000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000001','Synthetic clinical A',30,'2026-10-27','novo'),
 ('90000000-0000-4000-8000-000000000012','90000000-0000-4000-8000-000000000002','Synthetic clinical B',31,'2026-10-27','novo');
INSERT INTO public.consultations(id,user_id,patient_id,soap_note) VALUES
 ('90000000-0000-4000-8000-000000000021','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011','Original SOAP');
UPDATE public.patients SET clinical_notes='Foreign note' WHERE id='90000000-0000-4000-8000-000000000012';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
INSERT INTO public.consultation_drafts(id,user_id,patient_id,chief_complaint,audio_storage_path,content,status) VALUES
 ('90000000-0000-4000-8000-000000000031',auth.uid(),'90000000-0000-4000-8000-000000000011','Synthetic complaint',
 'consultations/90000000-0000-4000-8000-000000000001/draft.webm','{"soapDraft":"Recoverable"}','review');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.consultation_drafts)=1,'Owned draft not readable';
  ASSERT (SELECT content->>'soapDraft' FROM public.consultation_drafts)='Recoverable','Draft content lost';
  BEGIN
    INSERT INTO public.consultation_drafts(id,user_id,patient_id,content) VALUES
      ('90000000-0000-4000-8000-000000000032',auth.uid(),'90000000-0000-4000-8000-000000000011','{"soapDraft":"SECOND TAB"}')
      ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content;
    RAISE EXCEPTION 'Second tab replaced the existing draft';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  ASSERT (SELECT content->>'soapDraft' FROM public.consultation_drafts)='Recoverable','Second-tab conflict overwrote the draft';
  ASSERT (SELECT count(*) FROM public.clinical_record_revisions)=0,'Foreign clinical revision readable';
  BEGIN
    INSERT INTO public.consultation_drafts(user_id,patient_id) VALUES(auth.uid(),'90000000-0000-4000-8000-000000000012');
    RAISE EXCEPTION 'Foreign patient draft accepted';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
  BEGIN
    PERFORM public.apply_clinical_comment(auth.uid(),'90000000-0000-4000-8000-000000000011',0,'{}');
    RAISE EXCEPTION 'Client could invoke privileged clinical write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
  ASSERT public.apply_clinical_comment('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011',0,
    '{"allergies":["Synthetic allergy"],"clinical_notes":"Accepted note"}',
    '90000000-0000-4000-8000-000000000021',0,'Accepted addendum'),'Atomic comment failed';
  ASSERT (SELECT revision FROM public.patients WHERE id='90000000-0000-4000-8000-000000000011')=1,'Patient revision not incremented';
  ASSERT (SELECT revision FROM public.consultations WHERE id='90000000-0000-4000-8000-000000000021')=1,'SOAP revision not incremented';
  ASSERT (SELECT allergies FROM public.patients WHERE id='90000000-0000-4000-8000-000000000011')=ARRAY['Synthetic allergy'],'Allergy patch failed';
  ASSERT (SELECT soap_note FROM public.consultations WHERE id='90000000-0000-4000-8000-000000000021')=E'Original SOAP\n\nAccepted addendum','SOAP addendum lost original text';
  BEGIN
    PERFORM public.apply_clinical_comment('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011',0,
      '{"clinical_notes":"STALE OVERWRITE"}','90000000-0000-4000-8000-000000000021',0,'STALE');
    RAISE EXCEPTION 'Stale patient update accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN
    PERFORM public.apply_clinical_comment('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011',1,
      '{"clinical_notes":"PARTIAL OVERWRITE"}','90000000-0000-4000-8000-000000000021',0,'STALE');
    RAISE EXCEPTION 'Stale SOAP update accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  ASSERT (SELECT clinical_notes FROM public.patients WHERE id='90000000-0000-4000-8000-000000000011')='Accepted note','Conflict partially updated patient';
  ASSERT (SELECT revision FROM public.patients WHERE id='90000000-0000-4000-8000-000000000011')=1,'Conflict changed revision';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ DECLARE changed integer; BEGIN
  UPDATE public.consultations SET soap_note='STALE EDIT' WHERE id='90000000-0000-4000-8000-000000000021' AND revision=0;
  GET DIAGNOSTICS changed=ROW_COUNT;
  ASSERT changed=0,'Concurrent stale edit overwrote SOAP';
  ASSERT (SELECT count(*) FROM public.clinical_record_revisions)=2,'Owned revision history incomplete or leaked foreign history';
  ASSERT (SELECT snapshot->>'soap_note' FROM public.clinical_record_revisions WHERE record_type='consultations')='Original SOAP','Original SOAP snapshot missing';
  ASSERT (SELECT snapshot->'allergies' FROM public.clinical_record_revisions WHERE record_type='patients')='[]'::jsonb,'Original allergy snapshot missing';
  BEGIN
    DELETE FROM public.clinical_record_revisions;
    RAISE EXCEPTION 'Client could erase revision history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
