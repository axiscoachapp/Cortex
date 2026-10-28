import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertOAuthRedirect, configuredOAuthRedirects, createOAuthSecrets, hashOAuthState } from "../_shared/oauth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Cache-Control':'no-store', 'Vary':'Origin',
};
serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null,{headers:corsHeaders});
  if (req.method !== 'POST') return new Response(null,{status:405,headers:corsHeaders});
  try {
    const {userId} = await requireUser(req);
    const {redirectUri: rawRedirect} = await readJsonObject(req);
    const redirectUri = assertOAuthRedirect(rawRedirect,configuredOAuthRedirects(key=>Deno.env.get(key)));
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    if (!clientId) throw new Error('Integração Google indisponível');
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const {state,verifier,challenge} = await createOAuthSecrets();
    const {error: clearError} = await db.from('google_oauth_transactions').delete().eq('user_id',userId);
    if (clearError) throw new Error('Não foi possível iniciar a conexão');
    const {error} = await db.from('google_oauth_transactions').insert({
      state_hash:await hashOAuthState(state),user_id:userId,redirect_uri:redirectUri,code_verifier:verifier,
    });
    if (error) throw new Error('Não foi possível iniciar a conexão');
    const params = new URLSearchParams({
      client_id:clientId,redirect_uri:redirectUri,response_type:'code',
      scope:'https://www.googleapis.com/auth/calendar.events',access_type:'offline',prompt:'consent',
      state,code_challenge:challenge,code_challenge_method:'S256',
    });
    return new Response(JSON.stringify({authorizationUrl:`https://accounts.google.com/o/oauth2/v2/auth?${params}`}),
      {headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error,corsHeaders);
    return new Response(JSON.stringify({error:'Não foi possível iniciar a conexão Google. Verifique a configuração e tente novamente.'}),
      {status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
