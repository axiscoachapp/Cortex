// UX 4 / 12, recepção 6 / 15: a dense chronological day, the doctor's own
// commitments as anonymous busy rows, and actions that fit the day.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionCalendar from './ReceptionCalendar';
import { ClinicAccessContext } from './accessContext';
import { clinicDay, clinicTimestamp, nextClinicDay } from './dates';
import type { ReceptionAppointment } from './contracts';

const mocks = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), busy: vi.fn(), booking: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { appointments: mocks.read, changeAppointment: mocks.change, busyIntervals: mocks.busy } }));
vi.mock('./BookingDialog', () => ({ BookingDialog: (props: unknown) => { mocks.booking(props); return <div role="dialog" aria-label="Novo agendamento" />; } }));

const clinic = '66666666-6666-4666-8666-666666666666', doctor = '88888888-8888-4888-8888-888888888888', today = clinicDay(new Date().toISOString());
const at = (time: string, day = today) => clinicTimestamp(day, time);
const appointment = (id: string, start: string, end: string, day = today, over: Partial<ReceptionAppointment> = {}): ReceptionAppointment => ({
  id, doctorId: doctor, patientId: null, contactId: null, caseId: null, patientName: 'Paciente ' + id.slice(0, 1), startTime: at(start, day), endTime: at(end, day),
  type: 'retorno', status: 'agendado', revision: 2, checkedInAt: null, googleSyncStatus: 'idle', ...over,
});
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ClinicAccessContext.Provider value={{ actorId: '11111111-1111-4111-8111-111111111111', kind: 'reception', active: true, admin: false,
      clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [{ id: doctor, name: 'Dra. Ana', specialty: null }], staff: [] }}>
      <ReceptionCalendar />
    </ClinicAccessContext.Provider>
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.change.mockResolvedValue(3);
  mocks.busy.mockResolvedValue([]);
});

describe('team agenda day', () => {
  it('shows the doctor\'s own commitments as "Ocupado" with nothing but the time', async () => {
    mocks.read.mockResolvedValue({ items: [], blocks: [] });
    mocks.busy.mockResolvedValue([{ doctorId: doctor, startTime: at('15:00', nextClinicDay(today, 1)), endTime: at('16:00', nextClinicDay(today, 1)) }]);
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
    const row = (await screen.findByText('Ocupado · agenda do médico')).closest('li')!;
    expect(row).toHaveTextContent(/^15:00–16:00Ocupado · agenda do médico$/);
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.busy).toHaveBeenLastCalledWith(clinic, at('00:00', nextClinicDay(today)), at('00:00', nextClinicDay(today, 2)), null);
  });

  it('merges blocks and busy periods into the time order, under a weekday heading', async () => {
    const tomorrow = nextClinicDay(today);
    mocks.read.mockResolvedValue({
      items: [appointment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '09:00', '09:30', tomorrow),
        appointment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '14:00', '14:30', tomorrow)],
      blocks: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', doctorId: doctor, startTime: at('12:00', tomorrow), endTime: at('13:00', tomorrow), reason: 'Almoço', revision: 1 }],
    });
    mocks.busy.mockResolvedValue([{ doctorId: doctor, startTime: at('10:00', tomorrow), endTime: at('11:00', tomorrow) }]);
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
    const section = await screen.findByRole('region', { name: /^Amanhã · / });
    await within(section).findByText('Bloqueado · Almoço');
    const rows = within(section).getAllByRole('listitem').map(li => li.textContent ?? '');
    const order = rows.map(text => text.includes('Paciente a') ? 'a' : text.includes('Ocupado') ? 'busy' : text.includes('Almoço') ? 'block' : text.includes('Paciente b') ? 'b' : 'free');
    expect(order.filter(kind => kind !== 'free')).toEqual(['a', 'busy', 'block', 'b']);
    expect(within(section).getAllByRole('button', { name: /^Agendar às/ }).length).toBeGreaterThan(0);
  });

  it('books from a free time with that doctor, day and start', async () => {
    const tomorrow = nextClinicDay(today);
    mocks.read.mockResolvedValue({ items: [], blocks: [] });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agendar às 08:00' }));
    expect(mocks.booking).toHaveBeenLastCalledWith(expect.objectContaining({ doctor, day: tomorrow, start: '08:00' }));
  });

  it('says "Hoje" on today and offers arrival only today', async () => {
    mocks.read.mockResolvedValue({ items: [appointment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '07:00', '07:30')], blocks: [] });
    mount();
    expect(await screen.findByRole('heading', { name: /^Hoje · / })).toBeVisible();
    const row = (await screen.findByRole('heading', { name: 'Paciente a' })).closest('article')!;
    expect(within(row).getByRole('button', { name: 'Registrar chegada' })).toBeVisible();
    expect(within(row).getByText('Agendado')).toBeVisible();
    await userEvent.click(within(row).getByRole('button', { name: 'Registrar chegada' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(clinic, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2, 'check_in'));
  });

  it('offers "Paciente confirmou" on a future day, hides it once confirmed, and never offers arrival there', async () => {
    const tomorrow = nextClinicDay(today);
    const future = appointment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '09:00', '09:30', tomorrow);
    mocks.read.mockResolvedValue({ items: [future, { ...future, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', patientName: 'Paciente b', status: 'confirmado', startTime: at('10:00', tomorrow), endTime: at('10:30', tomorrow) }], blocks: [] });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
    const pending = (await screen.findByRole('heading', { name: 'Paciente a' })).closest('article')!;
    const confirmed = screen.getByRole('heading', { name: 'Paciente b' }).closest('article')!;
    expect(within(pending).getByRole('button', { name: 'Paciente confirmou' })).toBeVisible();
    expect(within(pending).queryByRole('button', { name: 'Registrar chegada' })).not.toBeInTheDocument();
    expect(within(confirmed).getByText('Confirmado')).toBeVisible();
    expect(within(confirmed).queryByRole('button', { name: 'Paciente confirmou' })).not.toBeInTheDocument();
    await userEvent.click(within(confirmed).getByRole('button', { name: /^Mais ações/ }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Remarcar', 'Cancelar agendamento']);
  });

  it('shows an action error next to its row', async () => {
    mocks.read.mockResolvedValue({ items: [appointment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '07:00', '07:30'), appointment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '07:30', '08:00')], blocks: [] });
    mocks.change.mockRejectedValue(new Error('Os dados mudaram em outra tela. Atualize antes de tentar novamente.'));
    mount();
    const first = (await screen.findByRole('heading', { name: 'Paciente a' })).closest('article')!;
    const second = screen.getByRole('heading', { name: 'Paciente b' }).closest('article')!;
    await userEvent.click(within(first).getByRole('button', { name: 'Registrar chegada' }));
    expect(await within(first).findByRole('alert')).toHaveTextContent('Os dados mudaram');
    expect(within(second).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows arrival as a chip with the time and moves "Desfazer chegada" to the menu', async () => {
    mocks.read.mockResolvedValue({ items: [appointment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '07:00', '07:30', today, { checkedInAt: at('06:52') })], blocks: [] });
    mount();
    const row = (await screen.findByRole('heading', { name: 'Paciente a' })).closest('article')!;
    expect(within(row).getByText('Chegou 06:52')).toBeVisible();
    expect(within(row).queryByRole('button', { name: 'Registrar chegada' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /^Mais ações/ }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Paciente confirmou', 'Desfazer chegada', 'Remarcar', 'Cancelar agendamento']);
  });

  it('keeps the agenda when the busy read is unavailable and says so', async () => {
    mocks.read.mockResolvedValue({ items: [], blocks: [] });
    mocks.busy.mockRejectedValue(new Error('indisponível'));
    mount();
    expect(await screen.findByText(/Não foi possível conferir os compromissos particulares/)).toBeVisible();
    expect(screen.getByRole('heading', { name: /^Hoje · / })).toBeVisible();
  });
});
