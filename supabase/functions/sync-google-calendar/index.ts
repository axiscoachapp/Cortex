import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getAccessToken(supabase: any, userId: string): Promise<string> {
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.google_refresh_token,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);

  const tokens = await res.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('user_integrations')
    .update({ google_access_token: tokens.access_token, google_token_expiry: newExpiry })
    .eq('user_id', userId);

  return tokens.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Identity comes from the JWT — the body userId is ignored. Without this,
    // any caller could exercise any user's stored Google OAuth tokens.
    const { userId } = await requireUser(req);
    const { action, appointment } = await req.json();

    if (!action || !appointment?.id) {
      return new Response(
        JSON.stringify({ error: 'action e appointment.id são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Never trust event content from the body: load the appointment from the
    // DB, scoped to the authenticated user. For 'delete' the row may already
    // be gone, so fall back to the body's google_event_id in that case only.
    const { data: dbAppt } = await supabase
      .from('appointments')
      .select('id, title, notes, start_time, end_time, google_event_id')
      .eq('id', appointment.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!dbAppt && action !== 'delete') {
      return new Response(
        JSON.stringify({ error: 'Consulta não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const accessToken = await getAccessToken(supabase, userId);
    const calendarId = 'primary';
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

    const authHeader = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    if (action === 'delete') {
      const eventId = dbAppt?.google_event_id ?? appointment.google_event_id;
      if (!eventId) {
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      await fetch(`${baseUrl}/${eventId}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const eventBody = {
      summary: dbAppt!.title,
      description: dbAppt!.notes ?? '',
      start: { dateTime: dbAppt!.start_time, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: dbAppt!.end_time, timeZone: 'America/Sao_Paulo' },
    };

    let googleEventId: string | null = dbAppt!.google_event_id ?? null;

    if (action === 'update' && googleEventId) {
      const res = await fetch(`${baseUrl}/${googleEventId}`, {
        method: 'PUT',
        headers: authHeader,
        body: JSON.stringify(eventBody),
      });
      // Event was deleted on the Google side — recreate instead of failing.
      if (res.status === 404 || res.status === 410) {
        googleEventId = null;
      } else if (!res.ok) {
        throw new Error(`Google Calendar update failed: ${await res.text()}`);
      }
    }

    // 'create', or 'update' with no linked event yet (previous sync failed or
    // the event vanished) — create and store the id back.
    if (action === 'create' || (action === 'update' && !googleEventId)) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(eventBody),
      });
      if (!res.ok) throw new Error(`Google Calendar create failed: ${await res.text()}`);
      const created = await res.json();
      googleEventId = created.id;

      await supabase
        .from('appointments')
        .update({ google_event_id: googleEventId })
        .eq('id', dbAppt!.id)
        .eq('user_id', userId);
    }

    return new Response(
      JSON.stringify({ success: true, googleEventId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('sync-google-calendar error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
