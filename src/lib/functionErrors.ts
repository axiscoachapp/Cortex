/** Read an Edge Function error defensively; malformed or absent JSON is optional. */
export async function functionErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = error.context;
  if (!context || typeof context !== 'object' || !('json' in context) || typeof context.json !== 'function') return null;
  try {
    const body: unknown = await context.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}
