import { RequestError } from './errors.ts';
import { assertAiEnabled, observeProviderOperation, providerOperation } from './operationControls.ts';
export { RequestError } from './errors.ts';

/** Count actual bytes; Content-Length is optional and cannot enforce a limit. */
export async function readJsonObject(req: Request, maxBytes = 128 * 1024): Promise<Awaited<ReturnType<Request['json']>>> {
  if (!req.body) throw new RequestError('Envie um objeto JSON.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new RequestError('Solicitação muito grande.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError('Envie um objeto JSON válido.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError('Envie um objeto JSON.');
  return parsed;
}

/** The deadline includes reading the body, not only receiving headers. Buffering
 * is bounded so a stalled/oversized upstream cannot outlive the operation. */
export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 90_000, maxResponseBytes = 100 * 1024 * 1024): Promise<Response> {
  const operation = providerOperation(input, init);
  if (operation) {
    assertAiEnabled();
    return observeProviderOperation(operation, () => boundedFetch(input, init, timeoutMs, maxResponseBytes));
  }
  return boundedFetch(input, init, timeoutMs, maxResponseBytes);
}
async function boundedFetch(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, maxResponseBytes: number): Promise<Response> {
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  const cancel = () => controller.abort(init.signal?.reason ?? new Error('Solicitação cancelada.'));
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Tempo limite do serviço excedido. Tente novamente.')), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([fetch(input, { ...init, signal: controller.signal }), aborted]);
    if (!response.body) return response;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new RequestError('Resposta do serviço muito grande.', 502);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', abort);
    // A misbehaving stream's cancel promise must not hold up timeout delivery.
    if (reader) void reader.cancel().catch(() => {});
  }
}
