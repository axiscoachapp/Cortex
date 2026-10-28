BEGIN;
INSERT INTO auth.users(id,email) VALUES('94000000-0000-4000-8000-000000000001','operations@example.invalid');
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
  FOR i IN 1..30 LOOP
    result:=public.admit_operation('94000000-0000-4000-8000-000000000001','ai');
    ASSERT (result->>'allowed')::boolean,'Premature AI admission denial';
  END LOOP;
  result:=public.admit_operation('94000000-0000-4000-8000-000000000001','ai');
  ASSERT NOT (result->>'allowed')::boolean,'AI burst exceeded fixed-minute cap';
  ASSERT (result->>'used')::integer=31,'Lost concurrent-counter update';
  ASSERT (public.admit_operation('94000000-0000-4000-8000-000000000001','communication')->>'allowed')::boolean,'AI cap blocked independent communication admission';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.admit_operation(auth.uid(),'ai');
    RAISE EXCEPTION 'Client bypassed server admission boundary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
