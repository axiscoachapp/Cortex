-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user daily Gemini-usage tracking, denominated in "credits".
--
--   1 credit = $0.001 of real Gemini API cost.
--
-- Conversion (Gemini 2.5 Flash):
--   text input  $0.30 / 1M tokens  →  0.0003 credits / token
--   text output $2.50 / 1M tokens  →  0.0025 credits / token
--   audio input $1.00 / 1M tokens  →  0.0010 credits / token
--
-- Default daily limit 1500 credits  =  ~$1.50/day  =  ~$45/month worst case.
-- A typical busy practice burns ~300–600 credits/day.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Per-user override (one row per user, optional).
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_credit_limit   INTEGER NOT NULL DEFAULT 1500,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own settings" ON public.user_settings;
CREATE POLICY "Users read own settings"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

-- Only edge functions (service role) may write — users can't lift their own cap.
DROP POLICY IF EXISTS "Service role writes settings" ON public.user_settings;
CREATE POLICY "Service role writes settings"
  ON public.user_settings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2. Daily counters. One row per (user, UTC day).
CREATE TABLE IF NOT EXISTS public.usage_daily (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  credits_used  NUMERIC NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  calls         INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_user_day
  ON public.usage_daily (user_id, day DESC);

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own usage" ON public.usage_daily;
CREATE POLICY "Users read own usage"
  ON public.usage_daily FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role writes usage" ON public.usage_daily;
CREATE POLICY "Service role writes usage"
  ON public.usage_daily FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 3. Atomic increment function — called from edge functions to record actual
--    cost after a successful Gemini call. Returns the new total so the caller
--    can decide whether to alert.
CREATE OR REPLACE FUNCTION public.record_usage(
  p_user_id UUID,
  p_credits NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_new_total NUMERIC;
BEGIN
  INSERT INTO public.usage_daily (user_id, day, credits_used, calls, updated_at)
  VALUES (p_user_id, v_today, p_credits, 1, now())
  ON CONFLICT (user_id, day) DO UPDATE
    SET credits_used = public.usage_daily.credits_used + EXCLUDED.credits_used,
        calls        = public.usage_daily.calls + 1,
        updated_at   = now()
  RETURNING credits_used INTO v_new_total;

  RETURN v_new_total;
END;
$$;

-- Tighten function ownership / grants.
REVOKE ALL ON FUNCTION public.record_usage(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_usage(UUID, NUMERIC) TO service_role;
