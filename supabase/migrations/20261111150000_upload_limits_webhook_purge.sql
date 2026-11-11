-- Owner: Claude (seguranca, round 2 of the 2026-11-10 improvement plan).
-- Security review findings 11 and 13 (docs/reviews/2026-11-10/revisao-geral/relatorios/seguranca-privacidade.md).
--
-- 1. Upload types are enforced by Storage, not only by the browser. Each private bucket accepts only
--    what the app writes to it, with the size limits the app already announces:
--    - audio-recordings: consultation audio from MediaRecorder (webm/opus in Chrome and Firefox,
--      mp4 in Safari, ogg/opus) and the "recover audio" import (a downloaded .webm can be typed
--      video/webm by the operating system, .m4a as audio/x-m4a); wav and mpeg for imported files.
--      The parameterised forms (";codecs=opus") are listed too: older Storage versions compare the
--      whole subtype text, newer ones drop the parameters, so both spellings keep working. 200 MB.
--    - patient-files: PDF and the photo formats of PatientFiles and the chat attachment
--      (JPEG, PNG, WebP, HEIC/HEIF). 25 MB, the limit the screen shows.
--    - prescriptions: generated and signed PDFs only (generate-prescription, sign-document). 10 MB.
--    SVG and HTML are refused everywhere: opened from a signed URL they could run script.
-- 2. Failed WhatsApp webhook deliveries kept the full payload (message text, phone numbers) forever.
--    A daily job erases the payload of any event older than 30 days and deletes events older than
--    90 days (Meta stops redelivering after about 7 days, so the hash is no longer needed for
--    de-duplication). No other table keeps third-party payloads: billing XML is the clinic's own
--    batch, the other jsonb columns are Cortex's own data.

update storage.buckets set
  allowed_mime_types = array[
    'audio/webm', 'audio/webm;codecs=opus', 'video/webm',
    'audio/mp4', 'audio/x-m4a', 'audio/m4a',
    'audio/ogg', 'audio/ogg;codecs=opus',
    'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mpeg'
  ],
  file_size_limit = 209715200
where id = 'audio-recordings';

update storage.buckets set
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  file_size_limit = 26214400
where id = 'patient-files';

update storage.buckets set
  allowed_mime_types = array['application/pdf'],
  file_size_limit = 10485760
where id = 'prescriptions';

create index if not exists whatsapp_webhook_events_received_at on public.whatsapp_webhook_events (received_at);

-- Returns what it did so the job history (cron.job_run_details) shows it.
create or replace function public.purge_whatsapp_webhook_events(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_nulled integer;
  v_deleted integer;
begin
  delete from public.whatsapp_webhook_events where received_at < p_now - interval '90 days';
  get diagnostics v_deleted = row_count;
  update public.whatsapp_webhook_events set payload = null
  where payload is not null and (processed_at is not null or received_at < p_now - interval '30 days');
  get diagnostics v_nulled = row_count;
  return jsonb_build_object('nulled', v_nulled, 'deleted', v_deleted);
end $$;

revoke all on function public.purge_whatsapp_webhook_events(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_whatsapp_webhook_events(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-whatsapp-webhook-events', '17 4 * * *',
      $job$select public.purge_whatsapp_webhook_events()$job$);
  end if;
end $$;
