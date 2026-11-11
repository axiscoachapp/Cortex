import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

const statusLabels = {
  processing: 'Processamento pendente',
  review: 'Aguardando revisão',
  error: 'Nova tentativa necessária',
};
const id = z.string().min(1).max(100);
const recoveryRow = z.object({
  id,
  patient_id: id,
  status: z.enum(['processing', 'review', 'error']),
  updated_at: z.string().max(64).refine(value => Number.isFinite(Date.parse(value))),
  patient: z.object({id, name: z.string().min(1).max(2000)}).strict(),
}).strict().refine(row => row.patient_id === row.patient.id);

export const CONSULTATION_RECOVERY_KEY = 'consultation-recovery';

/** Metadata only; recovery and all writes stay in the selected patient's chart. */
export function ConsultationRecoveryNotice({ userId, onResume }: {
  userId: string;
  onResume: (patientId: string) => void;
}) {
  const drafts = useQuery({
    queryKey: [CONSULTATION_RECOVERY_KEY, userId],
    enabled: !!userId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    queryFn: async ({signal}) => {
      const {data,error} = await supabase.from('consultation_drafts')
        .select('id,patient_id,status,updated_at,patient:patients!draft_patient_owner_fk(id,name)')
        .eq('user_id',userId)
        .is('discard_requested_at',null)
        .in('status',['processing','review','error'])
        .order('updated_at',{ascending:false}).order('id')
        .limit(51).abortSignal(signal);
      if (error) throw error;
      return z.array(recoveryRow).max(51).parse(data);
    },
  });
  // Rendered only with something to resume or an error, so Home does not jump on
  // every load: the first check runs out of sight.
  if (!userId || !drafts.isError && !drafts.data?.length) return null;
  return <section aria-label="Consultas para retomar" className="min-w-0 rounded-xl border border-amber-300/70 bg-amber-50/50 p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Consultas para retomar</h2>
      <Button variant="outline" size="sm" aria-label={drafts.isError ? 'Tentar novamente' : 'Atualizar consultas para retomar'} disabled={drafts.isFetching}
        onClick={() => void drafts.refetch()} className="min-h-11 gap-2">
        <RefreshCw className="w-4 h-4" aria-hidden="true" />{drafts.isError ? 'Tentar novamente' : 'Atualizar'}
      </Button>
    </div>
    {drafts.isError ? <p role="alert" className="text-sm">Não foi possível verificar as consultas para retomar.</p>
      : drafts.isFetching ? <p role="status" className="text-sm">Verificando consultas…</p> : <>
      <p className="text-sm text-muted-foreground">Abra o paciente para revisar a consulta ou recuperar o áudio. Nenhum processamento é iniciado aqui.</p>
      <ul className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {drafts.data?.slice(0,50).map(draft => <li key={draft.id}>
          <button className="w-full min-w-0 min-h-11 rounded-lg border bg-background p-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={'Retomar consulta de ' + draft.patient.name} onClick={() => onResume(draft.patient_id)}>
            <span className="block break-words text-sm font-medium">{draft.patient.name}</span>
            <span className="block text-sm text-muted-foreground">{statusLabels[draft.status]}</span>
            <time dateTime={draft.updated_at} className="block text-xs text-muted-foreground mt-1">
              Atualizada em {new Date(draft.updated_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}
            </time>
          </button>
        </li>)}
      </ul>
      {drafts.data && drafts.data.length > 50 && <p className="text-xs text-muted-foreground">Mostrando as 50 consultas mais recentes. Abra o paciente para verificar consultas anteriores.</p>}
    </>}
  </section>;
}
