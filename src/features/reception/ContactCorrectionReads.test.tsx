import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactCorrectionDialog } from './ContactCorrectionDialog';
import { ClinicAccessContext } from './accessContext';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import type { ClinicAccess, ContactEdit } from './contracts';

const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), toast: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { contactEdit: mocks.read, updateContact: mocks.update } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
const actor = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222';
const contact: ContactEdit = { id: '33333333-3333-4333-8333-333333333333', name: 'Contato sintético', phone: 'Telefone sintético', revision: 4 };
const access: ClinicAccess = { actorId: actor, active: true, admin: true, kind: 'clinical', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const prefix = ['reception', actor, 'contact-edit', clinic, contact.id];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), close = vi.fn();
  if (cached) client.setQueryData(prefix, contact);
  const tree = (next = access, hidden = false) => <QueryClientProvider client={client}><SessionVisibilityContext.Provider value={hidden}><ClinicAccessContext.Provider value={next}><ContactCorrectionDialog contactId={contact.id} onClose={close} /></ClinicAccessContext.Provider></SessionVisibilityContext.Provider></QueryClientProvider>;
  return { ...render(tree()), tree, client, close };
}
type View = ReturnType<typeof mount>;
const currentQuery = (view: View) => view.client.getQueryCache().findAll({ queryKey: prefix }).find(query => query.getObserversCount() > 0)!;
async function edit() {
  fireEvent.change(await screen.findByLabelText('Nome do contato'), { target: { value: 'Meu rascunho sintético' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
}
const form = () => screen.getByLabelText('Nome do contato').closest('form')!;
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(contact); mocks.update.mockResolvedValue(5); });

describe('contact correction verified reader', () => {
  it('does not mount fields from cached data before the new read finishes', async () => {
    const pending = deferred<ContactEdit>(); mocks.read.mockReturnValue(pending.promise); mount(true);
    expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
    await act(async () => pending.resolve(contact)); expect(await screen.findByLabelText('Nome do contato')).toHaveValue(contact.name);
  });
  it('retires fields during refresh, preserves the frozen draft and requires review again', async () => {
    const view = mount(); await edit(); const pending = deferred<ContactEdit>(); mocks.read.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<void>; act(() => { refresh = view.client.invalidateQueries({ queryKey: prefix }); });
    await waitFor(() => expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.queryByRole('button', { name: 'Salvar correção' })).not.toBeInTheDocument();
    await act(async () => { pending.resolve({ ...contact, name: 'Novo nome no servidor', revision: 5 }); await refresh; });
    expect(await screen.findByLabelText('Nome do contato')).toHaveValue('Meu rascunho sintético');
    expect(screen.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked();
    mocks.update.mockRejectedValue(new Error('Revisão antiga sintética'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ })); fireEvent.submit(form());
    await screen.findByText('Revisão antiga sintética');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(contact.id, 4, 'Meu rascunho sintético', contact.phone);
  });
  it('requires review again after an immediate refetch coalesced before React renders', async () => {
    const view = mount(); await edit(); mocks.read.mockResolvedValue({ ...contact, revision: 5 });
    await act(async () => { await view.client.invalidateQueries({ queryKey: prefix }); });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked(), { timeout: 1500 });
    expect(screen.getByRole('button', { name: 'Salvar correção' })).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('removes fields on failure, hides private errors and retries without replacing the draft', async () => {
    const view = mount(); await edit(); mocks.read.mockRejectedValueOnce(new Error('PRIVATE SYNTHETIC READ'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: prefix }); });
    await waitFor(() => expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByLabelText('Nome do contato')).toHaveValue('Meu rascunho sintético');
    expect(screen.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled();
  });
  it('does not show old cached fields when the first read is paused offline', async () => {
    onlineManager.setOnline(false); let view: View | undefined;
    try {
      view = mount(true); expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
      expect(screen.getByText('Aguardando conexão de rede para conferir o cadastro…')).toBeVisible();
      expect(mocks.read).not.toHaveBeenCalled();
    } finally { await act(async () => onlineManager.setOnline(true)); }
    await screen.findByLabelText('Nome do contato'); expect(view!.close).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('removes fields and review while a cached refetch is paused', async () => {
    const view = mount(); await edit(); onlineManager.setOnline(false); let refresh: Promise<void> | undefined;
    try {
      refresh = view.client.invalidateQueries({ queryKey: prefix });
      await waitFor(() => expect(currentQuery(view).state.fetchStatus).toBe('paused'));
      await waitFor(() => expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument(), { timeout: 1500 });
      expect(screen.getByText('Aguardando conexão de rede para conferir o cadastro…')).toBeVisible();
    } finally { await act(async () => { onlineManager.setOnline(true); await refresh; }); }
    expect(await screen.findByLabelText('Nome do contato')).toHaveValue('Meu rascunho sintético');
    expect(screen.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('blocks an old form before React receives the refetch notification', async () => {
    const view = mount(); await edit(); const target = form(), pending = deferred<ContactEdit>(); mocks.read.mockReturnValue(pending.promise);
    const refresh = view.client.invalidateQueries({ queryKey: prefix }); fireEvent.submit(target); await act(async () => {});
    try { expect(mocks.update).not.toHaveBeenCalled(); } finally { await act(async () => { pending.resolve(contact); await refresh; }); }
  });
  it('blocks a form after its query snapshot changes before React rerenders', async () => {
    const view = mount(); await edit(); const target = form();
    const previous = view.client.getQueryData(currentQuery(view).queryKey) as object;
    view.client.setQueryData(currentQuery(view).queryKey, { ...previous, syntheticSnapshotMarker: true }); fireEvent.submit(target); await act(async () => {});
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not start a queued write when a reader refresh starts in the same batch', async () => {
    const view = mount(); await edit(); const target = form(), pending = deferred<ContactEdit>(); mocks.read.mockReturnValue(pending.promise);
    let refresh!: Promise<void>; act(() => { fireEvent.submit(target); refresh = view.client.invalidateQueries({ queryKey: prefix }); });
    await act(async () => {});
    try { expect(mocks.update).not.toHaveBeenCalled(); } finally { await act(async () => { pending.resolve(contact); await refresh; }); }
  });
  it.each(['unmount', 'hidden', 'inactive'])('cancels only the reader after %s', async kind => {
    const pending = deferred<ContactEdit>(); mocks.read.mockReturnValue(pending.promise); const view = mount();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); const signal = mocks.read.mock.calls[0][1] as AbortSignal;
    if (kind === 'unmount') view.unmount();
    if (kind === 'hidden') view.rerender(view.tree(access, true));
    if (kind === 'inactive') view.rerender(view.tree({ ...access, active: false }));
    expect(signal).toBeInstanceOf(AbortSignal); await waitFor(() => expect(signal.aborted).toBe(true), { timeout: 1500 });
    await act(async () => pending.resolve(contact)); expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled();
  });
});
