// CORS of the browser-facing Edge Functions. The only allowed origin is the ALLOWED_ORIGIN secret
// (the app's origin, e.g. https://app.example.com.br). Without it, or with anything that is not a
// plain origin, no Access-Control-Allow-Origin is sent and browsers refuse the call: it fails
// closed instead of falling back to '*'. A local origin (http://localhost:<port>) works only when
// it is configured explicitly. Functions pass Deno.env.get('ALLOWED_ORIGIN') in, so this module
// has no runtime dependency and the Vitest suite uses it as is.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The configured origin when it is a plain https origin (or an explicit local http one), else null. */
export function allowedOrigin(configured: string | undefined | null): string | null {
  const value = (configured ?? '').trim().replace(/\/$/, '');
  if (!value || value === '*') return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  // A path, query, credentials or wildcard host make the text differ from the parsed origin.
  if (!secure || url.origin !== value.toLowerCase()) return null;
  return url.origin;
}

/** Standard CORS headers for one configured origin, plus `extra` (e.g. Cache-Control). */
export function corsHeadersFor(configured: string | undefined | null, extra: Record<string, string> = {}): Record<string, string> {
  const origin = allowedOrigin(configured);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
    ...extra,
  };
}
