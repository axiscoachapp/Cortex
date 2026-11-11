import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactCorrectionDialog } from './ContactCorrectionDialog';
import { ClinicAccessContext } from './accessContext';
import { SessionPausedContext, SessionVisibilityContext } from '@/contexts/SessionVisibility';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import type { ClinicAccess, ContactEdit } from './contracts';
// The shared Radix checkbox measures itself inside a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;


const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), toast: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('./api', () => ({ receptionApi: { contactEdit: mocks.read, updateContact: mocks.update } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
const clinic = '22222222-2222-4222-8222-222222222222', other = '77777777-7777-4777-8777-777777777777';
const contact: ContactEdit = { id: '33333333-3333-4333-8333-333333333333', name: 'Contato sintético', phone: 'Telefone sintético', revision: 4 };
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: true, kind: 'clinical', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(value = access, hidden = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), close = vi.fn();
  const tree = (next = value, invisible = hidden, target = contact.id) => <QueryClientProvider client={client}><SessionVisibilityContext.Provider value={invisible}><ClinicAccessContext.Provider value={next}><ContactCorrectionDialog contactId={target} onClose={close} /></ClinicAccessContext.Provider></SessionVisibilityContext.Provider></QueryClientProvider>;
  return { ...render(tree()), tree, client, close };
}
type View = ReturnType<typeof mount>;
function change(view: View, kind: string) {
  if (kind === 'unmount') view.unmount();
  if (kind === 'actor') { mocks.actor = other; view.rerender(view.tree({ ...access, actorId: other })); }
  if (kind === 'clinic') view.rerender(view.tree({ ...access, clinic: { id: other, name: 'Outra clínica sintética' } }));
  if (kind === 'admin') view.rerender(view.tree({ ...access, admin: false }));
  if (kind === 'inactive') view.rerender(view.tree({ ...access, active: false }));
  if (kind === 'hidden') view.rerender(view.tree(access, true));
  if (kind === 'role') view.rerender(view.tree({ ...access, kind: 'reception' }));
  if (kind === 'target') view.rerender(view.tree(access, false, other));
}
async function edit() {
  fireEvent.change(await screen.findByLabelText('Nome do contato'), { target: { value: 'Correção sintética' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Conferi a identidade/ }));
}
const form = () => screen.getByLabelText('Nome do contato').closest('form')!;
const submit = () => fireEvent.submit(form());
beforeEach(() => { vi.resetAllMocks(); mocks.actor = access.actorId; mocks.read.mockResolvedValue(contact); mocks.update.mockResolvedValue(5); });

describe('contact correction context and async effects', () => {
  it.each(['actor', 'clinic', 'admin', 'inactive', 'hidden', 'role', 'target'])('removes old fields and refuses stale submit after %s changes', async kind => {
    const view = mount(); await edit(); const old = form(); change(view, kind);
    await waitFor(() => expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.queryByDisplayValue(contact.phone)).not.toBeInTheDocument(); fireEvent.submit(old); await act(async () => {});
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses a loaded identity that differs from the contact opened by the person', async () => {
    mocks.read.mockResolvedValue({ ...contact, id: other }); mount();
    await screen.findByRole('alert', {}, { timeout: 1500 });
    expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not start a queued mutation after context changes before its first await', async () => {
    const view = mount(); await edit(); const target = form();
    act(() => { fireEvent.submit(target); change(view, 'clinic'); }); await act(async () => {});
    expect(mocks.update).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it.each(['actor', 'clinic', 'target', 'hidden', 'unmount'])('does not adopt a late initial read after %s', async kind => {
    const pending = deferred<ContactEdit>(); mocks.read.mockReturnValue(pending.promise); const view = mount();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); change(view, kind); await act(async () => pending.resolve(contact));
    expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(['actor', 'clinic', 'admin', 'hidden', 'target', 'unmount'])('ignores a late saved result after %s', async kind => {
    const pending = deferred<number>(); mocks.update.mockReturnValue(pending.promise); const view = mount(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    await edit(); submit(); await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1)); change(view, kind);
    await act(async () => pending.resolve(5)); expect(view.close).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
  it.each(['clinic', 'hidden', 'target', 'unmount'])('ignores late explicit recovery after %s', async kind => {
    const view = mount(); await edit(); const pending = deferred<ContactEdit>(); mocks.read.mockReturnValueOnce(pending.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true), invalidate = vi.spyOn(view.client, 'invalidateQueries');
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar e recarregar' }));
      await screen.findByRole('button', { name: 'Recarregando…' }); change(view, kind);
      await act(async () => pending.resolve({ ...contact, name: 'Resposta tardia sintética', revision: 5 }));
      expect(invalidate).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
    } finally { confirm.mockRestore(); }
  });
  it('does not announce or close after context changes while invalidation is pending', async () => {
    const view = mount(); await edit(); const pending = deferred<void>(); vi.spyOn(view.client, 'invalidateQueries').mockReturnValue(pending.promise);
    submit(); await waitFor(() => expect(view.client.invalidateQueries).toHaveBeenCalled()); change(view, 'clinic');
    await act(async () => pending.resolve()); expect(view.close).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('excludes duplicate synchronous submits before pending state renders', async () => {
    const pending = deferred<number>(); mocks.update.mockReturnValue(pending.promise); const view = mount(); await edit(); const target = form();
    act(() => { fireEvent.submit(target); fireEvent.submit(target); }); await waitFor(() => expect(mocks.update.mock.calls.length).toBeGreaterThan(0));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(contact.id, contact.revision, 'Correção sintética', contact.phone);
    await act(async () => pending.resolve(5)); await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
  });
  it.each(['save-first', 'recover-first'])('excludes interleaved save and recovery before a render (%s)', async order => {
    const view = mount(); await edit(); const writing = deferred<number>(), reading = deferred<ContactEdit>();
    mocks.update.mockReturnValue(writing.promise); mocks.read.mockReturnValueOnce(reading.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true), target = form(), recover = screen.getByRole('button', { name: 'Descartar e recarregar' });
    try {
      act(() => { if (order === 'save-first') { fireEvent.submit(target); fireEvent.click(recover); } else { fireEvent.click(recover); fireEvent.submit(target); } });
      await act(async () => {});
      expect(mocks.update).toHaveBeenCalledTimes(order === 'save-first' ? 1 : 0);
      expect(mocks.read).toHaveBeenCalledTimes(order === 'save-first' ? 1 : 2);
    } finally {
      await act(async () => { writing.resolve(5); reading.resolve({ ...contact, revision: 5 }); }); confirm.mockRestore();
    }
  });
  it('invalidates related cache only for its original actor and clinic', async () => {
    const view = mount(); const own = ['reception', access.actorId, 'contacts', clinic, 'query', 'reader'];
    const otherActor = ['reception', other, 'contacts', clinic, 'query'], otherClinic = ['reception', access.actorId, 'contacts', other, clinic], medical = ['medical', access.actorId, clinic];
    for (const key of [own, otherActor, otherClinic, medical]) view.client.setQueryData(key, { synthetic: true });
    await edit(); submit(); await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
    expect(view.client.getQueryState(own)?.isInvalidated).toBe(true);
    for (const key of [otherActor, otherClinic, medical]) expect(view.client.getQueryState(key)?.isInvalidated).toBe(false);
  });
  it('keeps an invalidated window blocked after the original clinic returns', async () => {
    const view = mount(); await edit(); change(view, 'clinic'); view.rerender(view.tree());
    expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar janela' })); expect(view.close).toHaveBeenCalledTimes(1); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('removes the old session exit guard when sending loses context', async () => {
    const pending = deferred<number>(); mocks.update.mockReturnValue(pending.promise); const view = mount(); await edit(); submit();
    await screen.findByRole('button', { name: 'Salvando…' }); const alert = vi.spyOn(window, 'alert').mockImplementation(() => {}), confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      expect(confirmSessionExit()).toBe(false); change(view, 'admin'); expect(confirmSessionExit()).toBe(true); expect(confirm).not.toHaveBeenCalled();
      await act(async () => pending.resolve(5)); expect(view.close).not.toHaveBeenCalled();
    } finally { alert.mockRestore(); confirm.mockRestore(); }
  });
  it.each([{ active: false }, { admin: false }, { actorId: other }])('does not read without current administrative access (%#)', async patch => {
    mount({ ...access, ...patch }); await act(async () => {}); expect(mocks.read).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Nome do contato')).not.toBeInTheDocument();
  });
});

describe('contact correction during a paused re-verification', () => {
  it('keeps the typed correction, refuses saving while paused and resumes without reopening', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (paused: boolean) => <QueryClientProvider client={client}><SessionPausedContext.Provider value={paused}><ClinicAccessContext.Provider value={access}><ContactCorrectionDialog contactId={contact.id} onClose={vi.fn()} /></ClinicAccessContext.Provider></SessionPausedContext.Provider></QueryClientProvider>;
    const view = render(tree(false)); await edit();
    view.rerender(tree(true));
    expect(screen.getByLabelText('Nome do contato')).toHaveValue('Correção sintética');
    expect(screen.getByText('Verificando acesso… O preenchimento continua preservado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar correção' })).toBeDisabled();
    submit(); await act(async () => {});
    expect(mocks.update).not.toHaveBeenCalled();
    view.rerender(tree(false));
    expect(screen.queryByText(/Esta correção foi interrompida/)).toBeNull();
    expect(screen.getByLabelText('Nome do contato')).toHaveValue('Correção sintética');
    expect(screen.getByRole('checkbox', { name: /Conferi a identidade/ })).toBeChecked();
    submit();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith(contact.id, contact.revision, 'Correção sintética', contact.phone));
  });
});
