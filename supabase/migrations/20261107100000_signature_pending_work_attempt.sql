-- D17 executor (P4): what signature_pending_work discovers, in the shape signature_reconcile needs.
-- Owner: Claude; review: Codex. Same grants (create or replace keeps them).
--
-- Two changes from 20261105100000:
-- 1. Each item carries `attempt` (psc_attempts): signature_reconcile compares it under the lock,
--    and the executor had no other way to read it.
-- 2. The kind follows the state, not cleanup_pending. The transition to 'stored' sets
--    cleanup_pending = true ("clean if this does not complete"), so the old rule listed an operation
--    still waiting for the doctor as remove_candidate at once, and never as stuck after 24 h.
--    Now:
--    - stuck: reserved/prepared/psc_requested untouched for 15 min, or stored for 24 h (stored_at);
--    - remove_candidate: failed/cancelled/cancelled_by_revocation with the cleanup pending or the
--      candidate object still in Storage.
--    completed and ambiguous are never listed: a completed file is never removed, and an ambiguous
--    operation waits for the doctor's own retry.
create or replace function public.signature_pending_work(p_limit integer default 100) returns jsonb
language sql volatile security definer set search_path='' as $$
 select coalesce(jsonb_agg(w order by w->>'updatedAt'),'[]'::jsonb) from (
  select jsonb_build_object('operationId',o.operation_id,'userId',o.user_id,'prescriptionId',o.prescription_id,'state',o.state,
   'attempt',o.psc_attempts,
   'kind',case when o.state in ('failed','cancelled','cancelled_by_revocation') then 'remove_candidate' else 'stuck' end,
   'candidatePath','rx/'||o.user_id::text||'/'||o.prescription_id::text||'/signed-'||o.operation_id::text||'.pdf',
   'signedSha256',o.signed_pdf_sha256,'updatedAt',o.updated_at) w
  from cortex_private.signature_operations o
  where (o.state in ('reserved','prepared','psc_requested') and o.updated_at<now()-interval '15 minutes')
   or (o.state='stored' and o.stored_at<now()-interval '24 hours')
   or (o.state in ('failed','cancelled','cancelled_by_revocation') and (o.cleanup_pending or exists(select 1 from storage.objects so
    where so.bucket_id='prescriptions'
     and so.name='rx/'||o.user_id::text||'/'||o.prescription_id::text||'/signed-'||o.operation_id::text||'.pdf')))
  order by o.updated_at limit least(greatest(coalesce(p_limit,100),1),500)) x;
$$;

revoke all on function public.signature_pending_work(integer) from public,anon,authenticated;
grant execute on function public.signature_pending_work(integer) to service_role;
