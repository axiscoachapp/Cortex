// The auth session id (JWT `session_id` claim) survives token refreshes; a new
// sign-in gets a new one. Only the id is read (no verification: the server
// verifies every token); the token itself never enters a cache key.
export function sessionIdOf(token: string | undefined): string | null {
  try {
    const part = token?.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return typeof claims?.session_id === 'string' && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}
