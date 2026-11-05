/* Shared JWT authentication for edge functions.
 *
 * Every function historically trusted a body-supplied `userId` while using the
 * service-role key — letting any caller act as any user (IDOR). This helper
 * derives the identity from the caller's JWT instead. The frontend already
 * sends it: supabase-js functions.invoke() attaches the session token as the
 * Authorization header automatically.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { fetchWithDeadline } from './http.ts';

export class AuthError extends Error {
  constructor(message = "Não autorizado", public status = 401, public mfaRequired = false) {
    super(message);
    this.name = "AuthError";
  }
}

type UserAuthOptions = { allowReception?: boolean };

export type VerifiedUserContext = Readonly<{
  userId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  exp: number;
}>;

async function authenticateUser(req: Request, options: UserAuthOptions): Promise<{ userId: string; claims: Record<string, unknown> }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new AuthError();

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader }, fetch: fetchWithDeadline } },
  );

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new AuthError("Sessão inválida");

  // getUser above verifies the bearer token with Auth. Only then may its signed
  // claims establish assurance; decoding alone is never authentication.
  const token = /^Bearer\s+([^\s]+)$/i.exec(authHeader)?.[1];
  let claims: Record<string, unknown>;
  try {
    if (!token || token.split('.').length !== 3) throw new Error();
    claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims) || claims.sub !== user.id) throw new Error();
  } catch { throw new AuthError('Sessão inválida'); }
  if (user.factors?.some(factor => factor.status === 'verified') && claims.aal !== 'aal2') {
    throw new AuthError('Confirme o segundo fator para continuar.', 403, true);
  }

  // app_metadata is managed by Auth administrators, unlike editable user_metadata.
  // Reception has its own scoped RPCs and cannot enter service-role clinical handlers.
  if (user.app_metadata?.account_type === 'reception' && !options.allowReception) {
    throw new AuthError('Esta operação é restrita ao ambiente médico.', 403);
  }

  return { userId: user.id, claims };
}

/** Validates the bearer and preserves the existing user-id-only interface. */
export async function requireUser(req: Request, options: UserAuthOptions = {}): Promise<{ userId: string }> {
  const { userId } = await authenticateUser(req, options);
  return { userId };
}

/**
 * Context from the same bearer verified by Auth, never the request body.
 * Consumers still enforce operation-specific assurance and recheck live
 * session/factor rows and deadlines in the authorizing database transaction.
 */
export async function requireUserContext(req: Request, options: UserAuthOptions = {}): Promise<VerifiedUserContext> {
  const { userId, claims } = await authenticateUser(req, options);
  const { session_id: sessionId, aal, exp } = claims;
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!uuid.test(userId) || claims.role !== 'authenticated'
    || typeof sessionId !== 'string' || !uuid.test(sessionId)
    || (aal !== 'aal1' && aal !== 'aal2')
    || typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= 0 || exp <= Date.now() / 1000) {
    throw new AuthError('Sessão inválida');
  }
  return { userId, sessionId, aal, exp };
}

/** 401 response the generic catch block can return for AuthError. */
export function authResponse(err: AuthError, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: err.message, ...(err.mfaRequired ? { mfaRequired: true } : {}) }),
    { status: err.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
