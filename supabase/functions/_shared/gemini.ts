/**
 * Shared Gemini API utilities for edge functions.
 */
import { fetchWithDeadline } from './http.ts';
import { assertPromptSize, isRecord } from './modelInput.ts';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';
export interface GeminiUsage {
  promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number;
  promptTokensDetails?: Array<{ modality: string; tokenCount: number }>;
}
interface GeminiResponse { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ thought?: boolean; text?: string }> } }>; promptFeedback?: { blockReason?: string }; usageMetadata?: GeminiUsage }
export interface ModelSchema { type?: string; enum?: unknown[]; required?: string[]; properties?: Record<string, ModelSchema>; items?: ModelSchema }

interface GeminiConfig {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  responseMimeType?: string;
  responseSchema?: object;
}

export async function callGemini(
  apiKey: string,
  parts: object[],
  cfg: GeminiConfig = {},
): Promise<{ text: string; usage: GeminiUsage | undefined }> {
  assertGeminiTextBudget(parts, cfg.systemInstruction);
  const body: { contents: Array<{ parts: object[] }>; generationConfig: Record<string, unknown>; systemInstruction?: { parts: Array<{ text: string }> } } = {
    contents: [{ parts }],
    generationConfig: {
      temperature: cfg.temperature ?? 0.2,
      maxOutputTokens: cfg.maxOutputTokens ?? 1024,
    },
  };

  if (cfg.systemInstruction) {
    body.systemInstruction = { parts: [{ text: cfg.systemInstruction }] };
  }
  if (cfg.responseMimeType) body.generationConfig.responseMimeType = cfg.responseMimeType;
  if (cfg.responseSchema)   body.generationConfig.responseSchema   = cfg.responseSchema;
  if (cfg.thinkingBudget !== undefined) {
    body.generationConfig.thinkingConfig = { thinkingBudget: cfg.thinkingBudget };
  }

  const res = await fetchWithDeadline(`${BASE_URL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Falha no provedor de IA (${res.status}). Tente novamente.`);
  }

  const json = await res.json() as GeminiResponse;
  return { text: requireCompleteModelText(json), usage: json.usageMetadata };
}

/** Run before reserving credits; callGemini repeats it as a final boundary. */
export function assertGeminiTextBudget(parts: object[], systemInstruction = ''): void {
  const text = parts.map(part => 'text' in part && typeof part.text === 'string' ? part.text : '').join('');
  assertPromptSize(text, systemInstruction);
}

/** https://ai.google.dev/api/generate-content#FinishReason */
export function requireCompleteModelText(value: unknown): string {
  if (!isRecord(value)) throw new Error('Resposta do provedor inválida.');
  const json = value as GeminiResponse;
  const candidate = json.candidates?.[0];
  if (json.promptFeedback?.blockReason || candidate?.finishReason !== 'STOP') {
    throw new Error('A IA não concluiu a geração. Tente novamente.');
  }
  const text = (candidate.content?.parts ?? [])
    .filter(part => !part.thought && typeof part.text === 'string')
    .map(part => part.text).join('');
  if (!text.trim()) throw new Error('A IA retornou conteúdo vazio. Tente novamente.');
  return text;
}

/** Upload audio to Gemini Files API via resumable upload — handles large files. */
export async function uploadToGeminiFiles(
  apiKey: string,
  audioBuffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const initRes = await fetchWithDeadline(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'X-Goog-Upload-Header-Content-Length': String(audioBuffer.byteLength),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'consultation-audio' } }),
    },
  );

  if (!initRes.ok) {
    throw new Error(`Falha ao preparar envio de áudio (${initRes.status}).`);
  }

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('Gemini Files API did not return an upload URL');

  const uploadRes = await fetchWithDeadline(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(audioBuffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Blob([audioBuffer], { type: mimeType }),
  });

  if (!uploadRes.ok) {
    throw new Error(`Falha ao enviar áudio (${uploadRes.status}).`);
  }

  const fileInfo = await uploadRes.json();
  const fileUri = fileInfo.file?.uri;
  if (!fileUri) throw new Error('Gemini Files API did not return a file URI');
  return fileUri;
}

// gemini-embedding-001 is the current embedding model; 768-dim output matches
// the vector(768) column (cosine distance, so no magnitude normalization needed).
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
const EMBED_BATCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;

/** Embed a single text → 768-dim vector. */
export async function embedText(apiKey: string, text: string, taskType = 'RETRIEVAL_QUERY'): Promise<number[]> {
  const res = await fetchWithDeadline(`${EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType,
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!res.ok) throw new Error(`Falha ao indexar documento (${res.status}).`);
  const json = await res.json();
  return json.embedding?.values ?? [];
}

/** Embed many texts (documents). Batch first; on failure, sequential fallback. */
export async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  const res = await fetchWithDeadline(`${EMBED_BATCH_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(t => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t.slice(0, 8000) }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBED_DIM,
      })),
    }),
  });
  if (res.ok) {
    const json = await res.json();
    return (json.embeddings ?? []).map((e: { values?: number[] }) => e.values ?? []);
  }
  // Fallback: some models/regions don't expose batchEmbedContents — embed one by one.
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await embedText(apiKey, t, 'RETRIEVAL_DOCUMENT'));
  }
  return out;
}

/** Split text into ~overlapping chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = (text ?? '').replace(/\r\n/g, '\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      // Prefer to break at a paragraph or sentence boundary within the window.
      const slice = clean.slice(i, end);
      const brk = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
      if (brk > size * 0.5) end = i + brk + 1;
    }
    const chunk = clean.slice(i, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    i = end - overlap;
  }
  return chunks;
}

/** Tolerant parse of a model JSON response: strips ```json fences and parses.
 *  Returns null on failure so the caller can salvage individual fields. */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  let s = (raw ?? '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/** Validate provider output in code; the provider's schema hint is not a boundary. */
export function parseModelObject<T extends object = Record<string, unknown>>(raw: string, schema: ModelSchema): T {
  const parsed = parseModelJson(raw);
  const check = (value: unknown, rule: ModelSchema): boolean => {
    if (rule.enum && !rule.enum.includes(value)) return false;
    if (rule.type === 'string') return typeof value === 'string';
    if (rule.type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (rule.type === 'integer') return Number.isInteger(value);
    if (rule.type === 'boolean') return typeof value === 'boolean';
    if (rule.type === 'array') return Array.isArray(value) && value.every(item => check(item, rule.items ?? {}));
    if (rule.type === 'object') return isRecord(value)
      && (rule.required ?? []).every((key: string) => Object.prototype.hasOwnProperty.call(value, key))
      && Object.entries(rule.properties ?? {}).every(([key, child]) => value[key] === undefined || check(value[key], child));
    return true;
  };
  if (!parsed || !check(parsed, schema)) throw new Error('Resposta clínica incompleta ou inválida. Revise o conteúdo e tente novamente.');
  return parsed as T;
}

/** Extract a top-level JSON string field even from TRUNCATED output (e.g. the
 *  model hit maxOutputTokens mid-string, leaving invalid JSON). Prevents the
 *  raw JSON envelope from leaking into the document shown to the doctor. */
export function salvageJsonString(raw: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 'i');
  const m = (raw ?? '').match(re);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    // Unterminated capture — unescape best-effort.
    return m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/** Collapse pathological blank-line runs the model sometimes emits as padding. */
export function collapseBlankLines(s: string): string {
  return (s ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildPatientSummary(ctx: unknown, _chiefComplaint: string): string {
  if (!isRecord(ctx)) return '';
  const summarize = (value: unknown, fields: string[]) => Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item : isRecord(item) ? fields.map(field => typeof item[field] === 'string' ? item[field] : '').filter(Boolean).join(' ') : '').filter(Boolean).join('; ') : '';
  const diagnoses = summarize(ctx.diagnoses, ['code','description']) || 'Nenhum registrado';
  const meds = summarize(ctx.medications, ['name','dosage']) || 'Nenhuma registrada';
  const allergies = (Array.isArray(ctx.allergies) ? ctx.allergies.filter(item => typeof item === 'string').join(', ') : '') || 'Não registradas';
  return `Paciente: ${ctx.name}, ${ctx.age} anos\nDiagnósticos: ${diagnoses}\nMedicações: ${meds}\nAlergias: ${allergies}`;
}
