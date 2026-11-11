/**
 * Clinic admins create doctor accounts directly (public sign-up is disabled).
 *
 * With open, auto-confirmed sign-up anyone could register a colleague's email
 * first and then receive that colleague's clinic invitation and shared charts.
 * Here the admin provisions the account: it is created confirmed, joins the
 * admin's clinic as an active doctor, and gets a temporary password that must
 * be changed on first sign-in. The flag and its 72-hour expiry live in
 * app_metadata (service role only); until the owner calls change-initial-password
 * the server refuses everything else (_shared/auth.ts, migration 20261111110000).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { readJsonObject, RequestError, fetchWithDeadline } from '../_shared/http.ts';
import { generateTemporaryPassword, temporaryPasswordAppMetadata } from '../_shared/passwordPolicy.ts';

const headers = {
  ...allowOriginHeader(),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });
  try {
    const { userId } = await requireUser(req);
    const body = await readJsonObject(req, 4096);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const crm = typeof body.crm === 'string' ? body.crm.trim() : '';
    const crmUf = typeof body.crmUf === 'string' ? body.crmUf.trim().toUpperCase() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)
      throw new RequestError('Informe um e-mail válido.');
    if (name.length < 3 || name.length > 120) throw new RequestError('Informe o nome completo do médico.');
    if (crm.length > 20 || (crmUf && !/^[A-Z]{2}$/.test(crmUf))) throw new RequestError('CRM ou UF inválidos.');

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      global: { fetch: fetchWithDeadline },
    });

    // Only an active clinic admin may provision accounts, and only into their clinic.
    const { data: membership, error: membershipError } = await db
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) throw new Error('Não foi possível verificar sua função na clínica.');
    if (!membership) throw new RequestError('Somente o administrador da clínica pode criar contas.', 403);

    const password = generateTemporaryPassword();
    const now = new Date();
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { provisioned_at: now.toISOString(), ...temporaryPasswordAppMetadata(now) },
      user_metadata: { full_name: name },
    });
    if (createError || !created?.user) {
      const exists = /already|registered|exists/i.test(createError?.message ?? '');
      throw new RequestError(
        exists
          ? 'Já existe uma conta com este e-mail. Use "Disponibilizar convite" para adicioná-la à clínica.'
          : 'Não foi possível criar a conta. Tente novamente.',
        exists ? 409 : 503,
      );
    }
    const doctorId = created.user.id;

    const { error: settingsError } = await db
      .from('user_settings')
      .upsert({ user_id: doctorId, doctor_name: name, crm_number: crm, crm_uf: crmUf }, { onConflict: 'user_id' });
    const { error: memberError } = await db
      .from('clinic_members')
      .insert({ clinic_id: membership.clinic_id, user_id: doctorId, role: 'doctor', status: 'active' });
    if (memberError) {
      // Never leave a half-provisioned account behind.
      await db.auth.admin.deleteUser(doctorId);
      throw new Error('Não foi possível vincular o médico à clínica. A conta não foi criada.');
    }
    await db
      .from('chart_access_audit')
      .insert({ clinic_id: membership.clinic_id, actor_user_id: userId, action: 'member_provisioned', resource_id: doctorId });

    return new Response(
      JSON.stringify({
        success: true,
        email,
        temporaryPassword: password,
        settingsSaved: !settingsError,
      }),
      { headers },
    );
  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, headers);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Não foi possível criar a conta.' }),
      { status: error instanceof RequestError ? error.status : 503, headers },
    );
  }
});

// No ALLOWED_ORIGIN secret means no Access-Control-Allow-Origin: browsers refuse the call instead
// of the function answering any origin (same rule as _shared/cors.ts).
function allowOriginHeader(): Record<string, string> {
  const origin = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim();
  return origin && origin !== '*' ? { 'Access-Control-Allow-Origin': origin } : {};
}
