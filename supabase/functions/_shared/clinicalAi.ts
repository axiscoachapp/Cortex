import { AI_UNAVAILABLE_MESSAGE, fetchWithDeadline, RequestError } from './http.ts';
import { assertAiEnabled } from './operationControls.ts';
import { assertPromptSize, isRecord } from './modelInput.ts';
import type { ModelSchema } from './gemini.ts';

export const TEXT_MODEL = 'gpt-6.1-terra';
export const TRANSCRIPTION_MODEL = 'gpt-transcribe';
const ADAPTER_VERSION = 'openai-initial-2026-11-10';
const BASE_URL = 'https://api.openai.com/v1';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export type OpenAiUsage =
  | { provider: 'openai'; model: typeof TEXT_MODEL; inputTokens: number; outputTokens: number }
  | { provider: 'openai'; model: typeof TRANSCRIPTION_MODEL; durationSeconds: number };
export interface AiMetadata {
  provider: 'openai';
  requestedModel: string;
  effectiveModel: string | null;
  adapterVersion: string;
  usageStatus: 'reported' | 'unavailable';
  diarization?: 'unavailable';
}
interface AiResult { text: string; usage: OpenAiUsage | undefined; metadata: AiMetadata }
type TextPart = { text: string } | { document: { data: Uint8Array; mimeType: string } };
interface TextOptions {
  systemInstruction?: string;
  maxOutputTokens?: number;
  responseSchema?: ModelSchema;
  /** Deadline for this call, including the response body. Default 90 s. */
  timeoutMs?: number;
}
interface AudioOptions { timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_MS = 150_000;

/** How a failed call stands with the provider's bill, so the caller can settle its reservation:
 * - `none`: the request was never sent, or the provider answered non-2xx (no work billed);
 * - `reserved`: the provider answered 2xx but the output is unusable and its usage is unknown, so
 *   the reservation stays charged (contract: missing usage never becomes zero cost).
 * Transport failures and timeouts are not AiProviderError: their cost is unknown. */
export class AiProviderError extends RequestError {
  constructor(message: string, status: number, readonly billing: 'none' | 'reserved', readonly retryable: boolean) {
    super(message, status);
    this.name = 'AiProviderError';
  }
}
/** Anything thrown before the request is sent is not billed. */
function unsent(error: unknown): never {
  if (error instanceof AiProviderError || !(error instanceof RequestError)) throw error;
  throw new AiProviderError(error.message, error.status, 'none', false);
}

/** Saving a key never activates a provider. Called again at the HTTP boundary. */
export function assertOpenAiEnabled(): void {
  assertAiEnabled();
  const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
  if (runtime.Deno?.env.get('AI_PROVIDER') !== 'openai')
    throw new RequestError('IA indisponível: integração OpenAI ainda não ativada. O registro manual permanece disponível.', 503);
}

function assertKey(key: string): void {
  assertOpenAiEnabled();
  if (!key?.trim()) throw new RequestError(AI_UNAVAILABLE_MESSAGE, 503);
}

function strictSchema(schema: ModelSchema): ModelSchema & { additionalProperties?: false } {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, strictSchema(child)]));
    return { ...schema, properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (schema.type === 'array') return { ...schema, items: strictSchema(schema.items ?? {}) };
  return { ...schema };
}

function validSchema(value: unknown, schema: ModelSchema): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value) && value.every(item => validSchema(item, schema.items ?? {}));
    case 'object': return isRecord(value)
      && Object.keys(value).every(key => Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key))
      && Object.entries(schema.properties ?? {}).every(([key, rule]) => Object.prototype.hasOwnProperty.call(value, key) && validSchema(value[key], rule));
    default: return false;
  }
}

function dataUrl(data: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

function textInput(parts: TextPart[]): object[] {
  let totalBytes = 0;
  return parts.map(part => {
    if ('text' in part && typeof part.text === 'string') return { type: 'input_text', text: part.text };
    if (!('document' in part)) throw new RequestError('Entrada de IA inválida.');
    const { data, mimeType } = part.document;
    totalBytes += data.byteLength;
    if (!data.byteLength || totalBytes > MAX_DOCUMENT_BYTES) throw new RequestError('Anexo vazio ou acima de 15 MB.', 413);
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType))
      throw new RequestError('Formato de anexo não suportado para análise.', 415);
    const url = dataUrl(data, mimeType);
    return mimeType === 'application/pdf'
      ? { type: 'input_file', filename: 'document.pdf', file_data: url }
      : { type: 'input_image', image_url: url };
  });
}

/** The requested model or a snapshot of it (`<requested>-<anything>`): a naming change on the
 * provider's side must not throw away a completed, paid answer. Any other model is a substitution. */
function sameModel(value: unknown, requested: string): boolean {
  return typeof value === 'string' && (value === requested || value.startsWith(requested + '-'));
}
function reportedModel(value: unknown, requested: string): string | null {
  // Recorded as reported, but never an arbitrary upstream string in logs or metadata.
  return sameModel(value, requested) && /^[A-Za-z0-9._:-]{1,96}$/.test(value as string) ? value as string : null;
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function textUsage(value: unknown): OpenAiUsage | undefined {
  if (!isRecord(value) || !count(value.input_tokens) || !count(value.output_tokens)) return undefined;
  // output_tokens already includes reasoning tokens. Never add those again.
  return { provider: 'openai', model: TEXT_MODEL, inputTokens: value.input_tokens, outputTokens: value.output_tokens };
}
function audioUsage(value: unknown): OpenAiUsage | undefined {
  if (!isRecord(value) || value.type !== 'duration' || typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || value.seconds < 0) return undefined;
  return { provider: 'openai', model: TRANSCRIPTION_MODEL, durationSeconds: value.seconds };
}
function metadata(model: string, effective: unknown, usage: OpenAiUsage | undefined): AiMetadata {
  return { provider: 'openai', requestedModel: model, effectiveModel: reportedModel(effective, model), adapterVersion: ADAPTER_VERSION, usageStatus: usage ? 'reported' : 'unavailable' };
}

function invalidOutput(response: Response, model: string): AiProviderError {
  const operationId = response.headers.get('x-cortex-operation-id') ?? crypto.randomUUID();
  console.info(JSON.stringify({ event: 'model_response_invalid', operation_id: operationId, operation: model === TEXT_MODEL ? 'generate' : 'transcribe', provider: 'openai', model, status: 'failed', error_code: 'incomplete_or_invalid_output' }));
  return new AiProviderError(`A IA retornou conteúdo incompleto ou inválido. Revise a origem e tente novamente. Referência: ${operationId}`, 502, 'reserved', true);
}

/** Only short identifier-like provider codes are logged; never the provider's message. */
const providerToken = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;

type RequestKind = 'text' | 'document' | 'audio';
/** A non-2xx answer: 429 and 5xx can be retried; any other 4xx cannot, so the doctor is told what
 * is wrong instead of being asked to retry something that will fail again. */
async function providerFailure(response: Response, endpoint: string, kind: RequestKind): Promise<AiProviderError> {
  const operationId = response.headers.get('x-cortex-operation-id') ?? crypto.randomUUID();
  let code: string | null = null;
  let type: string | null = null;
  try {
    const body: unknown = JSON.parse(await response.text());
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    code = providerToken(error?.code);
    type = providerToken(error?.type);
  } catch { /* An unreadable error body still has a status. */ }
  const status = response.status;
  console.info(JSON.stringify({ event: 'model_request_failed', operation_id: operationId, operation: endpoint === 'responses' ? 'generate' : 'transcribe', provider: 'openai', model: endpoint === 'responses' ? TEXT_MODEL : TRANSCRIPTION_MODEL, http_status: status, error_code: code, error_type: type }));
  const ref = ` Referência: ${operationId}`;
  const hint = `${code ?? ''} ${type ?? ''}`.toLowerCase();
  if (status === 429 && !/insufficient_quota|billing/.test(hint))
    return new AiProviderError(`A IA está recebendo muitas solicitações agora. Aguarde um minuto e tente novamente.${ref}`, 429, 'none', true);
  if (status >= 500)
    return new AiProviderError(`Não foi possível concluir a operação de IA. Tente novamente em instantes.${ref}`, 503, 'none', true);
  if ([400, 413, 415, 422].includes(status)) {
    if (kind === 'audio') {
      if (status === 413 || /too_long|duration|too_large|size|limit/.test(hint))
        return new AiProviderError(`A gravação é longa demais para a IA processar de uma vez. O áudio continua salvo: registre a consulta manualmente.${ref}`, 413, 'none', false);
      return new AiProviderError(`A IA não aceitou este áudio (formato não suportado ou arquivo inválido). O áudio continua salvo: registre a consulta manualmente.${ref}`, 422, 'none', false);
    }
    if (status === 413 || /context_length|too_large|too_long|max_length|tokens/.test(hint))
      return new AiProviderError(`O conteúdo enviado é grande demais para a IA. Reduza o texto e tente novamente, ou registre manualmente.${ref}`, 413, 'none', false);
    if (kind === 'document')
      return new AiProviderError(`A IA não conseguiu ler este documento (formato ou conteúdo não aceito). Revise o arquivo manualmente.${ref}`, 422, 'none', false);
  }
  // 401/403 (key), 404 (model), insufficient_quota and malformed requests: nothing the doctor can retry.
  return new AiProviderError(`${AI_UNAVAILABLE_MESSAGE}${ref}`, 503, 'none', false);
}
function logResult(response: Response, meta: AiMetadata, usage: OpenAiUsage | undefined): void {
  console.info(JSON.stringify({ event: 'model_response', operation_id: response.headers.get('x-cortex-operation-id'), ...meta, usage: usage ?? null }));
}
async function request(endpoint: 'responses' | 'audio/transcriptions', apiKey: string, body: string | FormData, kind: RequestKind, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  try { assertKey(apiKey); } catch (error) { unsent(error); }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) throw new AiProviderError('Prazo da operação de IA inválido.', 400, 'none', false);
  const response = await fetchWithDeadline(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
    body,
    redirect: 'error',
  }, timeoutMs, 2 * 1024 * 1024);
  if (!response.ok) throw await providerFailure(response, endpoint, kind);
  return response;
}

export async function callClinicalText(apiKey: string, parts: TextPart[], options: TextOptions = {}): Promise<AiResult> {
  let body: object;
  try {
    assertKey(apiKey);
    assertPromptSize(parts.map(part => 'text' in part ? part.text : '').join(''), options.systemInstruction ?? '');
    const limit = options.maxOutputTokens ?? 1024;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32768) throw new RequestError('Limite de saída da IA inválido.');
    body = {
      model: TEXT_MODEL, store: false, reasoning: { effort: 'none' }, max_output_tokens: limit,
      ...(options.systemInstruction ? { instructions: options.systemInstruction } : {}),
      input: [{ role: 'user', content: textInput(parts) }],
      ...(options.responseSchema ? { text: { format: { type: 'json_schema', name: 'clinical_result', strict: true, schema: strictSchema(options.responseSchema) } } } : {}),
    };
  } catch (error) { unsent(error); }
  const kind: RequestKind = parts.some(part => 'document' in part) ? 'document' : 'text';
  const response = await request('responses', apiKey, JSON.stringify(body), kind, options.timeoutMs);
  let result: AiResult;
  try {
    const json: unknown = await response.json();
    if (!isRecord(json) || json.status !== 'completed' || json.error || json.incomplete_details || !Array.isArray(json.output)) throw new Error();
    if (json.model != null && !sameModel(json.model, TEXT_MODEL)) throw new Error();
    let text = '';
    for (const item of json.output) {
      if (!isRecord(item)) throw new Error();
      // Reasoning items are deliberately ignored; they are never clinical text.
      if (item.type === 'reasoning') continue;
      if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) throw new Error();
      for (const content of item.content) {
        if (!isRecord(content) || content.type !== 'output_text' || typeof content.text !== 'string') throw new Error();
        text += content.text;
      }
    }
    if (!text.trim()) throw new Error();
    if (options.responseSchema && !validSchema(JSON.parse(text), options.responseSchema)) throw new Error();
    const usage = textUsage(json.usage);
    result = { text, usage, metadata: metadata(TEXT_MODEL, json.model, usage) };
  } catch { throw invalidOutput(response, TEXT_MODEL); }
  logResult(response, result.metadata, result.usage);
  return result;
}

const audioFormats: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' };
export async function transcribeClinicalAudio(apiKey: string, blob: Blob, suppliedMime: string, options: AudioOptions = {}): Promise<AiResult> {
  try { assertKey(apiKey); } catch (error) { unsent(error); }
  const mime = suppliedMime.split(';')[0].trim().toLowerCase();
  const extension = audioFormats[mime];
  if (!extension) throw new AiProviderError('Formato de áudio não suportado.', 415, 'none', false);
  if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new AiProviderError('Áudio vazio ou acima de 25 MB. O áudio continua salvo: registre a consulta manualmente.', 413, 'none', false);
  const form = new FormData();
  form.set('file', new Blob([blob], { type: mime }), `consultation.${extension}`);
  form.set('model', TRANSCRIPTION_MODEL);
  form.set('languages[]', 'pt');
  // Context only, not instructions or invented names/medications.
  form.set('prompt', 'Consulta médica em português brasileiro.');
  const response = await request('audio/transcriptions', apiKey, form, 'audio', options.timeoutMs);
  let result: AiResult;
  try {
    const json: unknown = await response.json();
    if (!isRecord(json) || typeof json.text !== 'string' || json.error) throw new Error();
    const usage = audioUsage(json.usage);
    result = { text: json.text, usage, metadata: { ...metadata(TRANSCRIPTION_MODEL, json.model, usage), diarization: 'unavailable' } };
  } catch { throw invalidOutput(response, TRANSCRIPTION_MODEL); }
  logResult(response, result.metadata, result.usage);
  return result;
}
