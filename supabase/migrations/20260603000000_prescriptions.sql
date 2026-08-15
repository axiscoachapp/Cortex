-- ─────────────────────────────────────────────────────────────────────────────
-- Digital prescriptions (Phase 1 — vendor-independent core).
--
-- Prescriber identity lives on user_settings (CFM Res. 2.299/2021 art. 2º
-- requires name, CRM and professional address on every prescription).
-- Signed/unsigned PDFs live in the private `prescriptions` bucket, served only
-- through the validate-prescription edge function gated by a secret code.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Prescriber identity
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS doctor_name           TEXT,
  ADD COLUMN IF NOT EXISTS crm_number            TEXT,
  ADD COLUMN IF NOT EXISTS crm_uf                TEXT,
  ADD COLUMN IF NOT EXISTS professional_address  TEXT;

-- 2. Prescriptions table
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)   ON DELETE CASCADE,
  consultation_id UUID REFERENCES public.consultations(id)       ON DELETE SET NULL,
  medications     JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_path    TEXT NOT NULL UNIQUE,
  secret_code     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'generated'
                  CHECK (status IN ('generated', 'signed', 'revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  signed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_user    ON public.prescriptions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions (patient_id, created_at DESC);

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own prescriptions" ON public.prescriptions;
CREATE POLICY "Users manage own prescriptions"
  ON public.prescriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Private storage bucket — clients never touch it directly; edge functions
--    use the service role, so no storage RLS policies are added (default deny).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('prescriptions', 'prescriptions', false, 10485760)
ON CONFLICT (id) DO NOTHING;
