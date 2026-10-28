import { RequestError } from './errors.ts';

/** Fail closed until the configured deployment explicitly enables its AI use. */
export function assertAiEnabled(): void {
  const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
  if (runtime.Deno?.env.get('AI_ENABLED') !== 'true') throw new RequestError('IA temporariamente indisponível. Você pode registrar a consulta manualmente.', 503);
}
interface ProviderOperation { operation: 'generate' | 'embed' | 'embed_batch' | 'file_upload'; model: string }
export function providerOperation(input: RequestInfo | URL, init: RequestInit): ProviderOperation | null {
  const raw = input instanceof Request ? input.url : String(input);
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.origin !== 'https://generativelanguage.googleapis.com' || (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'DELETE') return null;
  const model = /^\/v1beta\/models\/(gemini-[a-z0-9.-]+):(generateContent|embedContent|batchEmbedContents)$/.exec(url.pathname);
  if (model) return { operation: model[2] === 'generateContent' ? 'generate' : model[2] === 'embedContent' ? 'embed' : 'embed_batch', model: model[1] };
  if (url.pathname === '/upload/v1beta/files') return { operation: 'file_upload', model: 'files-api' };
  return null;
}
/** One bounded event per provider HTTP operation. No URL, key, chart, user or
 * patient identity is accepted by this logger. Endpoint bodies are never logged. */
export async function observeProviderOperation(meta: ProviderOperation, execute: () => Promise<Response>): Promise<Response> {
  const operationId = crypto.randomUUID();
  const start = performance.now();
  try {
    const response = await execute();
    console.info(JSON.stringify({ event: 'provider_operation', operation_id: operationId, operation: meta.operation, provider: 'gemini', model: meta.model, duration_ms: Math.round(performance.now() - start), status: response.ok ? 'success' : 'failed', http_status: response.status, error_code: response.ok ? null : 'upstream_http' }));
    const headers = new Headers(response.headers);
    headers.set('x-cortex-operation-id', operationId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.info(JSON.stringify({ event: 'provider_operation', operation_id: operationId, operation: meta.operation, provider: 'gemini', model: meta.model, duration_ms: Math.round(performance.now() - start), status: 'failed', error_code: error instanceof RequestError ? 'response_limit' : 'transport_or_timeout' }));
    throw new RequestError(`Não foi possível concluir a operação de IA. Tente novamente. Referência: ${operationId}`, 503);
  }
}
