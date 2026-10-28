BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000001','a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','b@example.invalid');
INSERT INTO public.patients(id,user_id,name,age,last_visit,status) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic A',30,'2026-10-27','novo'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Synthetic B',31,'2026-10-27','novo');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.patients)=1,'Foreign patient readable';
  BEGIN
    INSERT INTO public.appointments(user_id,patient_id,title,start_time,end_time)
    VALUES(auth.uid(),'20000000-0000-4000-8000-000000000002','attack',now(),now()+interval '30 minutes');
    RAISE EXCEPTION 'Cross-user appointment accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at)
    VALUES(gen_random_uuid(),auth.uid(),'20000000-0000-4000-8000-000000000001','/rx/foreign.pdf','chosen',now()+interval '1 day');
    RAISE EXCEPTION 'Client prescription insertion accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.update_user_settings('{"doctor_name":"Synthetic Doctor","crm_number":"123","crm_uf":"sp"}');
DO $$ BEGIN
  ASSERT (SELECT doctor_name FROM public.user_settings WHERE user_id=auth.uid())='Synthetic Doctor','Settings RPC failed';
  BEGIN
    PERFORM public.update_user_settings('{"daily_credit_limit":100000}');
    RAISE EXCEPTION 'Client quota override accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    DELETE FROM public.patients WHERE user_id=auth.uid();
    RAISE EXCEPTION 'Unverified direct patient deletion accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT public.is_canonical_storage_path('consultations/A/../B/x.webm'),'Traversal accepted';
  ASSERT NOT public.is_canonical_storage_path('patients/A/%2e%2e/x.pdf'),'Encoded traversal accepted';
  ASSERT NOT public.is_canonical_storage_path('/rx/A/x.pdf'),'Leading slash accepted';
END $$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.google_oauth_transactions(state_hash,user_id,redirect_uri,code_verifier)
VALUES('test-state','10000000-0000-4000-8000-000000000001','https://app.invalid/google-oauth-callback','verifier');
DO $$ BEGIN
  ASSERT public.consume_google_oauth_transaction('test-state','10000000-0000-4000-8000-000000000002','https://app.invalid/google-oauth-callback') IS NULL,'OAuth user mismatch accepted';
  ASSERT public.consume_google_oauth_transaction('test-state','10000000-0000-4000-8000-000000000001','https://app.invalid/google-oauth-callback')='verifier','Valid OAuth state rejected';
  ASSERT public.consume_google_oauth_transaction('test-state','10000000-0000-4000-8000-000000000001','https://app.invalid/google-oauth-callback') IS NULL,'OAuth replay accepted';
END $$;
ROLLBACK;
