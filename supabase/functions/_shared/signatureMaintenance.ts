/**
 * D17 reconciliation executor (P4), contract in docs/prescriptions/ASSINATURA_HANDLERS.md §9.
 *
 * Called by pg_cron with the x-cortex-cron header (SIGNATURE_CRON_SECRET). It only closes:
 * - ends expired sessions and drops their tokens (signature_expire_sessions);
 * - closes operations left behind, through signature_reconcile, which rechecks state and attempt
 *   under the barrier and the row lock (reserved/prepared → failed, psc_requested → ambiguous,
 *   stored for 24 h → cancelled);
 * - removes the temporary candidate of an operation that ended without completing, then records it.
 * It never completes, publishes or calls the PSC, and never removes the file of a completed operation.
 */

export interface PendingItem {
  operationId: string; userId: string; prescriptionId: string; state: string; attempt: number;
  kind: 'stuck' | 'remove_candidate'; candidatePath: string; updatedAt: string;
}

export interface MaintenanceDeps {
  cronSecret: string;
  rpc(name: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Removes one object from the private prescriptions bucket; throws when Storage fails. */
  removeObject(path: string): Promise<void>;
  log?(event: string, data: Record<string, unknown>): void;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const REMOVABLE = new Set(['failed', 'cancelled', 'cancelled_by_revocation']);
const STUCK = new Set(['reserved', 'prepared', 'psc_requested', 'stored']);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function sameSecret(secret: string, given: string): boolean {
  let diff = secret.length === given.length && secret.length >= 32 ? 0 : 1;
  for (let i = 0; i < Math.min(secret.length, given.length); i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** The candidate path is rebuilt from the ids; a listed path that differs is never used. */
function candidatePath(item: PendingItem): string | null {
  if (![item.userId, item.prescriptionId, item.operationId].every((v) => typeof v === 'string' && UUID_RE.test(v))) return null;
  const path = `rx/${item.userId}/${item.prescriptionId}/signed-${item.operationId}.pdf`;
  return item.candidatePath === path ? path : null;
}

export async function maintenanceHandler(req: Request, deps: MaintenanceDeps): Promise<Response> {
  if (req.method !== 'POST' || !sameSecret(deps.cronSecret, req.headers.get('x-cortex-cron') ?? '')) {
    return json(401, { error: 'Não autorizado.' });
  }
  const tally = { expiredSessions: 0, failed: 0, ambiguous: 0, cancelled: 0, unchanged: 0, removed: 0, busy: 0, skipped: 0, errors: 0 };
  tally.expiredSessions = Number(await deps.rpc('signature_expire_sessions')) || 0;
  const work = ((await deps.rpc('signature_pending_work', { p_limit: 100 })) ?? []) as PendingItem[];
  for (const item of Array.isArray(work) ? work : []) {
    try {
      if (item.kind === 'remove_candidate') {
        const path = candidatePath(item);
        if (!REMOVABLE.has(item.state) || !path) { tally.skipped++; continue; }
        await deps.removeObject(path);
        await deps.rpc('signature_cleanup_done', { p_user: item.userId, p_operation: item.operationId });
        tally.removed++;
      } else if (item.kind === 'stuck' && STUCK.has(item.state) && Number.isInteger(item.attempt)) {
        const after = (await deps.rpc('signature_reconcile', {
          p_user: item.userId, p_operation: item.operationId, p_expected_state: item.state, p_expected_attempt: item.attempt,
        })) as { state?: string } | null;
        const state = after?.state;
        if (state === 'failed' || state === 'ambiguous' || state === 'cancelled') tally[state]++;
        else tally.unchanged++;
      } else {
        tally.skipped++;
      }
    } catch (e) {
      // 40001: the doctor's own operation holds the lock; the next run sees it again.
      if ((e as { code?: string })?.code === '40001') tally.busy++;
      else {
        tally.errors++;
        deps.log?.('signature_maintenance_error', { operationId: item?.operationId, kind: item?.kind, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
  }
  return json(200, tally);
}
