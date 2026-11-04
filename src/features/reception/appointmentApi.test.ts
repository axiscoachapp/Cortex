import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receptionApi } from './api';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reply: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
const clinic = 'b8200000-0000-4000-8000-000000000001';
const appointment = 'b8600000-0000-4000-8000-000000000001';

describe('appointment change failures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockReturnValue({ abortSignal: mocks.reply });
  });

  it('explains unavailable appointments without calling them a lost permission', async () => {
    mocks.reply.mockResolvedValue({ data: null, error: { code: '42501', message: 'Agendamento indisponível' } });
    await expect(receptionApi.changeAppointment(clinic, appointment, 1, 'cancel')).rejects.toMatchObject({
      code: '42501', message: 'Agendamento indisponível. Atualize a agenda antes de tentar novamente.',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['denied', 'internal relation reception_calendar_versions', 'Agendamento indisponível: internal detail'])('keeps unrecognized permission errors generic (%s)', async (message) => {
    mocks.reply.mockResolvedValue({ data: null, error: { code: '42501', message } });
    await expect(receptionApi.changeAppointment(clinic, appointment, 1, 'cancel')).rejects.toMatchObject({
      code: '42501', message: 'Você não tem mais permissão para esta ação. Atualize a página.',
    });
  });

  it('preserves the stale/busy revision response and makes no automatic retry', async () => {
    mocks.reply.mockResolvedValue({ data: null, error: { code: '40001', message: 'Agenda em alteração' } });
    await expect(receptionApi.changeAppointment(clinic, appointment, 1, 'cancel')).rejects.toMatchObject({
      code: '40001', message: 'Os dados mudaram em outra tela. Atualize antes de tentar novamente.',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
