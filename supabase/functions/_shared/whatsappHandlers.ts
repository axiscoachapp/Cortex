// Edge handlers of the WhatsApp channel (C4): the public webhook and the authenticated API used by
// Settings (connection) and by the reception inbox. Dependencies are injected so the Vitest suite can
// run them with fakes. Contract: docs/product/whatsapp/CONTRATO.md.
//
// The caller's clinic and role come only from the injected authorize() (JWT + session assurance +
// clinic_access()), never from the body. Logs carry ids and codes only.

import { openSecret, sealSecret } from './psc.ts';
import { secretEquals } from './secrets.ts';
import { GraphError, parseWebhook, sha256Hex, validSignature, windowOpenUntil, type GraphClient, type InboundMessage } from './whatsapp.ts';
import {
  decideStep, isOpenNow, isQuietWord, SESSION_IDLE_MS, starterFlow, validateFlow,
  type BusinessHours, type FlowDefinition, type FlowNode, type FlowSettings, type SessionState,
} from './whatsappFlow.ts';

type KeyList = { current: string; keys: Record<string, Uint8Array> };
type Sealed = { v: 1; keyId: string; nonce: string; ciphertext: string };

export interface Caller { userId: string; clinicId: string; admin: boolean; reception: boolean }

export interface ChannelRow {
  id: string; clinic_id: string; phone_number_id: string; waba_id: string; display_phone: string; verified_name: string;
  quality_rating: string | null; status: 'connected' | 'disconnected' | 'error'; token_sealed: Sealed | null;
  last_error: string | null; connected_at: string;
}
export interface ConversationRow {
  id: string; clinic_id: string; wa_id: string | null; user_id: string | null; profile_name: string; contact_id: string | null; case_id: string | null;
  queue: string; status: 'open' | 'closed'; assigned_to: string | null; assigned_at: string | null; opened_at: string;
  first_response_at: string | null; closed_at: string | null; last_inbound_at: string | null; last_message_at: string;
  last_message_preview: string; unread_count: number; opted_out_at: string | null; revision: number;
  /** Current WhatsApp opt-in for this phone (filled by the store). */
  consented?: boolean;
}
export interface MessageRow {
  id: string; clinic_id: string; conversation_id: string; direction: 'in' | 'out'; wamid: string | null; kind: string; body: string;
  media: { id: string; mime: string; filename?: string; voice?: boolean } | null; template: { name: string; language: string } | null;
  status: string; error: string | null; sent_by: string | null; provider_at: string | null; created_at: string;
}
export interface TemplateRow { name: string; language: string; category: string; status: string; body: string; param_count: number }
export type InboxFilter = 'unassigned' | 'mine' | 'open' | 'closed';
/** Keyset cursor: timestamp plus id, so rows sharing a timestamp are never skipped. */
export interface Cursor { at: string; id: string }
const encodeCursor = (at: string, id: string) => `${at}|${id}`;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
function decodeCursor(v: unknown): Cursor | null {
  if (typeof v !== 'string' || v.length > 80) return null;
  const [at, id, extra] = v.split('|');
  // The timestamp text is kept as the database wrote it: converting through Date would drop microseconds.
  if (extra !== undefined || !at || !id || !TIMESTAMP.test(at) || Number.isNaN(Date.parse(at)) || !UUID.test(id)) return null;
  return { at, id: id.toLowerCase() };
}
export type ParamSource = 'paciente_primeiro_nome' | 'data' | 'hora' | 'dia_semana' | 'medico' | 'clinica' | 'link' | 'link_pre_consulta' | 'texto';
export interface AutomationRow {
  id: string; clinic_id: string; name: string; enabled: boolean; trigger: 'before_start' | 'after_end'; offset_minutes: number;
  template_name: string; template_language: string; params: Array<{ source: ParamSource; text?: string }>; link_url: string | null;
  doctor_ids: string[] | null; appointment_types: string[] | null; revision: number; updated_at: string;
}
export interface AutomationRunRow {
  id: string; automation_id: string; appointment_id: string; appointment_start: string; status: string; reason: string | null;
  reply: string | null; replied_at: string | null; created_at: string;
}
export interface FlowRow {
  clinic_id: string; enabled: boolean; definition: FlowDefinition; hours: BusinessHours; after_hours_text: string; handoff_text: string;
  default_queue: string; revision: number; updated_at: string;
}
export interface BotSessionRow {
  conversation_id: string; flow_revision: number; node: string; attempts: number; path: string[];
  status: 'active' | 'handed_off' | 'closed' | 'human' | 'error'; outcome: string | null; revision: number; started_at: string; updated_at: string;
}
export interface Candidate {
  automation_id: string; clinic_id: string; appointment_id: string; appointment_start: string; appointment_end: string;
  doctor_id: string; patient_name: string; phone: string | null; doctor_name: string; clinic_name: string; opted_out: boolean;
  consented: boolean;
}

export interface WhatsAppStore {
  channelForClinic(clinicId: string): Promise<ChannelRow | null>;
  channelByPhoneNumberId(phoneNumberId: string): Promise<ChannelRow | null>;
  saveChannel(row: Omit<ChannelRow, 'connected_at'> & { connected_by: string }): Promise<void>;
  disconnect(clinicId: string): Promise<void>;
  replaceTemplates(channelId: string, rows: TemplateRow[]): Promise<void>;
  templates(channelId: string): Promise<TemplateRow[]>;
  conversations(q: { clinicId: string; filter: InboxFilter; actor: string; search: string; before: Cursor | null; limit: number }): Promise<ConversationRow[]>;
  conversation(clinicId: string, id: string): Promise<ConversationRow | null>;
  messages(q: { clinicId: string; conversationId: string; before: Cursor | null; limit: number }): Promise<MessageRow[]>;
  message(clinicId: string, id: string): Promise<MessageRow | null>;
  lastInboundWamid(clinicId: string, conversationId: string): Promise<string | null>;
  automations(clinicId: string): Promise<AutomationRow[]>;
  automationsByIds(ids: string[]): Promise<AutomationRow[]>;
  deleteAutomation(clinicId: string, id: string): Promise<boolean>;
  automationRuns(clinicId: string, limit: number): Promise<AutomationRunRow[]>;
  /** Conversation by id regardless of the caller (webhook/bot only). */
  conversationById(id: string): Promise<ConversationRow | null>;
  flowForClinic(clinicId: string): Promise<FlowRow | null>;
  botSession(conversationId: string): Promise<BotSessionRow | null>;
  /** People who can receive a conversation (same rule as act/assign), ordered by user id, after `afterUserId`. */
  assignees(clinicId: string, afterUserId: string | null, limit: number): Promise<AssigneeRow[]>;
}

export interface AssigneeRow { user_id: string; name: string; role: 'reception' | 'admin' }

export interface WhatsAppConfig {
  appSecret: string;
  verifyToken: string;
  keys: KeyList | null;
  webhookUrl: string;
  /** Shared secret of the scheduler that calls whatsapp-automations (WHATSAPP_CRON_SECRET). */
  cronSecret?: string;
}

export interface WhatsAppDeps {
  corsHeaders: Record<string, string>;
  config: WhatsAppConfig;
  authorize(req: Request): Promise<Caller>;
  authFailure(error: unknown): Response | null;
  /** Service-role RPC; throws an object with the SQLSTATE in `code`. */
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  store: WhatsAppStore;
  graph: GraphClient;
  newId?: () => string;
  now?: () => Date;
  log?: (event: string, detail: Record<string, unknown>) => void;
  /** Pre-consultation link of a clinic appointment (created on first use), or null when the form is off. */
  intakeLink?: (clinicId: string, appointmentId: string) => Promise<string | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^[0-9]{5,30}$/;
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export const tokenBinding = (channelId: string, clinicId: string) => `cortex/whatsapp-token/v1|${channelId.toLowerCase()}|${clinicId.toLowerCase()}`;

/** Reads at most `max` bytes of the body, cancelling the stream beyond that (null = too large). */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

const json = (deps: WhatsAppDeps, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...deps.corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function rpcError(e: unknown): HttpError {
  const code = (e as { code?: string })?.code;
  const message = (e as { message?: string })?.message ?? '';
  switch (code) {
    case 'P0W01': return new HttpError(409, 'Passaram mais de 24 horas desde a última mensagem do paciente. Use um modelo aprovado.', 'window_closed');
    case 'P0W02': return new HttpError(409, 'Este contato pediu para não receber mensagens.', 'opted_out');
    case '40001': return new HttpError(409, 'A conversa mudou. Atualize e tente de novo.', 'stale');
    case '42501': return new HttpError(403, 'Sem permissão para esta conversa.', 'forbidden');
    case '22023': return new HttpError(400, message.slice(0, 200) || 'Pedido inválido.', 'invalid');
    default: return new HttpError(500, 'Não foi possível concluir. Tente de novo.', 'server');
  }
}

// ---------------------------------------------------------------- webhook

export async function webhookHandler(req: Request, deps: WhatsAppDeps): Promise<Response> {
  const text = (status: number, body = '') => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  const { appSecret, verifyToken } = deps.config;
  if (!appSecret || !verifyToken) return text(503);
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (url.searchParams.get('hub.mode') === 'subscribe' && await secretEquals(verifyToken, url.searchParams.get('hub.verify_token'), 16) && /^[0-9A-Za-z_-]{1,200}$/.test(challenge))
      return text(200, challenge);
    return text(403);
  }
  if (req.method !== 'POST') return text(405);
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_WEBHOOK_BYTES) return text(413);
  const raw = await readLimited(req, MAX_WEBHOOK_BYTES);
  if (!raw) return text(413);
  if (!(await validSignature(appSecret, raw, req.headers.get('x-hub-signature-256')))) return text(401);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return text(400); }
  const sha = await sha256Hex(raw);
  let state: { new: boolean; processed: boolean };
  try { state = (await deps.rpc('whatsapp_record_event', { p_sha: sha, p_payload: payload })) as typeof state; }
  catch { return text(500); }
  if (state.processed) return text(200);
  let parsed: ReturnType<typeof parseWebhook>;
  try { parsed = parseWebhook(payload); }
  catch {
    await deps.rpc('whatsapp_finish_event', { p_sha: sha, p_error: 'parse' }).catch(() => null);
    return text(200); // the payload cannot be read; a retry would not change that
  }
  const { messages, statuses, identityChanges } = parsed;
  let failure: string | null = null;
  for (const m of messages) {
    try {
      const ingested = await deps.rpc('whatsapp_ingest_inbound', {
        p_phone_number_id: m.phoneNumberId, p_wa_id: m.waId, p_user_id: m.userId, p_profile_name: m.profileName, p_wamid: m.wamid,
        p_kind: m.kind, p_body: m.body, p_media: m.media, p_context_wamid: m.contextWamid, p_provider_at: m.providerAt,
      }) as { conversationId?: string; duplicate?: boolean } | null;
      // The bot answers only a message stored now (a redelivery never answers twice).
      if (ingested?.conversationId && ingested.duplicate === false) await runBot(deps, m, ingested.conversationId);
    } catch (e) { failure = `ingest ${(e as { code?: string })?.code ?? 'error'}`; }
  }
  for (const c of identityChanges) {
    try {
      await deps.rpc('whatsapp_identity_change', {
        p_phone_number_id: c.phoneNumberId, p_wamid: c.wamid, p_previous_user_id: c.previousUserId, p_user_id: c.userId,
        p_wa_id: c.waId, p_kind: c.kind, p_provider_at: c.at,
      });
    } catch (e) { failure = `identity ${(e as { code?: string })?.code ?? 'error'}`; }
  }
  for (const s of statuses) {
    try {
      await deps.rpc('whatsapp_apply_status', { p_phone_number_id: s.phoneNumberId, p_wamid: s.wamid, p_status: s.status, p_at: s.at, p_error: s.error });
    } catch (e) { failure = `status ${(e as { code?: string })?.code ?? 'error'}`; }
  }
  try { await deps.rpc('whatsapp_finish_event', { p_sha: sha, p_error: failure }); } catch { return text(500); }
  deps.log?.('whatsapp_webhook', { messages: messages.length, statuses: statuses.length, failed: !!failure });
  // A failure asks Meta to deliver again; processing is idempotent per wamid.
  return text(failure ? 500 : 200);
}

// ---------------------------------------------------------------- API

const conversationDto = (c: ConversationRow) => ({
  id: c.id, waId: c.wa_id, profileName: c.profile_name, contactId: c.contact_id, caseId: c.case_id, queue: c.queue,
  status: c.status, assignedTo: c.assigned_to, assignedAt: c.assigned_at, openedAt: c.opened_at, firstResponseAt: c.first_response_at,
  closedAt: c.closed_at, lastInboundAt: c.last_inbound_at, windowOpenUntil: windowOpenUntil(c.last_inbound_at),
  lastMessageAt: c.last_message_at, lastMessagePreview: c.last_message_preview, unreadCount: c.unread_count,
  optedOut: c.opted_out_at !== null, consented: c.consented ?? false, revision: c.revision,
});
const messageDto = (m: MessageRow) => ({
  id: m.id, direction: m.direction, kind: m.kind, body: m.body,
  media: m.media ? { mime: m.media.mime, filename: m.media.filename ?? null, voice: !!m.media.voice } : null,
  template: m.template ? { name: m.template.name, language: m.template.language } : null,
  status: m.status, error: m.error, sentBy: m.sent_by, at: m.provider_at ?? m.created_at,
});

async function channelToken(deps: WhatsAppDeps, ch: ChannelRow): Promise<string> {
  if (ch.status !== 'connected' || !ch.token_sealed) throw new HttpError(409, 'O WhatsApp da clínica não está conectado.', 'not_connected');
  if (!deps.config.keys) throw new HttpError(503, 'O servidor ainda não está configurado para o WhatsApp.', 'server_not_ready');
  try { return await openSecret(deps.config.keys, ch.token_sealed, tokenBinding(ch.id, ch.clinic_id)); }
  catch { throw new HttpError(503, 'Não foi possível abrir a credencial do WhatsApp. Reconecte o número.', 'token_unreadable'); }
}

function graphFailure(e: unknown): HttpError {
  if (e instanceof GraphError) return new HttpError(e.status === 413 ? 413 : 502, e.message, `graph_${e.code ?? e.status}`);
  return new HttpError(502, 'O WhatsApp não respondeu. Tente de novo.', 'graph');
}

/** Marks a value so apiHandler answers 202 (accepted, outcome not confirmed). */
const ACCEPTED = Symbol('accepted');
const json202 = <T extends object>(body: T) => Object.assign(body, { [ACCEPTED]: true });

/**
 * Sends one reserved message and records the outcome. A refusal from Meta (4xx) is a failure; no
 * answer or a 5xx is "unknown" and is never retried automatically. If Meta accepted but recording
 * fails, recording is retried; when it still fails the id is logged for reconciliation.
 */
async function deliver(deps: WhatsAppDeps, ch: ChannelRow, token: string, messageId: string, message: Record<string, unknown>):
  Promise<{ status: 'sent'; recorded: boolean } | { status: 'failed' | 'unknown'; error: string }> {
  let wamid: string;
  try { wamid = await deps.graph.send(ch.phone_number_id, token, message); }
  catch (e) {
    const definite = e instanceof GraphError && e.definite;
    const error = e instanceof GraphError ? e.message : 'O WhatsApp não respondeu.';
    await deps.rpc('whatsapp_finish_outbound', { p_message: messageId, p_wamid: null, p_error: error, p_unknown: !definite })
      .catch(() => deps.log?.('whatsapp_finish_outbound_failed', { message: messageId, outcome: definite ? 'failed' : 'unknown' }));
    return { status: definite ? 'failed' : 'unknown', error };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await deps.rpc('whatsapp_finish_outbound', { p_message: messageId, p_wamid: wamid, p_error: null, p_unknown: false });
      return { status: 'sent', recorded: true };
    } catch { /* retried below */ }
  }
  deps.log?.('whatsapp_sent_unrecorded', { message: messageId, wamid });
  return { status: 'sent', recorded: false };
}

const requireAdmin = (c: Caller) => { if (!c.admin) throw new HttpError(403, 'Somente o administrador da clínica pode alterar a conexão.', 'forbidden'); };
const requireInbox = (c: Caller) => { if (!c.admin && !c.reception) throw new HttpError(403, 'A caixa de conversas é da recepção.', 'forbidden'); };
const uuid = (v: unknown, what: string) => { if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `${what} inválido.`, 'invalid'); return v.toLowerCase(); };

export async function apiHandler(req: Request, deps: WhatsAppDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: deps.corsHeaders });
  if (req.method !== 'POST') return json(deps, 405, { error: 'Método não permitido.' });
  try {
    const caller = await deps.authorize(req);
    let body: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (raw.length > 64 * 1024) throw new Error();
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch { throw new HttpError(400, 'Pedido inválido.', 'invalid'); }
    switch (body.action) {
      case 'state': return json(deps, 200, await state(deps, caller));
      case 'connect': return json(deps, 200, await connect(deps, caller, body));
      case 'disconnect': requireAdmin(caller); await deps.store.disconnect(caller.clinicId); deps.log?.('whatsapp_disconnected', { clinic: caller.clinicId }); return json(deps, 200, { connected: false });
      case 'syncTemplates': return json(deps, 200, await syncTemplates(deps, caller));
      case 'templates': {
        requireInbox(caller);
        const ch = await deps.store.channelForClinic(caller.clinicId);
        const rows = ch ? await deps.store.templates(ch.id) : [];
        return json(deps, 200, { templates: rows.map((t) => ({ name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, paramCount: t.param_count })) });
      }
      case 'conversations': return json(deps, 200, await conversations(deps, caller, body));
      case 'messages': return json(deps, 200, await messages(deps, caller, body));
      case 'send': {
        const result = await send(deps, caller, body);
        return json(deps, (result as Record<symbol, unknown>)[ACCEPTED] ? 202 : 200, result);
      }
      case 'act': return json(deps, 200, await act(deps, caller, body));
      case 'media': return await media(deps, caller, body);
      case 'automations': return json(deps, 200, await listAutomations(deps, caller));
      case 'flow': return json(deps, 200, await getFlow(deps, caller, body));
      case 'saveFlow': return json(deps, 200, await saveFlow(deps, caller, body));
      case 'botSession': return json(deps, 200, await botSessionView(deps, caller, body));
      case 'assignees': return json(deps, 200, await assigneesView(deps, caller, body));
      case 'dashboard': return json(deps, 200, await dashboardView(deps, caller, body));
      case 'saveAutomation': return json(deps, 200, await saveAutomation(deps, caller, body));
      case 'deleteAutomation': {
        requireAdmin(caller);
        const ok = await deps.store.deleteAutomation(caller.clinicId, uuid(body.id, 'Regra'));
        if (!ok) throw new HttpError(404, 'Regra não encontrada.', 'not_found');
        return json(deps, 200, { deleted: true });
      }
      default: throw new HttpError(400, 'Ação desconhecida.', 'invalid');
    }
  } catch (e) {
    const auth = deps.authFailure(e);
    if (auth) return auth;
    if (e instanceof HttpError) return json(deps, e.status, { error: e.message, code: e.code ?? null });
    deps.log?.('whatsapp_api_error', { kind: (e as Error)?.name ?? 'unknown' });
    return json(deps, 500, { error: 'Não foi possível concluir. Tente de novo.', code: 'server' });
  }
}

async function state(deps: WhatsAppDeps, caller: Caller) {
  const ch = await deps.store.channelForClinic(caller.clinicId);
  const serverReady = !!(deps.config.appSecret && deps.config.verifyToken && deps.config.keys);
  const base = {
    serverReady, connected: ch?.status === 'connected', status: ch?.status ?? 'none',
    displayPhone: ch?.display_phone ?? null, verifiedName: ch?.verified_name ?? null, quality: ch?.quality_rating ?? null,
    connectedAt: ch?.connected_at ?? null, canManage: caller.admin, canUseInbox: caller.admin || caller.reception,
  };
  return caller.admin ? { ...base, lastError: ch?.last_error ?? null, webhookUrl: deps.config.webhookUrl, phoneNumberId: ch?.phone_number_id ?? null, wabaId: ch?.waba_id ?? null } : base;
}

async function connect(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireAdmin(caller);
  if (!deps.config.keys || !deps.config.appSecret || !deps.config.verifyToken)
    throw new HttpError(503, 'O servidor ainda não tem os segredos do WhatsApp (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN_KEYS).', 'server_not_ready');
  const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
  const wabaId = typeof body.wabaId === 'string' ? body.wabaId.trim() : '';
  const token = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!DIGITS.test(phoneNumberId) || !DIGITS.test(wabaId)) throw new HttpError(400, 'Informe o ID do número e o ID da conta do WhatsApp Business (só números).', 'invalid');
  if (token.length < 20 || token.length > 1024 || /\s/.test(token)) throw new HttpError(400, 'Informe o token de acesso completo.', 'invalid');
  if (pin && !/^[0-9]{6}$/.test(pin)) throw new HttpError(400, 'O PIN de confirmação em duas etapas tem 6 dígitos.', 'invalid');
  const other = await deps.store.channelByPhoneNumberId(phoneNumberId);
  if (other && other.clinic_id !== caller.clinicId) throw new HttpError(409, 'Este número já está conectado a outra clínica.', 'in_use');
  let info: Awaited<ReturnType<GraphClient['phoneNumber']>>;
  try {
    info = await deps.graph.phoneNumber(phoneNumberId, token);
    const numbers = await deps.graph.wabaPhoneNumbers(wabaId, token);
    if (!numbers.includes(phoneNumberId)) throw new HttpError(400, 'O número não pertence a esta conta do WhatsApp Business.', 'mismatch');
    if (pin) await deps.graph.register(phoneNumberId, token, pin);
    await deps.graph.subscribeApp(wabaId, token);
  } catch (e) { throw e instanceof HttpError ? e : graphFailure(e); }
  const existing = await deps.store.channelForClinic(caller.clinicId);
  const id = existing?.id ?? (deps.newId ?? (() => crypto.randomUUID()))();
  const sealed = (await sealSecret(deps.config.keys, token, tokenBinding(id, caller.clinicId))) as Sealed;
  await deps.store.saveChannel({
    id, clinic_id: caller.clinicId, phone_number_id: phoneNumberId, waba_id: wabaId, display_phone: info.displayPhone,
    verified_name: info.verifiedName, quality_rating: info.quality, status: 'connected', token_sealed: sealed, last_error: null,
    connected_by: caller.userId,
  });
  deps.log?.('whatsapp_connected', { clinic: caller.clinicId, channel: id });
  let templates = 0;
  try { templates = (await syncTemplates(deps, caller)).templates; } catch { /* the connection stands; templates can be synced later */ }
  return { connected: true, displayPhone: info.displayPhone, verifiedName: info.verifiedName, quality: info.quality, templates };
}

async function syncTemplates(deps: WhatsAppDeps, caller: Caller) {
  requireAdmin(caller);
  const ch = await deps.store.channelForClinic(caller.clinicId);
  if (!ch) throw new HttpError(409, 'O WhatsApp da clínica não está conectado.', 'not_connected');
  const token = await channelToken(deps, ch);
  let list: Awaited<ReturnType<GraphClient['templates']>>;
  try { list = await deps.graph.templates(ch.waba_id, token); } catch (e) { throw graphFailure(e); }
  await deps.store.replaceTemplates(ch.id, list.map((t) => ({ name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, param_count: t.paramCount })));
  return { templates: list.length };
}

async function conversations(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  const filter = (['unassigned', 'mine', 'open', 'closed'] as const).find((f) => f === body.filter) ?? 'open';
  const search = typeof body.search === 'string' ? body.search.trim().slice(0, 80) : '';
  const before = decodeCursor(body.before);
  const limit = typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 100 ? Math.floor(body.limit) : 50;
  const rows = await deps.store.conversations({ clinicId: caller.clinicId, filter, actor: caller.userId, search, before, limit });
  const last = rows[rows.length - 1];
  return { conversations: rows.map(conversationDto), nextBefore: rows.length === limit && last ? encodeCursor(last.last_message_at, last.id) : null };
}

async function messages(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  const conversationId = uuid(body.conversationId, 'Conversa');
  const conv = await deps.store.conversation(caller.clinicId, conversationId);
  if (!conv) throw new HttpError(404, 'Conversa não encontrada.', 'not_found');
  const before = decodeCursor(body.before);
  const rows = await deps.store.messages({ clinicId: caller.clinicId, conversationId, before, limit: 50 });
  const last = rows[rows.length - 1];
  return { conversation: conversationDto(conv), messages: rows.map(messageDto), nextBefore: rows.length === 50 && last ? encodeCursor(last.created_at, last.id) : null };
}

async function send(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  const conversationId = uuid(body.conversationId, 'Conversa');
  const requestId = uuid(body.requestId, 'Pedido');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const tpl = body.template as { name?: unknown; language?: unknown; params?: unknown } | undefined;
  let kind: 'text' | 'template';
  let message: Record<string, unknown> = {};
  let template: { name: string; language: string; params: string[] } | null = null;
  if (text && !tpl) {
    if (text.length > 4096) throw new HttpError(400, 'A mensagem passa de 4.096 caracteres.', 'invalid');
    kind = 'text';
    message = { type: 'text', text: { preview_url: false, body: text } };
  } else if (tpl && !text && typeof tpl.name === 'string' && typeof tpl.language === 'string') {
    const params = Array.isArray(tpl.params) ? tpl.params : [];
    if (params.length > 20 || params.some((p) => typeof p !== 'string' || !p.trim() || p.length > 1024 || /[\n\t]| {5,}/.test(p)))
      throw new HttpError(400, 'Preencha os campos do modelo (sem quebras de linha).', 'invalid');
    kind = 'template';
    template = { name: tpl.name, language: tpl.language, params: params as string[] };
  } else throw new HttpError(400, 'Escreva a mensagem ou escolha um modelo.', 'invalid');

  const conv = await deps.store.conversation(caller.clinicId, conversationId);
  if (!conv) throw new HttpError(404, 'Conversa não encontrada.', 'not_found');
  const ch = await deps.store.channelForClinic(caller.clinicId);
  if (!ch) throw new HttpError(409, 'O WhatsApp da clínica não está conectado.', 'not_connected');
  if (template) {
    const known = (await deps.store.templates(ch.id)).find((t) => t.name === template!.name && t.language === template!.language);
    if (!known || known.status !== 'APPROVED') throw new HttpError(400, 'Modelo não aprovado. Sincronize os modelos em Configurações.', 'template');
    if (known.param_count !== template.params.length) throw new HttpError(400, `Este modelo pede ${known.param_count} campo(s).`, 'template');
    message = {
      type: 'template',
      template: {
        name: template.name, language: { code: template.language },
        ...(template.params.length ? { components: [{ type: 'body', parameters: template.params.map((p) => ({ type: 'text', text: p.trim() })) }] } : {}),
      },
    };
  }
  const token = await channelToken(deps, ch);
  type Reserved = { messageId: string; state: 'new' | 'existing'; status: string; wamid: string | null; to?: string | null; recipient?: string | null };
  const reserve = () => deps.rpc('whatsapp_begin_outbound', {
    p_clinic: caller.clinicId, p_conversation: conversationId, p_actor: caller.userId, p_request: requestId,
    p_kind: kind, p_body: kind === 'text' ? text : '', p_template: template,
  }) as Promise<Reserved>;
  let reserved: Reserved;
  try { reserved = await reserve(); }
  catch (e) {
    if ((e as { code?: string })?.code === '23505') { try { reserved = await reserve(); } catch (again) { throw rpcError(again); } }
    else throw rpcError(e);
  }
  if (reserved.state === 'existing') return { messageId: reserved.messageId, status: reserved.status, duplicate: true };
  // Send to the address fixed at reservation (Meta may know the person only by the business-scoped id).
  const address = reserved.to ? { to: reserved.to } : reserved.recipient ? { recipient: reserved.recipient } : null;
  if (!address) throw new HttpError(409, 'A conversa não tem destinatário válido.', 'invalid');
  const outcome = await deliver(deps, ch, token, reserved.messageId, { ...address, ...message });
  if (outcome.status === 'failed') throw new HttpError(502, outcome.error, 'send_failed');
  if (outcome.status === 'unknown')
    return json202({ messageId: reserved.messageId, status: 'unknown', duplicate: false,
      warning: 'O WhatsApp não confirmou o envio. Confira com o paciente antes de mandar de novo.' });
  return { messageId: reserved.messageId, status: 'recorded' in outcome && !outcome.recorded ? 'unrecorded' : 'sent', duplicate: false };
}

async function act(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  const conversationId = uuid(body.conversationId, 'Conversa');
  const action = typeof body.operation === 'string' ? body.operation : '';
  const allowed = ['assign', 'unassign', 'close', 'reopen', 'mark_read', 'link_contact', 'link_case', 'set_queue', 'record_opt_in', 'revoke_opt_in'];
  if (!allowed.includes(action)) throw new HttpError(400, 'Ação desconhecida.', 'invalid');
  const revision = typeof body.revision === 'number' && Number.isInteger(body.revision) ? body.revision : null;
  if (action !== 'mark_read' && revision === null) throw new HttpError(400, 'Revisão da conversa ausente.', 'invalid');
  let target: string | null = null;
  if (action === 'assign') target = body.targetUserId === undefined ? caller.userId : uuid(body.targetUserId, 'Pessoa');
  if (action === 'link_contact' || action === 'link_case') target = body.targetId === null ? null : uuid(body.targetId, 'Vínculo');
  let result: unknown;
  try {
    result = await deps.rpc('whatsapp_conversation_action', {
      p_clinic: caller.clinicId, p_conversation: conversationId, p_actor: caller.userId, p_revision: revision,
      p_action: action, p_target: target, p_queue: typeof body.queue === 'string' ? body.queue : null,
    });
  } catch (e) { throw rpcError(e); }
  if (action === 'mark_read') {
    // Best effort read receipt to the patient's phone; the inbox state is already saved.
    try {
      const ch = await deps.store.channelForClinic(caller.clinicId);
      const wamid = ch ? await deps.store.lastInboundWamid(caller.clinicId, conversationId) : null;
      if (ch && wamid) await deps.graph.markRead(ch.phone_number_id, await channelToken(deps, ch), wamid);
    } catch { /* ignored */ }
  }
  return result;
}

async function media(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>): Promise<Response> {
  requireInbox(caller);
  const messageId = uuid(body.messageId, 'Mensagem');
  const m = await deps.store.message(caller.clinicId, messageId);
  if (!m?.media?.id) throw new HttpError(404, 'Mídia não encontrada.', 'not_found');
  const ch = await deps.store.channelForClinic(caller.clinicId);
  if (!ch) throw new HttpError(409, 'O WhatsApp da clínica não está conectado.', 'not_connected');
  let file: { bytes: Uint8Array; mime: string };
  try { file = await deps.graph.media(m.media.id, await channelToken(deps, ch)); } catch (e) { throw e instanceof HttpError ? e : graphFailure(e); }
  const safeMime = /^[a-z]+\/[a-z0-9.+-]+$/i.test(file.mime) ? file.mime : 'application/octet-stream';
  return new Response(file.bytes as BodyInit, {
    status: 200,
    headers: { ...deps.corsHeaders, 'Content-Type': safeMime, 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff' },
  });
}

// ---------------------------------------------------------------- agenda automations

export const PARAM_SOURCES: Record<ParamSource, string> = {
  paciente_primeiro_nome: 'Primeiro nome do paciente',
  data: 'Data da consulta (dd/mm)',
  hora: 'Horário da consulta',
  dia_semana: 'Dia da semana',
  medico: 'Nome do médico',
  clinica: 'Nome da clínica',
  link: 'Link da regra',
  link_pre_consulta: 'Link da pré-consulta (único por consulta)',
  texto: 'Texto fixo',
};
const TZ = 'America/Sao_Paulo';
/** Automated messages leave only between 08:00 and 20:00 in São Paulo. */
export const QUIET_HOURS = { start: 8, end: 20 };

const automationDto = (a: AutomationRow) => ({
  id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, offsetMinutes: a.offset_minutes, templateName: a.template_name,
  templateLanguage: a.template_language, params: a.params, linkUrl: a.link_url, doctorIds: a.doctor_ids, appointmentTypes: a.appointment_types,
  revision: a.revision, updatedAt: a.updated_at,
});

async function listAutomations(deps: WhatsAppDeps, caller: Caller) {
  requireAdmin(caller);
  const [rules, runs] = await Promise.all([deps.store.automations(caller.clinicId), deps.store.automationRuns(caller.clinicId, 100)]);
  return {
    automations: rules.map(automationDto),
    runs: runs.map((r) => ({
      id: r.id, automationId: r.automation_id, appointmentId: r.appointment_id, appointmentStart: r.appointment_start, status: r.status,
      reason: r.reason, reply: r.reply, repliedAt: r.replied_at, at: r.created_at,
    })),
    sources: PARAM_SOURCES,
    quietHours: QUIET_HOURS,
  };
}

async function saveAutomation(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireAdmin(caller);
  const rule = body.rule as Record<string, unknown> | undefined;
  if (!rule || typeof rule !== 'object') throw new HttpError(400, 'Regra inválida.', 'invalid');
  const id = body.id === undefined || body.id === null ? null : uuid(body.id, 'Regra');
  const revision = id ? (typeof body.revision === 'number' && Number.isInteger(body.revision) ? body.revision : -1) : null;
  const name = typeof rule.name === 'string' ? rule.name.trim() : '';
  const trigger = rule.trigger === 'before_start' || rule.trigger === 'after_end' ? rule.trigger : null;
  const offset = typeof rule.offsetMinutes === 'number' && Number.isInteger(rule.offsetMinutes) ? rule.offsetMinutes : -1;
  const linkUrl = typeof rule.linkUrl === 'string' && rule.linkUrl.trim() ? rule.linkUrl.trim() : null;
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Dê um nome à regra (2 a 80 caracteres).', 'invalid');
  if (!trigger || offset < 0 || offset > 20160) throw new HttpError(400, 'Escolha quando enviar (até 14 dias antes ou depois).', 'invalid');
  if (linkUrl && (!/^https:\/\/[^\s]+$/.test(linkUrl) || linkUrl.length > 500)) throw new HttpError(400, 'O link precisa começar com https://.', 'invalid');
  const ch = await deps.store.channelForClinic(caller.clinicId);
  if (!ch) throw new HttpError(409, 'Conecte o WhatsApp antes de criar automações.', 'not_connected');
  const template = (await deps.store.templates(ch.id)).find((t) => t.name === rule.templateName && t.language === rule.templateLanguage);
  if (!template) throw new HttpError(400, 'Escolha um modelo sincronizado do WhatsApp.', 'template');
  if (rule.enabled === true && template.status !== 'APPROVED') throw new HttpError(400, 'O modelo ainda não foi aprovado pela Meta.', 'template');
  const params = Array.isArray(rule.params) ? rule.params : [];
  if (params.length !== template.param_count) throw new HttpError(400, `Este modelo tem ${template.param_count} campo(s); preencha todos.`, 'template');
  const clean: Array<{ source: ParamSource; text?: string }> = [];
  for (const p of params as Array<Record<string, unknown>>) {
    const source = p?.source as ParamSource;
    if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(PARAM_SOURCES, source)) throw new HttpError(400, 'Campo do modelo com origem desconhecida.', 'invalid');
    if (source === 'texto') {
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      if (!text || text.length > 200 || /[\n\t]| {5,}/.test(text)) throw new HttpError(400, 'Texto fixo de até 200 caracteres, sem quebra de linha.', 'invalid');
      clean.push({ source, text });
    } else clean.push({ source });
    if (source === 'link' && !linkUrl) throw new HttpError(400, 'Informe o link usado no modelo.', 'invalid');
  }
  // null = all; an empty or invalid list is refused instead of silently widening the audience.
  if (rule.doctorIds !== undefined && rule.doctorIds !== null && (!Array.isArray(rule.doctorIds) || !rule.doctorIds.length))
    throw new HttpError(400, 'Escolha pelo menos um médico ou deixe "todos".', 'invalid');
  if (rule.appointmentTypes !== undefined && rule.appointmentTypes !== null && (!Array.isArray(rule.appointmentTypes) || !rule.appointmentTypes.length
    || rule.appointmentTypes.some((t) => typeof t !== 'string' || !/^[a-z_]{2,30}$/.test(t))))
    throw new HttpError(400, 'Tipo de consulta inválido.', 'invalid');
  const doctorIds = Array.isArray(rule.doctorIds) ? [...new Set((rule.doctorIds as unknown[]).map((d) => uuid(d, 'Médico')))] : null;
  const types = Array.isArray(rule.appointmentTypes) ? [...new Set(rule.appointmentTypes as string[])] : null;
  try {
    return await deps.rpc('whatsapp_automation_save', {
      p_clinic: caller.clinicId, p_actor: caller.userId, p_id: id, p_revision: revision,
      p_rule: {
        name, enabled: rule.enabled === true, trigger, offsetMinutes: offset, templateName: template.name, templateLanguage: template.language,
        params: clean, linkUrl, doctorIds, appointmentTypes: types,
      },
    });
  } catch (e) { throw rpcError(e); }
}

const firstName = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first ? first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR') : '';
};
const local = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts }).format(new Date(iso));

/** The template fields for one appointment; never empty (Meta refuses empty parameters). */
export function renderParams(rule: Pick<AutomationRow, 'params' | 'link_url'>, c: Candidate, preConsulta: string | null = null): string[] {
  return rule.params.map((p) => {
    switch (p.source) {
      case 'paciente_primeiro_nome': return firstName(c.patient_name) || 'paciente';
      case 'data': return local(c.appointment_start, { day: '2-digit', month: '2-digit' });
      case 'hora': return local(c.appointment_start, { hour: '2-digit', minute: '2-digit' });
      case 'dia_semana': return local(c.appointment_start, { weekday: 'long' });
      case 'medico': return c.doctor_name.trim() || 'nossa equipe';
      case 'clinica': return c.clinic_name.trim() || 'a clínica';
      case 'link': return rule.link_url ?? '';
      case 'link_pre_consulta': return preConsulta ?? '';
      case 'texto': return p.text ?? '';
      default: return '';
    }
  });
}

/** Stored in place of the pre-consultation link (contracts: whatsapp and pre-consulta). */
export const PRE_CONSULTA_PLACEHOLDER = '[link da pré-consulta]';

export const renderBody =(body: string, params: string[]) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] ?? '');

export function inQuietHours(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour < QUIET_HOURS.start || hour >= QUIET_HOURS.end;
}

/** Scheduler entry point (pg_cron every few minutes). Sends what is due, at most once per rule and appointment start. */
export async function automationsHandler(req: Request, deps: WhatsAppDeps): Promise<Response> {
  const secret = deps.config.cronSecret ?? '';
  const given = req.headers.get('x-cortex-cron') ?? '';
  let diff = secret.length === given.length && secret.length >= 32 ? 0 : 1;
  for (let i = 0; i < Math.min(secret.length, given.length); i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  if (req.method !== 'POST' || diff !== 0) return json(deps, 401, { error: 'Não autorizado.' });
  const now = (deps.now ?? (() => new Date()))();
  if (inQuietHours(now)) return json(deps, 200, { quiet: true, candidates: 0, sent: 0, skipped: 0, failed: 0, unknown: 0 });
  const candidates = (await deps.rpc('whatsapp_automation_candidates', { p_now: now.toISOString(), p_limit: 100 })) as Candidate[] | null;
  const list = candidates ?? [];
  const rules = new Map((await deps.store.automationsByIds([...new Set(list.map((c) => c.automation_id))])).map((r) => [r.id, r]));
  const channels = new Map<string, ChannelRow | null>();
  const tokens = new Map<string, string | null>();
  const templateCache = new Map<string, TemplateRow[]>();
  const tally = { sent: 0, skipped: 0, failed: 0, unknown: 0 };
  const fail = (rule: AutomationRow, c: Candidate, reason: string) =>
    deps.rpc('whatsapp_automation_fail', { p_automation: rule.id, p_appointment: c.appointment_id, p_start: c.appointment_start, p_reason: reason }).catch(() => null);
  for (const c of list) {
    const rule = rules.get(c.automation_id);
    if (!rule) continue;
    if (!channels.has(c.clinic_id)) channels.set(c.clinic_id, await deps.store.channelForClinic(c.clinic_id));
    const ch = channels.get(c.clinic_id);
    if (!ch) continue;
    if (!tokens.has(ch.id)) { try { tokens.set(ch.id, await channelToken(deps, ch)); } catch { tokens.set(ch.id, null); } }
    const token = tokens.get(ch.id);
    if (!token) continue; // channel unusable: retried on the next run, nothing is claimed
    if (!templateCache.has(ch.id)) templateCache.set(ch.id, await deps.store.templates(ch.id));
    const template = templateCache.get(ch.id)!.find((t) => t.name === rule.template_name && t.language === rule.template_language);
    const skip = c.opted_out ? 'O contato pediu para não receber mensagens.'
      : !c.consented ? 'Sem consentimento registrado para mensagens pelo WhatsApp.'
      : !c.phone || !/^[0-9]{10,15}$/.test(c.phone) ? 'Sem telefone válido no cadastro.'
      : !template || template.status !== 'APPROVED' ? 'Modelo não aprovado.'
      : template.param_count !== rule.params.length ? 'Campos do modelo mudaram; revise a regra.' : null;
    // The pre-consultation link is created only for a message that will go out.
    let preConsulta: string | null = null;
    let linkSkip: string | null = null;
    if (!skip && rule.params.some((p) => p.source === 'link_pre_consulta')) {
      try {
        preConsulta = deps.intakeLink ? await deps.intakeLink(c.clinic_id, c.appointment_id) : null;
        if (!preConsulta) linkSkip = 'Pré-consulta não configurada no servidor.';
      } catch (e) {
        const code = (e as { code?: string })?.code;
        linkSkip = code === '55000' ? 'A pré-consulta não está ativa nesta clínica.' : code === '22023' ? 'O agendamento não aceita pré-consulta.' : null;
        if (!linkSkip) { await fail(rule, c, `Pré-consulta: ${code ?? 'erro'}`); tally.failed++; continue; }
      }
    }
    const finalSkip = skip ?? linkSkip;
    const params = finalSkip ? [] : renderParams(rule, c, preConsulta);
    if (!finalSkip && params.some((p) => !p.trim())) { await fail(rule, c, 'Campo do modelo vazio.'); tally.failed++; continue; }
    // The pre-consultation link is a credential: the stored copy (inbox body and template fields)
    // gets a placeholder; the real link only goes to Meta in the send below.
    const stored = finalSkip ? [] : renderParams(rule, c, preConsulta ? PRE_CONSULTA_PLACEHOLDER : null);
    let begun: { runId: string; messageId?: string; to?: string; skipped: boolean } | null;
    try {
      begun = (await deps.rpc('whatsapp_automation_begin', {
        p_automation: rule.id, p_rule_revision: rule.revision, p_appointment: c.appointment_id, p_start: c.appointment_start,
        p_wa_id: finalSkip ? null : c.phone, p_skip_reason: finalSkip,
        p_body: finalSkip ? '' : renderBody(template!.body, stored), p_template: finalSkip ? null : { name: rule.template_name, language: rule.template_language, params: stored },
      })) as typeof begun;
    } catch (e) {
      await fail(rule, c, `Preparação: ${(e as { code?: string })?.code ?? 'erro'}`);
      tally.failed++;
      continue;
    }
    if (!begun) continue; // another run claimed it
    if (begun.skipped) { tally.skipped++; continue; }
    const outcome = await deliver(deps, ch, token, begun.messageId!, {
      to: begun.to, type: 'template',
      template: {
        name: rule.template_name, language: { code: rule.template_language },
        ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
      },
    });
    if (outcome.status === 'sent') tally.sent++; else if (outcome.status === 'unknown') tally.unknown++; else tally.failed++;
  }
  deps.log?.('whatsapp_automations', { candidates: list.length, ...tally });
  return json(deps, 200, { quiet: false, candidates: list.length, ...tally });
}

// ---------------------------------------------------------------- menu bot ("robô de fluxo")

const flowDto = (row: FlowRow | null, clinicName: string, doctors: string[]) => {
  if (!row) return { ...starterFlow(clinicName, doctors), revision: 0, updatedAt: null, starter: true };
  return {
    enabled: row.enabled, definition: row.definition, hours: row.hours, afterHoursText: row.after_hours_text, handoffText: row.handoff_text,
    defaultQueue: row.default_queue, revision: row.revision, updatedAt: row.updated_at, starter: false,
  };
};

async function getFlow(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireAdmin(caller);
  const clinicName = typeof body.clinicName === 'string' ? body.clinicName.slice(0, 120) : '';
  const doctors = Array.isArray(body.doctors) ? (body.doctors as unknown[]).filter((d): d is string => typeof d === 'string').map((d) => d.slice(0, 60)).slice(0, 8) : [];
  return flowDto(await deps.store.flowForClinic(caller.clinicId), clinicName, doctors);
}

/** Only the fields of the flow, re-built from the request; anything else is dropped. */
function cleanFlow(raw: unknown): FlowSettings | null {
  const f = raw as Record<string, unknown> | null;
  if (!f || typeof f !== 'object') return null;
  const def = f.definition as Record<string, unknown> | null;
  if (!def || typeof def !== 'object' || typeof def.start !== 'string' || !def.nodes || typeof def.nodes !== 'object') return null;
  const nodes: Record<string, FlowNode> = {};
  for (const [id, value] of Object.entries(def.nodes as Record<string, unknown>)) {
    const n = value as Record<string, unknown>;
    if (!n || typeof n !== 'object') return null;
    nodes[id] = {
      title: typeof n.title === 'string' ? n.title.trim() : '',
      text: typeof n.text === 'string' ? n.text.trim() : '',
      options: Array.isArray(n.options)
        ? (n.options as Array<Record<string, unknown>>).map((o) => ({ label: typeof o?.label === 'string' ? o.label.trim() : '', goto: typeof o?.goto === 'string' ? o.goto : '' }))
        : [],
      ...(typeof n.then === 'string' && n.then ? { then: n.then } : {}),
    };
  }
  const hours: BusinessHours = {};
  for (const [day, range] of Object.entries((f.hours as Record<string, unknown>) ?? {})) {
    if (Array.isArray(range)) hours[day as keyof BusinessHours] = [String(range[0] ?? ''), String(range[1] ?? '')];
    else return null;
  }
  return {
    enabled: f.enabled === true,
    definition: { start: def.start, nodes },
    hours,
    afterHoursText: typeof f.afterHoursText === 'string' ? f.afterHoursText.trim() : '',
    handoffText: typeof f.handoffText === 'string' ? f.handoffText.trim() : '',
    defaultQueue: typeof f.defaultQueue === 'string' ? f.defaultQueue.trim() : '',
  };
}

async function saveFlow(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireAdmin(caller);
  const flow = cleanFlow(body.flow);
  if (!flow) throw new HttpError(400, 'Fluxo inválido.', 'invalid');
  const errors = validateFlow(flow);
  if (errors.length) throw new HttpError(400, errors.slice(0, 5).join(' '), 'invalid');
  const revision = typeof body.revision === 'number' && Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : -1;
  if (revision < 0) throw new HttpError(400, 'Revisão do fluxo ausente.', 'invalid');
  try {
    return await deps.rpc('whatsapp_flow_save', { p_clinic: caller.clinicId, p_actor: caller.userId, p_revision: revision, p_flow: flow });
  } catch (e) { throw rpcError(e); }
}

async function botSessionView(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  const conversationId = uuid(body.conversationId, 'Conversa');
  const conv = await deps.store.conversation(caller.clinicId, conversationId);
  if (!conv) throw new HttpError(404, 'Conversa não encontrada.', 'not_found');
  const s = await deps.store.botSession(conversationId);
  return {
    session: s ? { status: s.status, path: s.path, outcome: s.outcome, startedAt: s.started_at, updatedAt: s.updated_at } : null,
  };
}

const ASSIGNEE_CURSOR = /^a1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** The directory is read whole to certify name uniqueness; beyond this size it is reported unavailable. */
export const DIRECTORY_MAX = 5000;
const DIRECTORY_PAGE = 1000;

interface DirectoryEntry { userId: string; name: string; role: 'reception' | 'admin'; ambiguous: boolean }

/**
 * Everyone who can receive a conversation (active reception staff or active admins, the act/assign
 * rule), ordered by user id. `ambiguous` compares the name exactly as shown (trimmed, cut at 256,
 * case-insensitive) across the whole directory, never a sample. A directory too large to read whole
 * is refused as unavailable instead of being marked unambiguous.
 */
async function eligibleDirectory(deps: WhatsAppDeps, clinicId: string): Promise<DirectoryEntry[]> {
  const rows: AssigneeRow[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await deps.store.assignees(clinicId, after, DIRECTORY_PAGE);
    rows.push(...page);
    if (rows.length > DIRECTORY_MAX) throw new HttpError(503, 'A equipe é grande demais para conferir nomes repetidos.', 'directory_unavailable');
    if (page.length < DIRECTORY_PAGE) break;
    after = page[page.length - 1].user_id;
  }
  const shown = (n: string) => n.normalize('NFC').trim().slice(0, 256);
  const key = (n: string) => shown(n).toLocaleLowerCase('pt-BR');
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r.name), (counts.get(key(r.name)) ?? 0) + 1);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.user_id) && seen.add(r.user_id))
    .sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0))
    .map((r) => ({ userId: r.user_id, name: shown(r.name), role: r.role, ambiguous: (counts.get(key(r.name)) ?? 0) > 1 }));
}

function pageParams(body: Record<string, unknown>) {
  // A JSON integer only: "2", true or [2] are refused, not coerced (Codex 1052).
  const limit = body.limit === undefined ? 50 : body.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, 'Limite inválido.', 'invalid');
  let after: string | null = null;
  if (body.before !== undefined && body.before !== null) {
    const m = typeof body.before === 'string' ? ASSIGNEE_CURSOR.exec(body.before) : null;
    if (!m) throw new HttpError(400, 'Cursor inválido.', 'invalid');
    after = m[1];
  }
  return { limit, after };
}

function pageOf<T extends { userId: string }>(list: T[], after: string | null, limit: number) {
  const rest = after ? list.filter((x) => x.userId > after) : list;
  const items = rest.slice(0, limit);
  return { items, nextBefore: rest.length > limit ? `a1.${items[items.length - 1].userId}` : null };
}

/** Who can receive a conversation, in pages of up to 50. A catalog, not an authorization: assign checks again. */
async function assigneesView(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  const { limit, after } = pageParams(body);
  return pageOf(await eligibleDirectory(deps, caller.clinicId), after, limit);
}

/**
 * An ISO 8601 instant with an explicit offset, only if every field exists in the calendar:
 * 2026-02-30 or 25:00 are refused instead of being normalized by Date.parse (Codex 1052).
 */
export function strictInstant(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
  if (!m) return null;
  const n = (x: string | undefined) => Number(x ?? '0');
  const [y, mo, d, h, mi, sec, oh, om] = [m[1], m[2], m[3], m[4], m[5], m[6], m[8], m[9]].map(n);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || sec > 59 || oh > 14 || om > 59) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const AUTHORITY_FIELDS = ['clinicId', 'clinic_id', 'actorId', 'userId', 'user_id', 'role', 'admin', 'reception', 'p_clinic'];

/**
 * Reception dashboard (K2/1): latest-cycle cohort of [from, to) and the open conversations now, by
 * current owner. Counts and user ids only. Contract: docs/product/clinic-crm/RECEPTION_DASHBOARD_READ.md.
 */
async function dashboardView(deps: WhatsAppDeps, caller: Caller, body: Record<string, unknown>) {
  requireInbox(caller);
  if (AUTHORITY_FIELDS.some((f) => f in body)) throw new HttpError(400, 'Clínica e pessoa vêm da sessão.', 'invalid');
  const now = (deps.now ?? (() => new Date()))();
  const iso = (v: unknown, what: string) => {
    const t = typeof v === 'string' ? strictInstant(v) : null;
    if (t === null) throw new HttpError(400, `${what} inválido.`, 'invalid');
    return t;
  };
  const from = iso(body.from, 'Início');
  const to = iso(body.to, 'Fim');
  if (!(from < to) || to > now.getTime() || to - from > 31 * 86_400_000) throw new HttpError(400, 'Escolha um período de até 31 dias, terminando até agora.', 'invalid');
  const { limit, after } = pageParams(body);
  let snap: { cohort: { incomingCycles: number; withHumanSend: number; withoutHumanSend: number; medianFirstHumanSendSeconds: number | null;
    closedWithoutHumanSend: number }; openNow: { total: number; unassigned: number; assignedToIneligible: number; owners: Array<{ userId: string; openCount: number }> } };
  try {
    snap = (await deps.rpc('whatsapp_dashboard', { p_clinic: caller.clinicId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() })) as typeof snap;
  } catch (e) { throw rpcError(e); }
  const directory = new Map((await eligibleDirectory(deps, caller.clinicId)).map((d) => [d.userId, d]));
  // An owner the SQL saw as eligible but the directory no longer lists (changed in between) is counted as ineligible.
  const owners = snap.openNow.owners.filter((o) => directory.has(o.userId)).map((o) => ({ ...directory.get(o.userId)!, openCount: Number(o.openCount) }));
  const vanished = snap.openNow.owners.filter((o) => !directory.has(o.userId)).reduce((a, o) => a + Number(o.openCount), 0);
  const c = snap.cohort;
  return {
    schemaVersion: 1, asOf: now.toISOString(),
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), timeZone: 'America/Sao_Paulo' },
    coverage: 'latest_cycle_only',
    cohort: { incomingCycles: Number(c.incomingCycles), withHumanSend: Number(c.withHumanSend), withoutHumanSend: Number(c.withoutHumanSend),
      medianFirstHumanSendSeconds: c.medianFirstHumanSendSeconds === null ? null : Number(c.medianFirstHumanSendSeconds),
      closedWithoutHumanSend: Number(c.closedWithoutHumanSend) },
    openNow: { total: Number(snap.openNow.total), unassigned: Number(snap.openNow.unassigned),
      assignedToIneligible: Number(snap.openNow.assignedToIneligible) + vanished, owners: pageOf(owners, after, limit) },
    unavailable: { abandonment: 'no_explicit_event', appointments: 'scoped_source_required' },
  };
}

const BOT_KINDS = new Set(['text', 'interactive', 'button', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts']);

/**
 * Runs the bot for one freshly ingested inbound message. Never throws: a failure leaves the
 * conversation to the reception (the session ends as "error").
 */
export async function runBot(deps: WhatsAppDeps, m: InboundMessage, conversationId: string): Promise<void> {
  try {
    if (!BOT_KINDS.has(m.kind) || isQuietWord(m.body)) return;
    const conv = await deps.store.conversationById(conversationId);
    if (!conv) return;
    const flow = await deps.store.flowForClinic(conv.clinic_id);
    if (!flow?.enabled) return;
    const settings: FlowSettings = {
      enabled: flow.enabled, definition: flow.definition, hours: flow.hours, afterHoursText: flow.after_hours_text,
      handoffText: flow.handoff_text, defaultQueue: flow.default_queue,
    };
    if (validateFlow(settings).length) return;
    const session = await deps.store.botSession(conv.id);
    const now = (deps.now ?? (() => new Date()))();
    if (conv.status !== 'open' || conv.assigned_to) {
      if (session?.status === 'active')
        await deps.rpc('whatsapp_bot_apply', endArgs(conv.id, session, 'human', 'Atendimento assumido pela recepção'));
      return;
    }
    // A late message (provider time older than 24 h) does not open the window; the SQL step checks it again under the lock.
    const until = windowOpenUntil(conv.last_inbound_at);
    if (!until || Date.parse(until) <= now.getTime()) return;
    const idle = session ? now.getTime() - Date.parse(session.updated_at) > SESSION_IDLE_MS : false;
    const reopened = session ? Date.parse(conv.opened_at) > Date.parse(session.started_at) : false;
    const newCycle = !session || reopened || (session.status === 'active' && (idle || session.flow_revision !== flow.revision));
    // A cycle that already handed off, closed or was taken stays with the reception until the conversation reopens.
    if (!newCycle && session!.status !== 'active') return;
    const state: SessionState | null = newCycle ? null : { node: session!.node, attempts: session!.attempts, path: session!.path };
    const step = decideStep(settings, state, { kind: m.kind, body: m.body, replyId: m.replyId }, isOpenNow(settings.hours, now));
    const applied = (await deps.rpc('whatsapp_bot_apply', {
      p_conversation: conv.id, p_trigger_wamid: m.wamid, p_session_revision: session?.revision ?? 0, p_new_cycle: newCycle,
      p_flow_revision: flow.revision, p_node: step.node, p_attempts: step.attempts, p_path: step.path, p_status: step.status,
      p_outcome: step.queue ? `queue:${step.queue}` : step.close ? 'close' : null, p_queue: step.queue, p_close: step.close,
      p_messages: step.messages.map((x) => ({ kind: x.kind, body: x.body })),
    })) as { applied: boolean; revision?: number; messageIds?: string[]; to?: string | null; recipient?: string | null } | null;
    if (!applied?.applied || !applied.messageIds?.length) return;
    const ch = await deps.store.channelForClinic(conv.clinic_id);
    if (!ch) return;
    const token = await channelToken(deps, ch);
    const address = applied.to ? { to: applied.to } : applied.recipient ? { recipient: applied.recipient } : null;
    if (!address) return;
    for (let i = 0; i < applied.messageIds.length; i++) {
      const outcome = await deliver(deps, ch, token, applied.messageIds[i], { ...address, ...step.messages[i].graph });
      if (outcome.status !== 'sent') {
        // Stop the bot; the reception sees the conversation and the failed message.
        if (step.status === 'active')
          await deps.rpc('whatsapp_bot_apply', endArgs(conv.id, { revision: applied.revision ?? 0 }, 'error', 'Falha no envio do robô')).catch(() => null);
        break;
      }
    }
  } catch (e) {
    deps.log?.('whatsapp_bot_error', { conversation: conversationId, kind: (e as Error)?.name ?? 'unknown' });
  }
}

const endArgs = (conversationId: string, session: { revision: number }, status: 'human' | 'error', outcome: string) => ({
  p_conversation: conversationId, p_trigger_wamid: null, p_session_revision: session.revision, p_new_cycle: false, p_flow_revision: 1,
  p_node: 'fim', p_attempts: 0, p_path: [], p_status: status, p_outcome: outcome, p_queue: null, p_close: false, p_messages: [],
});
