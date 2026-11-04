-- R1 (Codex review of 2e5b844): a REPEATABLE READ transaction whose snapshot
-- predates a committed account-deletion intent could still save a template,
-- because the marker check read the old snapshot. Touching the custody epoch
-- (20261104002000) after the per-account advisory lock forces that transaction
-- to fail with 40001 instead, and refuses at once (NOWAIT) while an intent is
-- in progress. Same lock order as the deletion intent: advisory, then epoch.
-- Reproduction and proof: scripts/test-document-snippets-concurrency.mjs.
-- Owner: Claude (prescription/documents domain).

create or replace function public.document_snippet_writer() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform public.assert_clinical_actor();
  perform public.assert_session_assurance();
  if v_user is null then raise exception 'Não autorizado' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 123));
  perform cortex_private.touch_custody_epoch();
  if exists (select 1 from public.account_deletion_requests where user_id = v_user) then
    raise exception 'Exclusão de conta em andamento' using errcode = '55000';
  end if;
  return v_user;
end $$;
revoke all on function public.document_snippet_writer() from public, anon, authenticated;
