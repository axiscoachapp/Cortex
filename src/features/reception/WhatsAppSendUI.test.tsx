import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppInbox from './WhatsAppInbox';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
import type { WhatsAppConversation, WhatsAppMessage } from './whatsappApi';
import { WhatsAppSendError } from './whatsappSend';

const mocks = vi.hoisted(() => ({ state: vi.fn(), conversations: vi.fn(), messages: vi.fn(), botSession: vi.fn(), claim: vi.fn(), send: vi.fn(), markRead: vi.fn(), templates: vi.fn(), assignees: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { state: mocks.state, conversations: mocks.conversations, messages: mocks.messages, botSession: mocks.botSession } }));
vi.mock('./whatsappClaim', async original => ({ ...await original<typeof import('./whatsappClaim')>(), claimWhatsAppConversation: mocks.claim }));
vi.mock('./whatsappSend', async original => ({ ...await original<typeof import('./whatsappSend')>(), sendWhatsAppMessage: mocks.send, markWhatsAppConversationRead: mocks.markRead }));
vi.mock('./whatsappTemplates', async original => ({ ...await original<typeof import('./whatsappTemplates')>(), readWhatsAppTemplates: mocks.templates }));
vi.mock('./whatsappAssignees', async original => ({ ...await original<typeof import('./whatsappAssignees')>(), readWhatsAppAssignees: mocks.assignees }));

const clinic = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333', other = '77777777-7777-4777-8777-777777777777';
const at = '2026-11-06T18:30:00.123456+00:00';
const future = () => new Date(Date.now() + 3 * 3600_000).toISOString();
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const base: WhatsAppConversation = { id, profileName: 'Contato sintético A', waId: '5511900000000', contactId: null, caseId: null, queue: 'agenda', status: 'open', assignedTo: access.actorId, assignedAt: at, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: null, lastMessageAt: at, lastMessagePreview: 'Prévia sintética', unreadCount: 0, optedOut: false, consented: true, revision: 1 };
const inbound: WhatsAppMessage = { id: '44444444-4444-4444-8444-444444444444', direction: 'in', kind: 'text', body: 'Mensagem sintética recebida', media: null, template: null, status: 'received', error: null, sentBy: null, at };
const outbound = (body: string, status: string, n = 5): WhatsAppMessage => ({ ...inbound, id: `${n}5555555-5555-4555-8555-555555555555`, direction: 'out', body, status, sentBy: access.actorId });
let conversation: WhatsAppConversation;
const detail = (patch: Partial<WhatsAppConversation> = {}, messages: WhatsAppMessage[] = [inbound]) => ({ conversation: { ...conversation, ...patch }, messages, nextBefore: null });
const approved = { name: 'retomar_contato', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Olá {{1}}, podemos falar sobre {{2}}?', paramCount: 2 };
const pending = { ...approved, name: 'em_analise', status: 'PENDING' };

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}><WhatsAppInbox /></ClinicAccessContext.Provider></QueryClientProvider>);
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Contato sintético A' })); await screen.findByText('Mensagem sintética recebida'); }
const region = () => screen.getByRole('region', { name: 'Conversa selecionada' });
const composer = () => screen.getByRole('form', { name: 'Responder conversa' });

beforeEach(() => {
  vi.resetAllMocks(); mocks.actor = access.actorId;
  conversation = { ...base, windowOpenUntil: future() };
  mocks.state.mockResolvedValue({ serverReady: true, connected: true, canUseInbox: true });
  mocks.conversations.mockImplementation(async () => ({ conversations: [conversation], nextBefore: null }));
  mocks.messages.mockImplementation(async () => detail());
  mocks.botSession.mockResolvedValue({ session: null });
  mocks.send.mockResolvedValue({ outcome: 'sent', messageId: '66666666-6666-4666-8666-666666666666', duplicate: false });
  mocks.markRead.mockResolvedValue(true);
  mocks.templates.mockResolvedValue({ templates: [approved, pending] });
  mocks.assignees.mockResolvedValue({ items: [{ userId: other, name: 'Maria Sintética', role: 'reception', ambiguous: false }], nextBefore: null });
});

describe('composer inside the 24-hour window', () => {
  it('sends on Enter with a request id, keeps Shift+Enter as a line break and shows the new message without blanking', async () => {
    mount(); await open();
    const box = within(composer()).getByLabelText('Mensagem');
    fireEvent.change(box, { target: { value: 'Primeira linha' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(mocks.send).not.toHaveBeenCalled();
    const reads = mocks.messages.mock.calls.length;
    mocks.messages.mockImplementation(async () => detail({}, [outbound('Primeira linha', 'sent'), inbound]));
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    const [input, signal] = mocks.send.mock.calls[0];
    expect(input).toEqual({ conversationId: id, text: 'Primeira linha', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(await within(region()).findByText('Primeira linha')).toBeVisible();
    expect(mocks.messages.mock.calls.length).toBeGreaterThan(reads);
    expect(within(composer()).getByLabelText('Mensagem')).toHaveValue('');
    expect(screen.getByText('Mensagem enviada.')).toBeVisible();
    expect(screen.queryByText('Carregando mensagens…')).not.toBeInTheDocument();
  });
  it('locks the composer and the other commands while sending', async () => {
    let finish!: (value: unknown) => void; mocks.send.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mount(); await open();
    fireEvent.change(within(composer()).getByLabelText('Mensagem'), { target: { value: 'Texto sintético' } });
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    const busy = await within(composer()).findByRole('button', { name: 'Enviando…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy); fireEvent.keyDown(within(composer()).getByLabelText('Mensagem'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Devolver à fila' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Atualizar mensagens' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Atualizar conversas' })).toBeDisabled();
    await act(async () => finish({ outcome: 'sent', messageId: '66666666-6666-4666-8666-666666666666', duplicate: false }));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devolver à fila' })).toBeEnabled());
  });
  it('keeps the text after a definite failure and starts a new request on the next try', async () => {
    mocks.send.mockRejectedValueOnce(new WhatsAppSendError('send_failed'));
    mount(); await open();
    fireEvent.change(within(composer()).getByLabelText('Mensagem'), { target: { value: 'Texto que falhou' } });
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    expect(await within(composer()).findByRole('alert')).toHaveTextContent('O WhatsApp recusou a mensagem e nada foi enviado.');
    expect(within(composer()).getByLabelText('Mensagem')).toHaveValue('Texto que falhou');
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0].requestId).not.toBe(mocks.send.mock.calls[0][0].requestId);
  });
  it('keeps the text and the same request id after an unconfirmed failure, so a retry cannot duplicate', async () => {
    mocks.send.mockRejectedValueOnce(new WhatsAppSendError('unavailable'));
    mount(); await open();
    fireEvent.change(within(composer()).getByLabelText('Mensagem'), { target: { value: 'Texto sem resposta' } });
    const reads = mocks.messages.mock.calls.length;
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    expect(await within(composer()).findByRole('alert')).toHaveTextContent('A nova tentativa não duplica o envio.');
    await waitFor(() => expect(mocks.messages.mock.calls.length).toBeGreaterThan(reads));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(within(composer()).getByLabelText('Mensagem')).toHaveValue('Texto sem resposta');
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0].requestId).toBe(mocks.send.mock.calls[0][0].requestId);
  });
  it('warns on an unknown outcome, refreshes the messages and never resends by itself', async () => {
    mocks.send.mockResolvedValue({ outcome: 'unknown', messageId: '66666666-6666-4666-8666-666666666666', duplicate: false });
    mount(); await open();
    mocks.messages.mockImplementation(async () => detail({}, [outbound('Texto incerto', 'unknown'), inbound]));
    fireEvent.change(within(composer()).getByLabelText('Mensagem'), { target: { value: 'Texto incerto' } });
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    expect(await within(composer()).findByRole('alert')).toHaveTextContent('O WhatsApp não confirmou o envio.');
    expect(await within(region()).findByText('Envio não confirmado')).toBeVisible();
    expect(within(region()).getByText('O WhatsApp não confirmou o envio. Confira com o paciente antes de mandar de novo.')).toBeVisible();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('switches to templates after the server says the window closed, keeping the typed text', async () => {
    mocks.send.mockRejectedValueOnce(new WhatsAppSendError('window_closed'));
    mount(); await open();
    fireEvent.change(within(composer()).getByLabelText('Mensagem'), { target: { value: 'Texto tardio' } });
    mocks.messages.mockImplementation(async () => detail({ windowOpenUntil: at }));
    fireEvent.click(within(composer()).getByRole('button', { name: 'Enviar' }));
    expect(await within(composer()).findByText(/Passaram mais de 24 horas desde a última mensagem do paciente. Para responder/)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Agora só é possível enviar um modelo aprovado.');
    expect(within(composer()).queryByLabelText('Mensagem')).not.toBeInTheDocument();
  });
});

describe('composer outside the window', () => {
  it('offers only approved templates, one input per parameter, a preview and sends the template', async () => {
    conversation = { ...base, windowOpenUntil: at };
    mount(); await open();
    const select = await within(composer()).findByLabelText('Modelo');
    expect(within(select).queryByRole('option', { name: /em_analise/ })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: JSON.stringify([approved.name, approved.language]) } });
    const send = within(composer()).getByRole('button', { name: 'Enviar modelo' });
    expect(send).toBeDisabled();
    expect(screen.getByTestId('template-preview')).toHaveTextContent('Olá [campo 1], podemos falar sobre [campo 2]?');
    fireEvent.change(within(composer()).getByLabelText('Campo 1'), { target: { value: 'Ana' } });
    fireEvent.change(within(composer()).getByLabelText('Campo 2'), { target: { value: 'muitos     espaços' } });
    expect(send).toBeDisabled();
    fireEvent.change(within(composer()).getByLabelText('Campo 2'), { target: { value: ' seu retorno ' } });
    expect(screen.getByTestId('template-preview')).toHaveTextContent('Olá Ana, podemos falar sobre seu retorno?');
    fireEvent.click(send);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0][0]).toEqual({ conversationId: id, requestId: expect.any(String), template: { name: approved.name, language: approved.language, params: ['Ana', 'seu retorno'] } });
  });
  it('says so when the clinic has no approved template', async () => {
    conversation = { ...base, windowOpenUntil: null };
    mocks.templates.mockResolvedValue({ templates: [pending] });
    mount(); await open();
    expect(await within(composer()).findByText('A clínica ainda não tem modelos aprovados. Avise o administrador da clínica.')).toBeVisible();
    expect(within(composer()).queryByRole('button', { name: 'Enviar modelo' })).not.toBeInTheDocument();
  });
});

describe('who can answer', () => {
  it('asks to assume an unassigned conversation and offers no composer', async () => {
    conversation = { ...base, windowOpenUntil: future(), assignedTo: null, assignedAt: null };
    mount(); await open();
    expect(screen.getByText('Assuma a conversa para responder.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assumir conversa' })).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Responder conversa' })).not.toBeInTheDocument();
    expect(within(region()).getByText('Sem responsável')).toBeVisible();
  });
  it("shows another owner's name and offers no composer", async () => {
    conversation = { ...base, windowOpenUntil: future(), assignedTo: other };
    mount(); await open();
    expect(await within(region()).findByText('Com Maria Sintética')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Responder conversa' })).not.toBeInTheDocument();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
  it('says that nothing can be sent to a contact who opted out', async () => {
    conversation = { ...base, windowOpenUntil: future(), optedOut: true, consented: false };
    mount(); await open();
    expect(screen.getByText('Este contato pediu para não receber mensagens. Não é possível enviar mensagens nesta conversa.')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Responder conversa' })).not.toBeInTheDocument();
  });
  it('shows the phone and one compact status line', async () => {
    mount(); await open();
    expect(within(region()).getByText('+5511900000000')).toBeVisible();
    for (const text of ['agenda', 'Em aberto', 'Com você', 'Lembretes autorizados']) expect(within(region()).getByText(text)).toBeVisible();
  });
});

describe('message status and read receipts', () => {
  it('labels outbound statuses and says clearly when one failed', async () => {
    conversation = { ...base, windowOpenUntil: future() };
    mocks.messages.mockImplementation(async () => detail({}, [outbound('S1', 'sent', 1), outbound('S2', 'delivered', 2), outbound('S3', 'read', 3), outbound('S4', 'failed', 4), inbound]));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Contato sintético A' }));
    await within(await screen.findByRole('region', { name: 'Conversa selecionada' })).findByText('S4');
    for (const label of ['Enviada', 'Entregue', 'Lida', 'Falhou']) expect(within(region()).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(region()).getByText('Esta mensagem não foi entregue ao paciente.')).toBeVisible();
  });
  it('marks an owned conversation with unread messages as read once and refreshes the list', async () => {
    conversation = { ...base, windowOpenUntil: future(), unreadCount: 3 };
    mount(); await open();
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    expect(mocks.markRead).toHaveBeenCalledWith(id);
    await waitFor(() => expect(mocks.conversations.mock.calls.length).toBeGreaterThan(1));
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });
  it('does not mark an unassigned conversation as read', async () => {
    conversation = { ...base, windowOpenUntil: future(), unreadCount: 3, assignedTo: null };
    mount(); await open();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
});
