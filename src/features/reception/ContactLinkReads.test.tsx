import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactLinksDialog } from './ContactLinksDialog';
import { ClinicAccessContext } from './accessContext';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import type { ClinicAccess, LinkEdit } from './contracts';
const mocks = vi.hoisted(() => ({ read: vi.fn(), editor: vi.fn(), state: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('./api', () => ({ receptionApi: { contactLinks: mocks.read } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./LinkRelationshipDialog', () => ({ LinkRelationshipDialog: (props: object) => { mocks.editor(props); return <div>Editor sintético</div>; } }));
vi.mock('./LinkStateDialog', () => ({ LinkStateDialog: (props: object) => { mocks.state(props); return <div>Estado sintético</div>; } }));
const clinic = '22222222-2222-4222-8222-222222222222', contact = '33333333-3333-4333-8333-333333333333', other = '88888888-8888-4888-8888-888888888888';
const row: LinkEdit = { contactId: contact, patientId: '44444444-4444-4444-8444-444444444444', doctorId: '55555555-5555-4555-8555-555555555555', patientName: 'Beneficiário sintético', doctorName: 'Médico sintético', dateOfBirth: '2000-01-02', relationship: 'guardian', revision: 4, active: true, patientAvailable: true, doctorActive: true };
const page = { items: [row], nextCursor: null as string | null };
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: true, kind: 'clinical', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const prefix = ['reception', access.actorId, 'contact-links', clinic, contact];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(value = access, cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), close = vi.fn();
  if (cached) client.setQueryData(prefix, { pages: [page], pageParams: [null] });
  const tree = (next = value, hidden = false) => <QueryClientProvider client={client}><SessionVisibilityContext.Provider value={hidden}><ClinicAccessContext.Provider value={next}><ContactLinksDialog contactId={contact} contactName="Contato sintético" onClose={close} /></ClinicAccessContext.Provider></SessionVisibilityContext.Provider></QueryClientProvider>;
  return { ...render(tree()), tree, client, close };
}
type View = ReturnType<typeof mount>;
const query = (view: View) => view.client.getQueryCache().findAll({ queryKey: prefix }).find(q => q.getObserversCount() > 0)!;
const loaded = () => screen.findByText(row.patientName, {}, { timeout: 1500 });
beforeEach(() => { vi.resetAllMocks(); mocks.actor = access.actorId; mocks.read.mockResolvedValue(page); });

describe('verified contact link reads', () => {
  it('reads only the first page with a signal and preserves exact editor identities', async () => {
    mount(); await loaded(); expect(mocks.read).toHaveBeenCalledExactlyOnceWith(clinic, contact, null, 50, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir relação de ' + row.patientName }));
    expect(mocks.editor).toHaveBeenCalledWith(expect.objectContaining({ contactId: contact, patientId: row.patientId, doctorId: row.doctorId }));
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it('does not expose contact or beneficiary metadata before a fresh read', async () => {
    const pending = deferred<typeof page>(); mocks.read.mockReturnValue(pending.promise); mount(access, true);
    expect(screen.queryByText('Contato: Contato sintético')).not.toBeInTheDocument(); expect(screen.queryByText(row.patientName)).not.toBeInTheDocument();
    await act(async () => pending.resolve(page)); await loaded();
  });
  it('retires names, dates, counts, cursor and actions during refresh', async () => {
    mocks.read.mockResolvedValue({ ...page, nextCursor: row.patientId }); const view = mount(); await loaded();
    const pending = deferred<typeof page>(); mocks.read.mockReturnValue(pending.promise); let refresh!: Promise<void>;
    act(() => { refresh = view.client.invalidateQueries({ queryKey: prefix }); });
    await waitFor(() => expect(screen.queryByText(row.patientName)).not.toBeInTheDocument(), { timeout: 1500 });
    for (const text of ['Contato: Contato sintético', row.doctorName, '02/01/2000', '1 vínculo carregado']) expect(screen.queryByText(text)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais vínculos' })).not.toBeInTheDocument(); expect(screen.queryByText(/Nenhum vínculo administrativo/)).not.toBeInTheDocument();
    await act(async () => { pending.resolve(page); await refresh; }); await loaded();
  });
  it('uses a generic error and retry only restores reading', async () => {
    const view = mount(); await loaded(); mocks.read.mockRejectedValueOnce(new Error('PRIVATE SYNTHETIC LINK READ'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: prefix }); });
    expect(await screen.findByRole('alert', {}, { timeout: 1500 })).not.toHaveTextContent('PRIVATE'); expect(screen.queryByText(row.patientName)).not.toBeInTheDocument();
    expect(screen.queryByText('Contato: Contato sintético')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await loaded();
    expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled();
  });
  it('retires cached metadata while paused offline and resumes without an action', async () => {
    const view = mount(); await loaded(); onlineManager.setOnline(false); let refresh: Promise<void> | undefined;
    try {
      refresh = view.client.invalidateQueries({ queryKey: prefix }); await waitFor(() => expect(query(view).state.fetchStatus).toBe('paused'));
      await waitFor(() => expect(screen.queryByText(row.patientName)).not.toBeInTheDocument(), { timeout: 1500 });
      expect(screen.getByText('Aguardando conexão de rede para consultar vínculos…')).toBeVisible();
    } finally { await act(async () => { onlineManager.setOnline(true); await refresh; }); }
    await loaded(); expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled();
  });
  it.each(['correct', 'suspend', 'reactivate'])('blocks stale %s before React receives the refresh', async action => {
    mocks.read.mockResolvedValue({ ...page, items: [{ ...row, active: action !== 'reactivate' }] });
    const view = mount(); await loaded(); const name = (action === 'correct' ? 'Corrigir relação de ' : action === 'suspend' ? 'Suspender vínculo de ' : 'Reativar vínculo de ') + row.patientName;
    const button = screen.getByRole('button', { name }), pending = deferred<typeof page>(); mocks.read.mockReturnValue(pending.promise);
    const refresh = view.client.invalidateQueries({ queryKey: prefix }); fireEvent.click(button);
    expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(page); await refresh; });
  });
  it('blocks stale actions after the query snapshot changes before React rerenders', async () => {
    const view = mount(); await loaded(); const button = screen.getByRole('button', { name: 'Corrigir relação de ' + row.patientName });
    const previous = view.client.getQueryData(query(view).queryKey) as object;
    view.client.setQueryData(query(view).queryKey, { ...previous, syntheticSnapshotMarker: true }); fireEvent.click(button);
    expect(mocks.editor).not.toHaveBeenCalled();
  });
  it.each(['unmount', 'hidden', 'admin', 'actor', 'clinic'])('cancels only the old reader after %s', async change => {
    const pending = deferred<typeof page>(); mocks.read.mockReturnValueOnce(pending.promise).mockResolvedValue({ items: [], nextCursor: null }); const view = mount();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); const signal = mocks.read.mock.calls[0][4] as AbortSignal;
    if (change === 'unmount') view.unmount();
    if (change === 'hidden') view.rerender(view.tree(access, true));
    if (change === 'admin') view.rerender(view.tree({ ...access, admin: false }));
    if (change === 'actor') { mocks.actor = other; view.rerender(view.tree({ ...access, actorId: other })); }
    if (change === 'clinic') view.rerender(view.tree({ ...access, clinic: { id: other, name: 'Outra clínica sintética' } }));
    expect(signal).toBeInstanceOf(AbortSignal); await waitFor(() => expect(signal.aborted).toBe(true), { timeout: 1500 });
    await act(async () => pending.resolve(page)); expect(screen.queryByText(row.patientName)).not.toBeInTheDocument();
    expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled();
  });
  it.each([{ admin: false }, { kind: 'reception' as const }, { actorId: other }])('does not query outside current clinical admin access (%#)', async patch => {
    mount({ ...access, ...patch }); await act(async () => {}); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('starts the first page after immediate access loss and recovery instead of refetching old cursors', async () => {
    const second = { ...row, patientId: other, patientName: 'Segundo beneficiário sintético' };
    mocks.read.mockImplementation((_clinic, _contact, cursor) => Promise.resolve(cursor ? { items: [second], nextCursor: null } : { ...page, nextCursor: row.patientId }));
    const view = mount(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Carregar mais vínculos' })); await screen.findByText(second.patientName);
    view.rerender(view.tree({ ...access, admin: false })); view.rerender(view.tree());
    await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThanOrEqual(3)); await waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(mocks.read).toHaveBeenCalledTimes(3); expect(screen.queryByText(second.patientName)).not.toBeInTheDocument();
  });
  it('does not cancel a second mounted reader for the same contact', async () => {
    const pending = deferred<typeof page>(); mocks.read.mockReturnValue(pending.promise); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (first = true) => <QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}>{first && <ContactLinksDialog contactId={contact} contactName="Primeiro contato sintético" onClose={vi.fn()} />}<ContactLinksDialog contactId={contact} contactName="Segundo contato sintético" onClose={vi.fn()} /></ClinicAccessContext.Provider></QueryClientProvider>;
    const view = render(tree()); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2), { timeout: 1500 });
    const first = mocks.read.mock.calls[0][4] as AbortSignal, second = mocks.read.mock.calls[1][4] as AbortSignal;
    view.rerender(tree(false)); expect(first.aborted).toBe(true); expect(second.aborted).toBe(false);
    await act(async () => pending.resolve(page)); expect(second.aborted).toBe(false);
  });
});
