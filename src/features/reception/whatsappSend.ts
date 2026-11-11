// Human reply from the reception inbox: `send` (free text or approved template) and `act mark_read`.
// The server owns the 24-hour window, opt-out, template approval and idempotency by request id;
// this adapter only shapes the request, parses the answer strictly and classifies the outcome.
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { functionErrorBody } from '@/lib/functionErrors';

const uuid = z.string().uuid().toLowerCase();
export const MAX_TEXT = 4096;
export const MAX_PARAM = 1024;
const param = z.string().refine(value => value.trim().length > 0 && value.length <= MAX_PARAM && !/[\n\t]| {5,}/.test(value));
const templateInput = z.object({
  name: z.string().min(1).max(512).refine(value => !/[^a-z0-9_]/.test(value)),
  language: z.string().max(6).regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  params: z.array(param).max(20),
}).strict();
const sendInput = z.union([
  z.object({ conversationId: uuid, requestId: uuid, text: z.string().transform(value => value.trim()).refine(value => value.length > 0 && value.length <= MAX_TEXT) }).strict(),
  z.object({ conversationId: uuid, requestId: uuid, template: templateInput }).strict(),
]);
const messageStatus = z.enum(['pending', 'sent', 'delivered', 'read', 'failed', 'unknown', 'unrecorded']);
const accepted = z.object({ messageId: uuid, status: messageStatus, duplicate: z.boolean() }).strict();
const unconfirmed = z.object({ messageId: uuid, status: z.literal('unknown'), duplicate: z.literal(false), warning: z.string().max(1024) }).strict();
const readReceipt = z.object({ revision: z.number().int().positive(), status: z.enum(['open', 'closed']), assignedTo: uuid.nullable() }).strict();

export type WhatsAppSendInput = z.input<typeof sendInput>;
/** `sent`: WhatsApp accepted it. `unknown`: no confirmation; the message is in the history and must be checked. */
export type WhatsAppSendReceipt = { outcome: 'sent' | 'unknown'; messageId: string; duplicate: boolean };

const messages = {
  window_closed: 'Passaram mais de 24 horas desde a última mensagem do paciente. Agora só é possível enviar um modelo aprovado.',
  opted_out: 'Este contato pediu para não receber mensagens. Nada foi enviado.',
  template: 'Este modelo não está aprovado para envio ou mudou. Peça ao administrador da clínica para atualizar os modelos.',
  send_failed: 'O WhatsApp recusou a mensagem e nada foi enviado. Confira o texto e tente de novo.',
  forbidden: 'Você não tem permissão para responder nesta conversa.',
  not_found: 'Esta conversa não está mais disponível. Atualize a lista.',
  not_connected: 'O WhatsApp da clínica não está conectado. Avise o administrador da clínica.',
  server_not_ready: 'O envio pelo WhatsApp está indisponível no momento. Avise o administrador da clínica.',
  token_unreadable: 'O envio pelo WhatsApp está indisponível no momento. Avise o administrador da clínica.',
  invalid: 'Não foi possível enviar. Confira a mensagem ou os campos do modelo e tente de novo.',
  unavailable: 'Não foi possível confirmar o envio. Confira a conversa: se a mensagem não aparecer, tente de novo. A nova tentativa não duplica o envio.',
  INVALID_RESPONSE: 'Não foi possível confirmar o envio. Confira a conversa: se a mensagem não aparecer, tente de novo. A nova tentativa não duplica o envio.',
  cancelled: 'O envio foi interrompido. Confira a conversa antes de tentar de novo.',
} as const;
export type WhatsAppSendCode = keyof typeof messages;
/** Codes after which the server may have reserved (or even sent) the message. Retrying the same request id is safe. */
const ambiguous = new Set<WhatsAppSendCode>(['unavailable', 'INVALID_RESPONSE', 'cancelled']);

export class WhatsAppSendError extends Error {
  /** true: the outcome is not known; keep the request id so a manual retry stays idempotent. */
  readonly ambiguous: boolean;
  constructor(readonly code: WhatsAppSendCode) {
    super(messages[code]);
    this.name = 'WhatsAppSendError';
    this.ambiguous = ambiguous.has(code);
  }
}
const known = (raw: unknown): WhatsAppSendCode | null =>
  typeof raw === 'string' && raw !== 'INVALID_RESPONSE' && raw !== 'cancelled' && Object.prototype.hasOwnProperty.call(messages, raw) ? raw as WhatsAppSendCode : null;

/**
 * Sends once. Never retries: a 202 or a lost answer is reported, not repeated. A duplicate reply
 * (same request id) is classified by the stored status: failed is a refusal, pending/unknown unconfirmed.
 */
export async function sendWhatsAppMessage(input: WhatsAppSendInput, signal?: AbortSignal): Promise<WhatsAppSendReceipt> {
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) throw new WhatsAppSendError('invalid');
  if (signal?.aborted) throw new WhatsAppSendError('cancelled');
  let result: Awaited<ReturnType<typeof supabase.functions.invoke>>;
  try {
    result = await supabase.functions.invoke('whatsapp-api', { body: { action: 'send', ...parsed.data }, signal });
  } catch {
    throw new WhatsAppSendError(signal?.aborted ? 'cancelled' : 'unavailable');
  }
  if (!result || typeof result !== 'object') throw new WhatsAppSendError('unavailable');
  if (result.error) {
    const payload = await functionErrorBody(result.error);
    throw new WhatsAppSendError(known(payload?.code) ?? 'unavailable');
  }
  const status = (result as { response?: Response }).response?.status;
  if (status === 202 || (result.data && typeof result.data === 'object' && 'warning' in result.data)) {
    const receipt = unconfirmed.safeParse(result.data);
    if (!receipt.success) throw new WhatsAppSendError('INVALID_RESPONSE');
    return { outcome: 'unknown', messageId: receipt.data.messageId, duplicate: false };
  }
  const receipt = accepted.safeParse(result.data);
  if (!receipt.success || (status !== undefined && status !== 200)) throw new WhatsAppSendError('INVALID_RESPONSE');
  const { messageId, duplicate } = receipt.data;
  switch (receipt.data.status) {
    case 'sent': case 'delivered': case 'read': case 'unrecorded':
      return { outcome: 'sent', messageId, duplicate };
    case 'failed':
      if (duplicate) throw new WhatsAppSendError('send_failed');
      throw new WhatsAppSendError('INVALID_RESPONSE');
    default:
      // pending or unknown: reserved earlier under this request id, not confirmed.
      if (!duplicate && receipt.data.status === 'unknown') throw new WhatsAppSendError('INVALID_RESPONSE');
      return { outcome: 'unknown', messageId, duplicate };
  }
}

/** Best effort: clears the unread count of a conversation. Resolves false on any failure. */
export async function markWhatsAppConversationRead(conversationId: string, signal?: AbortSignal): Promise<boolean> {
  const id = uuid.safeParse(conversationId);
  if (!id.success || signal?.aborted) return false;
  try {
    const result = await supabase.functions.invoke('whatsapp-api', { body: { action: 'act', operation: 'mark_read', conversationId: id.data }, signal });
    return !!result && !result.error && readReceipt.safeParse(result.data).success;
  } catch {
    return false;
  }
}

/** Replaces {{1}}…{{n}} with the typed values; empty values stay visible as [campo n]. */
export function previewTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d{1,3})\}\}/g, (match, digits: string) => {
    const index = Number(digits) - 1;
    if (index < 0 || index >= params.length) return match;
    const value = params[index].trim();
    return value || `[campo ${index + 1}]`;
  });
}
export const validTemplateParam = (value: string) => param.safeParse(value).success;
