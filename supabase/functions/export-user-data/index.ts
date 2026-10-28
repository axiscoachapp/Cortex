import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertOwnedStoragePath } from "../_shared/storage.ts";
import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin':Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Cache-Control':'no-store','Vary':'Origin',
};

serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:corsHeaders});
  if(req.method!=='POST') return new Response(null,{status:405,headers:corsHeaders});
  try {
    const {userId}=await requireUser(req);
    const body=await readJsonObject(req,8192);
    const db=createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',{global:{fetch:fetchWithDeadline}});
    const validId=(value:unknown):value is string=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
    if(body.action==='file') {
      if(!validId(body.exportId)) throw new RequestError('Exportação inválida. Gere um novo manifesto.');
      let path:string;
      try {path=assertOwnedStoragePath(body.bucket,body.path,userId);}
      catch {throw new RequestError('Arquivo não autorizado',403);}
      const verify=async()=>{
        const {data,error}=await db.rpc('check_export_file',{p_user_id:userId,p_export_id:body.exportId,p_bucket:body.bucket,p_path:path});
        if(error || data!==true) throw new RequestError('O arquivo mudou ou a exportação expirou. Reinicie a exportação.',409);
      };
      await verify();
      const {data:blob,error}=await db.storage.from(body.bucket).download(path);
      if(error || !blob) throw new Error('Não foi possível exportar o arquivo');
      await verify();
      const name=path.split('/').at(-1) ?? 'arquivo';
      return new Response(blob.stream(),{headers:{...corsHeaders,
        'Content-Type':'application/octet-stream',
        'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      }});
    }
    if(body.action==='complete') {
      if(!validId(body.exportId)) throw new RequestError('Exportação inválida.');
      const {data,error}=await db.rpc('complete_data_export_snapshot',{p_user_id:userId,p_export_id:body.exportId});
      if(error || data!==true) throw new RequestError('Os dados mudaram durante a exportação. Reinicie para obter uma cópia consistente.',409);
      return new Response(JSON.stringify({success:true}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    }
    if(body.action!=='manifest') throw new RequestError('Ação de exportação inválida');
    let manifest:Record<string,unknown>;
    if(body.exportId!==undefined) {
      if(!validId(body.exportId)) throw new RequestError('Exportação inválida.');
      const {data,error}=await db.from('data_export_snapshots').select('id,manifest,created_at,expires_at').eq('id',body.exportId).eq('user_id',userId).gt('expires_at',new Date().toISOString()).maybeSingle();
      if(error || !data) throw new RequestError('A exportação expirou. Inicie uma nova cópia.',409);
      manifest={...data.manifest,version:2,exportId:data.id,exportedAt:data.created_at,expiresAt:data.expires_at,userId};
    } else {
      const {data,error}=await db.rpc('create_data_export_snapshot',{p_user_id:userId});
      if(error || !data) throw new Error('Não foi possível criar uma cópia consistente dos dados.');
      manifest=data;
    }
    const {data:account,error:accountError}=await db.auth.admin.getUserById(userId);
    if(accountError || !account.user) throw new Error('Não foi possível exportar os dados da conta');
    return new Response(JSON.stringify({...manifest,email:account.user.email ?? null}),
      {headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch(error) {
    if(error instanceof AuthError) return authResponse(error,corsHeaders);
    return new Response(JSON.stringify({error:error instanceof Error ? error.message : 'Exportação incompleta. Tente novamente.'}),
      {status:error instanceof RequestError ? error.status : 503,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
