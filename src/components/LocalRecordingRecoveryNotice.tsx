import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { listRescuedRecordingMetadata } from '@/lib/recordingRescue';
import { capturesInProgress } from '@/lib/recordingCaptureLock';

const patientRow=z.object({id:z.string().uuid(),name:z.string().min(1).max(2000)}).strict();

/** Home exposes no blob, stored patient name, comments or processing command. */
export function LocalRecordingRecoveryNotice({userId,onResume}:{userId:string;onResume:(id:string)=>void}) {
  const local=useQuery({
    queryKey:['local-recording-recovery',userId],enabled:!!userId,retry:false,gcTime:0,staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:false,refetchOnReconnect:false,
    queryFn:async({signal})=>{
      const [stored,live]=await Promise.all([listRescuedRecordingMetadata(userId,signal),capturesInProgress()]);
      signal.throwIfAborted();
      // A recording another tab is still capturing or uploading is not interrupted.
      const entries=stored.filter(row=>!live.has(row.id));
      const visible=entries.slice(0,50),ids=[...new Set(visible.map(row=>row.patientId))];
      const groups=new Map<string,{id:string;name:string;count:number;createdAt:string}>();
      let unavailable=0;
      if(ids.length){
        const {data,error}=await supabase.from('patients').select('id,name').eq('user_id',userId).is('deletion_requested_at',null).in('id',ids).limit(51).abortSignal(signal);
        if(error)throw error;
        signal.throwIfAborted();
        const patients=z.array(patientRow).max(50).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length&&rows.every(row=>ids.includes(row.id))).parse(data);
        const names=new Map(patients.map(row=>[row.id,row.name]));
        for(const row of visible){
          const name=names.get(row.patientId);
          if(!name){unavailable++;continue;}
          const existing=groups.get(row.patientId);
          if(existing)existing.count++;
          else groups.set(row.patientId,{id:row.patientId,name,count:1,createdAt:row.createdAt});
        }
      }
      return {groups:[...groups.values()],unavailable,hasMore:entries.length>50};
    },
  });
  const fresh=local.isSuccess&&local.isFetchedAfterMount&&!local.isFetching;
  if(!userId||fresh&&!local.data.groups.length&&!local.data.unavailable)return null;
  return <section aria-label="Áudios locais para retomar" className="min-w-0 rounded-xl border border-amber-300/70 bg-amber-50/50 p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Áudios locais para retomar</h2>
      <Button variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal" aria-label="Atualizar áudios locais" disabled={local.isFetching} onClick={()=>void local.refetch()}>Atualizar</Button>
    </div>
    {local.isPending||local.isFetching?<p role="status" className="text-sm">Verificando áudios locais…</p>:local.isError?<div role="alert" className="text-sm space-y-2">
      <p>Não foi possível verificar os áudios locais. As gravações foram preservadas.</p>
      <Button variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal" onClick={()=>void local.refetch()}>Tentar verificar áudios locais</Button>
    </div>:fresh?<>
      <p className="text-sm text-muted-foreground">Gravações interrompidas guardadas neste navegador. Abra o paciente para conferir e decidir o que fazer com o áudio.</p>
      <ul className="max-h-72 overflow-y-auto space-y-2 pr-1">{local.data.groups.map(group=><li key={group.id}>
        <button className="w-full min-w-0 min-h-11 rounded-lg border bg-background p-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={'Abrir áudios locais de '+group.name} onClick={()=>onResume(group.id)}>
          <span className="block text-sm font-medium [overflow-wrap:anywhere]">{group.name}</span>
          <span className="block text-sm text-muted-foreground">{group.count} {group.count===1?'gravação':'gravações'} neste navegador</span>
          <time dateTime={group.createdAt} className="block text-xs text-muted-foreground mt-1">Mais recente em {new Date(group.createdAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</time>
        </button>
      </li>)}</ul>
      {local.data.unavailable>0&&<p className="text-sm">{local.data.unavailable} {local.data.unavailable===1?'gravação local sem paciente disponível':'gravações locais sem paciente disponível'} para esta conta. O áudio permanece neste navegador.</p>}
      {local.data.hasMore&&<p className="text-xs text-muted-foreground">Mostrando as 50 gravações locais mais recentes. Abra o paciente para verificar gravações anteriores.</p>}
    </>:null}
  </section>;
}
