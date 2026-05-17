-- Create private bucket for temporary audio recordings (deleted after processing)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('audio-recordings', 'audio-recordings', false, 209715200)  -- 200 MB
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload to their own subfolder: consultations/{user_id}/
CREATE POLICY "Users can upload their own recordings"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'audio-recordings'
  AND (storage.foldername(name))[1] = 'consultations'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Authenticated users can delete their own recordings
CREATE POLICY "Users can delete their own recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'audio-recordings'
  AND (storage.foldername(name))[1] = 'consultations'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
