ALTER TABLE public.usage_daily ADD COLUMN credits_reserved NUMERIC NOT NULL DEFAULT 0 CHECK(credits_reserved >= 0);
CREATE TABLE public.usage_reservations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  reserved NUMERIC NOT NULL CHECK(reserved > 0),
  actual NUMERIC CHECK(actual >= 0),
  settled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(user_id,day) REFERENCES public.usage_daily(user_id,day) ON DELETE CASCADE
);
ALTER TABLE public.usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usage_reservations FROM anon, authenticated;
GRANT ALL ON public.usage_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_usage(p_user_id UUID,p_credits NUMERIC,p_reservation_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_day DATE := (now() AT TIME ZONE 'UTC')::date; v_limit NUMERIC; v_used NUMERIC; v_existing public.usage_reservations;
BEGIN
  IF p_user_id IS NULL OR p_reservation_id IS NULL OR p_credits IS NULL OR p_credits <= 0 OR p_credits > 100000
    OR p_credits::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE user_id=p_user_id) THEN RAISE EXCEPTION 'Account deletion in progress'; END IF;
  SELECT daily_credit_limit INTO v_limit FROM public.user_settings WHERE user_id=p_user_id;
  v_limit := coalesce(v_limit,1500);
  INSERT INTO public.usage_daily(user_id,day) VALUES(p_user_id,v_day) ON CONFLICT DO NOTHING;
  SELECT credits_used+credits_reserved INTO v_used FROM public.usage_daily WHERE user_id=p_user_id AND day=v_day;
  SELECT * INTO v_existing FROM public.usage_reservations WHERE id=p_reservation_id;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id OR v_existing.reserved <> p_credits OR v_existing.day <> v_day OR v_existing.settled THEN
      RAISE EXCEPTION 'Reservation already used';
    END IF;
    RETURN jsonb_build_object('allowed',true,'used',v_used,'limit',v_limit);
  END IF;
  IF v_used+p_credits > v_limit THEN RETURN jsonb_build_object('allowed',false,'used',v_used,'limit',v_limit); END IF;
  INSERT INTO public.usage_reservations(id,user_id,day,reserved) VALUES(p_reservation_id,p_user_id,v_day,p_credits);
  UPDATE public.usage_daily SET credits_reserved=credits_reserved+p_credits,updated_at=now() WHERE user_id=p_user_id AND day=v_day;
  RETURN jsonb_build_object('allowed',true,'used',v_used,'limit',v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_usage(p_user_id UUID,p_reservation_id UUID,p_credits NUMERIC)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_res public.usage_reservations; v_actual NUMERIC;
BEGIN
  IF p_user_id IS NULL OR p_reservation_id IS NULL OR p_credits < 0 OR p_credits::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Invalid usage';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  SELECT * INTO v_res FROM public.usage_reservations WHERE id=p_reservation_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.settled THEN RETURN true; END IF;
  -- Unknown cost retains the reservation. An unexpected overrun is charged in
  -- full so subsequent requests cannot hide spend; callers bound inputs/outputs.
  v_actual := coalesce(p_credits,v_res.reserved);
  UPDATE public.usage_daily SET credits_reserved=credits_reserved-v_res.reserved,
    credits_used=credits_used+v_actual,calls=calls+1,updated_at=now()
    WHERE user_id=p_user_id AND day=v_res.day;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usage day not found'; END IF;
  UPDATE public.usage_reservations SET actual=v_actual,settled=true WHERE id=p_reservation_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_usage(UUID,NUMERIC,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_usage(UUID,UUID,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_usage(UUID,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_usage(UUID,UUID,NUMERIC) TO service_role;
