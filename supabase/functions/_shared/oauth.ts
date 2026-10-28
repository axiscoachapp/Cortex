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
  const origin = get('ALLOWED_ORIGIN');
  return origin && origin !== '*' ? [`${origin.replace(/\/$/,'')}/google-oauth-callback`] : [];
}
