-- Read-only operator inventory. Run in the intended isolated/staging project
-- first, with service privileges. This does not delete or reassign any object.
-- A missing clinical relationship does not prove which patient owned old audio.
select o.bucket_id,o.name,o.id as object_id,
  case when o.name !~ '^consultations/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|m4a|ogg)$'
    then 'legacy_or_noncanonical_path'
    else 'missing_draft_and_consultation_metadata' end as review_reason
from storage.objects o
where o.bucket_id='audio-recordings'
and not exists(select 1 from public.consultation_drafts d
  where d.audio_storage_path=o.name)
and not exists(select 1 from public.consultations c
  where o.name ~ ('^consultations/'||c.user_id::text||'/'||c.id::text||'\.(webm|m4a|ogg)$'))
order by o.name;
