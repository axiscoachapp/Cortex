-- AI review of attached documents: short summary stored per file, shown in the
-- Documentos tab and injected into chat-assistant context.
ALTER TABLE public.patient_files
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;
