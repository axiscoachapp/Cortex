import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkQuota, recordUsage, creditsFromUsage, QuotaExceededError, OperationRateError, quotaResponse } from '../../supabase/functions/_shared/quota';

describe('quota reservation boundary', () => {
  beforeEach(()=>vi.stubGlobal('Deno',{env:{get:()=> 'true'}}));
  afterEach(()=>vi.unstubAllGlobals());
  it('reserves before allowing a paid operation', async () => {
    const rpc = vi.fn().mockResolvedValue({data: {allowed:true, used:100, limit:1500}, error:null});
    const quota = await checkQuota({rpc} as never, 'user', 3);
    expect(quota.reservationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rpc.mock.calls[0][0]).toBe('admit_operation');
    expect(rpc.mock.calls[1][0]).toBe('reserve_usage');
    expect(rpc.mock.calls[1][1].p_credits).toBeGreaterThanOrEqual(25);
  });
  it('fails closed when accounting is unavailable', async () => {
    await expect(checkQuota({rpc: async () => ({data:null,error:{message:'offline'}})} as never, 'user', 1)).rejects.toThrow();
  });
  it('rejects a denied atomic reservation', async () => {
    const rpc=vi.fn().mockResolvedValueOnce({data:{allowed:true,used:1,limit:30},error:null}).mockResolvedValueOnce({data:{allowed:false,used:1500,limit:1500},error:null});
    await expect(checkQuota({rpc} as never, 'user', 1)).rejects.toBeInstanceOf(QuotaExceededError);
  });
  it('does not reserve credits when rate admission is denied',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{allowed:false,used:31,limit:30},error:null});
    await expect(checkQuota({rpc} as never,'user',25)).rejects.toBeInstanceOf(OperationRateError);
    expect(rpc).toHaveBeenCalledTimes(1);
    const response=quotaResponse(new OperationRateError(31,30),{});
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toMatchObject({rateLimited:true,quotaExceeded:false});
  });
  it('keeps communication admission available when AI is disabled',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'false'}});
    const rpc=vi.fn().mockResolvedValue({data:{allowed:true,used:1,limit:30},error:null});
    await expect(checkQuota({rpc} as never,'user',25)).rejects.toThrow(/IA/);
    expect(rpc).not.toHaveBeenCalled();
    await expect(checkQuota({rpc} as never,'user',25,'communication')).resolves.toHaveProperty('reservationId');
    expect(rpc).toHaveBeenNthCalledWith(1,'admit_operation',{p_user_id:'user',p_operation:'communication'});
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
