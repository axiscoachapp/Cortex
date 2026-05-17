-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extra patient fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS phone             TEXT,
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS social_anamnesis  TEXT,
  ADD COLUMN IF NOT EXISTS medical_history   TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Consultations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.consultations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chief_complaint  TEXT,
  transcription    TEXT,
  soap_note        TEXT,
  whatsapp_message TEXT,
  pre_briefing     JSONB,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own consultations"
  ON public.consultations FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Appointments
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  patient_id      UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  start_time      TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time        TIMESTAMP WITH TIME ZONE NOT NULL,
  type            TEXT CHECK (type IN ('novo', 'retorno', 'seguimento', 'urgencia')) DEFAULT 'retorno',
  notes           TEXT,
  status          TEXT CHECK (status IN ('agendado', 'confirmado', 'cancelado', 'realizado')) DEFAULT 'agendado',
  google_event_id TEXT,
  reminder_sent   BOOLEAN DEFAULT false,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own appointments"
  ON public.appointments FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. User integrations (Google Calendar OAuth tokens)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_integrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  google_refresh_token  TEXT,
  google_access_token   TEXT,
  google_token_expiry   TIMESTAMP WITH TIME ZONE,
  google_calendar_id    TEXT DEFAULT 'primary',
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own integrations"
  ON public.user_integrations FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER set_user_integrations_updated_at
  BEFORE UPDATE ON public.user_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
