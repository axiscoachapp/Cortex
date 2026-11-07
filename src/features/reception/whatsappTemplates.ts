// K1/5a: stored catalog only; no synchronization, consent or send authority.
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { functionErrorBody } from '@/lib/functionErrors';

const template = z.object({
  name: z.string().min(1).max(512).refine(value => !/[^a-z0-9_]/.test(value)),
  language: z.string().max(6).regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/).refine(value => !/\s/.test(value)),
  category: z.string().max(40),
  status: z.string().max(40),
  body: z.string().max(4096),
  paramCount: z.number().int().min(0).max(100),
}).strict();
const catalog = z.object({ templates: z.array(template).max(1000) }).strict().refine(value => {
  const tuples = value.templates.map(row => JSON.stringify([row.name, row.language]));
  return new Set(tuples).size === tuples.length;
});

export type WhatsAppTemplate = z.infer<typeof template>;
export type WhatsAppTemplateCatalog = z.infer<typeof catalog>;
export class WhatsAppTemplateReadError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'WhatsAppTemplateReadError';
  }
}
const errors: Record<string, string> = {
  forbidden: 'Você não tem acesso aos modelos desta clínica.',
  not_connected: 'O WhatsApp desta clínica não está conectado.',
  server_not_ready: 'A conexão do WhatsApp ainda não está disponível.',
  invalid: 'Não foi possível consultar os modelos. Atualize e tente novamente.',
  not_found: 'Os modelos desta clínica não estão disponíveis.',
  unavailable: 'Não foi possível carregar os modelos. Verifique o acesso e tente novamente.',
};
function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new WhatsAppTemplateReadError('A leitura dos modelos foi cancelada.', 'cancelled');
}

export async function readWhatsAppTemplates(signal?: AbortSignal): Promise<WhatsAppTemplateCatalog> {
  checkCancellation(signal);
  const { data, error } = await supabase.functions.invoke('whatsapp-api', {
    body: { action: 'templates' }, signal,
  }).catch(() => {
    checkCancellation(signal);
    throw new WhatsAppTemplateReadError(errors.unavailable, 'unavailable');
  });
  checkCancellation(signal);
  if (error) {
    const payload = await functionErrorBody(error);
    checkCancellation(signal);
    const raw = payload?.code;
    const code = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(errors, raw) ? raw : 'unavailable';
    throw new WhatsAppTemplateReadError(errors[code], code);
  }
  const parsed = catalog.safeParse(data);
  if (!parsed.success) throw new WhatsAppTemplateReadError('A resposta dos modelos não pôde ser validada. Atualize e tente novamente.', 'INVALID_RESPONSE');
  return parsed.data;
}
