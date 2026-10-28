import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { assertOAuthRedirect, configuredOAuthRedirects, hashOAuthState } from "../_shared/oauth.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
  'Cache-Control': 'no-store',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') return new Response(null, {status:405,headers:corsHeaders});

  try {
    // The tokens are stored under the JWT-derived identity — a body-supplied
    // userId would let an attacker bind their Google account to a victim's row.
    const { userId } = await requireUser(req);
    const { code, state, redirectUri: rawRedirect } = await readJsonObject(req);
    const redirectUri = assertOAuthRedirect(rawRedirect, configuredOAuthRedirects(key=>Deno.env.get(key)));

    if (typeof code !== 'string' || !code || code.length > 4096 || typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      return new Response(
        JSON.stringify({ error: 'code e redirectUri são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const {data: verifier,error: transactionError} = await supabase.rpc('consume_google_oauth_transaction', {
      p_state_hash:await hashOAuthState(state),p_user_id:userId,p_redirect_uri:redirectUri,
    });
    if (transactionError || typeof verifier !== 'string' || !verifier) {
      return new Response(JSON.stringify({error:'Conexão expirada ou inválida. Inicie novamente pela agenda.'}),
        {status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
    }

    const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
    const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error('GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurados');
    }

    // Exchange code for tokens
    const tokenRes = await fetchWithDeadline('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error('Não foi possível concluir a conexão Google');
    }

    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      throw new Error('refresh_token não retornado. Certifique-se de usar access_type=offline e prompt=consent.');
    }

    const expiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    const { error } = await supabase
      .from('user_integrations')
      .upsert({
        user_id: userId,
        google_refresh_token: tokens.refresh_token,
        google_access_token: tokens.access_token,
        google_token_expiry: expiry,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    return new Response(
      JSON.stringify({ error: 'Não foi possível concluir a conexão Google. Inicie novamente pela agenda.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
