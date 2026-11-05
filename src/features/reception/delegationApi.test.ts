import { beforeEach, describe, expect, it, vi } from 'vitest';
import { delegationApi } from './delegationApi';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
const clinic = '11111111-1111-4111-8111-111111111111';
const staff = '22222222-2222-4222-8222-222222222222';
const doctor = '33333333-3333-4333-8333-333333333333';
const operation = '44444444-4444-4444-8444-444444444444';
const snapshot = { id: operation, state: 'pending', revision: 1, capabilityVersion: 'clinic_reception_v1' };
function answer(data: unknown, error: unknown = null) {
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error }) });
}
describe('authenticated delegation API', () => {
  beforeEach(() => vi.resetAllMocks());
  it('binds administrative inputs and keeps the operation for an explicit retry', async () => {
    answer(snapshot);
    const input = { clinicId: clinic, staffId: staff, doctorId: doctor, operationId: operation };
    await delegationApi.request(input); await delegationApi.request(input);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith('reception_request_delegation', { p_clinic: clinic, p_staff: staff, p_doctor: doctor, p_operation: operation });
  });
  it.each(['approve', 'deny', 'cancel', 'revoke'] as const)('routes %s with the displayed revision', async action => {
    answer(snapshot);
    await delegationApi.change({ requestId: operation, revision: 3, action, operationId: operation });
    const decide = action === 'approve' || action === 'deny';
    expect(mocks.rpc).toHaveBeenCalledWith(`reception_${decide ? 'decide' : action}_delegation`, {
      p_request: operation, p_revision: 3, p_operation: operation, ...(decide ? { p_decision: action } : {}),
    });
  });
  it('preserves microseconds in a composite cursor and defaults to the physician view', async () => {
    const cursor = { createdAt: '2026-11-05T12:00:00.123456+00:00', id: operation };
    answer({ canManage: false, items: [], nextCursor: cursor });
    expect((await delegationApi.list({ cursor })).nextCursor).toEqual(cursor);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_delegation_requests', { p_clinic: null, p_after: cursor.createdAt, p_after_id: operation, p_limit: 50 });
  });
  it('rejects actor injection, invalid limits and unrecognized response fields', async () => {
    await expect(delegationApi.list({ limit: 101 })).rejects.toThrow();
    await expect(delegationApi.request({ clinicId: clinic, staffId: staff, doctorId: doctor, operationId: operation, actor: doctor } as never)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    answer({ canManage: true, items: [], nextCursor: null, clinicalNotes: [] });
    await expect(delegationApi.list({ clinicId: clinic })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not retry conflicts or expose raw database errors', async () => {
    answer(null, { code: '40001', message: 'internal details' });
    await expect(delegationApi.change({ requestId: operation, revision: 1, action: 'approve', operationId: operation })).rejects.toMatchObject({ code: '40001', message: expect.stringContaining('Atualize') });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('binds the staff provenance reader to explicit clinic/staff and a bounded cursor',async()=>{
    answer({items:[{doctorId:doctor,doctorName:'Médico sintético',source:'legacy',requestId:null,effective:true}],nextCursor:doctor});
    const result=await delegationApi.permissions({clinicId:clinic,staffId:staff,after:doctor});
    expect(result.items[0].source).toBe('legacy');
    expect(mocks.rpc).toHaveBeenCalledWith('reception_staff_permissions',{p_clinic:clinic,p_staff:staff,p_after:doctor,p_limit:50});
  });
  it('refuses a proven-approval projection without its exact request and rejects actor injection',async()=>{
    await expect(delegationApi.permissions({clinicId:clinic,staffId:staff,actorId:doctor} as never)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    answer({items:[{doctorId:doctor,doctorName:'Médico sintético',source:'physician_approval',requestId:null,effective:true}],nextCursor:null});
    await expect(delegationApi.permissions({clinicId:clinic,staffId:staff})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('fetches the withdrawal review by request only and requires an approved exact DTO',async()=>{
    answer({id:operation,clinicId:clinic,clinicName:'Clínica sintética',staffId:staff,staffName:'Recepção sintética',doctorId:doctor,doctorName:'Médico sintético',revision:2,state:'approved',capabilityVersion:'clinic_reception_v1'});
    await delegationApi.withdrawal(operation);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_delegation_withdrawal',{p_request:operation});
    answer({...snapshot,state:'revoked'});
    await expect(delegationApi.withdrawal(operation)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
});
