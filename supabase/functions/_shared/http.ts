export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

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

export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 90_000): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Tempo limite do serviço excedido. Tente novamente.')), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
}
