// Starts the Google Calendar connection (PKCE S256, single-use state hashed at rest).
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_TOKEN_KEYS and ALLOWED_ORIGIN. The token key is checked here too,
// so the doctor is not sent through Google's consent only to be refused at the callback.
// Contract: docs/product/google-agenda/CONTRATO.md.
import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import {
  assertOAuthRedirect, configuredOAuthRedirects, createOAuthSecrets, googleTokenKeys, GoogleTokensNotConfigured, hashOAuthState,
} from "../_shared/oauth.ts";
import { corsHeadersFor } from "../_shared/cors.ts";

const corsHeaders = corsHeadersFor(Deno.env.get('ALLOWED_ORIGIN'), { 'Cache-Control': 'no-store' });
serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null,{headers:corsHeaders});
  if (req.method !== 'POST') return new Response(null,{status:405,headers:corsHeaders});
  try {
    const {userId} = await requireUser(req);
    const {redirectUri: rawRedirect} = await readJsonObject(req);
    const redirectUri = assertOAuthRedirect(rawRedirect,configuredOAuthRedirects(key=>Deno.env.get(key)));
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    if (!clientId) throw new Error('Integração Google indisponível');
    googleTokenKeys(Deno.env.get('GOOGLE_TOKEN_KEYS'));
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
    if (error instanceof GoogleTokensNotConfigured)
      return new Response(JSON.stringify({error:error.message,code:'not_configured'}),{status:503,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error,corsHeaders);
    return new Response(JSON.stringify({error:'Não foi possível iniciar a conexão Google. Verifique a configuração e tente novamente.'}),
      {status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
