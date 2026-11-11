import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactCorrectionDialog } from './ContactCorrectionDialog';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { ClinicAccessContext } from './accessContext';
// The shared Radix checkbox measures itself inside a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;


const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), update: vi.fn(), toast: vi.fn(), close: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { contactEdit: mocks.snapshot, updateContact: mocks.update } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
const actor = '22222222-2222-4222-8222-222222222222';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: '22222222-2222-4222-8222-222222222222' } }) }));
const original = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Contato Exemplo',
  phone: ' 9999-1234 ',
  revision: 1,
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <ClinicAccessContext.Provider value={{ actorId: actor, active: true, admin: true, kind: 'clinical', clinic: { id: '33333333-3333-4333-8333-333333333333', name: 'Clínica sintética' }, doctors: [], staff: [] }}>
        <ContactCorrectionDialog contactId={original.id} onClose={mocks.close} />
      </ClinicAccessContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
describe('administrative contact correction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.snapshot.mockResolvedValue(original);
    mocks.update.mockResolvedValue(2);
  });
  it('requires a human review and preserves the raw legacy phone during a name correction', async () => {
    mount();
    const name = await screen.findByLabelText('Nome do contato');
    fireEvent.change(name, { target: { value: 'Contato Corrigido' } });
    const save = screen.getByRole('button', { name: 'Salvar correção' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.click(save);
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith(original.id, 1, 'Contato Corrigido', original.phone);
  });
  it('preserves local input after a stale revision and reloads only after explicit consent', async () => {
    mocks.update.mockRejectedValue(new Error('O contato mudou em outra tela.'));
    mount();
    const name = await screen.findByLabelText('Nome do contato');
    fireEvent.change(name, { target: { value: 'Meu preenchimento' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O contato mudou');
    await waitFor(() => expect(screen.getByLabelText('Nome do contato')).toHaveValue('Meu preenchimento'), { timeout: 1500 });
    expect(mocks.close).not.toHaveBeenCalled();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e recarregar' }));
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    mocks.snapshot.mockResolvedValue({ ...original, name: 'Versão de outra pessoa', revision: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e recarregar' }));
    await waitFor(() => expect(screen.getByLabelText('Nome do contato')).toHaveValue('Versão de outra pessoa'));
    confirm.mockRestore();
  });
  it('clears the review confirmation whenever the edited fields change', async () => {
    mount();
    await screen.findByLabelText('Nome do contato');
    fireEvent.change(screen.getByLabelText('Telefone do contato'), { target: { value: '41999990001' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.change(screen.getByLabelText('Nome do contato'), { target: { value: 'Outra Correção' } });
    expect(screen.getByRole('button', { name: 'Salvar correção' })).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('freezes the editing baseline when a background refetch discovers a newer revision', async () => {
    const { client } = mount();
    const name = await screen.findByLabelText('Nome do contato');
    fireEvent.change(name, { target: { value: 'Meu preenchimento' } });
    mocks.snapshot.mockResolvedValue({ ...original, name: 'Alterado no servidor', revision: 2 });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['reception'] });
    });
    await waitFor(() => expect(screen.getByLabelText('Nome do contato')).toHaveValue('Meu preenchimento'), { timeout: 1500 });
    mocks.update.mockRejectedValue(new Error('Revisão antiga'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));
    expect(await screen.findByRole('alert', {}, { timeout: 1500 })).toHaveTextContent('Revisão antiga');
    expect(mocks.update).toHaveBeenCalledWith(original.id, 1, 'Meu preenchimento', original.phone);
  });
  it('preserves a dirty editor through a background failure and subsequent retry', async () => {
    const { client } = mount();
    const name = await screen.findByLabelText('Nome do contato');
    fireEvent.change(name, { target: { value: 'Texto para preservar' } });
    mocks.snapshot.mockRejectedValue(new Error('Servidor indisponível'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['reception'] });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o cadastro');
    expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
    mocks.snapshot.mockResolvedValue({ ...original, revision: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByLabelText('Nome do contato')).toBeVisible(), { timeout: 1500 });
    expect(screen.getByLabelText('Nome do contato')).toHaveValue('Texto para preservar');
  });
  it('blocks session exit while a correction is still in flight', async () => {
    let finish: (value: number) => void;
    mocks.update.mockReturnValue(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText('Nome do contato'), { target: { value: 'Correção pendente' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));
    await screen.findByRole('button', { name: 'Salvando…' });
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(confirmSessionExit()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Aguarde a confirmação da correção antes de sair.');
    await act(async () => {
      finish!(2);
    });
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    alert.mockRestore();
    confirm.mockRestore();
  });
  it('locks the editor during explicit recovery so a late response cannot discard new edits', async () => {
    mount();
    await screen.findByLabelText('Nome do contato');
    let finish: (value: typeof original) => void;
    mocks.snapshot.mockReturnValueOnce(
      new Promise<typeof original>((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e recarregar' }));
    expect(await screen.findByRole('button', { name: 'Recarregando…' })).toBeDisabled();
    expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar correção' })).not.toBeInTheDocument();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    expect(confirmSessionExit()).toBe(false);
    expect(alert).toHaveBeenCalledWith('Aguarde a recuperação do cadastro antes de sair.');
    alert.mockRestore();
    await act(async () => {
      finish!({ ...original, name: 'Cadastro recuperado', revision: 2 });
    });
    await waitFor(() => expect(screen.getByLabelText('Nome do contato')).toHaveValue('Cadastro recuperado'));
    expect(screen.getByLabelText('Nome do contato')).toBeEnabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  // Round 3, R 30: the shared dialog frame.
  it('puts the error right above "Cancelar" and the primary, and focuses it', async () => {
    mocks.update.mockRejectedValue(new Error('O contato mudou em outra tela.'));
    mount();
    fireEvent.change(await screen.findByLabelText('Nome do contato'), { target: { value: 'Contato Corrigido' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    const cancel = screen.getByRole('button', { name: 'Cancelar' }), save = screen.getByRole('button', { name: 'Salvar correção' });
    expect(alert.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.parentElement).toBe(save.parentElement);
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
  });
});
