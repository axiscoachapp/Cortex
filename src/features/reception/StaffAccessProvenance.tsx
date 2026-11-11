import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { delegationApi } from './delegationApi';
import { ReceptionNotice } from './ReceptionNotice';
import { WithdrawDelegation } from './WithdrawDelegation';

type Props = { actorId: string; clinicId: string; staffId: string; staffName: string };
export function StaffAccessProvenance(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return <div className="space-y-3 border-t pt-3">
    <Button variant="ghost" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal text-left" aria-expanded={expanded}
      aria-label={`${expanded ? 'Ocultar' : 'Ver'} quem autorizou as agendas de ${props.staffName}`} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Ocultar quem autorizou' : 'Ver quem autorizou'}
    </Button>
    {expanded && <AccessDetails key={`${props.actorId}:${props.clinicId}:${props.staffId}`} {...props} />}
  </div>;
}
const sourceLabels = { physician_approval: 'Aprovado pelo médico', legacy: 'Acesso antigo, sem aprovação registrada', unverified: 'Aprovação não confirmada' } as const;
function AccessDetails({ actorId, clinicId, staffId }: Props) {
  const client = useQueryClient();
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['reception', 'staff-permission-origin', actorId, clinicId, staffId] }),
    client.invalidateQueries({ queryKey: ['reception', 'staff-card-origin', actorId, clinicId, staffId] }),
    client.invalidateQueries({ queryKey: ['clinic-access', actorId] }),
    client.invalidateQueries({ queryKey: ['reception-delegations', actorId] }),
  ]);
  const page = useInfiniteQuery({
    queryKey: ['reception', 'staff-permission-origin', actorId, clinicId, staffId],
    queryFn: ({ pageParam }) => delegationApi.permissions({ clinicId, staffId, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 0, retry: false, refetchOnWindowFocus: true, refetchInterval: 15_000,
  });
  const verified = page.isSuccess && page.isFetchedAfterMount;
  const rows = verified ? page.data.pages.flatMap(value => value.items) : [];
  return <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
    <ReceptionNotice loading={page.isPending} error={page.error} onRetry={() => void page.refetch()} />
    {verified && <>
      {!rows.length && <p>Nenhuma agenda liberada para esta conta.</p>}
      <ul className="space-y-3">{rows.map(row => <li key={row.doctorId} className="space-y-1 break-words border-b pb-3 last:border-b-0 last:pb-0">
        <p className="font-medium">{row.doctorName}</p>
        <p className={row.source === 'physician_approval' ? 'text-primary' : 'text-muted-foreground'}>{sourceLabels[row.source]}</p>
        <p className="text-xs text-muted-foreground">{row.effective ? 'Acesso ativo' : 'Sem acesso ativo'}</p>
        {row.source === 'physician_approval' && <WithdrawDelegation key={row.requestId} actorId={actorId} clinicId={clinicId} staffId={staffId} doctorId={row.doctorId} requestId={row.requestId} doctorName={row.doctorName} disabled={page.isFetching} onRevoked={refresh} />}
      </li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={page.isFetching} onClick={() => void page.refetch()}>Atualizar</Button>
        {page.hasNextPage && <Button size="sm" variant="outline" className="min-h-11" disabled={page.isFetching} onClick={() => void page.fetchNextPage()}>Carregar mais</Button>}
      </div>
      <Link to={`/permissoes-recepcao?clinica=${clinicId}`} className="inline-flex min-h-11 items-center underline">Ver pedidos de acesso da clínica</Link>
    </>}
  </div>;
}
