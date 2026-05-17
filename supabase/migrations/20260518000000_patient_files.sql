-- ─────────────────────────────────────────────────────────────────────────────
-- Patient files: uploads attached to a patient (exams, photos, prescriptions
-- from elsewhere, etc).
--
-- Storage layout in the `patient-files` bucket:
--   patients/{user_id}/{patient_id}/{file_uuid}-{original_name}
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table
CREATE TABLE IF NOT EXISTS public.patient_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  file_name    TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  tag          TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_files_patient   ON public.patient_files (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_files_user      ON public.patient_files (user_id);

ALTER TABLE public.patient_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own patient files"
  ON public.patient_files FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Storage bucket — private (signed URLs only), 25 MB cap per file.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('patient-files', 'patient-files', false, 26214400)
ON CONFLICT (id) DO NOTHING;

-- Path convention enforced by RLS: patients/{user_id}/{patient_id}/{...}
CREATE POLICY "Users can upload files for their patients"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'patient-files'
    AND (storage.foldername(name))[1] = 'patients'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Users can read their own patient files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'patient-files'
    AND (storage.foldername(name))[1] = 'patients'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Users can delete their own patient files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'patient-files'
    AND (storage.foldername(name))[1] = 'patients'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
