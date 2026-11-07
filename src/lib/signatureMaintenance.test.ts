import { describe, expect, it, vi } from 'vitest';
import { maintenanceHandler, type MaintenanceDeps, type PendingItem } from '../../supabase/functions/_shared/signatureMaintenance';

const SECRET = 'synthetic-cron-secret-0123456789abcdef';
const U = 'd1700000-0000-4000-8000-000000000001';
const RX = 'd1720000-0000-4000-8000-000000000001';
const op = (n: number) => `d1740000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, state: string, kind: PendingItem['kind'], over: Partial<PendingItem> = {}): PendingItem => ({
  operationId: op(n), userId: U, prescriptionId: RX, state, attempt: 1, kind,
  candidatePath: `rx/${U}/${RX}/signed-${op(n)}.pdf`, updatedAt: '2026-11-07T10:00:00Z', ...over,
});

function harness(work: PendingItem[], opts: { reconcile?: (a: Record<string, unknown>) => unknown } = {}) {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const removed: string[] = [];
  const deps: MaintenanceDeps = {
    cronSecret: SECRET,
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === 'signature_expire_sessions') return 2;
      if (name === 'signature_pending_work') return work;
      if (name === 'signature_reconcile') return opts.reconcile ? opts.reconcile(args!) : { state: 'failed' };
      return null;
    }),
    removeObject: vi.fn(async (path: string) => { removed.push(path); }),
    log: vi.fn(),
  };
  const run = (secret = SECRET) => maintenanceHandler(new Request('https://x/m', { method: 'POST', headers: { 'x-cortex-cron': secret } }), deps);
  return { deps, calls, removed, run };
}

describe('signature maintenance executor', () => {
  it('refuses calls without the cron secret', async () => {
    const h = harness([]);
    expect((await h.run('wrong')).status).toBe(401);
    expect((await maintenanceHandler(new Request('https://x/m'), h.deps)).status).toBe(401);
    expect(h.calls).toEqual([]);
  });

  it('expires sessions, reconciles stuck operations with their attempt, and removes ended candidates', async () => {
    const h = harness([item(1, 'prepared', 'stuck', { attempt: 0 }), item(2, 'psc_requested', 'stuck', { attempt: 2 }), item(3, 'cancelled', 'remove_candidate')],
      { reconcile: (a) => ({ state: a.p_expected_state === 'prepared' ? 'failed' : 'ambiguous' }) });
    const res = await (await h.run()).json();
    expect(res).toMatchObject({ expiredSessions: 2, failed: 1, ambiguous: 1, removed: 1, errors: 0 });
    expect(h.calls.filter(([n]) => n === 'signature_reconcile').map(([, a]) => a)).toEqual([
      { p_user: U, p_operation: op(1), p_expected_state: 'prepared', p_expected_attempt: 0 },
      { p_user: U, p_operation: op(2), p_expected_state: 'psc_requested', p_expected_attempt: 2 },
    ]);
    expect(h.removed).toEqual([`rx/${U}/${RX}/signed-${op(3)}.pdf`]);
    expect(h.calls.at(-1)).toEqual(['signature_cleanup_done', { p_user: U, p_operation: op(3) }]);
  });

  it('never removes a completed file, a waiting candidate or a path that does not match the ids', async () => {
    const h = harness([
      item(4, 'completed', 'remove_candidate'),
      item(5, 'stored', 'remove_candidate'),
      item(6, 'failed', 'remove_candidate', { candidatePath: `rx/${U}/${RX}/signed-${op(7)}.pdf` }),
      item(8, 'failed', 'remove_candidate', { userId: '../etc' }),
      item(9, 'completed', 'stuck'),
    ]);
    const res = await (await h.run()).json();
    expect(res).toMatchObject({ removed: 0, skipped: 5 });
    expect(h.deps.removeObject).not.toHaveBeenCalled();
    expect(h.calls.some(([n]) => n === 'signature_reconcile' || n === 'signature_cleanup_done')).toBe(false);
  });

  it('leaves the flag when Storage fails, and counts a busy operation without failing the run', async () => {
    const h = harness([item(10, 'failed', 'remove_candidate'), item(11, 'reserved', 'stuck', { attempt: 0 })], {
      reconcile: () => { throw Object.assign(new Error('busy'), { code: '40001' }); },
    });
    vi.mocked(h.deps.removeObject).mockRejectedValueOnce(new Error('Storage indisponível'));
    const res = await (await h.run()).json();
    expect(res).toMatchObject({ removed: 0, busy: 1, errors: 1 });
    expect(h.calls.some(([n]) => n === 'signature_cleanup_done')).toBe(false);
  });

  it('still reconciles when expiring sessions fails, and answers 503 when the listing fails', async () => {
    const h = harness([item(12, 'failed', 'remove_candidate')]);
    const rpc = h.deps.rpc;
    h.deps.rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'signature_expire_sessions') throw new Error('timeout');
      return rpc(name, args);
    });
    expect(await (await h.run()).json()).toMatchObject({ removed: 1, errors: 1 });
    const down = harness([]);
    down.deps.rpc = vi.fn(async (name: string) => { if (name === 'signature_pending_work') throw new Error('down'); return 0; });
    expect((await down.run()).status).toBe(503);
  });
});
