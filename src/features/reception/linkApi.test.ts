import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receptionApi, ReceptionError } from './api';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reply: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
}));
const contactId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const snapshot = {
  contactId, patientId, doctorId: '33333333-3333-4333-8333-333333333333',
  patientName: 'Beneficiário sintético', dateOfBirth: null, doctorName: 'Médico sintético',
  relationship: 'guardian', revision: 1, active: true, patientAvailable: true, doctorActive: true,
};
describe('administrative link correction API boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockReturnValue({ abortSignal: mocks.reply });
  });
  it('reads the separate bounded administrative snapshot', async () => {
    mocks.reply.mockResolvedValue({ data: snapshot, error: null });
    expect(await receptionApi.linkEdit(contactId, patientId)).toEqual(snapshot);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_link_edit', { p_contact: contactId, p_patient: patientId });
  });
  it('rejects clinical content in an administrative response', async () => {
    mocks.reply.mockResolvedValue({ data: { ...snapshot, medical_history: 'Synthetic restricted content' }, error: null });
    await expect(receptionApi.linkEdit(contactId, patientId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects a missing or invalid revision', async () => {
    mocks.reply.mockResolvedValue({ data: { ...snapshot, revision: 0 }, error: null });
    await expect(receptionApi.linkEdit(contactId, patientId)).rejects.toBeInstanceOf(ReceptionError);
  });
  it('sends the reviewed revision and relationship without clinical fields', async () => {
    mocks.reply.mockResolvedValue({ data: 2, error: null });
    expect(await receptionApi.updateLinkRelationship(contactId, patientId, 1, 'family')).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_update_link_relationship', {
      p_contact: contactId, p_patient: patientId, p_revision: 1, p_relationship: 'family',
    });
  });
  it('reports a stale revision without automatically overwriting it', async () => {
    mocks.reply.mockResolvedValue({ data: null, error: { code: '40001', message: 'old revision' } });
    await expect(receptionApi.updateLinkRelationship(contactId, patientId, 1, 'family')).rejects.toMatchObject({
      code: '40001', message: 'Os dados mudaram em outra tela. Atualize antes de tentar novamente.',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps permission failures distinct from an empty editor', async () => {
    mocks.reply.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(receptionApi.linkEdit(contactId, patientId)).rejects.toMatchObject({ code: '42501' });
  });
});
