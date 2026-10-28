-- Admission rate is distinct from daily monetary quota. Fixed UTC-minute
-- windows are atomic per actor; provider retries remain inside one operation.
CREATE TABLE public.operation_rate_windows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK(operation IN ('ai','communication')),
  window_start timestamptz NOT NULL,
  admissions integer NOT NULL CHECK(admissions>0),
  PRIMARY KEY(user_id,operation,window_start)
);
ALTER TABLE public.operation_rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_rate_windows FROM anon,authenticated;
GRANT ALL ON public.operation_rate_windows TO service_role;
CREATE FUNCTION public.admit_operation(p_user_id uuid,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; cap integer; window_time timestamptz:=date_trunc('minute',now());
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation NOT IN ('ai','communication') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION 'Account deletion in progress' USING ERRCODE='55000';
  END IF;
  cap:=CASE WHEN p_operation='ai' THEN 30 ELSE 20 END;
  DELETE FROM public.operation_rate_windows WHERE user_id=p_user_id AND window_start<window_time-interval '1 day';
  INSERT INTO public.operation_rate_windows(user_id,operation,window_start,admissions)
    VALUES(p_user_id,p_operation,window_time,1)
    ON CONFLICT(user_id,operation,window_start) DO UPDATE SET admissions=public.operation_rate_windows.admissions+1
    RETURNING admissions INTO n;
  RETURN jsonb_build_object('allowed',n<=cap,'used',n,'limit',cap,'retryAfterSeconds',60);
END $$;
REVOKE ALL ON FUNCTION public.admit_operation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_operation(uuid,text) TO service_role;
