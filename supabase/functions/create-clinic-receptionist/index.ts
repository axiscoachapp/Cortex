import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { readJsonObject, RequestError, fetchWithDeadline } from '../_shared/http.ts';
import { temporaryPasswordAppMetadata } from '../_shared/passwordPolicy.ts';

const headers = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
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
    const body = await readJsonObject(req, 8192);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const doctorIds = body.doctorIds;
    if (name.length < 2 || name.length > 120 || email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new RequestError('Informe nome e e-mail válidos.');
    if (
      !Array.isArray(doctorIds) ||
      !doctorIds.length ||
      doctorIds.length > 50 ||
      doctorIds.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    )
      throw new RequestError('Selecione pelo menos uma agenda válida.');
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      global: { fetch: fetchWithDeadline },
    });
    const { data: member, error: memberError } = await db
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('status', 'active')
      .maybeSingle();
    if (memberError) throw new RequestError('Não foi possível verificar sua permissão.', 503);
    if (!member) throw new RequestError('Somente o administrador pode criar contas de recepção.', 403);
    const { data: doctors, error: doctorsError } = await db
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', member.clinic_id)
      .eq('status', 'active')
      .in('user_id', doctorIds);
    if (doctorsError || !doctors || new Set(doctors.map((row) => row.user_id)).size !== new Set(doctorIds).size)
      throw new RequestError('Uma das agendas não pertence à clínica ativa.', 403);
    const temporaryPassword = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    // The flag lives in app_metadata (service role only) and is enforced by the server until the
    // owner calls change-initial-password; the temporary password expires after 72 hours.
    const now = new Date();
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { account_type: 'reception', provisioned_at: now.toISOString(), ...temporaryPasswordAppMetadata(now) },
      user_metadata: { full_name: name },
    });
    if (createError || !created?.user)
      throw new RequestError('Não foi possível criar a conta. Use um e-mail exclusivo para a recepção.', 409);
    let provisionConfirmed = false;
    try {
      const { data, error } = await db.rpc('provision_clinic_receptionist', {
        p_actor: userId,
        p_user: created.user.id,
        p_name: name,
        p_doctors: doctorIds,
      });
      provisionConfirmed = !error && data === true;
    } catch {
      // A timeout can hide a committed membership. Reconcile before any retry
      // or identity cleanup; neither outcome is established by a transport error.
    }
    if (!provisionConfirmed) {
      throw new RequestError('Não foi possível confirmar a criação. A conta pode existir; atualize a página e confira a equipe antes de tentar novamente.', 503);
    }
    return new Response(JSON.stringify({ success: true, email, temporaryPassword }), { headers });
  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, headers);
    return new Response(
      JSON.stringify({
        error: error instanceof RequestError ? error.message : 'Não foi possível criar a conta de recepção.',
      }),
      { status: error instanceof RequestError ? error.status : 503, headers },
    );
  }
});
