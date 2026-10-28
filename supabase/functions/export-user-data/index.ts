import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertOwnedStoragePath, listStoragePrefix } from "../_shared/storage.ts";
import { readJsonObject, RequestError } from "../_shared/http.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin':Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Cache-Control':'no-store','Vary':'Origin',
};
const TABLES = [
  ['patients','id'],['consultations','id'],['appointments','id'],['patient_files','id'],
  ['prescriptions','id'],['user_settings','user_id'],['usage_daily','day'],
  ['document_templates','id'],['knowledge_documents','id'],['knowledge_chunks','id'],
  ['consultation_drafts','id'],['clinical_record_revisions','id'],
  ['usage_reservations','id'],['account_deletion_requests','user_id'],
] as const;

serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:corsHeaders});
  if(req.method!=='POST') return new Response(null,{status:405,headers:corsHeaders});
  try {
    const {userId}=await requireUser(req);
    const body=await readJsonObject(req,8192);
    const db=createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    if(body.action==='file') {
      let path:string;
      try {path=assertOwnedStoragePath(body.bucket,body.path,userId);}
      catch {throw new RequestError('Arquivo não autorizado',403);}
      const {data:blob,error}=await db.storage.from(body.bucket).download(path);
      if(error || !blob) throw new Error('Não foi possível exportar o arquivo');
      const name=path.split('/').at(-1) ?? 'arquivo';
      return new Response(blob.stream(),{headers:{...corsHeaders,
        'Content-Type':'application/octet-stream',
        'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      }});
    }
    if(body.action!=='manifest') throw new RequestError('Ação de exportação inválida');
    const tables:Record<string,unknown[]>={};
    // Stable ordering + explicit pages avoids the API's default row cap.
    for(const [table,order] of TABLES) {
      const rows:unknown[]=[];
      for(let offset=0;;) {
        const {data,error}=await db.from(table).select('*').eq('user_id',userId)
          .order(order,{ascending:true}).range(offset,offset+499);
        if(error || !data) throw new Error('Não foi possível exportar todos os registros');
        rows.push(...data);
        if(!data.length) break;
        offset+=data.length;
      }
      tables[table]=rows;
    }
    // The sanitized view has no access/refresh token columns. Never export the
    // underlying integrations table or OAuth transaction verifier/state hashes.
    const {data:integration,error:integrationError}=await db.from('user_integration_status')
      .select('google_connected,google_calendar_id,created_at,updated_at').eq('user_id',userId);
    if(integrationError || !integration) throw new Error('Não foi possível exportar as integrações');
    tables.user_integration_status=integration;
    const files=[];
    for(const [bucket,prefix] of [['patient-files',`patients/${userId}`],['audio-recordings',`consultations/${userId}`],['prescriptions',`rx/${userId}`]]) {
      files.push(...await listStoragePrefix(db.storage,bucket,prefix));
    }
    const {data:account,error:accountError}=await db.auth.admin.getUserById(userId);
    if(accountError || !account.user) throw new Error('Não foi possível exportar os dados da conta');
    return new Response(JSON.stringify({version:1,exportedAt:new Date().toISOString(),userId,email:account.user.email ?? null,tables,files}),
      {headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch(error) {
    if(error instanceof AuthError) return authResponse(error,corsHeaders);
    return new Response(JSON.stringify({error:error instanceof Error ? error.message : 'Exportação incompleta. Tente novamente.'}),
      {status:error instanceof RequestError ? error.status : 503,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
