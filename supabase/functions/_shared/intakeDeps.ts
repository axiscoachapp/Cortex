// Production dependencies of the pre-consultation functions (intake-public, intake-api).
// Configuration: INTAKE_LINK_SECRET (32+ random characters), INTAKE_APP_URL (https origin of the app,
// e.g. https://app.example.com.br) and ALLOWED_ORIGIN for CORS. Without the first two, the public
// page answers 503 and staff cannot create links.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { AuthError, authResponse, requireUser } from './auth.ts';
import { fetchWithDeadline } from './http.ts';
import type { IntakeCaller, IntakeDeps, IntakeFormRow, IntakeRequestRow } from './intakeHandlers.ts';
import type { AnswerItem } from './intakeForm.ts';

const REQUEST_COLUMNS = 'id, clinic_id, appointment_id, doctor_id, appointment_start, status, answered_at, submissions, registration, health, '
  + 'whatsapp_consent, registration_reviewed_at, health_reviewed_at, revision, expires_at, opened_at, '
  + 'registration_reviewed_submission, health_reviewed_submission';

export function intakeConfig() {
  return { linkSecret: Deno.env.get('INTAKE_LINK_SECRET') ?? '', appUrl: (Deno.env.get('INTAKE_APP_URL') ?? '').replace(/\/+$/, '') };
}

export function intakeDeps(): IntakeDeps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: fetchWithDeadline } });
  const fail = (what: string): never => { throw new Error(`Banco indisponível (${what})`); };
  return {
    corsHeaders: {
      ...allowOriginHeader(),
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      Vary: 'Origin',
    },
    config: intakeConfig(),
    async authorize(req): Promise<IntakeCaller> {
      const { userId } = await requireUser(req, { allowReception: true });
      const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' }, fetch: fetchWithDeadline },
      });
      const { data, error } = await user.rpc('clinic_access');
      if (error) throw new AuthError('Não foi possível verificar seu acesso à clínica.', 503);
      const access = data as { kind?: string; active?: boolean; admin?: boolean; clinic?: { id?: string } | null; actorId?: string } | null;
      const clinicId = access?.clinic?.id;
      if (!access || !clinicId || access.actorId !== userId) throw new AuthError('Sua conta não está vinculada a uma clínica.', 403);
      const reception = access.kind === 'reception' && access.active === true;
      const admin = access.admin === true;
      if (!reception && !admin && access.kind !== 'clinical') throw new AuthError('Sem acesso à clínica.', 403);
      return { userId, clinicId, admin, reception };
    },
    authFailure: (error) => (error instanceof AuthError ? authResponse(error, intakeDepsCors()) : null),
    rpc: async (name, args) => {
      const { data, error } = await service.rpc(name, args);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    },
    store: {
      async form(clinicId) {
        const { data, error } = await service.from('intake_forms').select('clinic_id, enabled, definition, revision, updated_at').eq('clinic_id', clinicId).maybeSingle();
        if (error) fail('formulário');
        return (data as IntakeFormRow | null) ?? null;
      },
      async clinicName(clinicId) {
        const { data, error } = await service.from('clinics').select('name').eq('id', clinicId).maybeSingle();
        if (error) fail('clínica');
        return (data as { name?: string } | null)?.name ?? '';
      },
      async requestByAppointment(clinicId, appointmentId) {
        const { data, error } = await service.from('intake_requests').select(REQUEST_COLUMNS).eq('clinic_id', clinicId).eq('appointment_id', appointmentId).maybeSingle();
        if (error) fail('pré-consulta');
        return (data as IntakeRequestRow | null) ?? null;
      },
      async submission(requestId, submission) {
        const { data, error } = await service.from('intake_submissions').select('registration, health')
          .eq('request_id', requestId).eq('submission', submission).maybeSingle();
        if (error) fail('histórico da pré-consulta');
        return (data as { registration: AnswerItem[]; health: AnswerItem[] } | null) ?? null;
      },
    },
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  };
}

const intakeDepsCors = () => ({ ...allowOriginHeader(), Vary: 'Origin' });

// No ALLOWED_ORIGIN secret means no Access-Control-Allow-Origin: browsers refuse the call instead
// of the function answering any origin (same rule as _shared/cors.ts).
function allowOriginHeader(): Record<string, string> {
  const origin = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim();
  return origin && origin !== '*' ? { 'Access-Control-Allow-Origin': origin } : {};
}
