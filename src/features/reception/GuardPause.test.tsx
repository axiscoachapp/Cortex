// Regression (review 2026-11-10, recepção findings 3 and 4; clínico-médico 29): a
// same-session token refresh or a failed clinic_access poll pauses the guards
// instead of invalidating an open "Novo atendimento" and discarding what was typed.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAssurance } from '@/components/SessionAssurance';
import { ClinicAccessGate } from './ClinicAccessGate';
import { NewCaseDialog } from './NewCaseDialog';
import { ClinicAccessTransportError } from './accessErrors';

const actor = '11111111-1111-4111-8111-111111111111', other = '66666666-6666-4666-8666-666666666666',
  clinic = '22222222-2222-4222-8222-222222222222', doctor = '55555555-5555-4555-8555-555555555555';
const mock = vi.hoisted(() => ({ level: vi.fn(), access: vi.fn(), contacts: vi.fn(), createCase: vi.fn(), createContact: vi.fn(), expiry: 100, user: '' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { mfa: { getAuthenticatorAssuranceLevel: mock.level, listFactors: vi.fn(), challengeAndVerify: vi.fn() } } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mock.user }, session: { expires_at: mock.expiry }, signOut: vi.fn() }) }));
vi.mock('./api', () => ({ receptionApi: { access: mock.access, contacts: mock.contacts, createCase: mock.createCase, createContact: mock.createContact } }));

const accessValue = { kind: 'reception', active: true, admin: false, actorId: actor, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [{ id: doctor, name: 'Médica sintética', specialty: null }], staff: [] };
const interrupted = /verificação deste atendimento foi interrompida/;
const hint = 'Verificando acesso… O preenchimento continua preservado.';
beforeEach(() => {
  mock.expiry = 100;
  mock.user = actor;
  mock.level.mockReset().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
  mock.access.mockReset().mockResolvedValue(accessValue);
  mock.contacts.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  mock.createCase.mockReset();
  mock.createContact.mockReset();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/recepcao']}>
    <SessionAssurance><ClinicAccessGate><NewCaseDialog onClose={() => {}} onCreated={() => {}} /></ClinicAccessGate></SessionAssurance>
  </MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { client, tree, view };
}
async function typeDraft() {
  fireEvent.click(await screen.findByLabelText('Novo contato', { exact: true }));
  fireEvent.change(screen.getByLabelText('Nome de quem entrou em contato'), { target: { value: 'Maria sintética' } });
  fireEvent.change(screen.getByLabelText('Assunto administrativo'), { target: { value: 'Quer marcar retorno' } });
  expect(screen.getByLabelText('Assunto administrativo')).toHaveValue('Quer marcar retorno');
}
const failPoll = () => { for (let i = 0; i < 3; i++) mock.access.mockRejectedValueOnce(new ClinicAccessTransportError()); };

describe('guards pause instead of invalidating', () => {
  it('A: a same-session token refresh keeps the open dialog and its typed text', async () => {
    const { tree, view } = mount();
    await typeDraft();
    const subject = screen.getByLabelText('Assunto administrativo');
    subject.focus();
    mock.expiry = 200;
    await act(async () => { view.rerender(tree()); });
    await waitFor(() => expect(mock.level).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText('Assunto administrativo')).toBe(subject);
    expect(subject).toHaveValue('Quer marcar retorno');
    expect(subject).toHaveFocus();
    expect(screen.getByLabelText('Nome de quem entrou em contato')).toHaveValue('Maria sintética');
    expect(screen.queryByText(interrupted)).toBeNull();
    expect(screen.queryByText('Verificando sessão…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar à fila' })).toBeEnabled();
  });

  it('B: a failed clinic_access poll pauses the dialog with the banner; the next poll resumes it intact', async () => {
    const { client } = mount();
    await typeDraft();
    failPoll();
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic-access'] }); });
    expect(await screen.findByText(/Não foi possível atualizar o acesso à clínica/)).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível verificar seu acesso à clínica.')).toBeNull();
    expect(document.querySelector('[data-clinic-page]')).not.toHaveAttribute('hidden');
    expect(screen.getByLabelText('Assunto administrativo')).toHaveValue('Quer marcar retorno');
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar à fila' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Adicionar à fila' }).closest('form')!);
    expect(mock.createContact).not.toHaveBeenCalled();
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic-access'] }); });
    await waitFor(() => expect(screen.queryByText(hint)).toBeNull());
    expect(screen.queryByText(/Não foi possível atualizar o acesso à clínica/)).toBeNull();
    expect(screen.getByLabelText('Assunto administrativo')).toHaveValue('Quer marcar retorno');
    expect(screen.getByLabelText('Nome de quem entrou em contato')).toHaveValue('Maria sintética');
    expect(screen.queryByText(interrupted)).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar à fila' })).toBeEnabled();
  });

  it('a single transient failure absorbed by the quick retry leaves the dialog untouched', async () => {
    const { client } = mount();
    await typeDraft();
    mock.access.mockRejectedValueOnce(new ClinicAccessTransportError());
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic-access'] }); });
    expect(screen.queryByText(/Não foi possível atualizar o acesso à clínica/)).toBeNull();
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.getByLabelText('Assunto administrativo')).toHaveValue('Quer marcar retorno');
  });

  it('a definitive refusal still hides and retires the dialog at once', async () => {
    const { client } = mount();
    await typeDraft();
    mock.access.mockRejectedValueOnce(Object.assign(new Error('blocking'), { code: '42501' }));
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic-access'] }); });
    expect(await screen.findByText('Não foi possível verificar seu acesso à clínica.')).toBeInTheDocument();
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic-access'] }); });
    expect(await screen.findByText(interrupted)).toBeInTheDocument();
    expect(screen.queryByLabelText('Assunto administrativo')).toBeNull();
    expect(screen.queryByDisplayValue('Quer marcar retorno')).toBeNull();
  });

  it('an actor change removes the previous actor dialog and its typed text', async () => {
    const { tree, view } = mount();
    await typeDraft();
    mock.user = other;
    mock.access.mockResolvedValue({ ...accessValue, actorId: other });
    await act(async () => { view.rerender(tree()); });
    expect(screen.queryByDisplayValue('Quer marcar retorno')).toBeNull();
    expect(screen.queryByDisplayValue('Maria sintética')).toBeNull();
    await screen.findByLabelText('Contato existente', { exact: true });
    expect(screen.queryByDisplayValue('Quer marcar retorno')).toBeNull();
    expect(screen.queryByDisplayValue('Maria sintética')).toBeNull();
  });
});
