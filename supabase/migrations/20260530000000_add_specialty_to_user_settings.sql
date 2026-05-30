-- Add specialty preference to user_settings so the doctor sets it once
-- and all SOAP generation adapts automatically.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS specialty TEXT NOT NULL DEFAULT 'geral'
  CHECK (specialty IN (
    'geral', 'psiquiatria', 'cardiologia', 'pediatria',
    'ginecologia', 'dermatologia', 'neurologia', 'ortopedia', 'endocrinologia'
  ));
