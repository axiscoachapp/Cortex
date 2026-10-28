-- Historic clients could forge dates under the old FOR ALL policy. Preserve
-- those documents but do not attest their issuance or expiry retroactively.
ALTER TABLE public.prescriptions ADD COLUMN issuance_verified_at TIMESTAMPTZ;
COMMENT ON COLUMN public.prescriptions.issuance_verified_at IS
  'Server-only issuance attestation set after PDF upload. NULL legacy rows require reissuance for public validation.';
