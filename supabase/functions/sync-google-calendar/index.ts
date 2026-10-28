import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { fetchWithDeadline, readJsonObject, RequestError } from '../_shared/http.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

async function getAccessToken(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_integrations')
    .select('google_refresh_token, google_access_token, google_token_expiry')
    .eq('user_id', userId)
    .single();

  if (error || !data?.google_refresh_token) {
    throw new Error('Google Calendar não conectado para este usuário');
  }

  // If token still valid (with 60s buffer), reuse it
  if (data.google_access_token && data.google_token_expiry) {
    const expiry = new Date(data.google_token_expiry);
    if (expiry.getTime() > Date.now() + 60000) {
      return data.google_access_token;
    }
  }

  // Refresh the access token
  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Integração Google não configurada');
  const res = await fetchWithDeadline('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.google_refresh_token,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) throw new RequestError('Não foi possível renovar a conexão Google. Reconecte pela agenda.', 502);

  const tokens = await res.json();
  if (typeof tokens.access_token !== 'string' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new RequestError('Resposta Google inválida.', 502);
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: saveError } = await supabase
    .from('user_integrations')
    .update({ google_access_token: tokens.access_token, google_token_expiry: newExpiry })
    .eq('user_id', userId);
  if (saveError) throw new Error('Não foi possível salvar a conexão Google.');

  return tokens.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let finalizeOperation: ((status: string, error?: string) => Promise<void>) | undefined;
  try {
    // Identity comes from the JWT — the body userId is ignored. Without this,
    // any caller could exercise any user's stored Google OAuth tokens.
    const { userId } = await requireUser(req);
    const { action, appointment } = await readJsonObject(req);

    if (!['create', 'update', 'delete'].includes(action) || typeof appointment?.id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'action e appointment.id são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Every mutation, including deletion, requires an existing owned row.
    // The UI deletes the local row only after the Google operation succeeds.
    const { data: ownedAppt, error: readError } = await supabase
      .from('appointments')
      .select('id, title, notes, start_time, end_time, google_event_id')
      .eq('id', appointment.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (readError) throw new Error('Não foi possível consultar o agendamento.');
    if (!ownedAppt) {
      return new Response(
        JSON.stringify({ error: 'Consulta não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: operation, error: claimError } = await supabase.rpc('claim_calendar_sync', { p_user_id: userId, p_appointment_id: appointment.id });
    if (claimError) throw new RequestError('Não foi possível iniciar a sincronização.', 503);
    if (!operation) throw new RequestError('Sincronização em andamento. Aguarde e tente novamente.', 409);
    const dbAppt = operation.appointment;
    finalizeOperation = async (status: string, error?: string) => {
      const { data, error: finishError } = await supabase.rpc('finish_calendar_sync', { p_user_id: userId, p_appointment_id: appointment.id,
        p_claim: operation.claim, p_revision: dbAppt.google_sync_revision, p_status: status, p_error: error ?? null });
      if (finishError || data !== true) throw new RequestError('Sincronização pendente. Atualize a agenda e tente novamente.', 503);
    };
    if (action === 'delete' && !dbAppt.google_event_id) {
      await finalizeOperation('synced'); finalizeOperation = undefined;
      return new Response(JSON.stringify({success:true}), { headers: {...corsHeaders, 'Content-Type':'application/json'} });
    }
    const accessToken = await getAccessToken(supabase, userId);
    const calendarId = 'primary';
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

    const authHeader = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    if (action === 'delete') {
      const eventId = dbAppt.google_event_id;
      if (!eventId) {
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const removed = await fetchWithDeadline(`${baseUrl}/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      if (!removed.ok && removed.status !== 404 && removed.status !== 410) throw new RequestError('Não foi possível excluir no Google. O agendamento foi preservado para tentar novamente.', 502);
      await finalizeOperation('synced'); finalizeOperation = undefined;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const eventBody = {
      summary: dbAppt!.title,
      status: dbAppt.status === 'cancelado' ? 'cancelled' : 'confirmed',
      description: dbAppt!.notes ?? '',
      start: { dateTime: dbAppt!.start_time, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: dbAppt!.end_time, timeZone: 'America/Sao_Paulo' },
    };

    let googleEventId: string | null = dbAppt!.google_event_id ?? null;

    if (googleEventId) {
      const res = await fetchWithDeadline(`${baseUrl}/${encodeURIComponent(googleEventId)}`, {
        method: 'PUT',
        headers: authHeader,
        body: JSON.stringify(eventBody),
      });
      // Event was deleted on the Google side — recreate instead of failing.
      if (res.status === 404 || res.status === 410) {
        googleEventId = null;
      } else if (!res.ok) {
        throw new RequestError('Não foi possível atualizar no Google. Tente novamente.', 502);
      }
    }

    // 'create', or 'update' with no linked event yet (previous sync failed or
    // the event vanished) — create and store the id back.
    if ((action === 'create' || action === 'update') && !googleEventId) {
      // Persist the creation identity BEFORE the provider mutation. Both a
      // response lost after creation and a later DB failure retry this same ID.
      const creationId = crypto.randomUUID().replaceAll('-', '');
      const { data: registered, error: identityError } = await supabase.from('appointments').update({ google_event_id: creationId })
        .eq('id', dbAppt.id).eq('user_id', userId).eq('google_sync_claim', operation.claim)
        .eq('google_sync_revision', dbAppt.google_sync_revision).select('id').maybeSingle();
      if (identityError || !registered) throw new RequestError('O agendamento mudou ou a operação expirou. Tente sincronizar novamente.', 409);
      googleEventId = creationId;
      const res = await fetchWithDeadline(baseUrl, { method: 'POST', headers: authHeader,
        body: JSON.stringify({ ...eventBody, id: creationId }) });
      if (res.status === 409) {
        const reconciled = await fetchWithDeadline(`${baseUrl}/${encodeURIComponent(creationId)}`, { method: 'PUT', headers: authHeader, body: JSON.stringify(eventBody) });
        if (!reconciled.ok) throw new RequestError('Não foi possível reconciliar o evento Google. Tente novamente.', 502);
      } else if (!res.ok) throw new RequestError('Não foi possível criar no Google. Tente novamente.', 502);
    }
    await finalizeOperation('synced'); finalizeOperation = undefined;

    return new Response(
      JSON.stringify({ success: true, googleEventId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    if (finalizeOperation) {
      try { await finalizeOperation('failed', 'Falha de sincronização. Tente novamente pela agenda.'); } catch { /* durable lease expires; do not hide the original failure */ }
    }
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('sync-google-calendar failed');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
