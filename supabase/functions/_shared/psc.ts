/**
 * Client of the ITI cloud-signature API (DOC-ICP-17.01 v3.0), which every
 * accredited PSC exposes, plus the sealing of its session token.
 * Contract: docs/prescriptions/ASSINATURA_DIGITAL.md (D17).
 *
 * Self-contained (fetch and WebCrypto only) and testable with an injected
 * fetch. Endpoints come only from the server-side PSC list; nothing a client
 * or a PSC redirect says is ever used as a destination for a token.
 *
 * Field names follow DOC-ICP-17.01; anything a given PSC returns differently
 * must be confirmed in its homologation environment before production.
 */

export interface PscConfig {
  /** Key in the server-side list, e.g. 'vidaas'. */
  id: string;
  /** https origin of the PSC, from the server-side list only. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** The single redirect_uri registered at the PSC (a Cortex frontend route). */
  redirectUri: string;
}

/** Longest signature session the Cortex asks for (12 h; the standard allows 7 days). */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;
const SHA256_OID = '2.16.840.1.101.3.4.2.1';

export class PscRejectedError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'PscRejectedError'; }
}
/** The request may have reached the PSC: never retried automatically. */
export class PscAmbiguousError extends Error {
  constructor(message: string) { super(message); this.name = 'PscAmbiguousError'; }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Encoding helpers

export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function assertConfig(cfg: PscConfig) {
  const url = new URL(cfg.baseUrl);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw new Error('PSC sem HTTPS.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('A base do PSC deve ser só a origem.');
}
const endpoint = (cfg: PscConfig, path: string) => { assertConfig(cfg); return new URL(path, cfg.baseUrl).toString(); };

// ---------------------------------------------------------------------------
// OAuth 2.0 + PKCE (S256)

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** Random opaque state for one authorization (store only its hash). */
export const newState = () => base64url(randomBytes(32));

export function authorizeUrl(cfg: PscConfig, p: { state: string; codeChallenge: string; lifetimeSeconds: number; loginHint?: string }): string {
  if (!Number.isInteger(p.lifetimeSeconds) || p.lifetimeSeconds < 60 || p.lifetimeSeconds > MAX_SESSION_SECONDS) throw new Error('Duração da sessão de assinatura fora do limite de 12 horas.');
  const url = new URL(endpoint(cfg, '/oauth/authorize'));
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: 'signature_session',
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    state: p.state,
    lifetime: String(p.lifetimeSeconds),
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  }).toString();
  return url.toString();
}

async function call(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number, idempotent: boolean): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch {
    // Network error or timeout: for a non-idempotent call the PSC may have acted.
    if (idempotent) throw new PscRejectedError('PSC indisponível. Tente de novo.', 503);
    throw new PscAmbiguousError('Sem resposta do PSC: a assinatura pode ter sido feita.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new PscRejectedError(`PSC recusou o pedido (${response.status}).`, response.status);
  try {
    return await response.json();
  } catch {
    if (idempotent) throw new PscRejectedError('Resposta do PSC ilegível.', 502);
    throw new PscAmbiguousError('Resposta do PSC ilegível: a assinatura pode ter sido feita.');
  }
}

export interface PscSession { accessToken: string; expiresAt: Date; authorizedCpf: string }

export async function exchangeCode(cfg: PscConfig, p: { code: string; codeVerifier: string; now?: Date }, fetchImpl: Fetch = fetch): Promise<PscSession> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code: p.code,
    redirect_uri: cfg.redirectUri,
    code_verifier: p.codeVerifier,
  });
  const json = (await call(fetchImpl, endpoint(cfg, '/oauth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 15_000, true)) as Record<string, unknown>;
  const token = json.access_token;
  const expiresIn = Number(json.expires_in);
  const cpf = String(json.authorized_identification ?? '').replace(/\D/g, '');
  if (typeof token !== 'string' || !token || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new PscRejectedError('Resposta de token incompleta.', 502);
  if (json.authorized_identification_type !== undefined && json.authorized_identification_type !== 'CPF') throw new PscRejectedError('A sessão não foi autorizada por CPF.', 403);
  if (cpf.length !== 11) throw new PscRejectedError('A sessão não informou o CPF autorizado.', 403);
  const now = p.now ?? new Date();
  // Never keep a session longer than the Cortex limit, whatever the PSC grants.
  const seconds = Math.min(expiresIn, MAX_SESSION_SECONDS);
  return { accessToken: token, expiresAt: new Date(now.getTime() + seconds * 1000), authorizedCpf: cpf };
}

export interface PscCertificate { alias: string; certificate: Uint8Array; chain: Uint8Array[] }

export async function certificateDiscovery(cfg: PscConfig, accessToken: string, fetchImpl: Fetch = fetch): Promise<PscCertificate[]> {
  const json = (await call(fetchImpl, endpoint(cfg, '/oauth/certificate-discovery'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  }, 15_000, true)) as { certificates?: Array<{ alias?: unknown; certificate?: unknown; certificate_chain?: unknown }> };
  const list = Array.isArray(json.certificates) ? json.certificates : [];
  const out = list
    .filter((c) => typeof c.certificate === 'string')
    .map((c) => ({
      alias: typeof c.alias === 'string' ? c.alias : '',
      certificate: fromBase64(c.certificate as string),
      chain: Array.isArray(c.certificate_chain) ? (c.certificate_chain as unknown[]).filter((x): x is string => typeof x === 'string').map(fromBase64) : [],
    }));
  if (!out.length) throw new PscRejectedError('O PSC não devolveu certificado para esta sessão.', 502);
  return out;
}

/**
 * Signs one SHA-256 hash (RAW). Not idempotent from the PSC's point of view:
 * a lost answer is PscAmbiguousError and must not be retried automatically.
 */
export async function signHash(cfg: PscConfig, accessToken: string, p: { id: string; hash: Uint8Array; alias?: string }, fetchImpl: Fetch = fetch): Promise<Uint8Array> {
  if (p.hash.length !== 32) throw new Error('Hash SHA-256 inválido.');
  const json = (await call(fetchImpl, endpoint(cfg, '/oauth/signature'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(p.alias ? { certificate_alias: p.alias } : {}),
      hashes: [{ id: p.id, alias: 'Documento Cortex', hash: base64(p.hash), hash_algorithm: SHA256_OID, signature_format: 'RAW' }],
    }),
  }, 30_000, false)) as { signatures?: Array<{ id?: unknown; raw_signature?: unknown }> };
  const found = (json.signatures ?? []).find((s) => s.id === p.id);
  if (!found || typeof found.raw_signature !== 'string') throw new PscAmbiguousError('Resposta do PSC sem a assinatura pedida.');
  return fromBase64(found.raw_signature);
}

// ---------------------------------------------------------------------------
// Sealing of the session token and of the OAuth code_verifier (AES-256-GCM)
//
// Each use has its own versioned namespace in the associated data, so a
// sealed token never opens as a verifier (or the reverse), nor in another
// session, account or generation. Nonces are 96 random bits per sealing.
// Keys come only from the server's key list (key id -> 32 bytes); nothing
// from a client chooses a key or an environment variable.

export interface SealedSecret { v: 1; keyId: string; nonce: string; ciphertext: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** AAD of a session token: one session, account and generation. */
export function tokenBinding(sessionId: string, userId: string, generation: number): string {
  if (!UUID.test(sessionId) || !UUID.test(userId) || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Vínculo do token inválido.');
  return `cortex/signature-token/v1|${sessionId.toLowerCase()}|${userId.toLowerCase()}|${generation}`;
}

/** AAD of an OAuth code_verifier: one authorization state, account and PSC. */
export function verifierBinding(stateHash: string, userId: string, psc: string): string {
  if (!/^[0-9a-f]{64}$/.test(stateHash) || !UUID.test(userId) || !KEY_ID.test(psc)) throw new Error('Vínculo do verificador inválido.');
  return `cortex/oauth-verifier/v1|${stateHash}|${userId.toLowerCase()}|${psc}`;
}

/** Hex SHA-256 of an OAuth state: only this hash is stored. */
export async function stateHash(state: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (!(rawKey instanceof Uint8Array) || rawKey.length !== 32) throw new Error('A chave de cifra deve ter 32 bytes.');
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Server key list from configuration, e.g. SIGNATURE_TOKEN_KEYS =
 * "k2:<base64 32 bytes>,k1:<base64 32 bytes>". The first one seals; older ones
 * only open, while they stay listed.
 */
export function parseKeyList(config: string): { current: string; keys: Record<string, Uint8Array> } {
  const keys: Record<string, Uint8Array> = {};
  let current = '';
  for (const entry of config.split(',').map((e) => e.trim()).filter(Boolean)) {
    const [id, value] = entry.split(':');
    if (!KEY_ID.test(id ?? '') || !value || keys[id]) throw new Error('Lista de chaves de assinatura inválida.');
    const raw = fromBase64(value);
    if (raw.length !== 32) throw new Error('Lista de chaves de assinatura inválida.');
    keys[id] = raw;
    current ||= id;
  }
  if (!current) throw new Error('Nenhuma chave de assinatura configurada.');
  return { current, keys };
}

export async function sealSecret(keyList: { current: string; keys: Record<string, Uint8Array> }, secret: string, binding: string): Promise<SealedSecret> {
  const rawKey = keyList.keys[keyList.current];
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(binding) },
    await importKey(rawKey),
    new TextEncoder().encode(secret),
  ));
  return { v: 1, keyId: keyList.current, nonce: base64(nonce), ciphertext: base64(ciphertext) };
}

/** Throws when the version, key, binding or ciphertext do not match. */
export async function openSecret(keyList: { keys: Record<string, Uint8Array> }, sealed: SealedSecret, binding: string): Promise<string> {
  if (sealed?.v !== 1 || !KEY_ID.test(sealed.keyId ?? '')) throw new Error('Segredo de assinatura em formato desconhecido.');
  const rawKey = Object.prototype.hasOwnProperty.call(keyList.keys, sealed.keyId) ? keyList.keys[sealed.keyId] : undefined;
  if (!rawKey) throw new Error('Chave do segredo de assinatura não está mais autorizada.');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.nonce), additionalData: new TextEncoder().encode(binding) },
      await importKey(rawKey),
      fromBase64(sealed.ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Segredo de assinatura inválido para este vínculo.');
  }
}
