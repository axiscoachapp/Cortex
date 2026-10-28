import { describe, expect, it, vi } from 'vitest';
import { checkQuota, recordUsage, creditsFromUsage, QuotaExceededError } from '../../supabase/functions/_shared/quota';

describe('quota reservation boundary', () => {
  it('reserves before allowing a paid operation', async () => {
    const rpc = vi.fn().mockResolvedValue({data: {allowed:true, used:100, limit:1500}, error:null});
    const quota = await checkQuota({rpc} as never, 'user', 3);
    expect(quota.reservationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rpc.mock.calls[0][0]).toBe('reserve_usage');
    expect(rpc.mock.calls[0][1].p_credits).toBeGreaterThanOrEqual(25);
  });
  it('fails closed when accounting is unavailable', async () => {
    await expect(checkQuota({rpc: async () => ({data:null,error:{message:'offline'}})} as never, 'user', 1)).rejects.toThrow();
  });
  it('rejects a denied atomic reservation', async () => {
    await expect(checkQuota({rpc: async () => ({data:{allowed:false,used:1500,limit:1500},error:null})} as never, 'user', 1)).rejects.toBeInstanceOf(QuotaExceededError);
  });
  it('requires a reservation even when provider usage is missing', async () => {
    await expect(recordUsage({rpc:vi.fn()} as never, 'user', 0, '')).rejects.toThrow();
  });
  it('surfaces settlement failures rather than silently granting free calls', async () => {
    await expect(recordUsage({rpc: async () => ({data:null,error:{message:'offline'}})} as never, 'user', 1, 'reservation')).rejects.toThrow();
  });
  it('includes separately reported thinking tokens in output charges', () => {
    expect(creditsFromUsage({promptTokenCount:100,candidatesTokenCount:10,thoughtsTokenCount:100})).toBeCloseTo(0.305);
  });
});
