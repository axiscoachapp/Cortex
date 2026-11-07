import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppInbox from './WhatsAppInbox';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
import type { WhatsAppConversation } from './whatsappApi';

const mocks = vi.hoisted(() => ({ state: vi.fn(), conversations: vi.fn(), messages: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { state: mocks.state, conversations: mocks.conversations, messages: mocks.messages } }));
const clinic = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
const at = '2026-11-06T18:30:00.123456+00:00';
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const state = { serverReady: true, connected: true, canUseInbox: true };
const conversation: WhatsAppConversation = { id, profileName: 'Contato sintético A', waId: null, contactId: null, caseId: null, queue: 'geral', status: 'open', assignedTo: null, assignedAt: null, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: at, lastMessageAt: at, lastMessagePreview: 'Prévia sintética', unreadCount: 2, optedOut: false, consented: true, revision: 1 };
const page = { conversations: [conversation], nextBefore: null };
const detail = { conversation, messages: [{ id: '44444444-4444-4444-8444-444444444444', direction: 'in', kind: 'text', body: 'Mensagem sintética recebida', media: null, template: null, status: 'received', error: null, sentBy: null, at }], nextBefore: null };
function mount(value = access) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (next = value) => <QueryClientProvider client={client}><ClinicAccessContext.Provider value={next}><WhatsAppInbox /></ClinicAccessContext.Provider></QueryClientProvider>;
  return { ...render(tree()), tree, client };
}
async function select() { fireEvent.click(await screen.findByRole('button', { name: /Abrir conversa com Contato sintético A/ })); }

describe('WhatsApp reception inbox read view', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.actor = access.actorId;
    mocks.state.mockResolvedValue(state); mocks.conversations.mockResolvedValue(page); mocks.messages.mockResolvedValue(detail);
  });
  it('waits for connection access before reading conversations', async () => {
    let resolve!: (value: typeof state) => void;
    mocks.state.mockReturnValue(new Promise(done => { resolve = done; }));
    mount(); expect(screen.getByRole('status')).toHaveTextContent('Verificando WhatsApp'); expect(mocks.conversations).not.toHaveBeenCalled();
    await act(async () => resolve(state)); await screen.findByText(conversation.profileName);
    expect(mocks.state.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it('opens the explicit conversation, shows messages and returns focus to the list', async () => {
    mount(); await select(); expect(await screen.findByText('Mensagem sintética recebida')).toBeVisible();
    expect(mocks.messages).toHaveBeenCalledWith({ conversationId: id }, expect.any(AbortSignal));
    expect(screen.getByRole('region', { name: 'Conversa selecionada' })).toHaveFocus();
    expect(screen.getByText('2 não lidas')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }));
    expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lista de conversas' })).toHaveFocus();
  });
  it.each([
    { ...access, active: false }, { ...access, kind: 'clinical' as const }, { ...access, actorId: clinic }, { ...access, clinic: null },
  ])('refuses local access without querying the channel', value => {
    mount(value); expect(screen.getByRole('alert')).toHaveTextContent('Acesso à caixa de conversas indisponível.'); expect(mocks.state).not.toHaveBeenCalled();
  });
  it('permits an active clinic administrator', async () => {
    mount({ ...access, kind: 'clinical', admin: true }); await screen.findByText(conversation.profileName);
  });
  it.each([
    { ...state, canUseInbox: false }, { ...state, connected: false }, { ...state, serverReady: false },
  ])('keeps the list hidden when channel access or connection is unavailable', async value => {
    mocks.state.mockResolvedValue(value); mount(); await screen.findByText('WhatsApp indisponível'); expect(mocks.conversations).not.toHaveBeenCalled();
  });
  it('submits search explicitly, changes filter and clears the selected conversation', async () => {
    mount(); await select(); await screen.findByText('Mensagem sintética recebida');
    const count = mocks.conversations.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Buscar conversa'), { target: { value: '  sintético  ' } }); expect(mocks.conversations).toHaveBeenCalledTimes(count);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(mocks.conversations).toHaveBeenLastCalledWith({ filter: 'open', search: 'sintético', limit: 50 }, expect.any(AbortSignal)));
    expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar conversas'), { target: { value: 'mine' } });
    await waitFor(() => expect(mocks.conversations).toHaveBeenLastCalledWith({ filter: 'mine', search: 'sintético', limit: 50 }, expect.any(AbortSignal)));
  });
  it('hides old list and messages on refused refresh and restores only after a fresh retry', async () => {
    mount(); await select(); await screen.findByText('Mensagem sintética recebida');
    mocks.conversations.mockRejectedValueOnce(new Error('SYNTHETIC INTERNAL ERROR'));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conversas' })); await screen.findByRole('alert');
    expect(screen.queryByText(conversation.profileName)).not.toBeInTheDocument(); expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
    expect(screen.queryByText('SYNTHETIC INTERNAL ERROR')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar conversas' })); await screen.findByRole('button', { name: /Abrir conversa com Contato sintético A/ });
  });
  it('hides a previously read message after a refused detail refresh and supports retry', async () => {
    mount(); await select(); await screen.findByText('Mensagem sintética recebida');
    mocks.messages.mockRejectedValueOnce(new Error('SYNTHETIC PRIVATE ERROR'));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar mensagens' })); await screen.findByRole('alert');
    expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument(); expect(screen.queryByText('SYNTHETIC PRIVATE ERROR')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar mensagens' })); await screen.findByText('Mensagem sintética recebida');
  });
  it('distinguishes an empty page and labels a bounded recent history', async () => {
    mocks.conversations.mockResolvedValueOnce({ conversations: [], nextBefore: null }); const view = mount();
    await screen.findByText('Nenhuma conversa neste filtro.'); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); view.unmount();
    mocks.messages.mockResolvedValue({ ...detail, nextBefore: at }); mount(); await select(); await screen.findByText('Exibindo as 50 mensagens mais recentes.');
  });
  it.each(['actor', 'clinic', 'inactive'])('clears selection and search when %s context changes', async target => {
    const view = mount(); await select(); await screen.findByText('Mensagem sintética recebida');
    fireEvent.change(screen.getByLabelText('Buscar conversa'), { target: { value: 'rascunho sintético' } });
    mocks.conversations.mockResolvedValue({ conversations: [], nextBefore: null });
    if (target === 'actor') mocks.actor = clinic;
    view.rerender(view.tree(target === 'actor' ? { ...access, actorId: clinic } : target === 'clinic' ? { ...access, clinic: { id, name: 'Outra clínica sintética' } } : { ...access, active: false }));
    expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('rascunho sintético')).not.toBeInTheDocument();
  });
  it('aborts the previous detail on selection close and ignores a late result', async () => {
    let resolve!: (value: typeof detail) => void;
    mocks.messages.mockReturnValue(new Promise(done => { resolve = done; })); mount(); await select();
    await waitFor(() => expect(mocks.messages).toHaveBeenCalledTimes(1)); const signal = mocks.messages.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' })); expect(signal.aborted).toBe(true);
    await act(async () => resolve(detail)); expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
  });
  it('refuses stale cached messages when reopening the same conversation', async () => {
    mount(); await select(); await screen.findByText('Mensagem sintética recebida');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }));
    let resolve!: (value: typeof detail) => void;
    mocks.messages.mockReturnValue(new Promise(done => { resolve = done; }));
    await select(); expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.messages).toHaveBeenCalledTimes(2));
    await act(async () => resolve({ ...detail, messages: [{ ...detail.messages[0], body: 'Mensagem atualizada sintética' }] }));
    await screen.findByText('Mensagem atualizada sintética'); expect(screen.queryByText('Mensagem sintética recebida')).not.toBeInTheDocument();
  });
  it('recovers a failed connection read without exposing the raw failure', async () => {
    mocks.state.mockRejectedValueOnce(new Error('SYNTHETIC INTERNAL STATE ERROR')); mount(); await screen.findByRole('alert');
    expect(mocks.conversations).not.toHaveBeenCalled(); expect(screen.queryByText('SYNTHETIC INTERNAL STATE ERROR')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar conexão' })); await screen.findByText(conversation.profileName);
  });
  it('focuses the panel while its first read is pending and keeps the error reachable', async () => {
    let reject!: (error: Error) => void;
    mocks.messages.mockReturnValue(new Promise((_, fail) => { reject = fail; })); mount(); await select();
    await waitFor(() => expect(mocks.messages).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('region', { name: 'Conversa selecionada' })).toHaveFocus();
    await act(async () => reject(new Error('Synthetic first read refused')));
    expect(await screen.findByRole('button', { name: 'Tentar carregar mensagens' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Conversa selecionada' })).toHaveFocus();
  });
  it('scrolls an offscreen panel into view regardless of the phone breakpoint', async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    const rect = vi.spyOn(HTMLHeadingElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2000, bottom: 2050 } as DOMRect);
    try {
      mount(); await select(); await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'start' }));
      expect(screen.getByRole('region', { name: 'Conversa selecionada' })).toHaveFocus();
    } finally { rect.mockRestore(); }
  });
});
