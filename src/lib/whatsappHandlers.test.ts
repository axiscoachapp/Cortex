// WhatsApp channel (C4): helpers and Edge handlers with injected fakes. Synthetic data only; no Meta
// account, number, token or deploy.
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openSecret, parseKeyList } from '../../supabase/functions/_shared/psc';
import { GraphError, graphClient, parseWebhook, validSignature, windowOpenUntil, type GraphClient } from '../../supabase/functions/_shared/whatsapp';
import {
  apiHandler, automationsHandler, runBot, type AssigneeRow, type BotSessionRow, type FlowRow, inQuietHours, renderBody, renderParams, tokenBinding, webhookHandler, type AutomationRow, type Candidate, type Caller, type ChannelRow, type ConversationRow, type MessageRow, type TemplateRow, type WhatsAppDeps,
} from '../../supabase/functions/_shared/whatsappHandlers';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const RECEPTION = '33333333-3333-4333-8333-333333333333';
const DOCTOR = '44444444-4444-4444-8444-444444444444';
const CONV = '55555555-5555-4555-8555-555555555555';
const REQ = '66666666-6666-4666-8666-666666666666';
const CHANNEL = '77777777-7777-4777-8777-777777777777';
const MSG = '88888888-8888-4888-8888-888888888888';
const RULE = '99999999-9999-4999-8999-999999999999';
const APPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CRON = 'c'.repeat(40);
const SECRET = 'synthetic-app-secret';
const keys = parseKeyList(`k1:${Buffer.from(new Uint8Array(32).fill(7)).toString('base64')}`);
const enc = (s: string) => new TextEncoder().encode(s);
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

const textDelivery = {
  object: 'whatsapp_business_account',
  entry: [{ id: '1000000001', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '554130000000', phone_number_id: '200000000001' },
    contacts: [{ profile: { name: 'Paciente Exemplo' }, wa_id: '5541999990000' }],
    messages: [{ from: '5541999990000', id: 'wamid.SYNTHETIC1', timestamp: '1793980800', type: 'text', text: { body: 'Olá, quero remarcar' } }],
    statuses: [{ id: 'wamid.OUT1', status: 'failed', timestamp: '1793980801', recipient_id: '5541999990000', errors: [{ code: 131047, title: 'Re-engagement message' }] }],
  } }] }],
};

describe('whatsapp helpers', () => {
  it('accepts only the exact HMAC of the raw body', async () => {
    const body = JSON.stringify(textDelivery);
    expect(await validSignature(SECRET, enc(body), sign(body))).toBe(true);
    expect(await validSignature(SECRET, enc(body + ' '), sign(body))).toBe(false);
    expect(await validSignature(SECRET, enc(body), 'sha256=abc')).toBe(false);
    expect(await validSignature(SECRET, enc(body), null)).toBe(false);
    expect(await validSignature('', enc(body), sign(body))).toBe(false);
  });

  it('parses messages, captions, replies and receipts, skipping malformed parts', () => {
    const payload = structuredClone(textDelivery) as typeof textDelivery & { entry: Array<{ changes: Array<{ field: string; value: Record<string, unknown[]> }> }> };
    const v = payload.entry[0].changes[0].value as unknown as { messages: unknown[] };
    v.messages.push(
      { from: '5541999990000', id: 'wamid.SYNTHETIC2', timestamp: '1793980802', type: 'image', image: { id: '9001', mime_type: 'image/jpeg', caption: 'Resultado' } },
      { from: '5541999990000', id: 'wamid.SYNTHETIC3', timestamp: '1793980803', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'c', title: 'Confirmo' } } },
      { from: 'not-a-number', id: 'wamid.BAD', type: 'text', text: { body: 'x' } },
      { from: '5541999990000', id: 'wamid.SYNTHETIC4', type: 'order' },
    );
    payload.entry[0].changes.push({ field: 'account_update', value: {} });
    const { messages, statuses } = parseWebhook(payload);
    expect(messages.map((m) => [m.wamid, m.kind, m.body])).toEqual([
      ['wamid.SYNTHETIC1', 'text', 'Olá, quero remarcar'],
      ['wamid.SYNTHETIC2', 'image', 'Resultado'],
      ['wamid.SYNTHETIC3', 'interactive', 'Confirmo'],
      ['wamid.SYNTHETIC4', 'unsupported', ''],
    ]);
    expect(messages[0]).toMatchObject({ phoneNumberId: '200000000001', waId: '5541999990000', profileName: 'Paciente Exemplo', providerAt: '2026-11-06T16:00:00.000Z', userId: null, contextWamid: null });
    expect(messages[1].media).toEqual({ id: '9001', mime: 'image/jpeg' });
    expect(statuses).toEqual([{ phoneNumberId: '200000000001', wamid: 'wamid.OUT1', status: 'failed', at: '2026-11-06T16:00:01.000Z', error: '131047 Re-engagement message' }]);
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual({ messages: [], statuses: [], identityChanges: [] });
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [], identityChanges: [] });
  });

  it('accepts people known only by their business-scoped id, quick replies and identity changes', () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: '200000000001' },
      contacts: [{ profile: { name: 'Pessoa Usuário', username: 'pessoa' }, user_id: 'BR.13491208655302741918' }],
      messages: [
        { from_user_id: 'BR.13491208655302741918', id: 'wamid.BSUID1', timestamp: '1793980800', type: 'button', button: { text: 'Confirmar', payload: 'c' }, context: { id: 'wamid.OUT000002' } },
        { id: 'wamid.SYS1', timestamp: '1793980801', type: 'system', system: { type: 'user_changed_number', user_id: 'BR.2', previous_user_id: 'BR.1', wa_id: '5541999970004', body: 'User changed from x to y' } },
        { from_user_id: 'not valid', id: 'wamid.BAD2', type: 'text', text: { body: 'x' } },
      ],
    } }] }] };
    const { messages, identityChanges } = parseWebhook(payload);
    expect(messages).toEqual([expect.objectContaining({ waId: null, userId: 'BR.13491208655302741918', profileName: 'Pessoa Usuário', kind: 'button', body: 'Confirmar', contextWamid: 'wamid.OUT000002' })]);
    expect(identityChanges).toEqual([{ phoneNumberId: '200000000001', wamid: 'wamid.SYS1', kind: 'user_changed_number', previousUserId: 'BR.1', userId: 'BR.2', waId: '5541999970004', at: '2026-11-06T16:00:01.000Z' }]);
  });

  it('computes the 24-hour customer service window', () => {
    expect(windowOpenUntil('2026-11-06T10:00:00.000Z')).toBe('2026-11-07T10:00:00.000Z');
    expect(windowOpenUntil(null)).toBeNull();
  });

  it('maps Graph errors to actionable messages and refuses unexpected media hosts', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/messages')) return new Response(JSON.stringify({ error: { code: 131047, message: 'x' } }), { status: 400 });
      return new Response(JSON.stringify({ url: 'https://evil.example/file', mime_type: 'image/png' }), { status: 200 });
    }) as unknown as typeof fetch;
    const g = graphClient(fetcher);
    await expect(g.send('200000000001', 'token', { to: '5541999990000', type: 'text', text: { body: 'oi' } })).rejects.toMatchObject({ code: 131047, message: expect.stringContaining('24 horas') });
    await expect(g.media('9001', 'token')).rejects.toBeInstanceOf(GraphError);
    expect(() => graphClient(fetcher, 'latest')).toThrow();
  });
});

const TEAM: AssigneeRow[] = [
  { user_id: '10000000-0000-4000-8000-000000000001', name: 'Ana Exemplo', role: 'reception' },
  { user_id: '10000000-0000-4000-8000-000000000002', name: 'Bruno Exemplo', role: 'admin' },
  { user_id: '10000000-0000-4000-8000-000000000003', name: 'ana exemplo', role: 'reception' },
];

function harness(opts: { caller?: Caller; conv?: Partial<ConversationRow>; templates?: TemplateRow[]; channel?: Partial<ChannelRow> | null; config?: Partial<WhatsAppDeps['config']>;
  flow?: Partial<FlowRow> | null; botSession?: BotSessionRow | null } = {}) {
  const flowRow: FlowRow | null = opts.flow === undefined ? null : opts.flow === null ? null : {
    clinic_id: CLINIC, enabled: true, hours: {}, after_hours_text: '', handoff_text: 'Uma pessoa da recepção continua por aqui.', default_queue: 'geral',
    revision: 3, updated_at: '2026-11-06T12:00:00Z',
    definition: { start: 'inicio', nodes: { inicio: { title: 'Início', text: 'Como podemos ajudar?', options: [
      { label: 'Agendar', goto: 'queue:agendamento' }, { label: 'Endereço', goto: 'info' }] },
      info: { title: 'Info', text: 'Rua Exemplo, 100.', options: [], then: 'close' } } },
    ...opts.flow,
  };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpcResults: Record<string, unknown> = {};
  const rpcErrors: Record<string, { code: string }> = {};
  const saved: Array<Omit<ChannelRow, 'connected_at'> & { connected_by: string }> = [];
  let channel: ChannelRow | null = opts.channel === null ? null : {
    id: CHANNEL, clinic_id: CLINIC, phone_number_id: '200000000001', waba_id: '1000000001', display_phone: '+55 41 3000-0000',
    verified_name: 'Clínica Exemplo', quality_rating: 'GREEN', status: 'connected', token_sealed: null, last_error: null,
    connected_at: '2026-11-06T12:00:00Z', ...(opts.channel ?? {}),
  };
  const conv: ConversationRow = {
    id: CONV, clinic_id: CLINIC, wa_id: '5541999990000', user_id: 'BR.1111', profile_name: 'Paciente Exemplo', contact_id: null, case_id: null, queue: 'geral',
    status: 'open', assigned_to: null, assigned_at: null, opened_at: '2026-11-06T12:00:00Z', first_response_at: null, closed_at: null,
    last_inbound_at: '2026-11-06T12:00:00Z', last_message_at: '2026-11-06T12:00:00Z', last_message_preview: 'Olá', unread_count: 1,
    opted_out_at: null, revision: 3, ...(opts.conv ?? {}),
  };
  const message: MessageRow = {
    id: MSG, clinic_id: CLINIC, conversation_id: CONV, direction: 'in', wamid: 'wamid.SYNTHETIC2', kind: 'image', body: '', media: { id: '9001', mime: 'image/jpeg' },
    template: null, status: 'received', error: null, sent_by: null, provider_at: null, created_at: '2026-11-06T12:00:00Z',
  };
  const automations: AutomationRow[] = [{
    id: RULE, clinic_id: CLINIC, name: 'Lembrete 48 h', enabled: true, trigger: 'before_start', offset_minutes: 2880, template_name: 'lembrete_consulta',
    template_language: 'pt_BR', params: [{ source: 'paciente_primeiro_nome' }, { source: 'data' }], link_url: null, doctor_ids: null, appointment_types: null,
    revision: 1, updated_at: '2026-11-06T12:00:00Z',
  }];
  const graph: GraphClient = {
    phoneNumber: vi.fn(async () => ({ displayPhone: '+55 41 3000-0000', verifiedName: 'Clínica Exemplo', quality: 'GREEN' })),
    wabaPhoneNumbers: vi.fn(async () => ['200000000001']),
    subscribeApp: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    templates: vi.fn(async () => [{ name: 'lembrete_consulta', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Olá {{1}}, sua consulta é {{2}}.', paramCount: 2 }]),
    send: vi.fn(async () => 'wamid.OUT2'),
    markRead: vi.fn(async () => {}),
    media: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' })),
  };
  const deps: WhatsAppDeps = {
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    config: { appSecret: SECRET, verifyToken: 'synthetic-verify', keys, webhookUrl: 'https://example.supabase.co/functions/v1/whatsapp-webhook', cronSecret: CRON, ...(opts.config ?? {}) },
    authorize: async () => opts.caller ?? { userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true },
    authFailure: () => null,
    // Fixed clock, one minute after the synthetic conversation's last inbound message.
    now: () => new Date('2026-11-06T12:01:00Z'),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (rpcErrors[name]) throw Object.assign(new Error('rpc'), rpcErrors[name]);
      return rpcResults[name] ?? null;
    }),
    store: {
      channelForClinic: async (id) => (channel && id === CLINIC ? channel : null),
      channelByPhoneNumberId: async (id) => (channel && channel.phone_number_id === id ? channel : null),
      saveChannel: async (row) => { saved.push(row); channel = { ...row, connected_at: '2026-11-06T13:00:00Z' } as ChannelRow; },
      disconnect: async () => { if (channel) channel = { ...channel, status: 'disconnected', token_sealed: null }; },
      replaceTemplates: async () => {},
      templates: async () => opts.templates ?? [{ name: 'lembrete_consulta', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Olá {{1}}, {{2}}', param_count: 2 }],
      conversations: async () => [conv],
      conversation: async (clinicId, id) => (clinicId === CLINIC && id === CONV ? conv : null),
      messages: async () => [message],
      message: async (clinicId, id) => (clinicId === CLINIC && id === MSG ? message : null),
      lastInboundWamid: async () => 'wamid.SYNTHETIC1',
      automations: async () => automations,
      automationsByIds: async (ids) => automations.filter((a) => ids.includes(a.id) && a.enabled),
      deleteAutomation: async () => true,
      automationRuns: async () => [],
      conversationById: async (id) => (id === CONV ? conv : null),
      flowForClinic: async () => flowRow,
      botSession: async () => opts.botSession ?? null,
      assignees: async (clinicId, after, limit) => (clinicId === CLINIC ? TEAM.filter((r) => !after || r.user_id > after).slice(0, limit) : []),
    },
    graph,
    newId: () => CHANNEL,
  };
  const api = (body: unknown) => apiHandler(new Request('https://x/functions/v1/whatsapp-api', { method: 'POST', body: JSON.stringify(body) }), deps);
  return { deps, calls, rpcResults, rpcErrors, saved, graph, api, setChannel: (c: ChannelRow | null) => { channel = c; } };
}

async function connectedHarness(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness({ caller: { userId: ADMIN, clinicId: CLINIC, admin: true, reception: false }, channel: null, ...opts });
  const res = await h.api({ action: 'connect', phoneNumberId: '200000000001', wabaId: '1000000001', accessToken: 'EAASYNTHETICTOKEN000000000000' });
  expect(res.status).toBe(200);
  return h;
}

describe('webhook handler', () => {
  it('answers the verification challenge only with the configured token', async () => {
    const { deps } = harness();
    const ok = await webhookHandler(new Request('https://x/w?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=12345'), deps);
    expect([ok.status, await ok.text()]).toEqual([200, '12345']);
    expect((await webhookHandler(new Request('https://x/w?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1'), deps)).status).toBe(403);
  });

  it('refuses unsigned deliveries and answers 503 when the server is not configured', async () => {
    const h = harness();
    const body = JSON.stringify(textDelivery);
    const res = await webhookHandler(new Request('https://x/w', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } }), h.deps);
    expect(res.status).toBe(401);
    expect(h.calls).toEqual([]);
    const off = harness({ config: { appSecret: '' } });
    expect((await webhookHandler(new Request('https://x/w', { method: 'POST', body }), off.deps)).status).toBe(503);
  });

  it('stores the delivery first, ingests messages and receipts, then marks it processed', async () => {
    const h = harness();
    h.rpcResults.whatsapp_record_event = { new: true, processed: false };
    const body = JSON.stringify(textDelivery);
    const res = await webhookHandler(new Request('https://x/w', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }), h.deps);
    expect(res.status).toBe(200);
    expect(h.calls.map(([n]) => n)).toEqual(['whatsapp_record_event', 'whatsapp_ingest_inbound', 'whatsapp_apply_status', 'whatsapp_finish_event']);
    expect(h.calls[1][1]).toMatchObject({ p_phone_number_id: '200000000001', p_wa_id: '5541999990000', p_wamid: 'wamid.SYNTHETIC1', p_kind: 'text' });
    expect(h.calls[3][1]).toMatchObject({ p_error: null });
  });

  it('skips an already processed delivery and asks for a retry when processing fails', async () => {
    const body = JSON.stringify(textDelivery);
    const done = harness();
    done.rpcResults.whatsapp_record_event = { new: false, processed: true };
    expect((await webhookHandler(new Request('https://x/w', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }), done.deps)).status).toBe(200);
    expect(done.calls.map(([n]) => n)).toEqual(['whatsapp_record_event']);

    const failing = harness();
    failing.rpcResults.whatsapp_record_event = { new: true, processed: false };
    failing.rpcErrors.whatsapp_ingest_inbound = { code: '08006' };
    const res = await webhookHandler(new Request('https://x/w', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }), failing.deps);
    expect(res.status).toBe(500);
    expect(failing.calls.at(-1)).toEqual(['whatsapp_finish_event', expect.objectContaining({ p_error: 'ingest 08006' })]);
  });
});

describe('api handler: connection', () => {
  it('lets only the clinic admin connect, checks the number against the account and seals the token', async () => {
    const reception = harness({ channel: null });
    const denied = await reception.api({ action: 'connect', phoneNumberId: '200000000001', wabaId: '1000000001', accessToken: 'EAASYNTHETICTOKEN000000000000' });
    expect(denied.status).toBe(403);

    const h = await connectedHarness();
    const row = h.saved[0];
    expect(row).toMatchObject({ id: CHANNEL, clinic_id: CLINIC, phone_number_id: '200000000001', status: 'connected', connected_by: ADMIN });
    expect(JSON.stringify(row)).not.toContain('EAASYNTHETICTOKEN');
    expect(await openSecret(keys, row.token_sealed, tokenBinding(CHANNEL, CLINIC))).toBe('EAASYNTHETICTOKEN000000000000');
    await expect(openSecret(keys, row.token_sealed, tokenBinding(CHANNEL, ADMIN))).rejects.toThrow();
    expect(h.graph.subscribeApp).toHaveBeenCalledWith('1000000001', 'EAASYNTHETICTOKEN000000000000');
    expect(h.graph.templates).toHaveBeenCalled();
  });

  it('refuses a number outside the business account and a server without secrets', async () => {
    const h = harness({ caller: { userId: ADMIN, clinicId: CLINIC, admin: true, reception: false }, channel: null });
    vi.mocked(h.graph.wabaPhoneNumbers).mockResolvedValueOnce(['999999999']);
    const res = await h.api({ action: 'connect', phoneNumberId: '200000000001', wabaId: '1000000001', accessToken: 'EAASYNTHETICTOKEN000000000000' });
    expect([res.status, (await res.json()).code]).toEqual([400, 'mismatch']);
    expect(h.saved).toEqual([]);

    const off = harness({ caller: { userId: ADMIN, clinicId: CLINIC, admin: true, reception: false }, channel: null, config: { keys: null } });
    expect((await off.api({ action: 'connect', phoneNumberId: '200000000001', wabaId: '1000000001', accessToken: 'EAASYNTHETICTOKEN000000000000' })).status).toBe(503);
  });

  it('shows connection details to the admin and only the status to the reception', async () => {
    const h = await connectedHarness();
    const admin = await (await h.api({ action: 'state' })).json();
    expect(admin).toMatchObject({ connected: true, serverReady: true, canManage: true, webhookUrl: expect.stringContaining('whatsapp-webhook'), phoneNumberId: '200000000001' });
    h.deps.authorize = async () => ({ userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true });
    const reception = await (await h.api({ action: 'state' })).json();
    expect(reception).toMatchObject({ connected: true, canManage: false, canUseInbox: true });
    expect(reception).not.toHaveProperty('webhookUrl');
    expect(reception).not.toHaveProperty('phoneNumberId');
  });
});

describe('api handler: inbox', () => {
  it('keeps the inbox to reception and admins', async () => {
    const h = harness({ caller: { userId: DOCTOR, clinicId: CLINIC, admin: false, reception: false } });
    expect((await h.api({ action: 'conversations' })).status).toBe(403);
    const ok = await harness().api({ action: 'conversations', filter: 'unassigned' });
    const body = await ok.json();
    expect(body.conversations[0]).toMatchObject({ id: CONV, waId: '5541999990000', windowOpenUntil: '2026-11-07T12:00:00.000Z', optedOut: false, revision: 3 });
  });

  it('sends free text inside the window under the request id', async () => {
    const h = await connectedHarness();
    h.deps.authorize = async () => ({ userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true });
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: '5541999990000' };
    const res = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Podemos às 15h?' });
    expect(res.status).toBe(200);
    expect(h.calls.find(([n]) => n === 'whatsapp_begin_outbound')?.[1]).toMatchObject({ p_actor: RECEPTION, p_request: REQ, p_kind: 'text' });
    expect(h.graph.send).toHaveBeenCalledWith('200000000001', 'EAASYNTHETICTOKEN000000000000', expect.objectContaining({ to: '5541999990000', type: 'text' }));
    expect(h.calls.at(-1)).toEqual(['whatsapp_finish_outbound', { p_message: MSG, p_wamid: 'wamid.OUT2', p_error: null, p_unknown: false }]);
  });

  it('does not call Meta when the window is closed or the request was already sent', async () => {
    const h = await connectedHarness();
    h.rpcErrors.whatsapp_begin_outbound = { code: 'P0W01' };
    const closed = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' });
    expect([closed.status, (await closed.json()).code]).toEqual([409, 'window_closed']);
    delete h.rpcErrors.whatsapp_begin_outbound;
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'existing', status: 'sent', wamid: 'wamid.OUT2' };
    const again = await (await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' })).json();
    expect(again).toMatchObject({ duplicate: true, status: 'sent' });
    expect(h.graph.send).not.toHaveBeenCalled();
  });

  it('records a failed send and reports it', async () => {
    const h = await connectedHarness();
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: '5541999990000' };
    vi.mocked(h.graph.send).mockRejectedValueOnce(new GraphError('O número não pode receber mensagens pelo WhatsApp.', 400, 131026));
    const res = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' });
    expect(res.status).toBe(502);
    expect(h.calls.at(-1)).toEqual(['whatsapp_finish_outbound', { p_message: MSG, p_wamid: null, p_error: 'O número não pode receber mensagens pelo WhatsApp.', p_unknown: false }]);
  });

  it('sends only approved templates with the right number of fields', async () => {
    const h = await connectedHarness();
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: '5541999990000' };
    const wrong = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, template: { name: 'lembrete_consulta', language: 'pt_BR', params: ['Paciente'] } });
    expect(wrong.status).toBe(400);
    const unknown = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, template: { name: 'promocao', language: 'pt_BR', params: [] } });
    expect(unknown.status).toBe(400);
    const ok = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, template: { name: 'lembrete_consulta', language: 'pt_BR', params: ['Paciente', 'amanhã às 15h'] } });
    expect(ok.status).toBe(200);
    expect(h.graph.send).toHaveBeenCalledWith('200000000001', expect.any(String), expect.objectContaining({
      type: 'template',
      template: { name: 'lembrete_consulta', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Paciente' }, { type: 'text', text: 'amanhã às 15h' }] }] },
    }));
  });

  it('assigns to the caller by default, needs the revision and reports conflicts', async () => {
    const h = harness();
    expect((await h.api({ action: 'act', conversationId: CONV, operation: 'assign' })).status).toBe(400);
    h.rpcResults.whatsapp_conversation_action = { revision: 4, status: 'open', assignedTo: RECEPTION };
    const ok = await h.api({ action: 'act', conversationId: CONV, operation: 'assign', revision: 3 });
    expect(await ok.json()).toEqual({ revision: 4, status: 'open', assignedTo: RECEPTION });
    expect(h.calls.at(-1)?.[1]).toMatchObject({ p_actor: RECEPTION, p_target: RECEPTION, p_revision: 3, p_action: 'assign' });
    h.rpcErrors.whatsapp_conversation_action = { code: '40001' };
    const stale = await h.api({ action: 'act', conversationId: CONV, operation: 'close', revision: 3 });
    expect([stale.status, (await stale.json()).code]).toEqual([409, 'stale']);
  });

  it('serves media as a download with a safe content type', async () => {
    const h = await connectedHarness();
    h.deps.authorize = async () => ({ userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true });
    const res = await h.api({ action: 'media', messageId: MSG });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('api handler: BSUID recipients', () => {
  it('sends to the business-scoped id when Meta did not share the phone', async () => {
    const h = await connectedHarness({ conv: { wa_id: null, user_id: 'BR.13491208655302741918' } });
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: null, recipient: 'BR.13491208655302741918' };
    expect((await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' })).status).toBe(200);
    const sent = vi.mocked(h.graph.send).mock.calls[0][2];
    expect(sent).toMatchObject({ recipient: 'BR.13491208655302741918', type: 'text' });
    expect(sent).not.toHaveProperty('to');
  });
});

describe('agenda automations', () => {
  const candidate: Candidate = {
    automation_id: RULE, clinic_id: CLINIC, appointment_id: APPT, appointment_start: '2026-12-10T18:00:00Z', appointment_end: '2026-12-10T18:30:00Z',
    doctor_id: ADMIN, patient_name: 'MARIA exemplo da silva', phone: '5541999990000', doctor_name: 'Dra. Ana Exemplo', clinic_name: 'Clínica Exemplo', opted_out: false, consented: true,
  };
  const cron = (h: ReturnType<typeof harness>, secret = CRON) =>
    automationsHandler(new Request('https://x/functions/v1/whatsapp-automations', { method: 'POST', headers: { 'x-cortex-cron': secret } }), h.deps);

  it('renders template fields in São Paulo time with safe fallbacks', () => {
    const params = renderParams({ params: [{ source: 'paciente_primeiro_nome' }, { source: 'data' }, { source: 'hora' }, { source: 'dia_semana' }, { source: 'medico' }, { source: 'texto', text: 'Rua Exemplo, 100' }], link_url: null }, candidate);
    expect(params).toEqual(['Maria', '10/12', '15:00', 'quinta-feira', 'Dra. Ana Exemplo', 'Rua Exemplo, 100']);
    expect(renderParams({ params: [{ source: 'paciente_primeiro_nome' }, { source: 'medico' }], link_url: null }, { ...candidate, patient_name: '', doctor_name: '' })).toEqual(['paciente', 'nossa equipe']);
    expect(renderBody('Olá {{1}}, sua consulta é {{2}}.', ['Maria', '10/12'])).toBe('Olá Maria, sua consulta é 10/12.');
    expect(inQuietHours(new Date('2026-11-06T10:59:00Z'))).toBe(true); // 07:59 in São Paulo
    expect(inQuietHours(new Date('2026-11-06T11:00:00Z'))).toBe(false);
    expect(inQuietHours(new Date('2026-11-06T23:00:00Z'))).toBe(true); // 20:00
  });

  it('refuses callers without the scheduler secret and stays silent at night', async () => {
    const h = await connectedHarness();
    expect((await cron(h, 'wrong')).status).toBe(401);
    expect((await cron(harness({ config: { cronSecret: '' } }), '')).status).toBe(401);
    h.deps.now = () => new Date('2026-11-06T02:00:00Z');
    expect(await (await cron(h)).json()).toMatchObject({ quiet: true, sent: 0 });
    expect(h.calls.some(([n]) => n === 'whatsapp_automation_candidates')).toBe(false);
  });

  it('claims, sends and records a due reminder; skips people who opted out', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-12-08T15:00:00Z');
    let begins = 0;
    vi.mocked(h.deps.rpc).mockImplementation(async (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      if (name === 'whatsapp_automation_candidates') return [candidate, { ...candidate, appointment_id: REQ, opted_out: true }];
      if (name === 'whatsapp_automation_begin') {
        if (args.p_skip_reason) return { runId: 'r2', skipped: true };
        begins++;
        return { runId: 'r1', messageId: MSG, to: '5541999990000', skipped: false };
      }
      return null;
    });
    const res = await (await cron(h)).json();
    expect(res).toMatchObject({ candidates: 2, sent: 1, skipped: 1, failed: 0 });
    const begin = h.calls.find(([n, a]) => n === 'whatsapp_automation_begin' && !a.p_skip_reason)![1];
    expect(begin).toMatchObject({ p_wa_id: '5541999990000', p_body: 'Olá Maria, 10/12', p_template: { name: 'lembrete_consulta', language: 'pt_BR', params: ['Maria', '10/12'] } });
    expect(h.calls.find(([n, a]) => n === 'whatsapp_automation_begin' && a.p_skip_reason)![1]).toMatchObject({ p_wa_id: null, p_skip_reason: expect.stringContaining('não receber') });
    expect(h.graph.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.graph.send).mock.calls[0][2]).toMatchObject({ to: '5541999990000', type: 'template', template: { components: [{ parameters: [{ text: 'Maria' }, { text: '10/12' }] }] } });
    expect(h.calls).toContainEqual(['whatsapp_finish_outbound', { p_message: MSG, p_wamid: 'wamid.OUT2', p_error: null, p_unknown: false }]);
    expect(begins).toBe(1);
  });

  it('puts the appointment pre-consultation link in the message, and skips when the form is off', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-12-08T15:00:00Z');
    const rule = { ...(await h.deps.store.automationsByIds([RULE]))[0], params: [{ source: 'paciente_primeiro_nome' as const }, { source: 'link_pre_consulta' as const }] };
    h.deps.store.automationsByIds = async () => [rule];
    h.deps.intakeLink = vi.fn(async () => 'https://app.example.com.br/pre-consulta/' + 'A'.repeat(43));
    h.rpcResults.whatsapp_automation_candidates = [candidate];
    h.rpcResults.whatsapp_automation_begin = { runId: 'r1', messageId: MSG, to: '5541999990000', skipped: false };
    expect(await (await cron(h)).json()).toMatchObject({ sent: 1 });
    expect(h.deps.intakeLink).toHaveBeenCalledWith(candidate.clinic_id, candidate.appointment_id);
    expect(h.calls.find(([n]) => n === 'whatsapp_automation_begin')![1]).toMatchObject({
      p_template: { params: ['Maria', 'https://app.example.com.br/pre-consulta/' + 'A'.repeat(43)] } });

    const off = await connectedHarness();
    off.deps.now = () => new Date('2026-12-08T15:00:00Z');
    off.deps.store.automationsByIds = async () => [rule];
    off.deps.intakeLink = vi.fn(async () => { throw Object.assign(new Error('off'), { code: '55000' }); });
    off.rpcResults.whatsapp_automation_candidates = [candidate];
    off.rpcResults.whatsapp_automation_begin = { runId: 'r2', skipped: true };
    expect(await (await cron(off)).json()).toMatchObject({ sent: 0, skipped: 1 });
    expect(off.calls.find(([n]) => n === 'whatsapp_automation_begin')![1]).toMatchObject({ p_wa_id: null, p_skip_reason: 'A pré-consulta não está ativa nesta clínica.' });
    expect(off.graph.send).not.toHaveBeenCalled();
  });

  it('does not send when another run already claimed the appointment', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-12-08T15:00:00Z');
    h.rpcResults.whatsapp_automation_candidates = [candidate];
    h.rpcResults.whatsapp_automation_begin = null;
    expect(await (await cron(h)).json()).toMatchObject({ sent: 0, failed: 0 });
    expect(h.graph.send).not.toHaveBeenCalled();
  });

  it('validates rules against the synced template before saving', async () => {
    const h = await connectedHarness();
    const base = { name: 'Lembrete 48 h', enabled: true, trigger: 'before_start', offsetMinutes: 2880, templateName: 'lembrete_consulta', templateLanguage: 'pt_BR' };
    const few = await h.api({ action: 'saveAutomation', rule: { ...base, params: [{ source: 'data' }] } });
    expect([few.status, (await few.json()).code]).toEqual([400, 'template']);
    const noLink = await h.api({ action: 'saveAutomation', rule: { ...base, params: [{ source: 'paciente_primeiro_nome' }, { source: 'link' }] } });
    expect(noLink.status).toBe(400);
    const badLink = await h.api({ action: 'saveAutomation', rule: { ...base, linkUrl: 'http://x', params: [{ source: 'paciente_primeiro_nome' }, { source: 'link' }] } });
    expect(badLink.status).toBe(400);
    h.rpcResults.whatsapp_automation_save = { id: RULE, revision: 1 };
    const ok = await h.api({ action: 'saveAutomation', rule: { ...base, linkUrl: 'https://forms.example/pre', params: [{ source: 'paciente_primeiro_nome' }, { source: 'link' }] } });
    expect(await ok.json()).toEqual({ id: RULE, revision: 1 });
    expect(h.calls.at(-1)?.[1]).toMatchObject({ p_actor: ADMIN, p_id: null, p_rule: { linkUrl: 'https://forms.example/pre', params: [{ source: 'paciente_primeiro_nome' }, { source: 'link' }] } });
    h.deps.authorize = async () => ({ userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true });
    expect((await h.api({ action: 'saveAutomation', rule: base })).status).toBe(403);
    expect((await h.api({ action: 'automations' })).status).toBe(403);
  });
});

describe('K6 corrections', () => {
  it('sends to the address fixed by the reservation, not the one read before it', async () => {
    const h = await connectedHarness();
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: '5541988887777' };
    await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' });
    expect(vi.mocked(h.graph.send).mock.calls[0][2]).toMatchObject({ to: '5541988887777' });
  });

  it('keeps a send without answer as unknown (202) and never as failed', async () => {
    const h = await connectedHarness();
    h.rpcResults.whatsapp_begin_outbound = { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: '5541999990000' };
    vi.mocked(h.graph.send).mockRejectedValueOnce(new GraphError('O WhatsApp não respondeu.', 0, null));
    const res = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'unknown' });
    expect(h.calls).toContainEqual(['whatsapp_finish_outbound', { p_message: MSG, p_wamid: null, p_error: 'O WhatsApp não respondeu.', p_unknown: true }]);
    vi.mocked(h.graph.send).mockRejectedValueOnce(new GraphError('O WhatsApp está indisponível no momento. Tente de novo.', 503, null));
    expect((await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' })).status).toBe(202);
  });

  it('retries recording an accepted message and reports it when recording still fails', async () => {
    const h = await connectedHarness();
    let finishes = 0;
    vi.mocked(h.deps.rpc).mockImplementation(async (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      if (name === 'whatsapp_begin_outbound') return { messageId: MSG, state: 'new', status: 'pending', wamid: null, to: '5541999990000' };
      if (name === 'whatsapp_finish_outbound') { finishes++; throw Object.assign(new Error('db'), { code: '08006' }); }
      return null;
    });
    const res = await h.api({ action: 'send', conversationId: CONV, requestId: REQ, text: 'Oi' });
    expect(await res.json()).toMatchObject({ status: 'unrecorded' });
    expect(finishes).toBe(3);
  });

  it('refuses empty or invalid audience filters instead of widening them', async () => {
    const h = await connectedHarness();
    const base = { name: 'Lembrete', enabled: true, trigger: 'before_start', offsetMinutes: 2880, templateName: 'lembrete_consulta', templateLanguage: 'pt_BR',
      params: [{ source: 'paciente_primeiro_nome' }, { source: 'data' }] };
    expect((await h.api({ action: 'saveAutomation', rule: { ...base, doctorIds: [] } })).status).toBe(400);
    expect((await h.api({ action: 'saveAutomation', rule: { ...base, appointmentTypes: ['retorno', 'X;drop'] } })).status).toBe(400);
    expect((await h.api({ action: 'saveAutomation', rule: { ...base, appointmentTypes: [] } })).status).toBe(400);
  });

  it('skips people without recorded consent', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-12-08T15:00:00Z');
    h.rpcResults.whatsapp_automation_candidates = [{
      automation_id: RULE, clinic_id: CLINIC, appointment_id: APPT, appointment_start: '2026-12-10T18:00:00Z', appointment_end: '2026-12-10T18:30:00Z',
      doctor_id: ADMIN, patient_name: 'Maria', phone: '5541999990000', doctor_name: '', clinic_name: '', opted_out: false, consented: false,
    }];
    h.rpcResults.whatsapp_automation_begin = { runId: 'r', skipped: true };
    const res = await automationsHandler(new Request('https://x', { method: 'POST', headers: { 'x-cortex-cron': CRON } }), h.deps);
    expect(await res.json()).toMatchObject({ skipped: 1, sent: 0 });
    expect(h.calls.find(([n]) => n === 'whatsapp_automation_begin')?.[1]).toMatchObject({ p_wa_id: null, p_skip_reason: expect.stringContaining('consentimento') });
    expect(h.graph.send).not.toHaveBeenCalled();
  });

  it('caps the webhook body while reading and survives out-of-range timestamps', async () => {
    const h = harness();
    const big = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(512 * 1024)); },
    });
    const res = await webhookHandler(new Request('https://x/w', { method: 'POST', body: big, duplex: 'half' } as RequestInit), h.deps);
    expect(res.status).toBe(413);
    const odd = structuredClone(textDelivery);
    (odd.entry[0].changes[0].value.messages[0] as Record<string, unknown>).timestamp = '1e30';
    expect(parseWebhook(odd).messages[0].providerAt).toBeNull();
  });

  it('pages with a timestamp and id cursor', async () => {
    const h = harness();
    const seen: unknown[] = [];
    h.deps.store.conversations = async (q) => { seen.push(q.before); return []; };
    await h.api({ action: 'conversations', before: '2026-11-06T12:00:00.000Z|55555555-5555-4555-8555-555555555555' });
    await h.api({ action: 'conversations', before: 'not-a-cursor' });
    expect(seen).toEqual([{ at: '2026-11-06T12:00:00.000Z', id: '55555555-5555-4555-8555-555555555555' }, null]);
  });
});

describe('K6 residuals (2058)', () => {
  it('keeps cursor timestamps byte for byte, microseconds included', async () => {
    const h = harness();
    const seen: unknown[] = [];
    h.deps.store.conversations = async (q) => { seen.push(q.before); return []; };
    await h.api({ action: 'conversations', before: '2026-11-06T12:00:00.123456+00:00|55555555-5555-4555-8555-555555555555' });
    await h.api({ action: 'conversations', before: '2026-11-06|55555555-5555-4555-8555-555555555555' });
    expect(seen).toEqual([{ at: '2026-11-06T12:00:00.123456+00:00', id: '55555555-5555-4555-8555-555555555555' }, null]);
  });

  it('keeps valid messages when a sibling is malformed', () => {
    const payload = structuredClone(textDelivery) as unknown as { entry: Array<{ changes: Array<{ value: { messages: unknown[] } }> }> };
    payload.entry[0].changes[0].value.messages.unshift({
      from: '5541999990000', id: 'wamid.BADLOC1', timestamp: '1793980800', type: 'location', location: { latitude: { toString: 0 }, longitude: 1 },
    });
    const { messages } = parseWebhook(payload);
    expect(messages.map((m) => m.wamid)).toEqual(['wamid.BADLOC1', 'wamid.SYNTHETIC1']);
    expect(messages[0].body).toBe(',1');
  });

  it('sends the rule revision so an edited rule is never claimed with the old settings', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-12-08T15:00:00Z');
    h.rpcResults.whatsapp_automation_candidates = [{
      automation_id: RULE, clinic_id: CLINIC, appointment_id: APPT, appointment_start: '2026-12-10T18:00:00Z', appointment_end: '2026-12-10T18:30:00Z',
      doctor_id: ADMIN, patient_name: 'Maria', phone: '5541999990000', doctor_name: '', clinic_name: '', opted_out: false, consented: true,
    }];
    h.rpcResults.whatsapp_automation_begin = null;
    await automationsHandler(new Request('https://x', { method: 'POST', headers: { 'x-cortex-cron': CRON } }), h.deps);
    expect(h.calls.find(([n]) => n === 'whatsapp_automation_begin')?.[1]).toMatchObject({ p_automation: RULE, p_rule_revision: 1 });
  });
});

describe('menu bot in the webhook', () => {
  const inbound = (body: string, replyId: string | null = null) => ({
    phoneNumberId: '200000000001', waId: '5541999990000', userId: null, profileName: 'Paciente', wamid: 'wamid.BOT0001',
    kind: replyId ? 'interactive' as const : 'text' as const, body, media: null, providerAt: null, contextWamid: null, replyId,
  });
  const applied = (ids = ['m1']) => ({ applied: true, revision: 1, messageIds: ids, to: '5541999990000', recipient: null });

  it('answers the first message with the menu and records the outcome', async () => {
    const h = await connectedHarness({ flow: {} });
    h.rpcResults.whatsapp_bot_apply = applied();
    await runBot(h.deps, inbound('Oi'), CONV);
    const apply = h.calls.find(([n]) => n === 'whatsapp_bot_apply')![1];
    expect(apply).toMatchObject({ p_conversation: CONV, p_trigger_wamid: 'wamid.BOT0001', p_new_cycle: true, p_session_revision: 0, p_flow_revision: 3,
      p_status: 'active', p_node: 'inicio', p_messages: [{ kind: 'interactive', body: 'Como podemos ajudar?\n\n1. Agendar\n2. Endereço' }] });
    expect(vi.mocked(h.graph.send).mock.calls[0][2]).toMatchObject({ to: '5541999990000', type: 'interactive', interactive: { type: 'button' } });
    expect(h.calls).toContainEqual(['whatsapp_finish_outbound', { p_message: 'm1', p_wamid: 'wamid.OUT2', p_error: null, p_unknown: false }]);
  });

  it('follows the tapped option and hands off to the queue', async () => {
    const session: BotSessionRow = { conversation_id: CONV, flow_revision: 3, node: 'inicio', attempts: 0, path: [], status: 'active', outcome: null, revision: 4,
      started_at: '2026-11-06T12:05:00Z', updated_at: '2026-11-06T12:05:00Z' };
    const h = await connectedHarness({ flow: {}, botSession: session, conv: { opened_at: '2026-11-06T12:00:00Z' } });
    h.deps.now = () => new Date('2026-11-06T12:06:00Z');
    h.rpcResults.whatsapp_bot_apply = applied();
    await runBot(h.deps, inbound('Agendar', 'o:inicio:0'), CONV);
    expect(h.calls.find(([n]) => n === 'whatsapp_bot_apply')![1]).toMatchObject({ p_new_cycle: false, p_session_revision: 4, p_status: 'handed_off',
      p_queue: 'agendamento', p_path: ['Agendar'] });
  });

  it('stays quiet when the flow is off, a person has the conversation, or the cycle already handed off', async () => {
    const off = await connectedHarness({ flow: { enabled: false } });
    await runBot(off.deps, inbound('Oi'), CONV);
    expect(off.calls.some(([n]) => n === 'whatsapp_bot_apply')).toBe(false);

    const active: BotSessionRow = { conversation_id: CONV, flow_revision: 3, node: 'inicio', attempts: 0, path: [], status: 'active', outcome: null, revision: 2,
      started_at: '2026-11-06T12:05:00Z', updated_at: '2026-11-06T12:05:00Z' };
    const taken = await connectedHarness({ flow: {}, botSession: active, conv: { assigned_to: RECEPTION, assigned_at: '2026-11-06T12:06:00Z' } });
    await runBot(taken.deps, inbound('1'), CONV);
    expect(taken.calls.find(([n]) => n === 'whatsapp_bot_apply')![1]).toMatchObject({ p_status: 'human', p_session_revision: 2 });
    expect(taken.graph.send).not.toHaveBeenCalled();

    const handed = await connectedHarness({ flow: {}, botSession: { ...active, status: 'handed_off' }, conv: { opened_at: '2026-11-06T12:00:00Z' } });
    handed.deps.now = () => new Date('2026-11-06T12:10:00Z');
    await runBot(handed.deps, inbound('Mais uma coisa'), CONV);
    expect(handed.calls.some(([n]) => n === 'whatsapp_bot_apply')).toBe(false);

    const quiet = await connectedHarness({ flow: {} });
    await runBot(quiet.deps, inbound('SAIR'), CONV);
    expect(quiet.calls.some(([n]) => n === 'whatsapp_bot_apply')).toBe(false);
  });

  it('sends nothing when the step was not applied, and stops the bot when sending fails', async () => {
    const h = await connectedHarness({ flow: {} });
    h.rpcResults.whatsapp_bot_apply = { applied: false, reason: 'taken' };
    await runBot(h.deps, inbound('Oi'), CONV);
    expect(h.graph.send).not.toHaveBeenCalled();

    const failing = await connectedHarness({ flow: {} });
    failing.rpcResults.whatsapp_bot_apply = applied();
    vi.mocked(failing.graph.send).mockRejectedValueOnce(new GraphError('O WhatsApp recusou o pedido.', 400, 100));
    await runBot(failing.deps, inbound('Oi'), CONV);
    expect(failing.calls.filter(([n]) => n === 'whatsapp_bot_apply').map(([, a]) => a.p_status)).toEqual(['active', 'error']);
  });

  it('does not answer a late message whose 24-hour window already closed', async () => {
    const h = await connectedHarness({ flow: {}, conv: { last_inbound_at: '2026-11-05T11:00:00Z' } });
    h.rpcResults.whatsapp_bot_apply = applied();
    await runBot(h.deps, inbound('Oi'), CONV);
    expect(h.calls.some(([n]) => n === 'whatsapp_bot_apply')).toBe(false);
    expect(h.graph.send).not.toHaveBeenCalled();
  });

  it('runs only for messages stored now, never for redeliveries', async () => {
    const h = await connectedHarness({ flow: {} });
    h.rpcResults.whatsapp_record_event = { new: true, processed: false };
    h.rpcResults.whatsapp_ingest_inbound = { conversationId: CONV, duplicate: true };
    const body = JSON.stringify(textDelivery);
    await webhookHandler(new Request('https://x/w', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }), h.deps);
    expect(h.calls.some(([n]) => n === 'whatsapp_bot_apply')).toBe(false);
    h.rpcResults.whatsapp_ingest_inbound = { conversationId: CONV, duplicate: false };
    h.rpcResults.whatsapp_bot_apply = applied();
    await webhookHandler(new Request('https://x/w', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }), h.deps);
    expect(h.calls.some(([n]) => n === 'whatsapp_bot_apply')).toBe(true);
  });

  it('lets only the admin read and save the flow, and validates it on save', async () => {
    const h = await connectedHarness();
    const starter = await (await h.api({ action: 'flow', clinicName: 'Clínica Exemplo', doctors: ['Dra. Ana Exemplo'] })).json();
    expect(starter).toMatchObject({ starter: true, revision: 0, enabled: false, definition: { start: 'inicio' } });
    const broken = { ...starter, definition: { start: 'inicio', nodes: { inicio: { title: 'x', text: 'Oi', options: [{ label: 'A', goto: 'lugar_nenhum' }] } } } };
    const bad = await h.api({ action: 'saveFlow', revision: 0, flow: broken });
    expect([bad.status, (await bad.json()).error]).toEqual([400, expect.stringContaining('não leva a lugar válido')]);
    h.rpcResults.whatsapp_flow_save = { revision: 1 };
    expect((await h.api({ action: 'saveFlow', revision: 0, flow: starter })).status).toBe(200);
    expect(h.calls.at(-1)?.[1]).toMatchObject({ p_clinic: CLINIC, p_actor: ADMIN, p_revision: 0, p_flow: { definition: { start: 'inicio' } } });
    expect(h.calls.at(-1)?.[1].p_flow).not.toHaveProperty('starter');
    h.deps.authorize = async () => ({ userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true });
    expect((await h.api({ action: 'flow' })).status).toBe(403);
    expect((await h.api({ action: 'botSession', conversationId: CONV })).status).toBe(200);
  });
});

describe('assignees catalog', () => {
  it('lists who can receive a conversation, page by page, and flags repeated names', async () => {
    const h = await connectedHarness();
    const first = await (await h.api({ action: 'assignees', limit: 2 })).json();
    expect(first).toEqual({
      items: [
        { userId: TEAM[0].user_id, name: 'Ana Exemplo', role: 'reception', ambiguous: true },
        { userId: TEAM[1].user_id, name: 'Bruno Exemplo', role: 'admin', ambiguous: false },
      ],
      nextBefore: `a1.${TEAM[1].user_id}`,
    });
    const second = await (await h.api({ action: 'assignees', limit: 2, before: first.nextBefore })).json();
    expect(second).toEqual({ items: [{ userId: TEAM[2].user_id, name: 'ana exemplo', role: 'reception', ambiguous: true }], nextBefore: null });
  });

  it('refuses bad limits and cursors, and callers without the inbox', async () => {
    const h = await connectedHarness();
    expect((await h.api({ action: 'assignees', limit: 0 })).status).toBe(400);
    expect((await h.api({ action: 'assignees', limit: 51 })).status).toBe(400);
    expect((await h.api({ action: 'assignees', before: TEAM[0].user_id })).status).toBe(400);
    h.deps.authorize = async () => ({ userId: ADMIN, clinicId: CLINIC, admin: false, reception: false });
    expect((await h.api({ action: 'assignees' })).status).toBe(403);
  });
});

describe('assignees ambiguity over the whole directory (Codex 1011)', () => {
  const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const store = (rows: AssigneeRow[]) => async (_c: string, after: string | null, limit: number) =>
    rows.filter((r) => !after || r.user_id > after).sort((a, b) => (a.user_id < b.user_id ? -1 : 1)).slice(0, limit);

  it('flags a repeated name between the first and the 501st person, on different pages', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ user_id: uid(i + 1), name: i === 0 || i === 500 ? 'Ana Exemplo' : `Pessoa ${i + 1}`, role: 'reception' as const }));
    const h = await connectedHarness();
    h.deps.store.assignees = store(rows);
    const first = await (await h.api({ action: 'assignees', limit: 1 })).json();
    expect(first.items[0]).toMatchObject({ userId: uid(1), ambiguous: true });
    let page = first;
    let last = null;
    while (page.nextBefore) { last = page; page = await (await h.api({ action: 'assignees', limit: 50, before: page.nextBefore })).json(); }
    expect(page.items.at(-1)).toMatchObject({ userId: uid(501), ambiguous: true });
    expect(last).not.toBeNull();
  });

  it('compares the name as shown (cut at 256 characters)', async () => {
    const prefix = 'N'.repeat(256);
    const h = await connectedHarness();
    h.deps.store.assignees = store([{ user_id: uid(1), name: `${prefix}A`, role: 'admin' }, { user_id: uid(2), name: `${prefix}B`, role: 'admin' }]);
    const r = await (await h.api({ action: 'assignees' })).json();
    expect(r.items.map((i: { name: string; ambiguous: boolean }) => [i.name.length, i.ambiguous])).toEqual([[256, true], [256, true]]);
  });

  it('reports the directory unavailable instead of guessing when it is too large', async () => {
    const h = await connectedHarness();
    h.deps.store.assignees = store(Array.from({ length: 5001 }, (_, i) => ({ user_id: uid(i + 1), name: `P${i}`, role: 'reception' as const })));
    const r = await h.api({ action: 'assignees' });
    expect([r.status, (await r.json()).code]).toEqual([503, 'directory_unavailable']);
  });
});

describe('reception dashboard (K2/1)', () => {
  const snapshot = { cohort: { incomingCycles: 5, withHumanSend: 3, withoutHumanSend: 2, medianFirstHumanSendSeconds: 420, closedWithoutHumanSend: 1 },
    openNow: { total: 7, unassigned: 2, assignedToIneligible: 1, owners: [{ userId: TEAM[0].user_id, openCount: 3 }, { userId: '30000000-0000-4000-8000-000000000009', openCount: 1 }] } };

  it('returns the aggregate with owners named like the catalog, and moves a vanished owner to ineligible', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-11-07T15:00:00Z');
    h.rpcResults.whatsapp_dashboard = snapshot;
    const r = await (await h.api({ action: 'dashboard', from: '2026-11-01T03:00:00Z', to: '2026-11-07T15:00:00Z' })).json();
    expect(h.calls.find(([n]) => n === 'whatsapp_dashboard')![1]).toEqual({ p_clinic: CLINIC, p_from: '2026-11-01T03:00:00.000Z', p_to: '2026-11-07T15:00:00.000Z' });
    expect(r).toMatchObject({ schemaVersion: 1, asOf: '2026-11-07T15:00:00.000Z', coverage: 'latest_cycle_only',
      window: { timeZone: 'America/Sao_Paulo' }, cohort: snapshot.cohort,
      openNow: { total: 7, unassigned: 2, assignedToIneligible: 2,
        owners: { items: [{ userId: TEAM[0].user_id, name: 'Ana Exemplo', role: 'reception', ambiguous: true, openCount: 3 }], nextBefore: null } },
      unavailable: { abandonment: 'no_explicit_event', appointments: 'scoped_source_required' } });
  });

  it('refuses authority fields, future ends, long windows and callers without the inbox', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-11-07T15:00:00Z');
    h.rpcResults.whatsapp_dashboard = snapshot;
    const ok = { action: 'dashboard', from: '2026-11-01T03:00:00Z', to: '2026-11-07T15:00:00Z' };
    expect((await h.api({ ...ok, clinicId: CLINIC })).status).toBe(400);
    expect((await h.api({ ...ok, to: '2026-11-07T15:00:01Z' })).status).toBe(400);
    expect((await h.api({ ...ok, from: '2026-10-07T14:59:59Z' })).status).toBe(400);
    expect((await h.api({ ...ok, from: '2026-11-01' })).status).toBe(400);
    expect((await h.api({ ...ok, limit: 51 })).status).toBe(400);
    h.deps.authorize = async () => ({ userId: ADMIN, clinicId: CLINIC, admin: false, reception: false });
    expect((await h.api(ok)).status).toBe(403);
  });

  it('keeps a missing median as null', async () => {
    const h = await connectedHarness();
    h.deps.now = () => new Date('2026-11-07T15:00:00Z');
    h.rpcResults.whatsapp_dashboard = { ...snapshot, cohort: { ...snapshot.cohort, withHumanSend: 0, withoutHumanSend: 5, medianFirstHumanSendSeconds: null } };
    const r = await (await h.api({ action: 'dashboard', from: '2026-11-01T03:00:00Z', to: '2026-11-07T15:00:00Z' })).json();
    expect(r.cohort.medianFirstHumanSendSeconds).toBeNull();
  });
});
