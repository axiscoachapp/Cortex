// Regression (review 2026-11-10, recepção finding 5): one failed background
// refetch of the selected case keeps CaseWorkspace mounted (open booking dialog,
// unsaved draft) and only disables the actions until a fresh read succeeds.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionQueue from './ReceptionQueue';
import { ClinicAccessContext } from './accessContext';

const actor = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222', caseId = '33333333-3333-4333-8333-333333333333',
  contactId = '44444444-4444-4444-8444-444444444444', doctor = '55555555-5555-4555-8555-555555555555';
const mocks = vi.hoisted(() => ({ queue: vi.fn(), detail: vi.fn(), contact: vi.fn(), saveDraft: vi.fn(), patients: vi.fn(), book: vi.fn(), sessionActor: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { queue: mocks.queue, case: mocks.detail, contact: mocks.contact, saveDraft: mocks.saveDraft, patients: mocks.patients, book: mocks.book, sessionActor: mocks.sessionActor } }));
vi.mock('./WhatsAppInbox', () => ({ default: () => null }));
// The queue page also reads the unread WhatsApp count; it is not what this test is about.
vi.mock('./whatsappApi', () => ({ whatsappApi: { conversations: async () => ({ conversations: [], nextBefore: null }) } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
vi.mock('@/hooks/use-mobile', () => ({ isBelowMobileBreakpoint: () => false }));

const caseValue = { id: caseId, clinicId: clinic, contactId, contactName: 'Contato sintético', phone: '', doctorId: doctor, subject: 'Retorno', kind: 'return', status: 'assigned',
  assignedTo: actor, revision: 2, createdAt: '2026-11-10T12:00:00Z', beneficiaries: [], eligibleAssignees: [], notes: [], noteCount: 0, draft: { body: '', revision: 0 } };
const access = { actorId: actor, kind: 'reception' as const, active: true, admin: false, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [{ id: doctor, name: 'Médica sintética', specialty: null }], staff: [] };
const stale = 'Atualize o atendimento para continuar. O rascunho e o que foi preenchido continuam preservados.';
beforeEach(() => {
  mocks.queue.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  mocks.detail.mockReset().mockResolvedValue(caseValue);
  mocks.contact.mockReset().mockResolvedValue({ id: contactId, clinicId: clinic, name: 'Contato sintético', phone: '', beneficiaries: [] });
  mocks.saveDraft.mockReset().mockResolvedValue(1);
  mocks.patients.mockReset().mockResolvedValue([]);
  mocks.book.mockReset();
  mocks.sessionActor.mockReset().mockResolvedValue(actor);
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/recepcao?case=${caseId}`]}><ClinicAccessContext.Provider value={access}><ReceptionQueue /></ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>);
  return { client, view };
}
const refetchCase = async (client: QueryClient) => {
  await act(async () => { await client.refetchQueries({ queryKey: ['reception', actor, 'case', caseId] }); });
};
const failOnce = async (client: QueryClient, error: Error = new Error('Falha de rede sintética')) => {
  mocks.detail.mockRejectedValueOnce(error);
  await refetchCase(client);
};

describe('case workspace survives a failed background refetch', () => {
  it('C1: keeps the open booking dialog and its contents, pausing only the confirmation', async () => {
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Agendar consulta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar agendamento' });
    fireEvent.click(await screen.findByLabelText('Primeiro cadastro com este médico'));
    fireEvent.change(screen.getByLabelText('Nome do novo paciente'), { target: { value: 'Paciente sintética nova' } });
    await failOnce(client);
    expect(await screen.findByText('Falha de rede sintética')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Confirmar agendamento' })).toBe(dialog);
    expect(screen.getByDisplayValue('Paciente sintética nova')).toBeInTheDocument();
    expect(screen.getByText('Verificando acesso… O preenchimento continua preservado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar agendamento' })).toBeDisabled();
    await refetchCase(client);
    await waitFor(() => expect(screen.queryByText('Verificando acesso… O preenchimento continua preservado.')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Confirmar agendamento' })).toBe(dialog);
    expect(screen.getByDisplayValue('Paciente sintética nova')).toBeInTheDocument();
    expect(screen.queryByText('Falha de rede sintética')).toBeNull();
    expect(mocks.book).not.toHaveBeenCalled();
  });

  it('C2: keeps the follow-up draft mounted and saves the text typed before the failure', async () => {
    const { client } = mount();
    const field = await screen.findByLabelText('Seu rascunho de acompanhamento');
    fireEvent.change(field, { target: { value: 'Paciente prefere sexta à tarde' } });
    await failOnce(client);
    expect(screen.getByLabelText('Seu rascunho de acompanhamento')).toBe(field);
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(caseId, 'Paciente prefere sexta à tarde', 0));
    expect(field).toHaveValue('Paciente prefere sexta à tarde');
  });

  it('disables actions on the stale case until a fresh read succeeds', async () => {
    const { client } = mount();
    expect(await screen.findByRole('button', { name: 'Agendar consulta' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Seu rascunho de acompanhamento'), { target: { value: 'Nota sintética' } });
    await failOnce(client);
    expect(await screen.findByText(stale)).toBeInTheDocument();
    for (const name of ['Agendar consulta', 'Concluir atendimento', 'Cancelar demanda', 'Registrar anotação']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByLabelText('Seu rascunho de acompanhamento')).toBeEnabled();
    await refetchCase(client);
    await waitFor(() => expect(screen.queryByText(stale)).toBeNull());
    for (const name of ['Agendar consulta', 'Concluir atendimento', 'Cancelar demanda', 'Registrar anotação']) expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  it('removes the case at once when the server definitively refuses it', async () => {
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Agendar consulta' }));
    await screen.findByRole('dialog', { name: 'Confirmar agendamento' });
    await failOnce(client, Object.assign(new Error('Você não tem mais permissão para esta ação. Atualize a página.'), { code: '42501' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirmar agendamento' })).toBeNull());
    expect(screen.queryByLabelText('Seu rascunho de acompanhamento')).toBeNull();
    expect(screen.queryByText('Contato sintético')).toBeNull();
  });

  it('flushes text not yet autosaved when the workspace unmounts', async () => {
    const { view } = mount();
    fireEvent.change(await screen.findByLabelText('Seu rascunho de acompanhamento'), { target: { value: 'Texto antes de sair' } });
    view.unmount();
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(caseId, 'Texto antes de sair', 0));
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
  });
});
