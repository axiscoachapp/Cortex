import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharingRpc } from './sharing';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
describe('bounded sharing authorization requests', () => {
  it('aborts and rejects a hanging RPC after the authorization deadline', async () => {
    let signal!: AbortSignal;
    mocks.rpc.mockReturnValue({ abortSignal: (next: AbortSignal) => { signal = next; return new Promise(() => {}); } });
    const request = sharingRpc('sharing_overview');
    const rejected = expect(request).rejects.toMatchObject({ code: 'ACCESS_UNVERIFIED' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(signal.aborted).toBe(true);
  });
  it('cleans up the deadline after a completed RPC', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { received: [] }, error: null }) });
    expect(await sharingRpc('sharing_overview')).toEqual({ received: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
});
