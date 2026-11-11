/**
 * Temporary-password lifecycle and the rule for a password chosen by its owner.
 *
 * Accounts provisioned by a clinic admin carry, in app_metadata (writable only by the
 * service role), `must_change_password: true` and `temporary_password_expires_at`.
 * While the flag is set the server refuses everything except change-initial-password
 * (see _shared/auth.ts and migration 20261111110000). Pure module: no Deno or network.
 * The same rule is mirrored for the UI in src/lib/passwordPolicy.ts (parity test).
 */

export const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 10;
/** Auth hashes with bcrypt, which ignores bytes after the 72nd. */
export const PASSWORD_MAX_BYTES = 72;

type Metadata = Record<string, unknown> | null | undefined;
export type AccountMetadata = { app_metadata?: Metadata; user_metadata?: Metadata; created_at?: string | null };

/** app_metadata written when a temporary password is issued or re-issued. */
export function temporaryPasswordAppMetadata(now: Date): Record<string, unknown> {
  return {
    must_change_password: true,
    temporary_password_expires_at: new Date(now.getTime() + TEMPORARY_PASSWORD_TTL_MS).toISOString(),
  };
}

/** True while the account must replace a temporary password (server flag or legacy flag). */
export function passwordChangePending(account: AccountMetadata): boolean {
  return account.app_metadata?.must_change_password === true || account.user_metadata?.must_change_password === true;
}

/**
 * Expiry of the pending temporary password. Server flag without a valid expiry fails closed.
 * A legacy-only flag (created before the server flag existed) expires 72 h after creation.
 */
export function temporaryPasswordExpired(account: AccountMetadata, now: Date): boolean {
  if (account.app_metadata?.must_change_password === true) {
    const at = account.app_metadata?.temporary_password_expires_at;
    const expires = typeof at === 'string' ? Date.parse(at) : NaN;
    return !Number.isFinite(expires) || expires <= now.getTime();
  }
  const created = typeof account.created_at === 'string' ? Date.parse(account.created_at) : NaN;
  return !Number.isFinite(created) || created + TEMPORARY_PASSWORD_TTL_MS <= now.getTime();
}

const COMMON = new Set([
  '1234567890', '0123456789', '12345678910', '0987654321', 'qwertyuiop', 'asdfghjkl', 'senha12345', 'senha123456',
  'password123', 'password1234', 'minhasenha', 'minhasenha1', 'mudar12345', 'trocar12345', 'cortex1234', 'cortex12345',
  'abcdefghij', 'abc1234567', 'iloveyou12', 'admin12345', 'medico1234', 'clinica123', 'clinica1234',
]);

function sequential(value: string): boolean {
  const s = value.toLowerCase();
  const steps = new Set<number>();
  for (let i = 1; i < s.length; i++) steps.add(s.charCodeAt(i) - s.charCodeAt(i - 1));
  return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

/** pt-BR reason the password is not acceptable, or null when it is. */
export function passwordProblem(password: unknown, email = ''): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH)
    return `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'Use no máximo 72 caracteres.';
  if (password.trim() !== password) return 'Não comece nem termine a senha com espaço.';
  if (new Set(password.toLowerCase()).size < 4 || sequential(password) || COMMON.has(password.toLowerCase()))
    return 'Essa senha é fácil de adivinhar. Misture palavras, números ou símbolos.';
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'Não use o seu e-mail na senha.';
  return null;
}

/** 14 characters from an unambiguous alphabet (no 0/O, 1/l/I), about 80 bits. */
export function generateTemporaryPassword(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  // Rejection sampling keeps the distribution uniform (256 is not a multiple of 56).
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < 14) {
    for (const b of random(new Uint8Array(32))) {
      if (b < limit && out.length < 14) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}
