-- Bucket type and size limits, and the WhatsApp webhook purge (migration 20261111150000). Synthetic data only.
begin;
do $$
declare
  b record;
  r jsonb;
begin
  -- Buckets: exact allow-lists and limits; nothing scriptable is accepted.
  select allowed_mime_types, file_size_limit into b from storage.buckets where id = 'audio-recordings';
  assert b.file_size_limit = 209715200, 'audio-recordings limit';
  assert b.allowed_mime_types @> array['audio/webm','audio/webm;codecs=opus','video/webm','audio/mp4','audio/x-m4a','audio/ogg','audio/ogg;codecs=opus','audio/wav','audio/mpeg'],
    'audio-recordings must accept every format the recorder and the recovery import produce';
  select allowed_mime_types, file_size_limit into b from storage.buckets where id = 'patient-files';
  assert b.file_size_limit = 26214400, 'patient-files limit';
  assert b.allowed_mime_types @> array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
     and array_length(b.allowed_mime_types, 1) = 6, 'patient-files allow-list';
  select allowed_mime_types, file_size_limit into b from storage.buckets where id = 'prescriptions';
  assert b.file_size_limit = 10485760 and b.allowed_mime_types = array['application/pdf'], 'prescriptions allow-list';
  assert not exists (
    select 1 from storage.buckets, unnest(allowed_mime_types) t
    where id in ('audio-recordings','patient-files','prescriptions') and (t ilike '%svg%' or t ilike '%html%' or t like '%*%')
  ), 'no scriptable or wildcard type';

  -- Purge: synthetic events at different ages and states.
  delete from public.whatsapp_webhook_events where payload_sha256 like 'eeee%';
  insert into public.whatsapp_webhook_events (payload_sha256, payload, received_at, processed_at, last_error) values
    ('eeee' || repeat('1', 60), '{"text":"recent failure"}', now() - interval '5 days', null, 'ingest error'),
    ('eeee' || repeat('2', 60), '{"text":"old failure"}', now() - interval '31 days', null, 'ingest error'),
    ('eeee' || repeat('3', 60), null, now() - interval '40 days', now() - interval '40 days', null),
    ('eeee' || repeat('4', 60), '{"text":"ancient failure"}', now() - interval '91 days', null, 'parse'),
    ('eeee' || repeat('5', 60), null, now() - interval '100 days', now() - interval '100 days', null),
    ('eeee' || repeat('6', 60), '{"text":"processed but kept"}', now() - interval '1 day', now() - interval '1 day', null);
  r := public.purge_whatsapp_webhook_events();
  assert (r->>'deleted')::int >= 2 and (r->>'nulled')::int >= 2, 'purge result ' || r::text;
  assert (select payload is not null from public.whatsapp_webhook_events where payload_sha256 = 'eeee' || repeat('1', 60)),
    'a recent failed delivery keeps its payload for a retry';
  assert (select payload is null and last_error = 'ingest error' from public.whatsapp_webhook_events where payload_sha256 = 'eeee' || repeat('2', 60)),
    'a failed delivery older than 30 days loses its payload but keeps the hash and the error';
  assert exists (select 1 from public.whatsapp_webhook_events where payload_sha256 = 'eeee' || repeat('3', 60)),
    'a processed event younger than 90 days keeps its hash';
  assert not exists (select 1 from public.whatsapp_webhook_events where payload_sha256 in ('eeee' || repeat('4', 60), 'eeee' || repeat('5', 60))),
    'events older than 90 days are deleted';
  assert (select payload is null from public.whatsapp_webhook_events where payload_sha256 = 'eeee' || repeat('6', 60)),
    'a processed event never keeps a payload';
  -- Idempotent.
  r := public.purge_whatsapp_webhook_events();
  assert not exists (select 1 from public.whatsapp_webhook_events where payload_sha256 like 'eeee%' and payload is not null and received_at < now() - interval '30 days'),
    'second run leaves nothing old with a payload';

  -- Only the service role (and the scheduler) may run it.
  assert not has_function_privilege('anon', 'public.purge_whatsapp_webhook_events(timestamptz)', 'execute'), 'anon must not purge';
  assert not has_function_privilege('authenticated', 'public.purge_whatsapp_webhook_events(timestamptz)', 'execute'), 'authenticated must not purge';
  assert has_function_privilege('service_role', 'public.purge_whatsapp_webhook_events(timestamptz)', 'execute'), 'service_role purges';

  -- Scheduled when pg_cron exists, like the other housekeeping jobs.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    assert exists (select 1 from cron.job where jobname = 'purge-whatsapp-webhook-events' and command like '%purge_whatsapp_webhook_events%'),
      'purge job scheduled';
  end if;
end $$;
rollback;
