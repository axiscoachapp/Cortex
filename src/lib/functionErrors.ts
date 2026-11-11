// The response body of a FunctionsHttpError can only be read once, so the
// parsed body is cached per error object. Without this, a second reader
// (e.g. a message helper after the quota check) silently got nothing.
const parsedBodies = new WeakMap<object, Promise<Record<string, unknown> | null>>();

/** Read an Edge Function error defensively; malformed or absent JSON is optional. */
export async function functionErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const cached = parsedBodies.get(error);
  if (cached) return cached;
  const read = (async () => {
    const context = (error as { context: unknown }).context;
    if (!context || typeof context !== 'object' || !('json' in context) || typeof context.json !== 'function')
      return null;
    try {
      const body: unknown = await (context as { json: () => Promise<unknown> }).json();
      return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();
  parsedBodies.set(error, read);
  return read;
}

/** HTTP status of a failed Edge Function call (FunctionsHttpError keeps the Response on `context`). */
export function functionErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context: unknown }).context;
  const status = context && typeof context === 'object' && 'status' in context ? (context as { status: unknown }).status : null;
  return typeof status === 'number' ? status : null;
}

// Transport/library messages are English and meaningless to a doctor.
const TECHNICAL_MESSAGES = [
  /non-2xx status code/i,
  /Failed to send a request/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /Load failed/i,
  /^Not authorized/i,
  /JWT/i,
  /violates .* constraint/i,
  /duplicate key/i,
];

/** What the doctor was doing when a call failed; each has one fixed sentence. */
export type FailedAction =
  | 'document'
  | 'aiDocument'
  | 'question'
  | 'comment'
  | 'attachment'
  | 'consultation'
  | 'draft'
  | 'discard'
  | 'note'
  | 'profile';

/** Fixed sentences: what happened, that nothing was lost, and what to do. */
export const FAILURE_SENTENCES: Record<FailedAction, string> = {
  document: 'Não foi possível gerar o documento. Nada foi perdido. Tente de novo.',
  aiDocument: 'Não foi possível gerar o texto com a IA. Nada foi perdido. Tente de novo.',
  question: 'Não foi possível enviar a pergunta. Nada foi perdido. Toque em "Tentar novamente" na pergunta.',
  comment: 'Não foi possível salvar o comentário. O texto voltou para o campo. Tente de novo.',
  attachment: 'Não foi possível anexar o documento. Nada foi salvo pela metade. Tente de novo.',
  consultation: 'Não foi possível processar a consulta.',
  draft: 'Não foi possível salvar as observações da revisão. Retome a revisão e tente de novo antes de sair.',
  discard: 'Não foi possível excluir o rascunho. Ele continua salvo. Tente de novo.',
  note: 'Não foi possível salvar a evolução. Seu texto continua na tela. Tente de novo.',
  profile: 'Não foi possível atualizar o perfil. Nada foi alterado. Tente de novo.',
};

export const CONNECTION_FAILURE = 'Sem conexão com o servidor. Nada foi perdido. Verifique a internet e tente de novo.';
export const UNAVAILABLE_FAILURE = 'O serviço está indisponível agora. Nada foi perdido. Tente de novo em alguns minutos.';
export const AI_UNAVAILABLE_FAILURE = 'A IA está indisponível agora. Nada foi perdido. Tente de novo em alguns minutos.';
const AI_ACTIONS: ReadonlySet<FailedAction> = new Set(['aiDocument', 'question', 'comment', 'consultation']);
export const SESSION_FAILURE = 'Sua sessão terminou. Entre de novo para continuar. Nada foi perdido.';
export const BUSY_FAILURE = 'Muitas solicitações seguidas. Aguarde um minuto e tente de novo. Nada foi perdido.';
export const PRESCRIBER_FAILURE =
  'O cadastro do prescritor está incompleto (nome, CRM ou endereço). Peça à equipe Cortex para conferir antes de emitir o documento.';

/**
 * A fixed pt-BR sentence for a failed call, never the server's own text.
 * Known signals map to their sentence: no connection, session ended, service
 * unavailable (503, not configured), rate limit, missing prescriber data.
 * The one exception is a 422: our functions answer it with a written
 * instruction for the doctor (e.g. "complete o CPF do paciente"), which is
 * what the doctor has to fix, so it is kept when it is Portuguese prose.
 */
export async function plainFailureMessage(error: unknown, action: FailedAction): Promise<string> {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'FunctionsFetchError' || /Failed to send a request|Failed to fetch|NetworkError|Load failed/i.test(raw))
    return CONNECTION_FAILURE;
  const status = functionErrorStatus(error);
  const body = await functionErrorBody(error);
  if (body?.missingPrescriber) return PRESCRIBER_FAILURE;
  if (status === 401) return SESSION_FAILURE;
  if (status === 503 || body?.code === 'not_configured') return AI_ACTIONS.has(action) ? AI_UNAVAILABLE_FAILURE : UNAVAILABLE_FAILURE;
  if (status === 429 && !body?.quotaExceeded) return BUSY_FAILURE;
  const text = typeof body?.error === 'string' ? body.error.trim() : '';
  if (status === 422 && text && !TECHNICAL_MESSAGES.some((re) => re.test(text)) && /[ãáéíóúçõâêô]|\b(não|informe|complete|paciente)\b/i.test(text))
    return text;
  return FAILURE_SENTENCES[action];
}

/**
 * A user-facing pt-BR message for a failed Edge Function call or Supabase
 * request: the server's own `error` text when it sent one, a connection
 * message for transport failures, otherwise the given fallback.
 */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const body = await functionErrorBody(error);
  if (typeof body?.error === 'string' && body.error.trim() && !TECHNICAL_MESSAGES.some((re) => re.test(body.error as string)))
    return body.error.trim();
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/Failed to send a request|Failed to fetch|NetworkError|Load failed/i.test(raw))
    return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  if (raw && !TECHNICAL_MESSAGES.some((re) => re.test(raw)) && /[ãáéíóúçõâêô]|\b(não|tente|paciente|consulta)\b/i.test(raw))
    return raw; // already a Portuguese message thrown by our own code
  return fallback;
}
