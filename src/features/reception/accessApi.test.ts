import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receptionApi } from './api';
import { ClinicAccessTransportError } from './accessErrors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reply: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));

describe('clinic access transport boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockReturnValue({ abortSignal: mocks.reply }); });
  it.each([
    [0, '', 'TypeError: Failed to fetch'], [0, '', 'AbortError: Aborted'], [0, '', 'TimeoutError: Timed out'],
    [502, '', 'Bad gateway'], [503, '', 'Unavailable'], [504, '', 'Gateway timeout'],
    [503, 'PGRST000', 'Connection'], [503, 'PGRST001', 'Connection'], [503, 'PGRST002', 'Schema unavailable'], [504, 'PGRST003', 'Pool timeout'],
  ])('classifies only documented availability failure %s/%s', async (status, code, message) => {
    mocks.reply.mockResolvedValue({ data: null, status, error: { code, message } });
    await expect(receptionApi.access()).rejects.toBeInstanceOf(ClinicAccessTransportError);
  });
  it.each([
    [403, '42501', 'Denied'], [401, 'PGRST301', 'JWT'], [503, '42501', 'Denied'], [0, '42501', 'TypeError: denied'],
    [0, '', 'SyntaxError: Invalid JSON'], [500, 'XX000', 'Internal'], [404, 'PGRST202', 'Missing function'], [503, 'unknown', 'Unavailable'],
  ])('keeps unknown and authoritative failure %s/%s blocking', async (status, code, message) => {
    mocks.reply.mockResolvedValue({ data: null, status, error: { code, message } });
    await expect(receptionApi.access()).rejects.not.toBeInstanceOf(ClinicAccessTransportError);
  });
  it('does not classify malformed successful role data as transport', async () => {
    mocks.reply.mockResolvedValue({ data: { kind: 'clinical' }, status: 200, error: null });
    await expect(receptionApi.access()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not add continuity to staff-management calls', async () => {
    mocks.reply.mockResolvedValue({ data: null, status: 503, error: { code: 'PGRST002', message: 'Unavailable' } });
    await expect(receptionApi.teamDoctors('11111111-1111-4111-8111-111111111111')).rejects.not.toBeInstanceOf(ClinicAccessTransportError);
  });
});
