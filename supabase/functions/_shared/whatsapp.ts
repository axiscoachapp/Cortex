// WhatsApp Business Platform (Cloud API) helpers: webhook signature, payload parsing and the Graph
// client. Pure and runtime-neutral (Deno and the Vitest suite). Contract: docs/product/whatsapp/CONTRATO.md.
// Never log tokens, message bodies or phone numbers.

export const DEFAULT_GRAPH_VERSION = 'v24.0';
const GRAPH = 'https://graph.facebook.com';

export type InboundKind =
  | 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts'
  | 'interactive' | 'button' | 'reaction' | 'unsupported';

export interface InboundMessage {
  phoneNumberId: string;
  /** Phone digits; Meta may omit it for people who use a WhatsApp username. */
  waId: string | null;
  /** Business-scoped user id (BSUID), e.g. "BR.1349…"; always sent by Meta since 2026. */
  userId: string | null;
  profileName: string;
  /** wamid of the message this one replies to (template quick replies). */
  contextWamid: string | null;
  wamid: string;
  kind: InboundKind;
  body: string;
  media: { id: string; mime: string; filename?: string; sha256?: string; voice?: boolean } | null;
  providerAt: string | null;
}

export interface IdentityChange {
  phoneNumberId: string;
  wamid: string;
  kind: 'user_changed_number' | 'user_changed_user_id';
  previousUserId: string | null;
  userId: string | null;
  waId: string | null;
  at: string | null;
}

export interface StatusUpdate {
  phoneNumberId: string;
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: string | null;
  error: string | null;
}

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

/** Constant-time check of Meta's X-Hub-Signature-256 header over the raw body. */
export async function validSignature(appSecret: string, rawBody: Uint8Array, header: string | null): Promise<boolean> {
  if (!appSecret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, rawBody as BufferSource));
  const given = header.slice(7).toLowerCase();
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '');
type Obj = Record<string, unknown>;
/** Untrusted JSON is read field by field: anything that is not an object becomes {}. */
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const DIGITS = /^[0-9]{5,30}$/;
const WA_ID = /^[0-9]{8,15}$/;
const BSUID = /^[A-Z]{2}\.[A-Za-z0-9.]{1,160}$/;
const phoneOrNull = (v: unknown) => (WA_ID.test(str(v, 20)) ? str(v, 20) : null);
const bsuidOrNull = (v: unknown) => (BSUID.test(str(v, 170)) ? str(v, 170) : null);
const isoFromUnix = (v: unknown): string | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

function mediaOf(value: unknown): InboundMessage['media'] {
  const part = obj(value);
  if (typeof part.id !== 'string') return null;
  return {
    id: str(part.id, 128),
    mime: str(part.mime_type, 120),
    ...(part.filename ? { filename: str(part.filename, 240) } : {}),
    ...(part.sha256 ? { sha256: str(part.sha256, 128) } : {}),
    ...(part.voice ? { voice: true } : {}),
  };
}

function inboundOf(m: Obj): Pick<InboundMessage, 'kind' | 'body' | 'media'> {
  const type = str(m.type, 40);
  switch (type) {
    case 'text': return { kind: 'text', body: str(obj(m.text).body), media: null };
    case 'image': case 'video': case 'document': case 'audio': case 'sticker':
      return { kind: type, body: str(obj(m[type]).caption), media: mediaOf(m[type]) };
    case 'location': {
      const l = obj(m.location);
      const label = [str(l.name, 200), str(l.address, 300)].filter(Boolean).join(' — ');
      return { kind: 'location', body: label || `${String(l.latitude ?? '')},${String(l.longitude ?? '')}`.slice(0, 80), media: null };
    }
    case 'contacts': {
      const names = arr(m.contacts).map((c) => str(obj(obj(c).name).formatted_name, 120)).filter(Boolean);
      return { kind: 'contacts', body: names.join(', '), media: null };
    }
    case 'interactive': {
      const i = obj(m.interactive);
      const r = obj(i.button_reply ?? i.list_reply);
      return { kind: 'interactive', body: str(r.title, 200), media: null };
    }
    case 'button': {
      const b = obj(m.button);
      return { kind: 'button', body: str(b.text ?? b.payload, 200), media: null };
    }
    case 'reaction': return { kind: 'reaction', body: str(obj(m.reaction).emoji, 16), media: null };
    default: return { kind: 'unsupported', body: '', media: null };
  }
}

/** Messages and delivery receipts in a webhook delivery. Malformed parts are skipped, never thrown. */
export function parseWebhook(payload: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[]; identityChanges: IdentityChange[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const identityChanges: IdentityChange[] = [];
  const p = obj(payload);
  if (p.object !== 'whatsapp_business_account') return { messages, statuses, identityChanges };
  for (const entry of arr(p.entry)) {
    for (const rawChange of arr(obj(entry).changes)) {
      const change = obj(rawChange);
      if (change.field !== 'messages') continue;
      const v = obj(change.value);
      const phoneNumberId = str(obj(v.metadata).phone_number_id, 40);
      if (!DIGITS.test(phoneNumberId)) continue;
      const names = new Map<string, string>();
      for (const rawContact of arr(v.contacts)) {
        const c = obj(rawContact);
        const name = str(obj(c.profile).name, 200);
        const phone = phoneOrNull(c.wa_id);
        const user = bsuidOrNull(c.user_id);
        if (phone) names.set(phone, name);
        if (user) names.set(user, name);
      }
      for (const rawMessage of arr(v.messages)) {
        const m = obj(rawMessage);
        const wamid = str(m.id, 256);
        if (wamid.length < 8) continue;
        if (m.type === 'system') {
          const sys = obj(m.system);
          if (sys.type === 'user_changed_number' || sys.type === 'user_changed_user_id')
            identityChanges.push({
              phoneNumberId, wamid, kind: sys.type, previousUserId: bsuidOrNull(sys.previous_user_id), userId: bsuidOrNull(sys.user_id),
              waId: phoneOrNull(sys.wa_id ?? m.from), at: isoFromUnix(m.timestamp),
            });
          continue;
        }
        const waId = phoneOrNull(m.from);
        const userId = bsuidOrNull(m.from_user_id);
        if (!waId && !userId) continue;
        const contextWamid = str(obj(m.context).id, 256);
        messages.push({
          phoneNumberId, waId, userId, profileName: names.get(userId ?? '') ?? names.get(waId ?? '') ?? '', wamid,
          contextWamid: contextWamid.length >= 8 ? contextWamid : null, providerAt: isoFromUnix(m.timestamp), ...inboundOf(m),
        });
      }
      for (const rawStatus of arr(v.statuses)) {
        const s = obj(rawStatus);
        const wamid = str(s.id, 256);
        const status = s.status;
        if (wamid.length < 8 || (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed')) continue;
        const first = obj(arr(s.errors)[0]);
        const err = Object.keys(first).length ? `${String(first.code ?? '')} ${str(first.title, 200)}`.trim() : null;
        statuses.push({ phoneNumberId, wamid, status, at: isoFromUnix(s.timestamp), error: err });
      }
    }
  }
  return { messages, statuses, identityChanges };
}

/** Free text is allowed only within 24 hours of the person's last message. */
export function windowOpenUntil(lastInboundAt: string | null): string | null {
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) ? new Date(t + 24 * 3600 * 1000).toISOString() : null;
}

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null) {
    super(message);
  }
}

export interface GraphClient {
  phoneNumber(phoneNumberId: string, token: string): Promise<{ displayPhone: string; verifiedName: string; quality: string | null }>;
  wabaPhoneNumbers(wabaId: string, token: string): Promise<string[]>;
  subscribeApp(wabaId: string, token: string): Promise<void>;
  register(phoneNumberId: string, token: string, pin: string): Promise<void>;
  templates(wabaId: string, token: string): Promise<Array<{ name: string; language: string; category: string; status: string; body: string; paramCount: number }>>;
  send(phoneNumberId: string, token: string, message: Record<string, unknown>): Promise<string>;
  markRead(phoneNumberId: string, token: string, wamid: string): Promise<void>;
  media(mediaId: string, token: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export function graphClient(fetchImpl: typeof fetch, version = DEFAULT_GRAPH_VERSION): GraphClient {
  if (!/^v[0-9]{2}\.0$/.test(version)) throw new Error('Versão da Graph API inválida.');
  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const res = await fetchImpl(`${GRAPH}/${version}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const body = obj(parsed);
    if (!res.ok || body.error) {
      const code = obj(body.error).code;
      const numeric = typeof code === 'number' ? code : null;
      throw new GraphError(graphMessage(numeric, res.status), res.status, numeric);
    }
    return body;
  };
  return {
    async phoneNumber(id, token) {
      const b = await call(`${id}?fields=display_phone_number,verified_name,quality_rating`, token);
      return { displayPhone: str(b.display_phone_number, 40), verifiedName: str(b.verified_name, 200), quality: b.quality_rating ? str(b.quality_rating, 20) : null };
    },
    async wabaPhoneNumbers(wabaId, token) {
      const b = await call(`${wabaId}/phone_numbers?fields=id&limit=100`, token);
      return arr(b.data).map((d) => str(obj(d).id, 40)).filter((v) => DIGITS.test(v));
    },
    async subscribeApp(wabaId, token) {
      await call(`${wabaId}/subscribed_apps`, token, { method: 'POST' });
    },
    async register(id, token, pin) {
      await call(`${id}/register`, token, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }) });
    },
    async templates(wabaId, token) {
      const out: Awaited<ReturnType<GraphClient['templates']>> = [];
      let path: string | null = `${wabaId}/message_templates?fields=name,language,category,status,components&limit=200`;
      for (let page = 0; path && page < 10; page++) {
        const b = await call(path, token);
        for (const raw of arr(b.data)) {
          const t = obj(raw);
          const bodyPart = obj(arr(t.components).find((c) => obj(c).type === 'BODY'));
          const body = str(bodyPart.text);
          const params = new Set(body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).size;
          const name = str(t.name, 512);
          const language = str(t.language, 10);
          if (/^[a-z0-9_]+$/.test(name) && /^[a-z]{2,3}(_[A-Z]{2})?$/.test(language))
            out.push({ name, language, category: str(t.category, 40), status: str(t.status, 40), body, paramCount: params });
        }
        const next = str(obj(b.paging).next, 2048);
        path = next && next.startsWith(`${GRAPH}/${version}/`) ? next.slice(`${GRAPH}/${version}/`.length) : null;
      }
      return out;
    },
    async send(id, token, message) {
      const b = await call(`${id}/messages`, token, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...message }) });
      const wamid = str(obj(arr(b.messages)[0]).id, 256);
      if (wamid.length < 8) throw new GraphError('Resposta do WhatsApp sem identificador da mensagem.', 502, null);
      return wamid;
    },
    async markRead(id, token, wamid) {
      await call(`${id}/messages`, token, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: wamid }) });
    },
    async media(mediaId, token) {
      const meta = await call(`${mediaId}`, token);
      const url = str(meta.url, 2048);
      let host = '';
      try { host = new URL(url).hostname; } catch { /* invalid */ }
      if (!url.startsWith('https://') || !(host === 'lookaside.fbsbx.com' || host.endsWith('.fbcdn.net') || host.endsWith('.whatsapp.net')))
        throw new GraphError('Endereço de mídia inesperado.', 502, null);
      if (typeof meta.file_size === 'number' && meta.file_size > MAX_MEDIA_BYTES) throw new GraphError('Arquivo grande demais para abrir aqui.', 413, null);
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new GraphError('Não foi possível baixar a mídia.', res.status, null);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_MEDIA_BYTES) throw new GraphError('Arquivo grande demais para abrir aqui.', 413, null);
      return { bytes, mime: str(meta.mime_type, 120) || 'application/octet-stream' };
    },
  };
}

/** User-facing message for the Cloud API error codes the reception can act on. */
export function graphMessage(code: number | null, status: number): string {
  switch (code) {
    case 190: return 'O token do WhatsApp expirou ou foi revogado. Reconecte o número em Configurações.';
    case 10: case 200: return 'O token não tem permissão para este número. Confira as permissões whatsapp_business_messaging e whatsapp_business_management.';
    case 100: return 'O WhatsApp recusou os dados enviados. Confira o ID do número e da conta.';
    case 131047: return 'Passaram mais de 24 horas desde a última mensagem do paciente. Use um modelo aprovado.';
    case 131026: return 'O número não pode receber mensagens pelo WhatsApp.';
    case 131051: return 'Tipo de mensagem não suportado.';
    case 132000: case 132001: return 'O modelo não existe, não está aprovado ou os campos não conferem.';
    case 133010: return 'O número ainda não está registrado na Cloud API.';
    case 130429: case 131056: case 80007: return 'Limite de envio do WhatsApp atingido. Tente de novo em instantes.';
    case 368: case 131031: return 'A conta do WhatsApp está restrita pela Meta.';
    default: return status >= 500 ? 'O WhatsApp está indisponível no momento. Tente de novo.' : 'O WhatsApp recusou o pedido.';
  }
}
