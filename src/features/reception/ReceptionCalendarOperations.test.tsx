import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionCalendar from './ReceptionCalendar';
import { ClinicAccessContext } from './accessContext';
import { clinicDay, clinicTimestamp, nextClinicDay } from './dates';
import type { ReceptionAppointment } from './contracts';

const mocks = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), block: vi.fn(), busy: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { appointments: mocks.read, changeAppointment: mocks.change, block: mocks.block, busyIntervals: mocks.busy } }));
vi.mock('./BookingDialog', () => ({ BookingDialog: () => null }));

const clinic = '66666666-6666-4666-8666-666666666666';
const doctor = '88888888-8888-4888-8888-888888888888';
const day = clinicDay(new Date().toISOString());
const appointment: ReceptionAppointment = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', doctorId: doctor, patientId: null,
  contactId: '77777777-7777-4777-8777-777777777777', caseId: null,
  patientName: 'Contato sintético', startTime: clinicTimestamp(day, '09:00'), endTime: clinicTimestamp(day, '09:30'),
  type: 'retorno', status: 'agendado', revision: 3, checkedInAt: null, googleSyncStatus: 'idle',
};

function mount(admin = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ClinicAccessContext.Provider value={{ actorId: '11111111-1111-4111-8111-111111111111', kind: 'reception', active: true, admin,
      clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [{ id: doctor, name: 'Médico sintético', specialty: null }], staff: [] }}>
      <ReceptionCalendar />
    </ClinicAccessContext.Provider>
  </QueryClientProvider>);
}

async function reschedule() {
  const heading = await screen.findByRole('heading', { name: appointment.patientName });
  await userEvent.click(within(heading.closest('article')!).getByRole('button', { name: /^Mais ações/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Remarcar' }));
  return screen.getByRole('dialog');
}

describe('reception calendar operational feedback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.read.mockResolvedValue({ items: [appointment], blocks: [] });
    mocks.change.mockResolvedValue(4);
    mocks.block.mockResolvedValue({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 });
    mocks.busy.mockResolvedValue([]);
  });

  it.each(['08:59', '09:00'])('keeps a reschedule ending at %s local and explains the invalid interval', async end => {
    mount();
    const dialog = within(await reschedule());
    fireEvent.change(dialog.getByLabelText('Novo término'), { target: { value: end } });
    expect(dialog.getByRole('alert')).toHaveTextContent('O término deve ser depois do início, no mesmo dia.');
    expect(dialog.getByLabelText('Novo término')).toHaveAttribute('aria-invalid', 'true');
    expect(dialog.getByRole('button', { name: 'Remarcar' })).toBeDisabled();
    fireEvent.submit(dialog.getByRole('button', { name: 'Remarcar' }).closest('form')!);
    await waitFor(() => expect(mocks.change).not.toHaveBeenCalled());
  });

  it('clears the interval error after correction and reschedules only on the explicit button', async () => {
    mount();
    const dialog = within(await reschedule());
    fireEvent.change(dialog.getByLabelText('Novo término'), { target: { value: '08:00' } });
    expect(dialog.getByRole('button', { name: 'Remarcar' })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('Novo término'), { target: { value: '10:00' } });
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.change).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: /^Remarcar para .* às 09:00 · Médico sintético$/ }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(clinic, appointment.id, 3, 'reschedule', clinicTimestamp(day, '09:00'), clinicTimestamp(day, '10:00')));
    expect(mocks.change).toHaveBeenCalledOnce();
  });

  it('moves the end with the start, keeping the appointment length', async () => {
    mount();
    const dialog = within(await reschedule());
    fireEvent.change(dialog.getByLabelText('Novo início'), { target: { value: '14:00' } });
    expect(dialog.getByLabelText('Novo término')).toHaveValue('14:30');
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a reschedule failure above the buttons and focuses it', async () => {
    mocks.change.mockRejectedValue(new Error('Horário ocupado ou bloqueado. Escolha outro intervalo.'));
    mount();
    const dialog = within(await reschedule());
    fireEvent.click(dialog.getByRole('button', { name: /^Remarcar para/ }));
    const alert = await dialog.findByRole('alert');
    expect(alert).toHaveTextContent('Horário ocupado');
    expect(alert).toHaveFocus();
    // Directly above the footer actions, never under the header.
    expect(alert.nextElementSibling).toContainElement(dialog.getByRole('button', { name: 'Cancelar' }));
  });

  it.each(['11:59', '12:00'])('prevents a block ending at %s before making a request', async end => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear horário' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Médico do bloqueio'), { target: { value: doctor } });
    fireEvent.change(dialog.getByLabelText('Término do bloqueio'), { target: { value: end } });
    expect(dialog.getByRole('alert')).toHaveTextContent('O término deve ser depois do início, no mesmo dia.');
    expect(dialog.getByLabelText('Término do bloqueio')).toHaveAttribute('aria-invalid', 'true');
    expect(dialog.getByRole('button', { name: 'Bloquear horário' })).toBeDisabled();
    fireEvent.submit(dialog.getByRole('button', { name: 'Bloquear horário' }).closest('form')!);
    await waitFor(() => expect(mocks.block).not.toHaveBeenCalled());
  });

  it('allows an explicitly submitted block after its interval is corrected', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear horário' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Médico do bloqueio'), { target: { value: doctor } });
    fireEvent.change(dialog.getByLabelText('Término do bloqueio'), { target: { value: '11:00' } });
    fireEvent.change(dialog.getByLabelText('Término do bloqueio'), { target: { value: '14:00' } });
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Bloquear horário' }));
    await waitFor(() => expect(mocks.block).toHaveBeenCalledWith(clinic, doctor, clinicTimestamp(day, '12:00'), clinicTimestamp(day, '14:00'), 'Indisponível', expect.any(String)));
    expect(mocks.block).toHaveBeenCalledOnce();
  });

  it('shows an overnight block only on days it actually overlaps', async () => {
    mocks.read.mockResolvedValue({ items: [], blocks: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', doctorId: doctor, startTime: clinicTimestamp(day, '23:00'),
      endTime: clinicTimestamp(nextClinicDay(day), '00:00'), reason: 'Bloqueio sintético', revision: 1 }] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    await waitFor(() => expect(screen.queryAllByText(/Bloqueio sintético/)).not.toHaveLength(0));
    expect(screen.getAllByText(/Bloqueio sintético/)).toHaveLength(1);
  });

  it('keeps the next day visible when a block ends a microsecond after midnight', async () => {
    mocks.read.mockResolvedValue({ items: [], blocks: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', doctorId: doctor, startTime: clinicTimestamp(day, '23:00'),
      endTime: clinicTimestamp(nextClinicDay(day), '00:00').replace('.000Z', '.000001Z'), reason: 'Bloqueio sintético', revision: 1 }] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    await waitFor(() => expect(screen.queryAllByText(/Bloqueio sintético/)).toHaveLength(2));
  });

  it('excludes a block that ended exactly as the displayed period begins', async () => {
    mocks.read.mockResolvedValue({ items: [], blocks: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', doctorId: doctor, startTime: clinicTimestamp(nextClinicDay(day, -1), '23:00'),
      endTime: clinicTimestamp(day, '00:00'), reason: 'Bloqueio sintético', revision: 1 }] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    await waitFor(() => expect(screen.getAllByText('Nenhum agendamento neste dia.')).toHaveLength(7));
    expect(screen.queryByText(/Bloqueio sintético/)).not.toBeInTheDocument();
  });

  it.each([
    ['pending', 'Sincronização externa pendente. A reserva está registrada no Cortex.'],
    ['failed', 'Não foi possível sincronizar com a agenda externa. A reserva está registrada no Cortex; confira a integração com a equipe responsável.'],
  ] as const)('distinguishes external sync %s without suggesting a duplicate booking', async (googleSyncStatus, message) => {
    mocks.read.mockResolvedValue({ items: [{ ...appointment, googleSyncStatus }], blocks: [] });
    mount(false);
    await screen.findByRole('heading', { name: appointment.patientName });
    expect(screen.getByText(message)).toBeVisible();
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.block).not.toHaveBeenCalled();
  });
});
