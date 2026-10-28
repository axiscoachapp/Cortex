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
  constructor(message = "Não autorizado", public status = 401) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Validates the caller's JWT and returns their user id.
 * Throws AuthError (401) when the header is missing or the token is invalid —
 * the public anon key resolves to no user and is rejected too.
 */
export async function requireUser(req: Request): Promise<{ userId: string }> {
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
    throw new AuthError('Confirme o segundo fator para continuar.', 403);
  }

  return { userId: user.id };
}

/** 401 response the generic catch block can return for AuthError. */
export function authResponse(err: AuthError, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: err.message, ...(err.status === 403 ? { mfaRequired: true } : {}) }),
    { status: err.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
