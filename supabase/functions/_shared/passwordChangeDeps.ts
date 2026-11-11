// Production dependencies of change-initial-password and reissue-temporary-password.
// Uses only the platform's SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { AuthError, authResponse, requirePendingPasswordCaller, requireUser } from './auth.ts';
import { fetchWithDeadline } from './http.ts';
import { generateTemporaryPassword } from './passwordPolicy.ts';
import type { ChangeInitialPasswordDeps, ReissueTemporaryPasswordDeps } from './passwordChange.ts';

const cors = () => ({
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
});
const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const service = () => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: noSession, global: { fetch: fetchWithDeadline },
});
const authFailure = (error: unknown) => (error instanceof AuthError ? authResponse(error, cors()) : null);
const log = (event: string, detail: Record<string, unknown>) => console.log(JSON.stringify({ event, ...detail }));

async function updateUser(db: ReturnType<typeof service>, userId: string, update: Parameters<ChangeInitialPasswordDeps['updateUser']>[1]) {
  const { error } = await db.auth.admin.updateUserById(userId, update);
  if (error) throw new Error('Auth update failed');
}

export function changeInitialPasswordDeps(): ChangeInitialPasswordDeps {
  const db = service();
  return {
    corsHeaders: cors(),
    authenticate: requirePendingPasswordCaller,
    authFailure,
    now: () => new Date(),
    async passwordIsCurrent(email, password) {
      const probe = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        auth: noSession, global: { fetch: fetchWithDeadline },
      });
      const { data, error } = await probe.auth.signInWithPassword({ email, password });
      if (data?.session) {
        // The probe opened a session with the temporary password: end it immediately.
        await db.auth.admin.signOut(data.session.access_token, 'local');
        return true;
      }
      if (error && (error.code === 'invalid_credentials' || error.status === 400)) return false;
      throw new Error('Password probe unavailable');
    },
    async revokeOtherSessions(accessToken) {
      const { error } = await db.auth.admin.signOut(accessToken, 'others');
      if (error) throw new Error('Session revocation failed');
    },
    updateUser: (userId, update) => updateUser(db, userId, update),
    log,
  };
}

export function reissueTemporaryPasswordDeps(): ReissueTemporaryPasswordDeps {
  const db = service();
  return {
    corsHeaders: cors(),
    authenticate: (req) => requireUser(req),
    authFailure,
    now: () => new Date(),
    async adminClinic(userId) {
      const { data, error } = await db.from('clinic_members').select('clinic_id')
        .eq('user_id', userId).eq('role', 'admin').eq('status', 'active').maybeSingle();
      if (error) throw new Error('Membership lookup failed');
      return (data as { clinic_id?: string } | null)?.clinic_id ?? null;
    },
    async clinicAccount(clinicId, targetId) {
      const { data: doctor, error: doctorError } = await db.from('clinic_members').select('user_id')
        .eq('clinic_id', clinicId).eq('user_id', targetId).eq('role', 'doctor').eq('status', 'active').maybeSingle();
      if (doctorError) throw new Error('Doctor lookup failed');
      if (doctor) return { kind: 'doctor' };
      const { data: staff, error: staffError } = await db.from('clinic_staff_members').select('user_id')
        .eq('clinic_id', clinicId).eq('user_id', targetId).eq('active', true).maybeSingle();
      if (staffError) throw new Error('Staff lookup failed');
      return staff ? { kind: 'reception' } : null;
    },
    async getAccount(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      return {
        email: data.user.email ?? '',
        appMetadata: (data.user.app_metadata ?? {}) as Record<string, unknown>,
        userMetadata: (data.user.user_metadata ?? {}) as Record<string, unknown>,
      };
    },
    updateUser: (userId, update) => updateUser(db, userId, update),
    generatePassword: () => generateTemporaryPassword(),
    async audit(clinicId, actorId, targetId) {
      const { error } = await db.from('chart_access_audit')
        .insert({ clinic_id: clinicId, actor_user_id: actorId, action: 'temporary_password_reissued', resource_id: targetId });
      if (error) throw new Error('Audit failed');
    },
    log,
  };
}
