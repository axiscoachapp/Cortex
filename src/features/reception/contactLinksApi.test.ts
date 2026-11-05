import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receptionApi } from './api';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reply: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
const clinic = '66666666-6666-4666-8666-666666666666', contact = '11111111-1111-4111-8111-111111111111';
const row = { contactId: contact, patientId: '22222222-2222-4222-8222-222222222222', doctorId: '33333333-3333-4333-8333-333333333333', patientName: 'Beneficiário sintético', dateOfBirth: null, doctorName: 'Médico sintético', relationship: 'guardian', revision: 1, active: true, patientAvailable: false, doctorActive: false };
describe('administrative contact link page API', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockReturnValue({ abortSignal: mocks.reply }); });
  it('uses the separate page RPC with explicit bounded defaults and permits unavailable rows', async () => {
    const data = { items: [row], nextCursor: null }; mocks.reply.mockResolvedValue({ data, error: null });
    expect(await receptionApi.contactLinks(clinic, contact)).toEqual(data);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_contact_links', { p_clinic: clinic, p_contact: contact, p_after: null, p_limit: 50 });
  });
  it('passes a next-page cursor and requested page size without changing the existing reader', async () => {
    mocks.reply.mockResolvedValue({ data: { items: [], nextCursor: null }, error: null }); await receptionApi.contactLinks(clinic, contact, row.patientId, 2);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_contact_links', { p_clinic: clinic, p_contact: contact, p_after: row.patientId, p_limit: 2 });
  });
  it.each([
    { items: [{ ...row, medical_history: 'Synthetic private text' }], nextCursor: null },
    { items: [{ ...row, contactId: clinic }], nextCursor: null },
    { items: [{ ...row, revision: 0 }], nextCursor: null },
    { items: [row], nextCursor: clinic },
    { items: [], nextCursor: row.patientId },
    { items: [row, row], nextCursor: null },
    { items: Array.from({ length: 51 }, () => row), nextCursor: null },
  ])('rejects extra/private, cross-contact, invalid or incoherent page data (%#)', async data => {
    mocks.reply.mockResolvedValue({ data, error: null }); await expect(receptionApi.contactLinks(clinic, contact)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('preserves permission failures as errors rather than an empty list', async () => {
    mocks.reply.mockResolvedValue({ data: null, error: { code: '42501', message: 'Synthetic refusal' } });
    await expect(receptionApi.contactLinks(clinic, contact)).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects a page that repeats an earlier cursor even when the row belongs to the contact', async () => {
    mocks.reply.mockResolvedValue({ data: { items: [row], nextCursor: null }, error: null });
    await expect(receptionApi.contactLinks(clinic, contact, row.patientId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
