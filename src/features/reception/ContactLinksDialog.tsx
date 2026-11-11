import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import type { LinkEdit } from './contracts';
import { LinkRelationshipDialog } from './LinkRelationshipDialog';
import { LinkStateDialog } from './LinkStateDialog';
import { relationshipLabels } from './linkRelationships';
import { ReceptionNotice } from './ReceptionNotice';
import { LoadErrorNotice, NoAccessNotice } from '@/features/shared/StatusNotice';
import { dialogLayout } from './dialogLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';

type Props = { contactId: string; contactName: string; onClose: () => void };
export function ContactLinksDialog(props: Props) {
  const access = useClinicAccess();
  const { user } = useAuth();
  const hidden = useSessionHidden();
  if (hidden) return null;
  if (!access?.admin || !access.active || access.kind !== 'clinical' || !access.clinic || user?.id !== access.actorId)
    return <NoAccessNotice message="Sua conta não pode ver os pacientes ligados a este contato." backTo={null} />;
  return <LinkList key={`${access.actorId}:${access.clinic.id}:${props.contactId}`} {...props} actorId={access.actorId} clinicId={access.clinic.id} />;
}
function LinkList({ actorId, clinicId, contactId, contactName, onClose }: Props & { actorId: string; clinicId: string }) {
  const client = useQueryClient();
  const reader = useId(), mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryKey = ['reception', actorId, 'contact-links', clinicId, contactId, reader];
  const [editing, setEditing] = useState<LinkEdit | null>(null), [changingState, setChangingState] = useState<LinkEdit | null>(null), [saved, setSaved] = useState<string | null>(null);
  const page = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      return receptionApi.contactLinks(clinicId, contactId, pageParam, 50, signal);
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: 'always', refetchOnWindowFocus: true,
  });
  const verified = page.isSuccess && page.isFetchedAfterMount && page.fetchStatus === 'idle';
  const withSnapshot = (action: () => void) => {
    const latest = client.getQueryState(queryKey);
    if (mounted.current && verified && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === page.data) action();
  };
  const rows = verified ? page.data.pages.flatMap(value => value.items) : [];
  if (editing) return <LinkRelationshipDialog contactId={contactId} patientId={editing.patientId} doctorId={editing.doctorId} contactName={contactName} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved('Relação corrigida.'); }} />;
  if (changingState) return <LinkStateDialog contactId={contactId} patientId={changingState.patientId} doctorId={changingState.doctorId} contactName={contactName} targetActive={!changingState.active} onClose={() => { setChangingState(null); void client.invalidateQueries({ queryKey: ['reception'] }); }} onSaved={() => { setChangingState(null); setSaved(changingState.active ? 'Ligação suspensa. O histórico foi mantido.' : 'Ligação reativada.'); }} />;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
      <DialogHeader className={dialogLayout.header}><DialogTitle>Pacientes ligados</DialogTitle><DialogDescription>Os pacientes ligados a este contato, com o médico e a relação de cada um.</DialogDescription></DialogHeader>
      <div className={dialogLayout.body}>
      {verified && <p className="break-words text-sm font-medium">Contato: {contactName}</p>}
      {saved && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{saved}</p>}
      {page.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando a conexão para carregar os pacientes ligados…</p>
        : page.isPending || page.isFetching ? <ReceptionNotice loading />
        : page.isError ? <LoadErrorNotice subject="os pacientes ligados" onRetry={() => void page.refetch()} /> : null}
      {verified && <>
        {!rows.length && <p className="rounded-lg border bg-muted/30 p-4 text-sm">Nenhum paciente ligado a este contato.</p>}
        <ul className="space-y-3">{rows.map(row => <li key={row.patientId} className="min-w-0 space-y-3 rounded-lg border p-4">
          <h3 className="break-words text-sm font-semibold">{row.patientName}</h3>
          <dl className="space-y-2 break-words text-sm">
            <div><dt className="text-xs text-muted-foreground">Médico</dt><dd>{row.doctorName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Nascimento</dt><dd>{row.dateOfBirth ? row.dateOfBirth.split('-').reverse().join('/') : 'Não informado'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Relação do contato</dt><dd>{relationshipLabels[row.relationship]}</dd></div>
          </dl>
          {(!row.active || !row.patientAvailable || !row.doctorActive) && <p className="text-xs text-muted-foreground">{[!row.active && 'Ligação suspensa', !row.patientAvailable && 'Paciente indisponível', !row.doctorActive && 'Médico indisponível'].filter(Boolean).join(' · ')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={!row.active || !row.patientAvailable || !row.doctorActive} onClick={() => withSnapshot(() => { setSaved(null); setEditing(row); })}>Corrigir relação de {row.patientName}</Button>
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={!row.active && (!row.patientAvailable || !row.doctorActive)} onClick={() => withSnapshot(() => { setSaved(null); setChangingState(row); })}>{row.active ? 'Suspender' : 'Reativar'} ligação de {row.patientName}</Button>
          </div>
        </li>)}</ul>
        <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? 'paciente ligado' : 'pacientes ligados'}</p>
        {page.hasNextPage && <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => withSnapshot(() => { void page.fetchNextPage(); })}>Carregar mais pacientes</Button>}
      </>}
      </div>
      <div className={dialogLayout.footer}><div className={dialogLayout.actions}>
        {verified && <Button type="button" variant="ghost" className={dialogLayout.button} onClick={() => withSnapshot(() => { void page.refetch(); })}>Atualizar lista</Button>}
        <Button type="button" variant="outline" className={dialogLayout.button} onClick={onClose}>Fechar janela</Button>
      </div></div>
    </DialogContent>
  </Dialog>;
}
