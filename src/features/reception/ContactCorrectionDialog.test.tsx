import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactCorrectionDialog } from './ContactCorrectionDialog';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { ClinicAccessContext } from './accessContext';

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
    expect(name).toHaveValue('Meu preenchimento');
    expect(mocks.close).not.toHaveBeenCalled();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar cadastro do servidor' }));
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    mocks.snapshot.mockResolvedValue({ ...original, name: 'Versão de outra pessoa', revision: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar cadastro do servidor' }));
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
    expect(name).toHaveValue('Meu preenchimento');
    mocks.update.mockRejectedValue(new Error('Revisão antiga'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisão antiga');
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível');
    expect(name).toHaveValue('Texto para preservar');
    expect(name).not.toBeVisible();
    mocks.snapshot.mockResolvedValue({ ...original, revision: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(name).toBeVisible());
    expect(name).toHaveValue('Texto para preservar');
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
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar cadastro do servidor' }));
    expect(await screen.findByRole('button', { name: 'Recuperando cadastro…' })).toBeDisabled();
    expect(screen.getByLabelText('Nome do contato')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar correção' })).toBeDisabled();
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
});
