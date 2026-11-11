import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkQuota, recordUsage, creditsFromUsage, QuotaExceededError, OperationRateError, quotaResponse, settleFailedCall, transcriptionReservationCredits, DEFAULT_DAILY_LIMIT } from '../../supabase/functions/_shared/quota';

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

describe('quota at OpenAI prices', () => {
  beforeEach(()=>vi.stubGlobal('Deno',{env:{get:()=> 'true'}}));
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
  const terra = (inputTokens: number, outputTokens: number) => creditsFromUsage({ provider: 'openai', model: 'gpt-6.1-terra', inputTokens, outputTokens });
  const minutes = (n: number) => creditsFromUsage({ provider: 'openai', model: 'gpt-transcribe', durationSeconds: n * 60 });
  it('matches the documented price table', () => {
    expect(terra(200_000, 0)).toBeCloseTo(200); // $1 per 1M input = 0.001 credits per token
    expect(terra(0, 200_000)).toBeCloseTo(1000); // $5 per 1M output = 0.005 credits per token
    expect(minutes(1)).toBeCloseTo(4.5); // $0.0045 per minute
  });
  it('fits a full clinic day (25 consultations of 20 minutes, briefings and questions) with margin', () => {
    const perVisit = minutes(20) + terra(12_000, 2_000) + terra(12_000, 2_000) / 2 + terra(3_000, 400) + terra(6_000, 600) + terra(1_500, 300) + 2 * terra(20_000, 400);
    const day = 25 * perVisit;
    expect(day).toBeLessThan(DEFAULT_DAILY_LIMIT * 0.65);
    // The largest in-flight reservation (a 25 MB recording) still fits on top of a full day.
    expect(day + transcriptionReservationCredits(25 * 1024 * 1024)).toBeLessThan(DEFAULT_DAILY_LIMIT);
  });
  it('reserves for a transcription in proportion to the audio size, never below its real cost', () => {
    const small = transcriptionReservationCredits(512 * 1024);
    const medium = transcriptionReservationCredits(10 * 1024 * 1024);
    const large = transcriptionReservationCredits(25 * 1024 * 1024);
    expect(small).toBe(25);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
    // 20 minutes of opus at 64 kbps is ~9.6 MB and costs 90 credits.
    expect(transcriptionReservationCredits(9.6 * 1000 * 1000)).toBeGreaterThanOrEqual(minutes(20));
    expect(large).toBeLessThan(600);
    expect(transcriptionReservationCredits(0)).toBe(25);
  });
  it('tells when the quota renews, on the clinic day (São Paulo)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T22:30:00Z')); // 19:30 in São Paulo
    const error = new QuotaExceededError(8000, 8000);
    expect(error.message).toBe('Limite diário de IA atingido (8000 de 8000 créditos). Renova à meia-noite, horário de Brasília (em cerca de 5 h).');
    const body = await quotaResponse(error, {}).json();
    expect(body).toMatchObject({ quotaExceeded: true, resetsAt: '2026-11-12T03:00:00.000Z' });
  });
  it('releases a never-billed failure at zero, charges an unusable paid answer and leaves an unknown one', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await settleFailedCall({ rpc } as never, 'user', 'r1', { billing: 'none' });
    expect(rpc).toHaveBeenLastCalledWith('settle_usage', { p_user_id: 'user', p_reservation_id: 'r1', p_credits: 0 });
    await settleFailedCall({ rpc } as never, 'user', 'r2', { billing: 'reserved' });
    expect(rpc).toHaveBeenLastCalledWith('settle_usage', { p_user_id: 'user', p_reservation_id: 'r2', p_credits: null });
    rpc.mockClear();
    await settleFailedCall({ rpc } as never, 'user', 'r3', new Error('Synthetic timeout'));
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(settleFailedCall({ rpc } as never, 'user', 'r4', { billing: 'none' })).resolves.toBeUndefined();
  });
  it('three failed calls do not lock the doctor out', async () => {
    // A tiny in-memory reserve/settle with the SQL semantics: used + reserved must fit the limit.
    let reserved = 0; let used = 0; const open = new Map<string, number>();
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'admit_operation') return { data: { allowed: true, used: 0, limit: 30 }, error: null };
      if (name === 'reserve_usage') {
        const credits = Number(args.p_credits);
        if (used + reserved + credits > 1000) return { data: { allowed: false, used: used + reserved, limit: 1000 }, error: null };
        reserved += credits; open.set(String(args.p_reservation_id), credits);
        return { data: { allowed: true, used: used + reserved, limit: 1000 }, error: null };
      }
      const credits = open.get(String(args.p_reservation_id)) ?? 0;
      open.delete(String(args.p_reservation_id)); reserved -= credits; used += args.p_credits === null ? credits : Number(args.p_credits);
      return { data: true, error: null };
    });
    for (let i = 0; i < 3; i++) {
      const { reservationId } = await checkQuota({ rpc } as never, 'user', 400);
      await settleFailedCall({ rpc } as never, 'user', reservationId, { billing: 'none' });
    }
    await expect(checkQuota({ rpc } as never, 'user', 400)).resolves.toHaveProperty('reservationId');
    expect(used).toBe(0);
  });
});
