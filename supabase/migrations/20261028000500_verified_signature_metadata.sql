-- Historical status='signed' could have been set through the old client policy.
-- Preserve those records but do not assert cryptographic verification. Only a
-- future trusted signature-verification service may populate this new column.
ALTER TABLE public.prescriptions ADD COLUMN signature_verified_at TIMESTAMPTZ;
ALTER TABLE public.prescriptions ADD CONSTRAINT signed_prescription_verified
  CHECK(status <> 'signed' OR signature_verified_at IS NOT NULL) NOT VALID;
