// Comparison of shared secrets (service key, webhook verify token, prescription access code).
// Both sides are hashed first, so neither the time taken nor an early exit reveals the length or a
// matching prefix of the expected value; the digests are then compared without branching.
// Self-contained (WebCrypto only), so it runs unchanged in Deno and in the Vitest suite.

const encoder = new TextEncoder();
const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

/**
 * True only when `given` equals `expected`. An expected secret that is missing or shorter than
 * `minLength` never matches (a misconfigured short secret fails closed), nor does an empty `given`.
 */
export async function secretEquals(expected: unknown, given: unknown, minLength = 32): Promise<boolean> {
  if (typeof expected !== 'string' || typeof given !== 'string') return false;
  const usable = expected.length >= minLength && given.length > 0;
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  let diff = usable ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The token of an `Authorization: Bearer <token>` header, or '' when the header has another form. */
export function bearerToken(header: string | null): string {
  return /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? '';
}
