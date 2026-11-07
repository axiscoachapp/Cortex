import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whatsappApi } from './whatsappApi';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const at = '2026-11-06T18:30:00.123456+00:00';
const cursor = at + '|' + id;
const oversizedTimestamp = '2026-11-06T18:30:00.' + '1'.repeat(128) + 'Z';
const state = { serverReady: true, connected: true, status: 'connected', displayPhone: 'Número sintético', verifiedName: 'Clínica sintética', quality: null, connectedAt: at, canManage: false, canUseInbox: true };
const conversation = { id, waId: null, profileName: 'Contato sintético', contactId: null, caseId: null, queue: 'geral', status: 'open', assignedTo: null, assignedAt: null, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: at, lastMessageAt: at, lastMessagePreview: 'Mensagem sintética', unreadCount: 2, optedOut: false, consented: true, revision: 1 };
const message = { id: other, direction: 'in', kind: 'text', body: 'Mensagem sintética', media: null, template: null, status: 'received', error: null, sentBy: null, at };
const session = { status: 'handed_off', path: ['Agendamento', 'Médico sintético'], outcome: 'queue:agendamento', startedAt: at, updatedAt: at };
describe('WhatsApp read adapter', () => {
  beforeEach(() => vi.resetAllMocks());
  it('reads connection state without sending actor or clinic and forwards cancellation', async () => {
    mocks.invoke.mockResolvedValue({ data: state, error: null });
    const signal = new AbortController().signal;
    expect(await whatsappApi.state(signal)).toEqual(state);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api', { body: { action: 'state' }, signal });
  });
  it('accepts the administrator DTO but retains only fields needed by the inbox', async () => {
    mocks.invoke.mockResolvedValue({ data: { ...state, canManage: true, lastError: null, webhookUrl: 'https://example.invalid/webhook', phoneNumberId: 'SYNTHETIC', wabaId: 'SYNTHETIC' }, error: null });
    expect(await whatsappApi.state()).toEqual({ ...state, canManage: true });
  });
  it.each([{ ...state, accessToken: 'SYNTHETIC-NOT-A-TOKEN' }, { ...state, unread: 3 }])('rejects unexpected state fields without returning their contents', async data => {
    mocks.invoke.mockResolvedValue({ data, error: null });
    await expect(whatsappApi.state()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('sends only the explicit read filter and preserves opaque timestamp precision', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversations: [conversation], nextBefore: cursor }, error: null });
    expect(await whatsappApi.conversations({ filter: 'mine', search: '  exemplo  ', before: cursor, limit: 25 })).toEqual({ conversations: [conversation], nextBefore: cursor });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api', { body: { action: 'conversations', filter: 'mine', search: 'exemplo', before: cursor, limit: 25 }, signal: undefined });
  });
  it('uses bounded default list parameters', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversations: [], nextBefore: null }, error: null });
    await whatsappApi.conversations();
    expect(mocks.invoke.mock.calls[0][1].body).toEqual({ action: 'conversations', filter: 'open', search: '', before: null, limit: 50 });
  });
  it('rejects a page larger than the requested limit', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversations: [conversation, { ...conversation, id: other }], nextBefore: cursor }, error: null });
    await expect(whatsappApi.conversations({ limit: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects an oversized timestamp cursor before transport', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversations: [], nextBefore: null }, error: null });
    await expect(whatsappApi.conversations({ before: oversizedTimestamp })).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each([at, at + '|invalid', cursor + '|extra', 'not-a-date|' + id])('refuses malformed v1.1 cursors before transport', async before => {
    await expect(whatsappApi.messages({ conversationId: id, before })).rejects.toThrow(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('preserves the complete v1.1 message cursor and consent state', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversation, messages: [message], nextBefore: cursor }, error: null });
    const page = await whatsappApi.messages({ conversationId: id, before: cursor });
    expect(page.nextBefore).toBe(cursor); expect(page.conversation.consented).toBe(true);
    expect(mocks.invoke.mock.calls[0][1].body.before).toBe(cursor);
  });
  it.each([
    { conversations: [conversation], nextBefore: oversizedTimestamp },
    { conversations: [{ ...conversation, lastMessageAt: oversizedTimestamp }], nextBefore: null },
  ])('rejects oversized retained response timestamps', async data => {
    mocks.invoke.mockResolvedValue({ data, error: null });
    await expect(whatsappApi.conversations()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([{ filter: 'all' }, { limit: 101 }, { limit: 0 }, { before: 'yesterday' }, { clinicId: id }, { actorId: id }])('rejects invalid or authority-bearing list input before transport', async input => {
    await expect(whatsappApi.conversations(input as never)).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { conversations: [{ ...conversation, revision: 0 }], nextBefore: null },
    { conversations: [{ ...conversation, unreadCount: -1 }], nextBefore: null },
    { conversations: [{ ...conversation, patientNotes: 'Synthetic forbidden field' }], nextBefore: null },
    { conversations: [conversation, conversation], nextBefore: null },
  ])('rejects invalid or duplicated conversation metadata', async data => {
    mocks.invoke.mockResolvedValue({ data, error: null });
    await expect(whatsappApi.conversations()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads messages only for the requested conversation with cancellation', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversation, messages: [message], nextBefore: null }, error: null });
    const signal = new AbortController().signal;
    expect(await whatsappApi.messages({ conversationId: id }, signal)).toEqual({ conversation, messages: [message], nextBefore: null });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api', { body: { action: 'messages', conversationId: id, before: null }, signal });
  });
  it('refuses a response bound to another conversation', async () => {
    mocks.invoke.mockResolvedValue({ data: { conversation: { ...conversation, id: other }, messages: [message], nextBefore: null }, error: null });
    await expect(whatsappApi.messages({ conversationId: id })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('canonicalizes UUID case without changing conversation identity', async () => {
    const canonical = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mocks.invoke.mockResolvedValue({ data: { conversation: { ...conversation, id: canonical }, messages: [message], nextBefore: null }, error: null });
    expect((await whatsappApi.messages({ conversationId: canonical.toUpperCase() })).conversation.id).toBe(canonical);
    expect(mocks.invoke.mock.calls[0][1].body.conversationId).toBe(canonical);
  });
  it.each([
    { messages: [{ ...message, media: { mime: 'image/png', filename: null, voice: false, url: 'https://example.invalid/forbidden' } }] },
    { messages: [message, message] },
  ])('rejects unexpected media fields and duplicated message IDs', async ({ messages }) => {
    mocks.invoke.mockResolvedValue({ data: { conversation, messages, nextBefore: null }, error: null });
    await expect(whatsappApi.messages({ conversationId: id })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('refuses invalid conversation IDs before transport', async () => {
    await expect(whatsappApi.messages({ conversationId: 'removed-or-invalid' })).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('maps forbidden to a safe message and does not expose raw server errors', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ code: 'forbidden', error: 'SYNTHETIC INTERNAL DETAIL' }), { status: 403 }) } });
    await expect(whatsappApi.conversations()).rejects.toMatchObject({ code: 'forbidden', message: 'Você não tem acesso à caixa de conversas desta clínica.' });
  });
  it('normalizes unknown server errors instead of exposing raw contents', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ code: 'SYNTHETIC-INTERNAL', error: 'SYNTHETIC PRIVATE DETAIL' }), { status: 500 }) } });
    await expect(whatsappApi.state()).rejects.toMatchObject({ code: 'unavailable', message: 'Não foi possível carregar o WhatsApp. Verifique o acesso e tente novamente.' });
  });
  it('normalizes thrown transport failures without exposing their contents', async () => {
    mocks.invoke.mockRejectedValue(new Error('SYNTHETIC PRIVATE TRANSPORT DETAIL'));
    await expect(whatsappApi.state()).rejects.toMatchObject({ code: 'unavailable', message: 'Não foi possível carregar o WhatsApp. Verifique o acesso e tente novamente.' });
  });
});

describe('WhatsApp bot session read contract v1.2',()=>{
  beforeEach(()=>vi.resetAllMocks());
  it('reads only the selected conversation with cancellation and preserves the path',async()=>{
    mocks.invoke.mockResolvedValue({data:{session},error:null});
    const signal=new AbortController().signal;
    expect(await whatsappApi.botSession({conversationId:id},signal)).toEqual({session});
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'botSession',conversationId:id},signal});
  });
  it('distinguishes no bot session from an unavailable response',async()=>{
    mocks.invoke.mockResolvedValue({data:{session:null},error:null});
    expect(await whatsappApi.botSession({conversationId:id})).toEqual({session:null});
  });
  it.each(['active','handed_off','closed','human','error'])('accepts the explicit %s status',async status=>{
    mocks.invoke.mockResolvedValue({data:{session:{...session,status}},error:null});
    expect((await whatsappApi.botSession({conversationId:id})).session?.status).toBe(status);
  });
  it.each([
    {session:{...session,status:'sent'}},
    {session:{...session,path:Array(21).fill('Sintético')}},
    {session:{...session,path:['x'.repeat(25)]}},
    {session:{...session,path:[{}]}},
    {session:{...session,outcome:'x'.repeat(81)}},
    {session:{...session,updatedAt:oversizedTimestamp}},
    {session:{...session,patientNotes:'Synthetic forbidden field'}},
    {session,conversationId:id},
    {},
  ])('refuses malformed or unexpected bot metadata',async data=>{
    mocks.invoke.mockResolvedValue({data,error:null});
    await expect(whatsappApi.botSession({conversationId:id})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it.each([{conversationId:'invalid'},{conversationId:id,clinicId:other},{conversationId:id,actorId:other}])('refuses invalid identity or authority input before transport',async input=>{
    await expect(whatsappApi.botSession(input as never)).rejects.toThrow();expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
