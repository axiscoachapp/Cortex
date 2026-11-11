import { allowedOrigin } from './cors.ts';
import { openSecret, parseKeyList, sealSecret, type SealedSecret } from './psc.ts';

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
}
export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
}
export async function createOAuthSecrets(): Promise<{state:string;verifier:string;challenge:string}> {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  return {state,verifier,challenge:await pkceChallenge(verifier)};
}
export function assertOAuthRedirect(value: unknown, allowed: string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('Redirecionamento OAuth não autorizado');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/google-oauth-callback' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
    throw new Error('Redirecionamento OAuth inválido');
  }
  return value;
}
export function configuredOAuthRedirects(get: (key:string)=>string|undefined): string[] {
  const explicit = get('GOOGLE_OAUTH_REDIRECT_URIS');
  if (explicit) return explicit.split(',').map(value=>value.trim()).filter(Boolean);
  const origin = allowedOrigin(get('ALLOWED_ORIGIN'));
  return origin ? [`${origin}/google-oauth-callback`] : [];
}

// ---------------------------------------------------------------------------
// Google OAuth tokens at rest (security review finding 10).
//
// The refresh and access tokens are sealed with AES-256-GCM under GOOGLE_TOKEN_KEYS, the same format
// as WHATSAPP_TOKEN_KEYS and SIGNATURE_TOKEN_KEYS: "k1:<base64 of 32 random bytes>" (several entries
// separated by commas; the first seals, the others only open while they stay listed). The sealed
// value is bound to the account and to the kind of token, so a value copied to another row or
// column does not open. It is stored as text in the existing columns ("cortex-sealed:v1:" + JSON),
// so get_integration_status keeps reading "connected" from google_refresh_token IS NOT NULL.
// Rows written before this change hold the plaintext token: they are still read, and the next
// refresh rewrites both tokens sealed. Without a valid key list nothing is read or written.

export type GoogleTokenKeys = { current: string; keys: Record<string, Uint8Array> };
export type GoogleTokenKind = 'refresh' | 'access';

const SEALED_PREFIX = 'cortex-sealed:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when GOOGLE_TOKEN_KEYS is missing or invalid; the handlers answer 503 with this message. */
export class GoogleTokensNotConfigured extends Error {
  constructor() {
    super('A conexão com o Google Agenda ainda não está configurada no servidor. Fale com a equipe Cortex.');
    this.name = 'GoogleTokensNotConfigured';
  }
}

/** The key list from GOOGLE_TOKEN_KEYS; throws GoogleTokensNotConfigured when absent or invalid. */
export function googleTokenKeys(config: string | undefined | null): GoogleTokenKeys {
  if (!config) throw new GoogleTokensNotConfigured();
  try { return parseKeyList(config); } catch { throw new GoogleTokensNotConfigured(); }
}

export function googleTokenBinding(userId: string, kind: GoogleTokenKind): string {
  if (!UUID.test(userId) || (kind !== 'refresh' && kind !== 'access')) throw new Error('Vínculo do token Google inválido.');
  return `cortex/google-token/v1|${kind}|${userId.toLowerCase()}`;
}

export const isSealedGoogleToken = (stored: unknown) => typeof stored === 'string' && stored.startsWith(SEALED_PREFIX);

export async function sealGoogleToken(keys: GoogleTokenKeys, token: string, userId: string, kind: GoogleTokenKind): Promise<string> {
  if (typeof token !== 'string' || !token) throw new Error('Token Google ausente.');
  return SEALED_PREFIX + JSON.stringify(await sealSecret(keys, token, googleTokenBinding(userId, kind)));
}

/**
 * The plain token of a stored value: sealed values are opened (throws when the key or binding does
 * not match), a legacy plaintext value is returned as it is, an empty value gives null.
 */
export async function openGoogleToken(keys: GoogleTokenKeys, stored: unknown, userId: string, kind: GoogleTokenKind): Promise<string | null> {
  if (typeof stored !== 'string' || !stored) return null;
  if (!isSealedGoogleToken(stored)) return stored;
  let sealed: SealedSecret;
  try { sealed = JSON.parse(stored.slice(SEALED_PREFIX.length)); } catch { throw new Error('Token Google em formato desconhecido.'); }
  return openSecret(keys, sealed, googleTokenBinding(userId, kind));
}
