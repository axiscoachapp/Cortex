// K1 read-only boundary. No connection, send or mutation methods are exposed here.
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { functionErrorBody } from '@/lib/functionErrors';

const uuid = z.string().uuid().toLowerCase();
const timestamp = z.string().max(40).datetime({ offset: true });
const nullableTime = timestamp.nullable();
const stateFields = {
  serverReady: z.boolean(), connected: z.boolean(), status: z.enum(['none', 'connected', 'disconnected', 'error']),
  displayPhone: z.string().max(256).nullable(), verifiedName: z.string().max(256).nullable(), quality: z.string().max(128).nullable(),
  connectedAt: nullableTime, canUseInbox: z.boolean(),
};
const stateResponse = z.discriminatedUnion('canManage', [
  z.object({ ...stateFields, canManage: z.literal(false) }).strict(),
  z.object({ ...stateFields, canManage: z.literal(true), lastError: z.string().max(4096).nullable(), webhookUrl: z.string().max(2048), phoneNumberId: z.string().max(256).nullable(), wabaId: z.string().max(256).nullable() }).strict(),
]);
const conversation = z.object({
  id: uuid, waId: z.string().max(128).nullable(), profileName: z.string().max(256), contactId: uuid.nullable(), caseId: uuid.nullable(),
  queue: z.string().max(128), status: z.enum(['open', 'closed']), assignedTo: uuid.nullable(), assignedAt: nullableTime,
  openedAt: timestamp, firstResponseAt: nullableTime, closedAt: nullableTime, lastInboundAt: nullableTime, windowOpenUntil: nullableTime,
  lastMessageAt: timestamp, lastMessagePreview: z.string().max(4096), unreadCount: z.number().int().nonnegative(), optedOut: z.boolean(), revision: z.number().int().positive(),
}).strict();
const message = z.object({
  id: uuid, direction: z.enum(['in', 'out']), kind: z.string().min(1).max(64), body: z.string().max(4096),
  media: z.object({ mime: z.string().max(256), filename: z.string().max(1024).nullable(), voice: z.boolean() }).strict().nullable(),
  template: z.object({ name: z.string().max(512), language: z.string().max(64) }).strict().nullable(),
  status: z.string().min(1).max(64), error: z.string().max(4096).nullable(), sentBy: uuid.nullable(), at: timestamp,
}).strict();
const listInput = z.object({ filter: z.enum(['unassigned', 'mine', 'open', 'closed']).default('open'), search: z.string().trim().max(80).default(''), before: timestamp.nullish(), limit: z.number().int().min(1).max(100).default(50) }).strict();
const messagesInput = z.object({ conversationId: uuid, before: timestamp.nullish() }).strict();
const uniqueIds = (rows: { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
const conversationPage = z.object({ conversations: z.array(conversation).max(100), nextBefore: nullableTime }).strict().refine(page => uniqueIds(page.conversations));
const messagePage = z.object({ conversation, messages: z.array(message).max(50), nextBefore: nullableTime }).strict().refine(page => uniqueIds(page.messages));

export type WhatsAppConversation = z.infer<typeof conversation>;
export type WhatsAppMessage = z.infer<typeof message>;
export type WhatsAppInboxFilter = z.infer<typeof listInput>['filter'];
export class WhatsAppReadError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
const errors: Record<string, string> = {
  forbidden: 'Você não tem acesso à caixa de conversas desta clínica.',
  not_connected: 'O WhatsApp desta clínica não está conectado.',
  server_not_ready: 'A conexão do WhatsApp ainda não está disponível.',
  not_found: 'Esta conversa não está disponível. Atualize a lista.',
  invalid: 'Confira os filtros e a conversa antes de tentar novamente.',
  unavailable: 'Não foi possível carregar o WhatsApp. Verifique o acesso e tente novamente.',
};
async function read<T>(body: Record<string, unknown>, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const { data, error } = await supabase.functions.invoke('whatsapp-api', { body, signal }).catch(() => {
    throw new WhatsAppReadError(errors.unavailable, 'unavailable');
  });
  if (error) {
    const payload = await functionErrorBody(error);
    const raw = payload?.code;
    const code = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(errors, raw) ? raw : 'unavailable';
    throw new WhatsAppReadError(errors[code], code);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new WhatsAppReadError('A resposta do WhatsApp não pôde ser validada. Atualize a lista.', 'INVALID_RESPONSE');
  return parsed.data;
}
export const whatsappApi = {
  async state(signal?: AbortSignal) {
    const value = await read({ action: 'state' }, stateResponse, signal);
    const { serverReady, connected, status, displayPhone, verifiedName, quality, connectedAt, canManage, canUseInbox } = value;
    return { serverReady, connected, status, displayPhone, verifiedName, quality, connectedAt, canManage, canUseInbox };
  },
  async conversations(input: z.input<typeof listInput> = {}, signal?: AbortSignal) {
    const value = listInput.parse(input);
    return read({ action: 'conversations', ...value, before: value.before ?? null }, conversationPage.refine(page => page.conversations.length <= value.limit), signal);
  },
  async messages(input: z.input<typeof messagesInput>, signal?: AbortSignal) {
    const value = messagesInput.parse(input);
    return read({ action: 'messages', ...value, before: value.before ?? null }, messagePage.refine(page => page.conversation.id === value.conversationId), signal);
  },
};
