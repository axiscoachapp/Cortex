import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
};

// Live assistance is disabled by the clinic's implementation policy. A stale
// client setting or a direct endpoint request cannot activate paid inference.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    await requireUser(req);
    return new Response(JSON.stringify({
      error: 'Copiloto ao vivo desativado. A gravação e a revisão da consulta continuam disponíveis.',
    }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    return new Response(JSON.stringify({ error: 'Não foi possível verificar o acesso.' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
