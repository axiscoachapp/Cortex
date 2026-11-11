import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markWhatsAppConversationRead, previewTemplate, sendWhatsAppMessage, WhatsAppSendError } from './whatsappSend';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', messageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const text = { conversationId, requestId, text: '  Olá, sua consulta está confirmada.  ' };
const template = { conversationId, requestId, template: { name: 'lembrete_consulta', language: 'pt_BR', params: ['Ana', '12/11 às 14h'] } };
const ok = (data: unknown, status = 200) => ({ data, error: null, response: new Response(null, { status }) });
const refusal = (code: unknown, status = 409) => ({ data: null, error: { context: new Response(JSON.stringify({ code, error: 'PRIVATE SYNTHETIC SERVER TEXT' }), { status }) }, response: undefined });

describe('WhatsApp send boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.invoke.mockResolvedValue(ok({ messageId, status: 'sent', duplicate: false })); });

  it('sends trimmed free text with the client request id and nothing else', async () => {
    const signal = new AbortController().signal;
    expect(await sendWhatsAppMessage(text, signal)).toEqual({ outcome: 'sent', messageId, duplicate: false });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api', { body: { action: 'send', conversationId, requestId, text: 'Olá, sua consulta está confirmada.' }, signal });
  });
  it('sends a template with exactly its name, language and parameters', async () => {
    await sendWhatsAppMessage(template);
    expect(mocks.invoke.mock.calls[0][1].body).toEqual({ action: 'send', conversationId, requestId, template: template.template });
  });
  it.each([
    { ...text, text: '   ' }, { ...text, text: 'x'.repeat(4097) }, { ...text, conversationId: 'invalid' }, { ...text, requestId: 'invalid' },
    { ...text, template: template.template }, { conversationId, requestId }, { ...text, clinicId: conversationId }, { ...text, actor: requestId },
    { ...template, template: { ...template.template, params: ['linha\nquebrada'] } }, { ...template, template: { ...template.template, params: [' '] } },
    { ...template, template: { ...template.template, params: ['a     b'] } }, { ...template, template: { ...template.template, name: 'Nome Inválido' } },
    { ...template, template: { ...template.template, language: 'portuguese' } }, { ...template, template: { ...template.template, params: Array(21).fill('x') } },
  ])('refuses malformed input or injected fields before transport (%j)', async input => {
    await expect(sendWhatsAppMessage(input as never)).rejects.toMatchObject({ code: 'invalid', ambiguous: false });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each(['sent', 'delivered', 'read', 'unrecorded'])('treats an accepted status as sent (%s)', async status => {
    mocks.invoke.mockResolvedValue(ok({ messageId, status, duplicate: status !== 'sent' }));
    expect((await sendWhatsAppMessage(text)).outcome).toBe('sent');
  });
  it('reports the 202 unknown outcome without retrying', async () => {
    mocks.invoke.mockResolvedValue(ok({ messageId, status: 'unknown', duplicate: false, warning: 'O WhatsApp não confirmou o envio.' }, 202));
    expect(await sendWhatsAppMessage(text)).toEqual({ outcome: 'unknown', messageId, duplicate: false });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: 'unknown', duplicate: true }, { status: 'pending', duplicate: true }])('reports a replayed unconfirmed message as unknown (%j)', async data => {
    mocks.invoke.mockResolvedValue(ok({ messageId, ...data }));
    expect((await sendWhatsAppMessage(text)).outcome).toBe('unknown');
  });
  it('reports a replayed failed message as a definite refusal', async () => {
    mocks.invoke.mockResolvedValue(ok({ messageId, status: 'failed', duplicate: true }));
    await expect(sendWhatsAppMessage(text)).rejects.toMatchObject({ code: 'send_failed', ambiguous: false });
  });
  it.each([
    ok({ messageId, status: 'sent' }), ok({ messageId, status: 'sent', duplicate: false, extra: 'PRIVATE' }), ok({ messageId: 'x', status: 'sent', duplicate: false }),
    ok({ messageId, status: 'other', duplicate: false }), ok({ messageId, status: 'sent', duplicate: false }, 202), ok({ messageId, status: 'unknown', duplicate: false }),
    ok({ messageId, status: 'failed', duplicate: false }), ok(null), ok([]), ok('texto'), ok({ messageId, status: 'unknown', duplicate: true, warning: 'x' }, 202),
  ])('treats an unparseable answer as an unconfirmed outcome that keeps the request id (%#)', async answer => {
    mocks.invoke.mockResolvedValue(answer);
    await expect(sendWhatsAppMessage(text)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', ambiguous: true });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['window_closed', 409, false], ['opted_out', 409, false], ['template', 400, false], ['send_failed', 502, false], ['forbidden', 403, false],
    ['not_found', 404, false], ['not_connected', 409, false], ['server_not_ready', 503, false], ['token_unreadable', 503, false], ['invalid', 400, false],
  ] as const)('maps the server code %s to a short message without raw details', async (code, status, ambiguous) => {
    mocks.invoke.mockResolvedValue(refusal(code, status));
    const error = await sendWhatsAppMessage(text).catch(failure => failure);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect(error).toMatchObject({ code, ambiguous });
    expect(error.message).not.toContain('PRIVATE');
    expect(error.message.length).toBeGreaterThan(10);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['server', 'stale', 'graph_131047', null, 42, 'INVALID_RESPONSE', 'cancelled'])('treats an unexpected server code as an unknown outcome (%s)', async code => {
    mocks.invoke.mockResolvedValue(refusal(code, 500));
    await expect(sendWhatsAppMessage(text)).rejects.toMatchObject({ code: 'unavailable', ambiguous: true });
  });
  it('treats a gateway error without JSON body as an unknown outcome', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response('Gateway Timeout', { status: 504 }) } });
    await expect(sendWhatsAppMessage(text)).rejects.toMatchObject({ code: 'unavailable', ambiguous: true });
  });
  it('treats a lost answer as an unknown outcome and never retries', async () => {
    mocks.invoke.mockRejectedValue(new Error('PRIVATE SYNTHETIC FETCH'));
    const error = await sendWhatsAppMessage(text).catch(failure => failure);
    expect(error).toMatchObject({ code: 'unavailable', ambiguous: true });
    expect(error.message).not.toContain('PRIVATE');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('does not send an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(sendWhatsAppMessage(text, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('WhatsApp mark_read boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('sends only the mark_read operation and the conversation', async () => {
    mocks.invoke.mockResolvedValue({ data: { revision: 3, status: 'open', assignedTo: requestId }, error: null });
    expect(await markWhatsAppConversationRead(conversationId.toUpperCase())).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api', { body: { action: 'act', operation: 'mark_read', conversationId }, signal: undefined });
  });
  it.each([
    { data: null, error: { context: new Response('{}', { status: 403 }) } }, { data: { revision: 0, status: 'open', assignedTo: null }, error: null },
    { data: { revision: 3, status: 'open', assignedTo: null, extra: 1 }, error: null }, undefined,
  ])('resolves false on refusal or an unexpected answer (%#)', async answer => {
    mocks.invoke.mockResolvedValue(answer);
    expect(await markWhatsAppConversationRead(conversationId)).toBe(false);
  });
  it('resolves false on a lost answer and refuses an invalid id before transport', async () => {
    mocks.invoke.mockRejectedValue(new Error('lost'));
    expect(await markWhatsAppConversationRead(conversationId)).toBe(false);
    mocks.invoke.mockClear();
    expect(await markWhatsAppConversationRead('invalid')).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('template preview', () => {
  it('fills numbered placeholders and shows empty fields', () => {
    expect(previewTemplate('Olá {{1}}, sua consulta é {{2}}.', ['Ana', ''])).toBe('Olá Ana, sua consulta é [campo 2].');
    expect(previewTemplate('Sem campos {{3}}', ['x'])).toBe('Sem campos {{3}}');
  });
});
