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

export function buildPatientSummary(ctx: any, chiefComplaint: string): string {
  if (!ctx) return '';
  const diagnoses = ctx.diagnoses?.map((d: any) => `${d.code} ${d.description}`).join('; ') || 'Nenhum';
  const meds      = ctx.medications?.map((m: any) => `${m.name} ${m.dosage}`).join(', ')  || 'Nenhum';
  const allergies = ctx.allergies?.join(', ') || 'Nenhuma';
  return `Paciente: ${ctx.name}, ${ctx.age} anos\nDiagnósticos: ${diagnoses}\nMedicações: ${meds}\nAlergias: ${allergies}`;
}
