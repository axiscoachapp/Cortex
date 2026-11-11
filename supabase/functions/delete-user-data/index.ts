import { readJsonObject, RequestError, fetchWithDeadline } from '../_shared/http.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { removeStoragePrefix } from '../_shared/storage.ts';
import { requireSafeDeletion } from '../_shared/deletion.ts';
import { retryProviderCleanup } from '../_shared/providerFiles.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { googleTokenKeys, isSealedGoogleToken, openGoogleToken } from '../_shared/oauth.ts';
import { bearerToken } from '../_shared/secrets.ts';

const corsHeaders = corsHeadersFor(Deno.env.get('ALLOWED_ORIGIN'), { 'Cache-Control': 'no-store' });

/** Step-up window: the calling session must have proven a credential this recently. */
const STEP_UP_MS = 10 * 60_000;
/** Methods that prove the person at the keyboard (a refresh or an e-mailed link does not). */
const STEP_UP_METHODS = new Set(['password', 'totp', 'mfa/totp', 'phone', 'mfa/phone', 'webauthn', 'mfa/webauthn']);

/**
 * When the calling session last proved a credential, in ms, from the `amr` claim of its own
 * access token (Supabase Auth keeps one entry per method with the time it was used in this
 * session; refreshing the token does not change them). The bearer was already verified by
 * requireUser, so its claims can be read; 0 when there is no usable entry.
 */
function sessionAuthenticatedAt(authorization: string | null, userId: string, now: number): number {
  try {
    const payload = bearerToken(authorization).split('.')[1] ?? '';
    const text = atob(payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4));
    const claims = JSON.parse(text);
    if (!claims || claims.sub !== userId || !Array.isArray(claims.amr)) return 0;
    let latest = 0;
    for (const entry of claims.amr) {
      const at = Number(entry?.timestamp) * 1000;
      if (STEP_UP_METHODS.has(entry?.method) && Number.isFinite(at) && at <= now + 60_000) latest = Math.max(latest, at);
    }
    return latest;
  } catch {
    return 0;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    const { userId } = await requireUser(req);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      global: { fetch: fetchWithDeadline },
    });
    const body = await readJsonObject(req).catch(() => ({}) as Record<string, unknown>);
    const { data: pending } = await admin
      .from('account_deletion_requests')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    // A deletion already in progress may be retried; a new one needs step-up.
    if (!pending) {
      if (body.retentionAcknowledged !== true)
        throw new RequestError(
          'Confirme que exportou seus prontuários e que conhece a obrigação de guardá-los por 20 anos.',
          400,
        );
      // Irreversible: THIS session must have entered the password (or a second
      // factor) within the last 10 minutes, so a stolen or left-open session
      // cannot destroy the account on its own. The account-wide last_sign_in_at
      // is not used: a sign-in on another device would refresh it.
      const now = Date.now();
      const authenticatedAt = sessionAuthenticatedAt(req.headers.get('Authorization'), userId, now);
      if (!authenticatedAt || now - authenticatedAt > STEP_UP_MS)
        return new Response(
          JSON.stringify({ error: 'Por segurança, confirme sua senha antes de excluir a conta.', reauthRequired: true }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
    await requireSafeDeletion(admin, userId);
    // Persistent intent blocks new writes; failed cleanup can be retried safely.
    const { error: lockError } = await admin.from('account_deletion_requests').upsert({ user_id: userId });
    if (lockError) throw new Error('Não foi possível iniciar a exclusão');
    await retryProviderCleanup(admin, userId, Deno.env.get('GEMINI_API_KEY'));
    await removeStoragePrefix(admin.storage, 'patient-files', `patients/${userId}`);
    await removeStoragePrefix(admin.storage, 'audio-recordings', `consultations/${userId}`);
    await removeStoragePrefix(admin.storage, 'prescriptions', `rx/${userId}`);
    const { data: integration, error: integrationError } = await admin
      .from('user_integrations')
      .select('google_refresh_token')
      .eq('user_id', userId)
      .maybeSingle();
    if (integrationError) throw new Error('Não foi possível verificar as integrações');
    if (integration?.google_refresh_token) {
      // Sealed tokens need GOOGLE_TOKEN_KEYS; a legacy plaintext one is used as it is.
      let token: string | null;
      try {
        const keys = isSealedGoogleToken(integration.google_refresh_token)
          ? googleTokenKeys(Deno.env.get('GOOGLE_TOKEN_KEYS')) : { current: '', keys: {} };
        token = await openGoogleToken(keys, integration.google_refresh_token, userId, 'refresh');
      } catch {
        throw new Error('Não foi possível desconectar o Google. Tente a exclusão novamente.');
      }
      const response = await fetchWithDeadline('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token ?? '' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status !== 400 || body?.error !== 'invalid_token')
          throw new Error('Não foi possível desconectar o Google. Tente a exclusão novamente.');
      }
    }
    // Cascades include drafts and revisions. Remove metadata only after storage
    // succeeds so partial failures leave enough information for a safe retry.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error('Não foi possível concluir a exclusão da conta');
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Conta e dados ativos removidos. Retenções de segurança seguem as políticas aplicáveis.',
        receipt: {
          activeRecords: 'removed',
          sourceFiles: 'removed',
          providerFiles: 'confirmed_removed_or_provider_reports_absent',
          operationalLogsAndBackups: 'subject_to_retention_policy',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    if (error instanceof RequestError)
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Exclusão incompleta. Tente novamente.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
