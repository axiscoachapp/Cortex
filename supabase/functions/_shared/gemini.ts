/**
 * Shared Gemini API utilities for edge functions.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';

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
): Promise<{ text: string; usage: any }> {
  const body: any = {
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

  const res = await fetch(`${BASE_URL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const json = await res.json();
  const parts2: any[] = json.candidates?.[0]?.content?.parts ?? [];
  const responsePart = parts2.find((p: any) => !p.thought) ?? parts2[parts2.length - 1];
  return { text: responsePart?.text ?? '', usage: json.usageMetadata };
}

/** Upload audio to Gemini Files API via resumable upload — handles large files. */
export async function uploadToGeminiFiles(
  apiKey: string,
  audioBuffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const initRes = await fetch(
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
    const err = await initRes.text();
    throw new Error(`Gemini Files init error ${initRes.status}: ${err}`);
  }

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('Gemini Files API did not return an upload URL');

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(audioBuffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Blob([audioBuffer], { type: mimeType }),
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Gemini Files upload error ${uploadRes.status}: ${err}`);
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
  const res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType,
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.embedding?.values ?? [];
}

/** Embed many texts (documents). Batch first; on failure, sequential fallback. */
export async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  const res = await fetch(`${EMBED_BATCH_URL}?key=${apiKey}`, {
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
    return (json.embeddings ?? []).map((e: any) => e.values ?? []);
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
export function parseModelJson(raw: string): Record<string, any> | null {
  let s = (raw ?? '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(s); } catch { return null; }
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

export function buildPatientSummary(ctx: any, chiefComplaint: string): string {
  if (!ctx) return '';
  const diagnoses = ctx.diagnoses?.map((d: any) => `${d.code} ${d.description}`).join('; ') || 'Nenhum';
  const meds      = ctx.medications?.map((m: any) => `${m.name} ${m.dosage}`).join(', ')  || 'Nenhum';
  const allergies = ctx.allergies?.join(', ') || 'Nenhuma';
  return `Paciente: ${ctx.name}, ${ctx.age} anos\nDiagnósticos: ${diagnoses}\nMedicações: ${meds}\nAlergias: ${allergies}`;
}
