import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactsPage from './ContactsPage';
import { ClinicAccessContext } from './accessContext';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import type { ClinicAccess } from './contracts';
import type { ContactOption } from './NewCaseDialog';
// The shared Radix checkbox measures itself inside a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;


const mocks = vi.hoisted(() => ({ contacts: vi.fn(), actor: '11111111-1111-4111-8111-111111111111', navigate: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { contacts: mocks.contacts } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('./NewCaseDialog', () => ({ NewCaseDialog: ({ contact }: { contact?: ContactOption }) => <div role="dialog" aria-label="Atendimento sintético">{contact?.name}<span>{contact?.id}</span></div> }));
vi.mock('./ContactCorrectionDialog', () => ({ ContactCorrectionDialog: ({ contactId }: { contactId: string }) => <div role="dialog" aria-label="Correção sintética">{contactId}</div> }));
vi.mock('./BookingDialog', () => ({ BookingDialog: ({ contact }: { contact?: ContactOption }) => <div role="dialog" aria-label="Agendamento sintético">{contact?.id}</div> }));
vi.mock('./ContactLinksDialog', () => ({ ContactLinksDialog: ({ contactId }: { contactId: string }) => <div role="dialog" aria-label="Vínculos sintéticos">{contactId}</div> }));

const clinic = '22222222-2222-4222-8222-222222222222', other = '77777777-7777-4777-8777-777777777777';
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const row = { id: '33333333-3333-4333-8333-333333333333', name: 'Contato sintético', phone: 'Telefone sintético', createdAt: '2026-11-07T12:00:00Z' };
const page = { items: [row], nextCursor: null as string | null };
const key = ['reception', access.actorId, 'contacts', clinic, ''];
const currentQuery = (client: QueryClient) => client.getQueryCache().findAll({ queryKey: key }).find(query => query.getObserversCount() > 0)!;
type Page = typeof page;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(value = access, cached?: Page) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(key, { pages: [cached], pageParams: [null] });
  const tree = (next = value, hidden = false) => <QueryClientProvider client={client}><SessionVisibilityContext.Provider value={hidden}><ClinicAccessContext.Provider value={next}><ContactsPage /></ClinicAccessContext.Provider></SessionVisibilityContext.Provider></QueryClientProvider>;
  return { ...render(tree()), client, tree };
}
const card = () => screen.findByRole('heading', { name: row.name }, { timeout: 1500 });
const open = () => screen.getByRole('button', { name: 'Novo atendimento para este contato' });
const search = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Buscar contatos' }), { target: { value: text } });

beforeEach(() => { vi.resetAllMocks(); mocks.actor = access.actorId; mocks.contacts.mockResolvedValue(page); });

describe('contact directory freshness and actions', () => {
  it('reads the first page with cancellation and opens only the selected administrative contact', async () => {
    mount(); await card();
    expect(mocks.contacts).toHaveBeenCalledExactlyOnceWith(clinic, '', null, expect.any(AbortSignal));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corrigir contato' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver pacientes ligados' })).not.toBeInTheDocument();
    fireEvent.click(open());
    expect(screen.getByRole('dialog')).toHaveTextContent(row.id);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('keeps cached rows and empty/cursor metadata hidden until a fresh read', async () => {
    const pending = deferred<Page>(); mocks.contacts.mockReturnValue(pending.promise);
    mount(access, { ...page, nextCursor: other });
    expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais contatos' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum contato encontrado/)).not.toBeInTheDocument();
    await act(async () => pending.resolve(page)); await card();
  });
  it('hides cached rows/actions on failure, sanitizes the error and retries only the read', async () => {
    const view = mount(); await card(); mocks.contacts.mockRejectedValue(new Error('PRIVATE SYNTHETIC FAILURE'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: key }); });
    await waitFor(() => expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE');
    expect(screen.queryByRole('button', { name: 'Novo atendimento para este contato' })).not.toBeInTheDocument();
    mocks.contacts.mockResolvedValue(page);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await card();
    expect(mocks.contacts).toHaveBeenCalledTimes(3); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('retires rows during a pending refresh and does not show false empty results', async () => {
    const view = mount(); await card(); const pending = deferred<Page>(); mocks.contacts.mockReturnValue(pending.promise);
    let refresh!: Promise<void>; act(() => { refresh = view.client.invalidateQueries({ queryKey: key }); });
    await waitFor(() => expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.queryByText(/Nenhum contato encontrado/)).not.toBeInTheDocument();
    await act(async () => { pending.resolve(page); await refresh; }); await card();
  });
  it('retires paused cached rows and cursor, then reconnects without opening an action', async () => {
    mocks.contacts.mockResolvedValue({ ...page, nextCursor: other }); const view = mount(); await card();
    onlineManager.setOnline(false); let refresh: Promise<void> | undefined;
    try {
      refresh = view.client.invalidateQueries({ queryKey: key });
      await waitFor(() => expect(currentQuery(view.client).state.fetchStatus).toBe('paused'));
      await waitFor(() => expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument(), { timeout: 1500 });
      expect(screen.queryByRole('button', { name: 'Carregar mais contatos' })).not.toBeInTheDocument();
      expect(screen.getByText('Aguardando conexão de rede para carregar contatos…')).toBeVisible();
    } finally { await act(async () => { onlineManager.setOnline(true); await refresh; }); }
    await card(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('refuses a row click before a refresh notification reaches React', async () => {
    const view = mount(); await card(); const button = open(); mocks.contacts.mockReturnValue(new Promise(() => {}));
    void view.client.invalidateQueries({ queryKey: key }); fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('refuses a stale row after the cache snapshot changes before React rerenders', async () => {
    const view = mount(); await card(); const button = open();
    view.client.setQueryData(currentQuery(view.client).queryKey, { pages: [{ ...page, items: [{ ...row, name: 'Outro contato sintético' }] }], pageParams: [null] });
    fireEvent.click(button); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('loads the next cursor only after a click and resets pagination on a new search', async () => {
    const second = { ...row, id: other, name: 'Segundo contato sintético' };
    mocks.contacts.mockResolvedValueOnce({ ...page, nextCursor: other }).mockResolvedValueOnce({ items: [second], nextCursor: null }).mockResolvedValue({ items: [], nextCursor: null });
    mount(); await card(); expect(mocks.contacts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais contatos' }));
    await screen.findByRole('heading', { name: second.name });
    expect(mocks.contacts.mock.calls[1]).toEqual([clinic, '', other, expect.any(AbortSignal)]);
    expect(screen.queryByRole('button', { name: 'Carregar mais contatos' })).not.toBeInTheDocument();
    search('Outra busca'); await screen.findByText('Nenhum contato encontrado para esta busca.');
    expect(mocks.contacts.mock.calls[2]).toEqual([clinic, 'Outra busca', null, expect.any(AbortSignal)]);
    expect(screen.queryByRole('heading', { name: second.name })).not.toBeInTheDocument();
  });
  it('hides previous pages after a next-page failure and requires an explicit retry', async () => {
    mocks.contacts.mockResolvedValueOnce({ ...page, nextCursor: other }).mockRejectedValueOnce(new Error('PRIVATE CURSOR FAILURE'));
    mount(); await card(); fireEvent.click(screen.getByRole('button', { name: 'Carregar mais contatos' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.queryByRole('button', { name: 'Carregar mais contatos' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE'); expect(mocks.contacts).toHaveBeenCalledTimes(2);
  });
  it('cancels an old search and ignores a late response', async () => {
    const pending = deferred<Page>(); mocks.contacts.mockReturnValueOnce(pending.promise).mockResolvedValue({ items: [], nextCursor: null });
    mount(); await waitFor(() => expect(mocks.contacts).toHaveBeenCalledTimes(1)); const signal = mocks.contacts.mock.calls[0][3] as AbortSignal;
    search('Outra busca'); await screen.findByText('Nenhum contato encontrado para esta busca.'); expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(page)); expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument();
  });
  it.each(['unmount', 'clinic', 'actor', 'inactive', 'hidden', 'role', 'admin'])('cancels old directory observation after %s changes', async change => {
    mocks.contacts.mockReturnValue(new Promise(() => {})); const view = mount(); search('Pesquisa privada sintética');
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledTimes(2)); const signal = mocks.contacts.mock.calls[1][3] as AbortSignal;
    if (change === 'unmount') view.unmount();
    if (change === 'clinic') view.rerender(view.tree({ ...access, clinic: { id: other, name: 'Outra clínica sintética' } }));
    if (change === 'actor') { mocks.actor = other; view.rerender(view.tree({ ...access, actorId: other })); }
    if (change === 'inactive') view.rerender(view.tree({ ...access, active: false }));
    if (change === 'hidden') view.rerender(view.tree(access, true));
    if (change === 'role') view.rerender(view.tree({ ...access, kind: 'clinical' }));
    if (change === 'admin') view.rerender(view.tree({ ...access, admin: true }));
    await waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 1500 });
    expect(screen.queryByDisplayValue('Pesquisa privada sintética')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it.each([{ active: false }, { actorId: other }, { kind: 'clinical' as const }])('does not query outside active authenticated access (%#)', async patch => {
    mount({ ...access, ...patch }); await act(async () => {}); expect(mocks.contacts).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: row.name })).not.toBeInTheDocument();
  });
  it.each(['role', 'hidden', 'inactive'])('restarts pagination after %s context change instead of refetching previous cursors', async change => {
    const second = { ...row, id: other, name: 'Segunda página sintética' };
    mocks.contacts.mockResolvedValueOnce({ ...page, nextCursor: other }).mockResolvedValueOnce({ items: [second], nextCursor: null }).mockImplementation((_clinic: string, _search: string, cursor: string | null) => Promise.resolve(cursor ? { items: [second], nextCursor: null } : { ...page, nextCursor: other }));
    const view = mount(); await card(); fireEvent.click(screen.getByRole('button', { name: 'Carregar mais contatos' }));
    await screen.findByRole('heading', { name: second.name });
    if (change === 'role') view.rerender(view.tree({ ...access, admin: true }));
    if (change === 'hidden') { view.rerender(view.tree(access, true)); view.rerender(view.tree()); }
    if (change === 'inactive') { view.rerender(view.tree({ ...access, active: false })); view.rerender(view.tree()); }
    await waitFor(() => expect(mocks.contacts.mock.calls.length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(mocks.contacts).toHaveBeenCalledTimes(3);
    expect(mocks.contacts.mock.calls[2]).toEqual([clinic, '', null, expect.any(AbortSignal)]);
    expect(screen.queryByRole('heading', { name: second.name })).not.toBeInTheDocument();
  });
  it.each(['Corrigir contato', 'Ver pacientes ligados'])('refuses stale admin action %s before a refresh notification', async action => {
    const view = mount({ ...access, admin: true, kind: 'clinical' }); await card();
    const button = screen.getByRole('button', { name: action }); mocks.contacts.mockReturnValue(new Promise(() => {}));
    void view.client.invalidateQueries({ queryKey: ['reception', access.actorId, 'contacts', clinic] }); fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps admin correction and clinical link actions gated and passes the exact selected id', async () => {
    mount({ ...access, admin: true, kind: 'clinical' }); const heading = await card(); const article = within(heading.closest('article')!);
    fireEvent.click(article.getByRole('button', { name: 'Corrigir contato' })); expect(screen.getByRole('dialog', { name: 'Correção sintética' })).toHaveTextContent(row.id);
    fireEvent.click(article.getByRole('button', { name: 'Ver pacientes ligados' })); expect(screen.getByRole('dialog', { name: 'Vínculos sintéticos' })).toHaveTextContent(row.id);
  });
  it('does not reuse a cached empty page as a fresh absence', async () => {
    const pending = deferred<Page>(); mocks.contacts.mockReturnValue(pending.promise); mount(access, { items: [], nextCursor: null });
    expect(screen.queryByText('Nenhum contato cadastrado ainda.')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ items: [], nextCursor: null })); expect(await screen.findByText('Nenhum contato cadastrado ainda.')).toBeVisible();
  });
  it('refreshes manually without opening an editor or navigating', async () => {
    mount(); await card(); fireEvent.click(screen.getByRole('button', { name: 'Atualizar contatos' }));
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledTimes(2)); await card();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  // Round 3, R 27: a contact row books directly, without opening a queue case first.
  it('books from the contact row with that exact contact and no queue case', async () => {
    mount(); const heading = await card(); const article = within(heading.closest('article')!);
    fireEvent.click(article.getByRole('button', { name: `Agendar para ${row.name}` }));
    expect(screen.getByRole('dialog', { name: 'Agendamento sintético' })).toHaveTextContent(row.id);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('shows a failed read with the shared retry notice, not the server text', async () => {
    mocks.contacts.mockRejectedValueOnce(new Error('Falha sintética do servidor'));
    mount();
    const alert = await screen.findByRole('alert', {}, { timeout: 1500 });
    expect(alert).toHaveTextContent('Não foi possível carregar os contatos. Verifique a conexão e tente de novo.');
    expect(alert).not.toHaveTextContent('Falha sintética');
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' })); await card();
  });
});
