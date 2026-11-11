import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppInbox from './WhatsAppInbox';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
import type { WhatsAppConversation } from './whatsappApi';
import { WHATSAPP_POLL_MS } from './useBackgroundRefresh';

const mocks = vi.hoisted(() => ({ state: vi.fn(), conversations: vi.fn(), messages: vi.fn(), botSession: vi.fn(), claim: vi.fn(), send: vi.fn(), markRead: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { state: mocks.state, conversations: mocks.conversations, messages: mocks.messages, botSession: mocks.botSession } }));
vi.mock('./whatsappClaim', async original => ({ ...await original<typeof import('./whatsappClaim')>(), claimWhatsAppConversation: mocks.claim }));
vi.mock('./whatsappSend', async original => ({ ...await original<typeof import('./whatsappSend')>(), sendWhatsAppMessage: mocks.send, markWhatsAppConversationRead: mocks.markRead }));

const clinic = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333', second = '88888888-8888-4888-8888-888888888888';
const at = '2026-11-06T18:30:00.123456+00:00';
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
let conversation: WhatsAppConversation;
const message = { id: '44444444-4444-4444-8444-444444444444', direction: 'in', kind: 'text', body: 'Mensagem sintética recebida', media: null, template: null, status: 'received', error: null, sentBy: null, at };
const newer = { ...message, id: '55555555-5555-4555-8555-555555555555', body: 'Mensagem nova sintética' };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}><WhatsAppInbox /></ClinicAccessContext.Provider></QueryClientProvider>);
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Contato sintético A' })); await screen.findByText('Mensagem sintética recebida'); }
const tick = () => act(async () => { vi.advanceTimersByTime(WHATSAPP_POLL_MS); });

beforeEach(() => {
  vi.resetAllMocks(); mocks.actor = access.actorId;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  conversation = { id, profileName: 'Contato sintético A', waId: '5511900000000', contactId: null, caseId: null, queue: 'agenda', status: 'open', assignedTo: access.actorId, assignedAt: at, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: new Date(Date.now() + 3600_000).toISOString(), lastMessageAt: at, lastMessagePreview: 'Prévia sintética', unreadCount: 0, optedOut: false, consented: true, revision: 1 };
  mocks.state.mockResolvedValue({ serverReady: true, connected: true, canUseInbox: true });
  mocks.conversations.mockImplementation(async () => ({ conversations: [conversation], nextBefore: null }));
  mocks.messages.mockImplementation(async () => ({ conversation, messages: [message], nextBefore: null }));
  mocks.botSession.mockResolvedValue({ session: null });
  mocks.markRead.mockResolvedValue(true);
});
afterEach(() => { vi.useRealTimers(); });

describe('background refresh of the inbox', () => {
  it('refreshes list and conversation every 15 s without blanking, remounting or losing typed text', async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    mount(); await open();
    const panel = screen.getByRole('region', { name: 'Conversa selecionada' });
    const box = within(panel).getByLabelText('Mensagem');
    fireEvent.change(box, { target: { value: 'Rascunho em andamento' } });
    const list = deferred<unknown>(), detail = deferred<unknown>();
    mocks.conversations.mockReturnValueOnce(list.promise);
    mocks.messages.mockReturnValueOnce(detail.promise);
    const [lists, details] = [mocks.conversations.mock.calls.length, mocks.messages.mock.calls.length];
    await tick();
    await waitFor(() => expect(mocks.conversations).toHaveBeenCalledTimes(lists + 1));
    await waitFor(() => expect(mocks.messages).toHaveBeenCalledTimes(details + 1));
    // While both reads run, everything stays on screen.
    expect(screen.getByRole('button', { name: 'Abrir conversa com Contato sintético A' })).toBeVisible();
    expect(screen.getByText('Mensagem sintética recebida')).toBeVisible();
    expect(screen.queryByText('Carregando conversas…')).not.toBeInTheDocument();
    expect(screen.queryByText('Carregando mensagens…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devolver à fila' })).toBeVisible();
    const updated = { ...conversation, lastMessagePreview: 'Mensagem nova sintética' };
    await act(async () => { list.resolve({ conversations: [updated, { ...conversation, id: second, profileName: 'Contato novo sintético' }], nextBefore: null }); detail.resolve({ conversation: updated, messages: [newer, message], nextBefore: null }); });
    expect(await screen.findByText('Mensagem nova sintética', { selector: 'p' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abrir conversa com Contato novo sintético' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Conversa selecionada' })).toBe(panel);
    expect(within(panel).getByLabelText('Mensagem')).toBe(box);
    expect(box).toHaveValue('Rascunho em andamento');
    expect(scroll).not.toHaveBeenCalled();
  });
  it('keeps the last good data marked as possibly outdated when a background refresh fails', async () => {
    mount(); await open();
    mocks.conversations.mockRejectedValueOnce(new Error('SYNTHETIC PRIVATE LIST'));
    mocks.messages.mockRejectedValueOnce(new Error('SYNTHETIC PRIVATE DETAIL'));
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Rascunho guardado' } });
    await tick();
    expect(await screen.findByText('Não foi possível atualizar. A lista pode estar desatualizada.')).toBeVisible();
    expect(await screen.findByText('Não foi possível atualizar. As mensagens abaixo podem estar desatualizadas.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abrir conversa com Contato sintético A' })).toBeVisible();
    expect(screen.getByText('Mensagem sintética recebida')).toBeVisible();
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Rascunho guardado');
    expect(screen.queryByText(/SYNTHETIC PRIVATE/)).not.toBeInTheDocument();
    // Commands wait for a successful read; the next tick recovers.
    expect(screen.queryByRole('button', { name: 'Devolver à fila' })).not.toBeInTheDocument();
    await tick();
    await waitFor(() => expect(screen.queryByText(/Não foi possível atualizar/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Devolver à fila' })).toBeVisible();
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Rascunho guardado');
  });
  it('does not poll while a command runs or the tab is hidden', async () => {
    let finish!: (value: unknown) => void;
    conversation = { ...conversation, assignedTo: null, assignedAt: null };
    mocks.claim.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mount(); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Assumir conversa' }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1));
    const [lists, details] = [mocks.conversations.mock.calls.length, mocks.messages.mock.calls.length];
    await tick(); await tick();
    expect(mocks.conversations).toHaveBeenCalledTimes(lists); expect(mocks.messages).toHaveBeenCalledTimes(details);
    await act(async () => finish({ revision: 2, status: 'open', assignedTo: access.actorId }));
    await screen.findByText('Dados atualizados. Confira o responsável atual na conversa.');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const after = mocks.conversations.mock.calls.length;
      await tick();
      expect(mocks.conversations).toHaveBeenCalledTimes(after);
    } finally { visibility.mockRestore(); }
  });
  it('does not poll an older page of conversations', async () => {
    mocks.conversations.mockImplementation(async (input: { before?: string }) => ({ conversations: [input.before ? { ...conversation, id: second, profileName: 'Contato antigo sintético' } : conversation], nextBefore: input.before ? null : at + '|' + id }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Conversas anteriores' }));
    await screen.findByText('Contato antigo sintético');
    const calls = mocks.conversations.mock.calls.length;
    await tick();
    expect(mocks.conversations).toHaveBeenCalledTimes(calls);
  });
});

describe('assuming a conversation', () => {
  it('keeps it open with the composer under "Sem responsável" after it leaves the filter', async () => {
    conversation = { ...conversation, assignedTo: null, assignedAt: null };
    mocks.claim.mockResolvedValue({ revision: 2, status: 'open', assignedTo: access.actorId });
    mount();
    fireEvent.change(await screen.findByLabelText('Filtrar conversas'), { target: { value: 'unassigned' } });
    await waitFor(() => expect(mocks.conversations).toHaveBeenLastCalledWith({ filter: 'unassigned', search: '', limit: 50 }, expect.any(AbortSignal)));
    await open();
    const owned = { ...conversation, assignedTo: access.actorId, assignedAt: at, revision: 2 };
    mocks.messages.mockImplementation(async () => ({ conversation: owned, messages: [message], nextBefore: null }));
    mocks.conversations.mockImplementation(async () => ({ conversations: [], nextBefore: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Assumir conversa' }));
    await screen.findByText('Dados atualizados. Confira o responsável atual na conversa.');
    await screen.findByText('Nenhuma conversa neste filtro.');
    const panel = await screen.findByRole('region', { name: 'Conversa selecionada' });
    expect(await within(panel).findByText('Com você')).toBeVisible();
    expect(within(panel).getByText('Mensagem sintética recebida')).toBeVisible();
    expect(within(panel).getByRole('form', { name: 'Responder conversa' })).toBeVisible();
    expect(within(panel).getByLabelText('Mensagem')).toBeEnabled();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });
});
