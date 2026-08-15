-- Per-doctor toggle for the live consultation copilot (rolling summary +
-- suggested questions during recording). Defaults ON; doctors who don't want
-- the extra per-consult cost can turn it off in Configurações.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS live_copilot_enabled boolean NOT NULL DEFAULT true;
