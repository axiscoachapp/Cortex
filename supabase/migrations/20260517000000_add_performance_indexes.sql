CREATE INDEX IF NOT EXISTS idx_consultations_patient_created
  ON public.consultations(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_user_start
  ON public.appointments(user_id, start_time);
