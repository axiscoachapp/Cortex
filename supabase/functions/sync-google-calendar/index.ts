import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { action, userId, appointment } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const accessToken = await getAccessToken(supabase, userId);
    const calendarId = 'primary';
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

    const authHeader = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    if (action === 'delete') {
      if (!appointment.google_event_id) {
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      await fetch(`${baseUrl}/${appointment.google_event_id}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const eventBody = {
      summary: appointment.title,
      description: appointment.notes ?? '',
      start: { dateTime: appointment.start_time, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: appointment.end_time, timeZone: 'America/Sao_Paulo' },
    };

    let googleEventId: string | null = null;

    if (action === 'create') {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(eventBody),
      });
      if (!res.ok) throw new Error(`Google Calendar create failed: ${await res.text()}`);
      const created = await res.json();
      googleEventId = created.id;

      // Store google_event_id back
      await supabase
        .from('appointments')
        .update({ google_event_id: googleEventId })
        .eq('id', appointment.id);
    } else if (action === 'update' && appointment.google_event_id) {
      const res = await fetch(`${baseUrl}/${appointment.google_event_id}`, {
        method: 'PUT',
        headers: authHeader,
        body: JSON.stringify(eventBody),
      });
      if (!res.ok) throw new Error(`Google Calendar update failed: ${await res.text()}`);
    }

    return new Response(
      JSON.stringify({ success: true, googleEventId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('sync-google-calendar error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
