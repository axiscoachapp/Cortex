import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertAudioPath, assertPrescriptionPath, removeStoragePrefix } from "../_shared/storage.ts";
import { requireSafeDeletion } from "../_shared/deletion.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin':Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Cache-Control':'no-store', 'Vary':'Origin',
};
serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:corsHeaders});
  if(req.method!=='POST') return new Response(null,{status:405,headers:corsHeaders});
  try {
    const {userId}=await requireUser(req);
    const {patientId}=await readJsonObject(req);
    if(typeof patientId!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(patientId)) {
      return new Response(JSON.stringify({error:'Paciente inválido'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
    }
    const db=createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const {data:patient,error:readError}=await db.from('patients').select('id,deletion_requested_at')
      .eq('id',patientId).eq('user_id',userId).maybeSingle();
    if(readError) throw new Error('Não foi possível verificar o paciente');
    if(!patient) return new Response(JSON.stringify({success:true}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    await requireSafeDeletion(db,userId,patientId);
    if(!patient.deletion_requested_at) {
      const {error}=await db.from('patients').update({deletion_requested_at:new Date().toISOString()})
        .eq('id',patientId).eq('user_id',userId).is('deletion_requested_at',null);
      if(error) throw new Error('Não foi possível iniciar a exclusão');
    }
    await removeStoragePrefix(db.storage,'patient-files',`patients/${userId}/${patientId}`);
    // Enumerate metadata before deleting it. Failed removals leave a resumable job.
    for(let offset=0;;) {
      const {data:rows,error}=await db.from('prescriptions').select('id,storage_path')
        .eq('user_id',userId).eq('patient_id',patientId).order('id').range(offset,offset+99);
      if(error || !rows) throw new Error('Não foi possível listar os documentos');
      if(rows.length) {
        const paths=rows.map(row=>assertPrescriptionPath(row.storage_path,userId,row.id));
        const {error:removeError}=await db.storage.from('prescriptions').remove(paths);
        if(removeError) throw new Error('Não foi possível excluir os documentos');
      }
      if(!rows.length) break;
      offset+=rows.length;
    }
    for(let offset=0;;) {
      const {data:rows,error}=await db.from('consultation_drafts').select('audio_storage_path')
        .eq('user_id',userId).eq('patient_id',patientId).order('id').range(offset,offset+99);
      if(error || !rows) throw new Error('Não foi possível listar os áudios');
      const paths=rows.filter(row=>row.audio_storage_path).map(row=>assertAudioPath(row.audio_storage_path,userId));
      if(paths.length) {
        const {error:removeError}=await db.storage.from('audio-recordings').remove(paths);
        if(removeError) throw new Error('Não foi possível excluir os áudios');
      }
      if(!rows.length) break;
      offset+=rows.length;
    }
    const {error:deleteError}=await db.from('patients').delete().eq('id',patientId).eq('user_id',userId);
    if(deleteError) throw new Error('Não foi possível concluir a exclusão');
    return new Response(JSON.stringify({success:true}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch(error) {
    if(error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if(error instanceof AuthError) return authResponse(error,corsHeaders);
    return new Response(JSON.stringify({error:error instanceof Error ? error.message : 'Exclusão incompleta. Tente novamente.'}),
      {status:503,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
