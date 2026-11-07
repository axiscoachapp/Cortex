import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppInbox from './WhatsAppInbox';
import { WhatsAppTransferAction } from './WhatsAppTransferAction';
import { ClinicAccessContext } from './accessContext';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import type { ClinicAccess } from './contracts';
import type { WhatsAppConversation } from './whatsappApi';
import type { WhatsAppAssigneePage } from './whatsappAssignees';
import { WhatsAppTransferError } from './whatsappTransfer';

const mocks = vi.hoisted(() => ({ state: vi.fn(), conversations: vi.fn(), messages: vi.fn(), botSession: vi.fn(), roster: vi.fn(), transfer: vi.fn(), confirm: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('./whatsappTransfer', async original => ({ ...await original<typeof import('./whatsappTransfer')>(), transferWhatsAppConversation: mocks.transfer }));
vi.mock('./whatsappAssignees', () => ({ readWhatsAppAssignees: mocks.roster }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { state: mocks.state, conversations: mocks.conversations, messages: mocks.messages, botSession: mocks.botSession } }));
const clinic = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333', target = '77777777-7777-4777-8777-777777777777', at = '2026-11-07T12:00:00Z';
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const conversation: WhatsAppConversation = { id, profileName: 'Contato sintético', waId: null, contactId: null, caseId: null, queue: 'agenda', status: 'open', assignedTo: access.actorId, assignedAt: at, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: at, lastMessageAt: at, lastMessagePreview: 'Prévia sintética', unreadCount: 1, optedOut: false, consented: true, revision: 7 };
const detail = { conversation, messages: [{ id: clinic, direction: 'in', kind: 'text', body: 'Mensagem sintética', media: null, template: null, status: 'received', error: null, sentBy: null, at }], nextBefore: null };
const eligible = { userId: target, name: 'Atendente sintético', role: 'reception' as const, ambiguous: false };
const roster: WhatsAppAssigneePage = { items: [{ userId: access.actorId, name: 'Pessoa atual', role: 'reception', ambiguous: false }, eligible, { userId: '88888888-8888-4888-8888-888888888888', name: 'Nome repetido', role: 'admin', ambiguous: true }], nextBefore: null };
const changed = { ...detail, conversation: { ...conversation, assignedTo: target, revision: 8 } };
const done = 'Dados atualizados. Confira o responsável atual na conversa.';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(standalone = false, initial = access) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (value = initial, hidden = false, row = conversation, disabled = false) => <QueryClientProvider client={client}><SessionVisibilityContext.Provider value={hidden}><ClinicAccessContext.Provider value={value}>{standalone ? <WhatsAppTransferAction actor={value.actorId} clinic={value.clinic?.id ?? clinic} conversation={row} disabled={disabled} onConfirm={mocks.confirm} /> : <WhatsAppInbox />}</ClinicAccessContext.Provider></SessionVisibilityContext.Provider></QueryClientProvider>;
  return { ...render(tree()), client, tree };
}
async function openInbox() { fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Contato sintético' })); await screen.findByText('Mensagem sintética'); }
async function openDialog() { fireEvent.click(await screen.findByRole('button', { name: 'Transferir conversa' })); return screen.findByRole('dialog', { name: 'Transferir conversa' }); }
async function select() { const modal = await openDialog(); fireEvent.click(await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' })); return modal; }
const submit = (modal: HTMLElement) => fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar transferência' }));
const rosterQuery = (client: QueryClient) => client.getQueryCache().findAll().find(q => q.getObserversCount() && q.queryKey.includes('assignees-choice'))!;
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor = access.actorId; mocks.state.mockResolvedValue({ serverReady: true, connected: true, canUseInbox: true });
  mocks.conversations.mockResolvedValue({ conversations: [conversation], nextBefore: null }); mocks.messages.mockResolvedValue(detail); mocks.botSession.mockResolvedValue({ session: null });
  mocks.roster.mockResolvedValue(roster); mocks.transfer.mockImplementation(async () => { mocks.messages.mockResolvedValue(changed); mocks.conversations.mockResolvedValue({ conversations: [changed.conversation], nextBefore: null }); return { revision: 8, status: 'open', assignedTo: target }; });
});
afterEach(() => { onlineManager.setOnline(true); });

describe('explicit transfer choice and confirmation', () => {
  it('does not read a roster until opening, verifies the channel first, and blocks own/ambiguous people', async () => {
    mount(true); expect(mocks.roster).not.toHaveBeenCalled(); const modal = await openDialog();
    expect(await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' })).toBeEnabled();
    expect(mocks.state).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(mocks.roster).toHaveBeenCalledExactlyOnceWith({ before: null, limit: 10 }, expect.any(AbortSignal));
    expect(within(modal).getByRole('button', { name: 'Selecionar Pessoa atual' })).toBeDisabled(); expect(within(modal).getByRole('button', { name: 'Selecionar Nome repetido' })).toBeDisabled();
    expect(within(modal).queryByText(target)).not.toBeInTheDocument(); expect(within(modal).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('requires explicit recipient and final confirmation, sending only one immutable selection', async () => {
    mount(true); const modal = await select(); expect(within(modal).getByText(/Novo responsável/)).toHaveTextContent('Atendente sintético');
    expect(mocks.confirm).not.toHaveBeenCalled(); const button = within(modal).getByRole('button', { name: 'Confirmar transferência' }); fireEvent.click(button); fireEvent.click(button);
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(conversation, target); expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'escape'])('discards a chosen person and restores focus without sending (%s)', async how => {
    mount(true); const trigger = screen.getByRole('button', { name: 'Transferir conversa' }), modal = await select();
    if (how === 'cancel') fireEvent.click(within(modal).getByRole('button', { name: 'Cancelar' })); else fireEvent.keyDown(modal, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.confirm).not.toHaveBeenCalled(); const reopened = await openDialog(); await within(reopened).findByRole('button', { name: 'Selecionar Atendente sintético' });
    expect(within(reopened).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument(); expect(mocks.roster).toHaveBeenCalledTimes(2);
  });
  it('replaces pages and resets to the first page on refresh without carrying the selection', async () => {
    mocks.roster.mockResolvedValueOnce({ items: [eligible], nextBefore: `a1.${target}` }).mockResolvedValueOnce({ items: [], nextBefore: null }).mockResolvedValue(roster);
    mount(true); const modal = await openDialog(); fireEvent.click(await within(modal).findByRole('button', { name: 'Próximos atendentes' }));
    await within(modal).findByText('Nenhum atendente nesta página.'); expect(within(modal).queryByText(eligible.name)).not.toBeInTheDocument();
    expect(mocks.roster.mock.calls[1][0]).toEqual({ before: `a1.${target}`, limit: 10 });
    fireEvent.click(within(modal).getByRole('button', { name: 'Atualizar atendentes' })); await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' }); expect(mocks.roster.mock.calls[2][0].before).toBeNull();
  });
  it.each([{ connected: false }, { serverReady: false }, { canUseInbox: false }])('does not query the catalogue when channel verification refuses %j', async patch => {
    mocks.state.mockResolvedValue({ serverReady: true, connected: true, canUseInbox: true, ...patch }); mount(true); const modal = await openDialog();
    await within(modal).findByRole('alert'); expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('hides names on read error and retries only a fresh channel/catalogue read', async () => {
    const view = mount(true); const modal = await select(); mocks.roster.mockRejectedValue(new Error('PRIVATE RAW DIRECTORY'));
    act(() => { void view.client.invalidateQueries({ predicate: q => q.queryKey.includes('assignees-choice') }); });
    const error = await within(modal).findByRole('alert'); expect(error).not.toHaveTextContent('PRIVATE'); expect(within(modal).queryByText(eligible.name)).not.toBeInTheDocument(); expect(within(modal).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument();
    mocks.roster.mockResolvedValue(roster); fireEvent.click(within(modal).getByRole('button', { name: 'Atualizar atendentes' })); await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' }); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('retires a chosen person during paused reads and does not restore confirmation on reconnect', async () => {
    const view = mount(true); const modal = await select(); onlineManager.setOnline(false); let fetching!: Promise<void>;
    try { act(() => { fetching = view.client.invalidateQueries({ predicate: q => q.queryKey.includes('assignees-choice') }); });
      await within(modal).findByText('Aguardando conexão para consultar atendentes…'); expect(within(modal).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument();
    } finally { await act(async () => { onlineManager.setOnline(true); await fetching; }); }
    await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' }); expect(within(modal).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('rejects a captured submit before invalidation reaches React', async () => {
    const view = mount(true), modal = await select(), button = within(modal).getByRole('button', { name: 'Confirmar transferência' }); mocks.roster.mockReturnValue(new Promise(() => {}));
    void view.client.invalidateQueries({ predicate: q => q.queryKey.includes('assignees-choice') }); fireEvent.click(button); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('discards confirmation after a coalesced identical successful catalogue read', async () => {
    const view = mount(true), modal = await select(); await act(async () => { await view.client.invalidateQueries({ predicate: q => q.queryKey.includes('assignees-choice') }); });
    await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' }); expect(within(modal).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument();
  });
  it('aborts an in-flight directory read when cancelling and starts over on a new opening', async () => {
    const pending = deferred<WhatsAppAssigneePage>(); mocks.roster.mockReturnValueOnce(pending.promise); mount(true); const modal = await openDialog();
    await waitFor(() => expect(mocks.roster).toHaveBeenCalledTimes(1)); const signal = mocks.roster.mock.calls[0][1] as AbortSignal;
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancelar' })); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(roster));
    const reopened = await openDialog(); await within(reopened).findByRole('button', { name: 'Selecionar Atendente sintético' }); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'role', 'actor', 'clinic', 'owner', 'revision', 'disabled'])('retires the dialog and selection on context change (%s)', async change => {
    const view = mount(true); await select(); let next = access, row = conversation, hidden = false, disabled = false;
    if (change === 'hidden') hidden = true; if (change === 'role') next = { ...access, kind: 'clinical', admin: false };
    if (change === 'actor') mocks.actor = target; if (change === 'clinic') next = { ...access, clinic: { id: target, name: 'Outra clínica sintética' } };
    if (change === 'owner') row = { ...conversation, assignedTo: target }; if (change === 'revision') row = { ...conversation, revision: 8 }; if (change === 'disabled') disabled = true;
    view.rerender(view.tree(next, hidden, row, disabled)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('uses a new selection after choosing another person instead of sending immediately', async () => {
    mount(true); const modal = await select(); fireEvent.click(within(modal).getByRole('button', { name: 'Escolher outra pessoa' }));
    expect(within(modal).queryByRole('button', { name: 'Confirmar transferência' })).not.toBeInTheDocument(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('does not reveal cached catalogue metadata while a new opening is pending', async () => {
    const view = mount(true); const modal = await select(); const key = rosterQuery(view.client).queryKey;
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancelar' })); view.client.setQueryData(key, { catalog: roster, version: 1 }); mocks.roster.mockReturnValue(new Promise(() => {}));
    const reopened = await openDialog(); await waitFor(() => expect(mocks.roster).toHaveBeenCalledTimes(2)); expect(within(reopened).queryByText(eligible.name)).not.toBeInTheDocument();
  });
});

describe('transfer integration with command reconciliation', () => {
  it('transfers only after fresh own detail and final selection, then reads back list/detail', async () => {
    mount(); await openInbox(); const modal = await select(); submit(modal); await screen.findByText(done);
    expect(mocks.transfer).toHaveBeenCalledExactlyOnceWith({ conversationId: id, revision: 7, status: 'open', assignedTo: access.actorId, targetUserId: target }, access.actorId, expect.any(AbortSignal));
    expect(mocks.messages.mock.calls.length).toBeGreaterThanOrEqual(3); expect(mocks.conversations).toHaveBeenCalledTimes(2); expect(mocks.roster).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Outra pessoa')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Transferir conversa' })).not.toBeInTheDocument();
  });
  it('adopts authoritative ownership instead of a divergent valid receipt', async () => {
    mocks.transfer.mockImplementation(async()=>{const authoritative={...detail,conversation:{...conversation,revision:9}};mocks.messages.mockResolvedValue(authoritative);mocks.conversations.mockResolvedValue({conversations:[authoritative.conversation],nextBefore:null});return {revision:8,status:'open',assignedTo:target};});
    mount();await openInbox();submit(await select());await screen.findByText(done);expect(await screen.findByText('Você')).toBeVisible();
    const next=await openDialog();await within(next).findByRole('button',{name:'Selecionar Atendente sintético'});expect(within(next).queryByRole('button',{name:'Confirmar transferência'})).not.toBeInTheDocument();expect(mocks.transfer).toHaveBeenCalledTimes(1);
  });
  it.each([{ assignedTo: null }, { assignedTo: target }, { status: 'closed' as const }, { revision: 2147483647 }])('does not offer transfer for ineligible detail %j', async patch => {
    mocks.messages.mockResolvedValue({ ...detail, conversation: { ...conversation, ...patch } }); mount(); await openInbox(); expect(screen.queryByRole('button', { name: 'Transferir conversa' })).not.toBeInTheDocument(); expect(mocks.roster).not.toHaveBeenCalled();
  });
  it.each(['messages', 'conversations', 'state'])('rejects captured confirmation after parent read starts (%s)', async kind => {
    const view = mount(); await openInbox(); const modal = await select(), button = within(modal).getByRole('button', { name: 'Confirmar transferência' });
    mocks[kind].mockReturnValue(new Promise(() => {})); void view.client.invalidateQueries({ predicate: q => q.queryKey.includes(kind) }); fireEvent.click(button); expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it('rejects a captured submit after a newer channel snapshot before React rerenders', async () => {
    const view=mount();await openInbox();const modal=await select(),button=within(modal).getByRole('button',{name:'Confirmar transferência'});
    const query=view.client.getQueryCache().findAll().find(q=>q.queryKey.at(-1)==='state')!;
    view.client.setQueryData(query.queryKey,{...(query.state.data as object),readVersion:100});fireEvent.click(button);expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it('retires a confirmation after an identical coalesced channel read', async () => {
    const view = mount(); await openInbox(); await select();
    const query=view.client.getQueryCache().findAll().find(q=>q.queryKey.at(-1)==='state')!,read=query.options.queryFn;
    if(typeof read!=='function')throw new Error('Expected real channel query function');
    // Deliver an actual successful read without an intermediate fetching render.
    await act(async()=>{const value=await read({client:view.client,queryKey:query.queryKey,signal:new AbortController().signal,meta:undefined});view.client.setQueryData(query.queryKey,value);});
    await waitFor(()=>expect(screen.queryByRole('dialog')===null).toBe(true)); expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it('blocks after an inconclusive command and failed read-back, retrying reads without repeating act', async () => {
    mocks.transfer.mockRejectedValue(new WhatsAppTransferError('Resultado inconclusivo', 'unavailable', true)); mount(); await openInbox(); const modal = await select(); mocks.messages.mockRejectedValue(new Error('PRIVATE READ')); submit(modal);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir o responsável.'); expect(mocks.transfer).toHaveBeenCalledTimes(1);
    mocks.messages.mockResolvedValue(changed); mocks.conversations.mockResolvedValue({ conversations: [changed.conversation], nextBefore: null }); fireEvent.click(screen.getByRole('button', { name: 'Conferir responsável' })); await screen.findByText(done); expect(mocks.transfer).toHaveBeenCalledTimes(1);
  });
});
