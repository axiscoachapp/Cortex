import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { removeStoragePrefix } from "../_shared/storage.ts";
import { requireSafeDeletion } from "../_shared/deletion.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin':Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Cache-Control':'no-store', 'Vary':'Origin',
};
serve(async req => {
  if (req.method==='OPTIONS') return new Response(null,{headers:corsHeaders});
  if (req.method!=='POST') return new Response(null,{status:405,headers:corsHeaders});
  try {
    const {userId} = await requireUser(req);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    await requireSafeDeletion(admin,userId);
    // Persistent intent blocks new writes; failed cleanup can be retried safely.
    const {error: lockError} = await admin.from('account_deletion_requests').upsert({user_id:userId});
    if (lockError) throw new Error('Não foi possível iniciar a exclusão');
    await removeStoragePrefix(admin.storage,'patient-files',`patients/${userId}`);
    await removeStoragePrefix(admin.storage,'audio-recordings',`consultations/${userId}`);
    await removeStoragePrefix(admin.storage,'prescriptions',`rx/${userId}`);
    const {data: integration,error: integrationError} = await admin.from('user_integrations')
      .select('google_refresh_token').eq('user_id',userId).maybeSingle();
    if (integrationError) throw new Error('Não foi possível verificar as integrações');
    if (integration?.google_refresh_token) {
      const response = await fetchWithDeadline('https://oauth2.googleapis.com/revoke',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({token:integration.google_refresh_token}),
      });
      if (!response.ok) {
        const body = await response.json().catch(()=>null);
        if (response.status!==400 || body?.error!=='invalid_token') throw new Error('Não foi possível desconectar o Google. Tente a exclusão novamente.');
      }
    }
    // Cascades include drafts and revisions. Remove metadata only after storage
    // succeeds so partial failures leave enough information for a safe retry.
    const {error} = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error('Não foi possível concluir a exclusão da conta');
    return new Response(JSON.stringify({success:true,message:'Todos os dados foram excluídos permanentemente.'}),
      {headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error,corsHeaders);
    return new Response(JSON.stringify({error:error instanceof Error ? error.message : 'Exclusão incompleta. Tente novamente.'}),
      {status:503,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
