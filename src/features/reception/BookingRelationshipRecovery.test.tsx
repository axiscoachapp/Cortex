import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingDialog } from './BookingDialog';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';

const mocks = vi.hoisted(() => ({ contact: vi.fn(), link: vi.fn(), book: vi.fn(), close: vi.fn() }));
const patient = { id: 'patient-a', name: 'Paciente sintético', dateOfBirth: '2000-01-02', doctorId: 'doctor', relationship: 'guardian' };
const original = { id: 'contact', clinicId: 'clinic', name: 'Contato sintético', phone: '', beneficiaries: [patient] };
vi.mock('./accessContext', () => ({ useClinicAccess: () => ({ actorId: 'staff', clinic: { id: 'clinic' }, doctors: [{ id: 'doctor', name: 'Médico sintético' }] }) }));
vi.mock('./api', () => ({ receptionApi: { contact: mocks.contact, linkPatient: mocks.link, book: mocks.book } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./ContactSearch', () => ({ ContactSearch: ({ onSelect }: { onSelect: (value: typeof original) => void }) => <button onClick={() => onSelect(original)}>Selecionar contato</button> }));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><BookingDialog day="2099-11-03" onClose={mocks.close} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar contato' }));
  return { client, ...view };
}
const relation = () => screen.getByLabelText('Relação do contato com o paciente');
const confirm = () => screen.getByRole('checkbox', { name: /Conferi o paciente/ });
const recover = () => screen.getByRole('button', { name: 'Recuperar vínculo selecionado' });
const save = () => screen.getByRole('button', { name: 'Confirmar agendamento' });
async function select() { fireEvent.click(await screen.findByRole('button', { name: /Paciente sintético/ })); }
describe('booking recovery after administrative relationship correction', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.contact.mockResolvedValue(original); mocks.link.mockResolvedValue(true); mocks.book.mockResolvedValue('booking'); });
  it('blocks an outdated relationship and explicitly recovers it without losing the slot or automatically booking', async () => {
    const { client } = mount(); await select();
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '14:00' } }); fireEvent.change(screen.getByLabelText('Término'), { target: { value: '14:30' } }); fireEvent.click(confirm());
    mocks.contact.mockResolvedValue({ ...original, beneficiaries: [{ ...patient, relationship: 'family' }] });
    await act(async () => { await client.invalidateQueries({ queryKey: ['reception'] }); });
    await screen.findByText(/O vínculo selecionado mudou/); expect(relation()).toHaveValue('guardian'); expect(save()).toBeDisabled();
    fireEvent.click(recover()); await waitFor(() => expect(relation()).toHaveValue('family'));
    expect(confirm()).not.toBeChecked(); expect(save()).toBeDisabled(); expect(screen.getByLabelText('Início')).toHaveValue('14:00'); expect(screen.getByLabelText('Término')).toHaveValue('14:30');
    expect(mocks.link).not.toHaveBeenCalled(); expect(mocks.book).not.toHaveBeenCalled();
    fireEvent.click(confirm()); fireEvent.click(save()); await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.link).toHaveBeenCalledWith('contact', 'doctor', patient.id, 'family'); expect(mocks.book.mock.calls[0][1]).toMatchObject({ patientId: patient.id, doctorId: 'doctor', startTime: '2099-11-03T17:00:00.000Z', endTime: '2099-11-03T17:30:00.000Z' });
  });
  it('keeps the draft and confirmation cleared when recovery fails, then permits explicit retry', async () => {
    mount(); await select(); fireEvent.click(confirm()); mocks.contact.mockRejectedValueOnce(new Error('Leitura indisponível')); fireEvent.click(recover());
    expect(await screen.findByText('Leitura indisponível')).toBeVisible(); expect(relation()).toHaveValue('guardian'); expect(confirm()).not.toBeChecked(); expect(save()).toBeDisabled();
    mocks.contact.mockResolvedValue({ ...original, beneficiaries: [{ ...patient, relationship: 'family' }] }); fireEvent.click(recover()); await waitFor(() => expect(relation()).toHaveValue('family')); expect(mocks.book).not.toHaveBeenCalled();
  });
  it('never replaces the selected beneficiary when the refreshed link is missing', async () => {
    mount(); await select(); mocks.contact.mockResolvedValue({ ...original, beneficiaries: [] }); fireEvent.click(recover());
    expect(await screen.findByText(/O vínculo selecionado não está disponível/)).toBeVisible(); expect(screen.getByText('Paciente selecionado: ' + patient.name)).toBeVisible(); expect(relation()).toHaveValue('guardian'); expect(save()).toBeDisabled(); expect(mocks.link).not.toHaveBeenCalled();
  });
  it('blocks edits, duplicate recovery and session exit until the read finishes', async () => {
    mount(); await select(); let finish!: (value: typeof original) => void; mocks.contact.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(recover()); expect(await screen.findByRole('button', { name: 'Recuperando vínculo…' })).toBeDisabled(); expect(screen.getByLabelText('Início')).toBeDisabled();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {}); expect(confirmSessionExit()).toBe(false); alert.mockRestore(); expect(mocks.contact).toHaveBeenCalledTimes(2);
    await act(async () => { finish(original); }); expect(await screen.findByRole('button', { name: 'Recuperar vínculo selecionado' })).toBeEnabled(); expect(mocks.book).not.toHaveBeenCalled();
  });
  it('ignores a recovery result after unmount', async () => {
    const view = mount(); await select(); let finish!: (value: typeof original) => void; mocks.contact.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(recover()); view.unmount(); await act(async () => { finish(original); }); expect(mocks.close).not.toHaveBeenCalled(); expect(mocks.book).not.toHaveBeenCalled();
  });
  it('rejects a contact response from a different clinic before showing beneficiaries', async () => {
    mocks.contact.mockResolvedValue({ ...original, clinicId: 'other-clinic' }); mount(); expect(await screen.findByText(/O contato não corresponde à clínica/)).toBeVisible(); expect(screen.queryByRole('button', { name: /Paciente sintético/ })).not.toBeInTheDocument();
  });
  it('keeps the booking request identity after an ambiguous result and an explicit relationship recovery', async () => {
    mocks.book.mockRejectedValueOnce(new Error('Resposta perdida')); mount(); await select(); fireEvent.click(confirm()); fireEvent.click(save());
    await screen.findByText('Resposta perdida'); const first = mocks.book.mock.calls[0];
    mocks.contact.mockResolvedValue({ ...original, beneficiaries: [{ ...patient, relationship: 'family' }] }); fireEvent.click(recover()); await waitFor(() => expect(relation()).toHaveValue('family'));
    expect(confirm()).not.toBeChecked(); expect(mocks.book).toHaveBeenCalledTimes(1); fireEvent.click(confirm()); fireEvent.click(save()); await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.book.mock.calls[1]).toEqual(first); expect(mocks.link.mock.calls[1]).toEqual(['contact', 'doctor', patient.id, 'family']);
  });
  it('does not start a booking after the component unmounts during link confirmation', async () => {
    let finish!: (value: boolean) => void; mocks.link.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = mount(); await select(); fireEvent.click(confirm()); fireEvent.click(save()); await waitFor(() => expect(mocks.link).toHaveBeenCalledOnce());
    view.unmount(); await act(async () => { finish(true); }); expect(mocks.book).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it('does not overwrite a corrected link or book when an older confirmation finishes later', async () => {
    let finish!: (value: boolean) => void; mocks.link.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { client } = mount(); await select(); fireEvent.click(confirm()); fireEvent.click(save()); await waitFor(() => expect(mocks.link).toHaveBeenCalledOnce());
    mocks.contact.mockResolvedValue({ ...original, beneficiaries: [{ ...patient, relationship: 'family' }] });
    await act(async () => { await client.invalidateQueries({ queryKey: ['reception'] }); }); await screen.findByText(/O vínculo selecionado mudou/);
    await act(async () => { finish(true); }); await waitFor(() => expect(recover()).toBeEnabled());
    expect(client.getQueryData<typeof original>(['reception', 'staff', 'contact', 'contact'])?.beneficiaries[0].relationship).toBe('family');
    expect(mocks.book).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled(); expect(confirm()).not.toBeChecked();
  });
  it('requires renewed confirmation even when an observed correction returns to the original relationship', async () => {
    let finish!: (value: boolean) => void; mocks.link.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { client } = mount(); await select(); fireEvent.click(confirm()); fireEvent.click(save()); await waitFor(() => expect(mocks.link).toHaveBeenCalledOnce());
    mocks.contact.mockResolvedValue({ ...original, beneficiaries: [{ ...patient, relationship: 'family' }] });
    await act(async () => { await client.invalidateQueries({ queryKey: ['reception'] }); }); await screen.findByText(/O vínculo selecionado mudou/); expect(confirm()).not.toBeChecked();
    mocks.contact.mockResolvedValue(original); await act(async () => { await client.invalidateQueries({ queryKey: ['reception'] }); });
    await act(async () => { finish(true); }); await waitFor(() => expect(recover()).toBeEnabled());
    expect(mocks.book).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled(); expect(confirm()).not.toBeChecked(); expect(save()).toBeDisabled();
  });
});
