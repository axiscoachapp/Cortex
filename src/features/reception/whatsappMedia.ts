// Received media of a WhatsApp conversation, through the server's `media` action
// (docs/product/whatsapp/CONTRATO.md). The server authorizes the reader, fetches the file from
// Meta with the clinic's token and answers the bytes as an attachment; nothing is cached here.
//
// The answer is binary, which `functions.invoke` would decode as text for most media types, so
// this adapter posts to the same function with the session's access token and reads a Blob.
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { validateSupabaseEnvironment } from '@/integrations/supabase/environment';

const uuid = z.string().uuid().toLowerCase();
/** Same rule the server applies before answering (anything else becomes octet-stream there). */
const mimePattern = /^[a-z]+\/[a-z0-9.+-]+$/i;
/** WhatsApp caps documents at 100 MB; a larger answer is not a file this channel sends. */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

export type WhatsAppMediaFile = { blob: Blob; mime: string };
export class WhatsAppMediaError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'WhatsAppMediaError'; }
}
const messages: Record<string, string> = {
  not_found: 'Este arquivo não está mais disponível no WhatsApp.',
  forbidden: 'Você não tem acesso a esta conversa.',
  not_connected: 'O WhatsApp da clínica não está conectado. Avise o administrador da clínica.',
  server_not_ready: 'O WhatsApp está indisponível no momento. Avise o administrador da clínica.',
  token_unreadable: 'O WhatsApp está indisponível no momento. Avise o administrador da clínica.',
  invalid: 'Não foi possível abrir este arquivo.',
  graph: 'O WhatsApp não entregou o arquivo agora. Tente de novo em instantes.',
  unavailable: 'Não foi possível baixar o arquivo. Verifique a conexão e tente de novo.',
  too_large: 'O arquivo é grande demais para abrir aqui.',
  cancelled: 'O download foi cancelado.',
};
const failure = (code: string) => new WhatsAppMediaError(messages[code] ?? messages.unavailable, Object.prototype.hasOwnProperty.call(messages, code) ? code : 'unavailable');

function endpoint() {
  const environment = validateSupabaseEnvironment(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  return { url: `${environment.url}/functions/v1/whatsapp-api`, key: environment.key };
}

/** Downloads one received file. The message must belong to a conversation the person can read. */
export async function downloadWhatsAppMedia(messageId: string, signal?: AbortSignal): Promise<WhatsAppMediaFile> {
  const id = uuid.safeParse(messageId);
  if (!id.success) throw failure('invalid');
  if (signal?.aborted) throw failure('cancelled');
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw failure('forbidden');
  if (signal?.aborted) throw failure('cancelled');
  let response: Response;
  try {
    const { url, key } = endpoint();
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'media', messageId: id.data }),
      signal,
    });
  } catch {
    throw failure(signal?.aborted ? 'cancelled' : 'unavailable');
  }
  if (!response.ok) {
    let code = 'unavailable';
    try {
      const body = await response.json() as { code?: unknown };
      if (typeof body?.code === 'string') code = body.code.startsWith('graph') ? 'graph' : body.code;
    } catch { /* not JSON: keep the generic message */ }
    throw failure(signal?.aborted ? 'cancelled' : code);
  }
  const mime = (response.headers.get('Content-Type') ?? '').split(';')[0].trim();
  // Only CORS-safelisted headers are readable cross-origin: the type is, the disposition is not.
  if (!mimePattern.test(mime) || mime.toLowerCase() === 'application/json') throw failure('unavailable');
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES) throw failure('too_large');
  let blob: Blob;
  try { blob = await response.blob(); } catch { throw failure(signal?.aborted ? 'cancelled' : 'unavailable'); }
  if (signal?.aborted) throw failure('cancelled');
  if (blob.size === 0) throw failure('not_found');
  if (blob.size > MEDIA_MAX_BYTES) throw failure('too_large');
  return { blob: blob.type === mime ? blob : new Blob([blob], { type: mime }), mime: mime.toLowerCase() };
}

/** Types the browser shows inside the conversation; everything else is only downloaded. */
export function previewKind(mime: string): 'image' | 'audio' | 'video' | null {
  const value = mime.toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(value)) return 'image';
  if (/^audio\/(ogg|mpeg|mp4|aac|amr|wav|webm)$/.test(value)) return 'audio';
  if (/^video\/(mp4|3gpp|webm)$/.test(value)) return 'video';
  return null;
}

/** A safe file name for the download: the sender's name when it has one, otherwise by type. */
export function mediaFileName(filename: string | null, mime: string, kind: string): string {
  const cleaned = Array.from(filename ?? '', char => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char)).join('').trim().slice(0, 120);
  if (cleaned) return cleaned;
  const extension = mime.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const base = { image: 'imagem', audio: 'audio', video: 'video', document: 'documento', sticker: 'figurinha' }[kind] ?? 'arquivo';
  return `${base}-whatsapp.${extension}`;
}
