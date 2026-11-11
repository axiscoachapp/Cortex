// B12 / C21 / UX 5, 6, 11: booking shows the doctor's day, offers free times,
// defaults to the next free one and shows a conflict above the buttons.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingDialog } from './BookingDialog';
import { clinicTimestamp } from './dates';

const mocks = vi.hoisted(() => ({ contact: vi.fn(), patients: vi.fn(), link: vi.fn(), book: vi.fn(), close: vi.fn(), appointments: vi.fn(), busy: vi.fn() }));
vi.mock('./accessContext', () => ({ useClinicAccess: () => ({ actorId: 'staff', clinic: { id: 'clinic' }, doctors: [{ id: 'doctor', name: 'Dra. Ana' }] }) }));
vi.mock('./api', () => ({ receptionApi: { contact: mocks.contact, patients: mocks.patients, linkPatient: mocks.link, book: mocks.book, appointments: mocks.appointments, busyIntervals: mocks.busy } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const contact = { id: 'contact', name: 'Maria Sintética', phone: '' };
vi.mock('./ContactSearch', () => ({ ContactSearch: ({ onSelect }: { onSelect: (value: typeof contact) => void }) => <button onClick={() => onSelect(contact)}>Selecionar contato</button> }));

const day = '2099-11-03';
const at = (time: string) => clinicTimestamp(day, time);
const linked = { id: 'patient', name: 'Paciente sintética', dateOfBirth: null, doctorId: 'doctor', relationship: 'self' as const };
const dayRead = {
  items: [{ id: '11111111-1111-4111-8111-111111111111', doctorId: 'doctor', patientId: 'patient', contactId: 'contact', caseId: null, patientName: 'Consulta marcada',
    startTime: at('08:00'), endTime: at('08:30'), type: 'retorno', status: 'agendado', revision: 1, checkedInAt: null, googleSyncStatus: 'idle' }],
  blocks: [{ id: '22222222-2222-4222-8222-222222222222', doctorId: 'doctor', startTime: at('09:00'), endTime: at('10:00'), reason: 'Reunião', revision: 1 }],
};
const busy = [{ doctorId: 'doctor', startTime: at('10:00'), endTime: at('11:00') }];

function mount(props: Partial<Parameters<typeof BookingDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BookingDialog onClose={mocks.close} day={day} {...props} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar contato' }));
}
const save = () => screen.getByRole('button', { name: /^Agendar / });
const chips = () => within(screen.getByRole('group', { name: 'Horários livres' })).getAllByRole('button').map(b => b.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.contact.mockResolvedValue({ ...contact, clinicId: 'clinic', beneficiaries: [linked] });
  mocks.appointments.mockResolvedValue(dayRead);
  mocks.busy.mockResolvedValue(busy);
  mocks.link.mockResolvedValue(true);
  mocks.book.mockResolvedValue('booking');
});

describe('booking with the doctor\'s day in view', () => {
  it('is titled like its trigger and asks for no extra checkbox', async () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Novo agendamento' })).toBeVisible();
    await screen.findByRole('group', { name: 'Horários livres' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the day, keeps busy times out of the chips and defaults to the next free time', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Paciente sintética' }));
    await screen.findByRole('group', { name: 'Horários livres' });
    expect(chips().slice(0, 3)).toEqual(['08:30', '11:00', '11:30']);
    expect(mocks.appointments).toHaveBeenCalledWith('clinic', at('00:00'), clinicTimestamp('2099-11-04', '00:00'), 'doctor');
    expect(mocks.busy).toHaveBeenCalledWith('clinic', at('00:00'), clinicTimestamp('2099-11-04', '00:00'), 'doctor');
    // The doctor's own commitment appears with no detail at all.
    const busyRow = screen.getByText('Ocupado · agenda do médico').closest('li')!;
    expect(busyRow).toHaveTextContent(/^10:00–11:00Ocupado · agenda do médico$/);
    expect(screen.getByText('Bloqueado · Reunião')).toBeVisible();
    expect(save()).toHaveTextContent('Agendar ter 03/11 às 08:30 · Dra. Ana');
  });

  it('fills start and end from a chip by the type duration and books exactly that', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Paciente sintética' }));
    await screen.findByRole('group', { name: 'Horários livres' });
    fireEvent.click(screen.getByRole('button', { name: '11:00' }));
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'novo' } });
    expect(save()).toHaveTextContent('Agendar ter 03/11 às 11:00 · Dra. Ana');
    fireEvent.click(save());
    await waitFor(() => expect(mocks.book).toHaveBeenCalledOnce());
    expect(mocks.book.mock.calls[0][1]).toMatchObject({ startTime: at('11:00'), endTime: at('12:00'), type: 'novo', patientId: 'patient' });
  });

  it('keeps the duration when a manual start changes', async () => {
    mount();
    await screen.findByRole('group', { name: 'Horários livres' });
    fireEvent.click(screen.getByRole('button', { name: 'Outro horário' }));
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '14:00' } });
    expect(screen.getByLabelText('Término')).toHaveValue('14:30');
    fireEvent.change(screen.getByLabelText('Término'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '16:00' } });
    expect(screen.getByLabelText('Término')).toHaveValue('17:00');
  });

  it('starts at the free time picked in the agenda', async () => {
    mount({ start: '15:00', doctor: 'doctor' });
    fireEvent.click(await screen.findByRole('button', { name: 'Paciente sintética' }));
    await screen.findByRole('group', { name: 'Horários livres' });
    expect(save()).toHaveTextContent('às 15:00');
  });

  it('renders a conflict directly above the buttons, focused, and reloads the day', async () => {
    mocks.book.mockRejectedValue(Object.assign(new Error('Horário ocupado ou bloqueado. Escolha outro intervalo.'), { code: '23P01' }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Paciente sintética' }));
    await screen.findByRole('group', { name: 'Horários livres' });
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Este horário já está ocupado na agenda do médico');
    expect(alert).toHaveFocus();
    expect(alert.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(mocks.appointments).toHaveBeenCalledTimes(2));
    expect(mocks.busy).toHaveBeenCalledTimes(2);
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('still offers times when the busy read is unavailable, and says so', async () => {
    mocks.busy.mockRejectedValue(new Error('indisponível'));
    mount();
    await screen.findByRole('group', { name: 'Horários livres' });
    expect(screen.getByText(/Não foi possível conferir os compromissos particulares/)).toBeVisible();
    expect(chips()[0]).toBe('08:30');
  });

  it('starts a contact with nobody registered at "Primeiro cadastro" with the contact as the patient', async () => {
    mocks.contact.mockResolvedValue({ ...contact, clinicId: 'clinic', beneficiaries: [] });
    mount();
    await waitFor(() => expect(screen.getByLabelText('Primeiro cadastro com este médico')).toBeChecked());
    expect(screen.getByLabelText('Nome do novo paciente')).toHaveValue('Maria Sintética');
    expect(screen.getByLabelText('Tipo')).toHaveValue('novo');
    // First visit: an hour; 08:30–09:30 would cross the 09:00 block.
    await waitFor(() => expect(chips()[0]).toBe('11:00'));
    fireEvent.change(screen.getByLabelText('Relação do contato com o paciente'), { target: { value: 'guardian' } });
    expect(screen.getByLabelText('Nome do novo paciente')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Relação do contato com o paciente'), { target: { value: 'self' } });
    expect(screen.getByLabelText('Nome do novo paciente')).toHaveValue('Maria Sintética');
    fireEvent.click(save());
    await waitFor(() => expect(mocks.book).toHaveBeenCalledOnce());
    expect(mocks.book.mock.calls[0][1]).toMatchObject({ beneficiaryName: 'Maria Sintética', relationship: 'self', patientId: null, caseId: null, startTime: at('11:00'), endTime: at('12:00') });
    expect(mocks.link).not.toHaveBeenCalled();
  });
});
