import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from '@/features/reception/accessContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { formatDateOnly } from '@/lib/dates';

const id=z.string().min(1).max(100);
const followup=z.object({
  id,patient_id:id,title:z.string().max(2000),status:z.enum(['open','draft']),due_date:z.string().nullable(),
  updated_at:z.string().max(64).refine(value=>Number.isFinite(Date.parse(value))),
  workflow:z.enum(['waitlist','confirmation']),stage:z.string().nullable(),availability:z.string().nullable(),
  patient:z.object({id,name:z.string().min(1).max(2000)}).strict(),
}).strict().refine(row=>row.patient_id===row.patient.id);
const stages:Record<string,string>={requested:'Aguardando',received:'Recebido',reviewed:'Revisado',acted:'Conduta registrada',contacted:'Contato realizado',confirmed:'Confirmado pelo paciente',declined:'Recusado pelo paciente'};
// Widen the projection string; runtime validation below owns the JSON aliases.
const projection:string='id,patient_id,title,status,due_date,updated_at,workflow:details->>workflow,stage:details->>stage,availability:details->>availability,patient:patients!clinical_work_items_patient_id_user_id_fkey(id,name)';

/** Doctor-owned tasks only. Reception uses its administrative queue and Calendar. */
export function SchedulingFollowups() {
  const {user}=useAuth();const access=useClinicAccess();
  const allowed=!!user&&access?.kind!=='reception'&&user.app_metadata?.account_type!=='reception';
  const work=useQuery({
    queryKey:['scheduling-followups',user?.id],enabled:allowed,staleTime:0,gcTime:0,refetchOnMount:'always',
    queryFn:async({signal})=>{
      const {data,error}=await supabase.from('clinical_work_items')
        .select(projection)
        .eq('user_id',user!.id).eq('kind','task').in('status',['open','draft'])
        .in('details->>workflow',['waitlist','confirmation']).order('updated_at',{ascending:false}).order('id')
        .limit(51).abortSignal(signal);
      if(error)throw error;
      return z.array(followup).max(51).parse(data);
    },
  });
  if(!allowed)return null;
  return <section aria-label="Lista de espera e confirmações" className="min-w-0 rounded-xl border bg-background p-4 sm:p-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Lista de espera e confirmações</h2>
      <Button variant="outline" aria-label="Atualizar acompanhamentos da agenda" disabled={work.isFetching} onClick={()=>void work.refetch()}>Atualizar</Button>
    </div>
    <p className="text-sm text-muted-foreground">Acompanhamentos privados da sua conta. Abra o paciente para editar ou concluir um registro. Uma confirmação registrada não reserva horário.</p>
    {work.isError?<p role="alert">Não foi possível carregar os acompanhamentos.{' '}<button className="underline min-h-10" disabled={work.isFetching} onClick={()=>void work.refetch()}>Tentar carregar acompanhamentos</button></p>
      :work.isPending||work.isFetching?<p role="status">Carregando acompanhamentos…</p>
      :work.data?.length?<>
        <ul className="grid md:grid-cols-2 gap-3">
          {work.data.slice(0,50).map(item=><li key={item.id} className="min-w-0 break-words rounded-lg border p-4 space-y-2">
            <h3 className="font-semibold">{item.patient.name}</h3>
            <p className="text-sm">{item.title}</p>
            <p className="text-sm text-muted-foreground">{item.workflow==='waitlist'?'Lista de espera':'Confirmação'} · {stages[item.stage??'requested']??'Etapa não reconhecida'}</p>
            {item.availability&&<p className="text-sm">Disponibilidade informada: {item.availability}</p>}
            {item.due_date&&<p className="text-sm">Prazo: {formatDateOnly(item.due_date)}</p>}
            <p className="text-xs text-muted-foreground">Atualizado em {new Date(item.updated_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</p>
            <Link className="inline-flex items-center min-h-11 text-sm text-primary underline underline-offset-4" aria-label={'Abrir paciente '+item.patient.name} to={'/?'+new URLSearchParams({patient:item.patient_id}).toString()}>Abrir paciente</Link>
          </li>)}
        </ul>
        {work.data.length>50&&<p className="text-xs text-muted-foreground">Mostrando os 50 acompanhamentos mais recentes. Consulte registros anteriores no paciente.</p>}
      </>:<p className="text-sm text-muted-foreground">Nenhum acompanhamento de espera ou confirmação em aberto.</p>}
  </section>;
}
