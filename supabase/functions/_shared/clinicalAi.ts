import { fetchWithDeadline, RequestError } from './http.ts';
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
  if (!key?.trim()) throw new RequestError('IA indisponível: conexão do servidor não configurada.', 503);
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

function reportedModel(value: unknown, requested: string): string | null {
  // Never log an arbitrary upstream string as "metadata".
  return typeof value === 'string' && (value === requested || (value.startsWith(requested + '-') && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(requested.length + 1)))) ? value : null;
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

function invalidOutput(response: Response, model: string): RequestError {
  const operationId = response.headers.get('x-cortex-operation-id') ?? crypto.randomUUID();
  console.info(JSON.stringify({ event: 'model_response_invalid', operation_id: operationId, operation: model === TEXT_MODEL ? 'generate' : 'transcribe', provider: 'openai', model, status: 'failed', error_code: 'incomplete_or_invalid_output' }));
  return new RequestError(`A IA retornou conteúdo incompleto ou inválido. Revise a origem e tente novamente. Referência: ${operationId}`, 502);
}
function logResult(response: Response, meta: AiMetadata, usage: OpenAiUsage | undefined): void {
  console.info(JSON.stringify({ event: 'model_response', operation_id: response.headers.get('x-cortex-operation-id'), ...meta, usage: usage ?? null }));
}
async function request(endpoint: 'responses' | 'audio/transcriptions', apiKey: string, body: string | FormData): Promise<Response> {
  assertKey(apiKey);
  const response = await fetchWithDeadline(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
    body,
    redirect: 'error',
  }, 90_000, 2 * 1024 * 1024);
  if (!response.ok) {
    const operationId = response.headers.get('x-cortex-operation-id') ?? crypto.randomUUID();
    throw new RequestError(`Não foi possível concluir a operação de IA. Tente novamente. Referência: ${operationId}`, response.status === 429 ? 429 : 503);
  }
  return response;
}

export async function callClinicalText(apiKey: string, parts: TextPart[], options: TextOptions = {}): Promise<AiResult> {
  assertKey(apiKey);
  assertPromptSize(parts.map(part => 'text' in part ? part.text : '').join(''), options.systemInstruction ?? '');
  const limit = options.maxOutputTokens ?? 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32768) throw new RequestError('Limite de saída da IA inválido.');
  const body = {
    model: TEXT_MODEL, store: false, reasoning: { effort: 'none' }, max_output_tokens: limit,
    ...(options.systemInstruction ? { instructions: options.systemInstruction } : {}),
    input: [{ role: 'user', content: textInput(parts) }],
    ...(options.responseSchema ? { text: { format: { type: 'json_schema', name: 'clinical_result', strict: true, schema: strictSchema(options.responseSchema) } } } : {}),
  };
  const response = await request('responses', apiKey, JSON.stringify(body));
  let result: AiResult;
  try {
    const json: unknown = await response.json();
    if (!isRecord(json) || json.status !== 'completed' || json.error || json.incomplete_details || !Array.isArray(json.output)) throw new Error();
    if (json.model != null && !reportedModel(json.model, TEXT_MODEL)) throw new Error();
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
export async function transcribeClinicalAudio(apiKey: string, blob: Blob, suppliedMime: string): Promise<AiResult> {
  assertKey(apiKey);
  const mime = suppliedMime.split(';')[0].trim().toLowerCase();
  const extension = audioFormats[mime];
  if (!extension) throw new RequestError('Formato de áudio não suportado.', 415);
  if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new RequestError('Áudio vazio ou acima de 25 MB. Divida a gravação antes de processar.', 413);
  const form = new FormData();
  form.set('file', new Blob([blob], { type: mime }), `consultation.${extension}`);
  form.set('model', TRANSCRIPTION_MODEL);
  form.set('languages[]', 'pt');
  // Context only, not instructions or invented names/medications.
  form.set('prompt', 'Consulta médica em português brasileiro.');
  const response = await request('audio/transcriptions', apiKey, form);
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
