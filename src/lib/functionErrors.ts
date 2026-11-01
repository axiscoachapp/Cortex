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
