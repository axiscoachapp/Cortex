import { useState } from 'react';
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

type Props = { contactId: string; contactName: string; onClose: () => void };
export function ContactLinksDialog(props: Props) {
  const access = useClinicAccess();
  if (!access?.admin || !access.active || access.kind !== 'clinical' || !access.clinic)
    return <p role="alert">Somente a administração da clínica pode consultar estes vínculos.</p>;
  return <LinkList key={`${access.actorId}:${access.clinic.id}:${props.contactId}`} {...props} actorId={access.actorId} clinicId={access.clinic.id} />;
}
function LinkList({ actorId, clinicId, contactId, contactName, onClose }: Props & { actorId: string; clinicId: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<LinkEdit | null>(null), [changingState, setChangingState] = useState<LinkEdit | null>(null), [saved, setSaved] = useState<string | null>(null);
  const page = useInfiniteQuery({
    queryKey: ['reception', actorId, 'contact-links', clinicId, contactId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const result = await receptionApi.contactLinks(clinicId, contactId, pageParam, 50);
      if (signal.aborted) throw new Error('Consulta de vínculos cancelada.');
      return result;
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const verified = page.isSuccess && page.isFetchedAfterMount;
  const rows = verified ? page.data.pages.flatMap(value => value.items) : [];
  if (editing) return <LinkRelationshipDialog contactId={contactId} patientId={editing.patientId} doctorId={editing.doctorId} contactName={contactName} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved('Relação administrativa corrigida.'); }} />;
  if (changingState) return <LinkStateDialog contactId={contactId} patientId={changingState.patientId} doctorId={changingState.doctorId} contactName={contactName} targetActive={!changingState.active} onClose={() => { setChangingState(null); void client.invalidateQueries({ queryKey: ['reception'] }); }} onSaved={() => { setChangingState(null); setSaved(changingState.active ? 'Vínculo suspenso. Histórico preservado.' : 'Vínculo reativado.'); }} />;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Vínculos do contato</DialogTitle><DialogDescription>Confira o beneficiário, o médico e a relação antes de corrigir, suspender ou reativar um vínculo.</DialogDescription></DialogHeader>
      <p className="break-words text-sm font-medium">Contato: {contactName}</p>
      {saved && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{saved}</p>}
      <ReceptionNotice loading={page.isPending || (!page.isFetchedAfterMount && page.isFetching)} error={page.error} onRetry={() => void page.refetch()} />
      {verified && <>
        {!rows.length && <p className="rounded-lg border bg-muted/30 p-4 text-sm">Nenhum vínculo administrativo neste contato.</p>}
        <ul className="space-y-3">{rows.map(row => <li key={row.patientId} className="min-w-0 space-y-3 rounded-lg border p-4">
          <h3 className="break-words text-sm font-semibold">{row.patientName}</h3>
          <dl className="space-y-2 break-words text-sm">
            <div><dt className="text-xs text-muted-foreground">Médico</dt><dd>{row.doctorName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Nascimento</dt><dd>{row.dateOfBirth ? row.dateOfBirth.split('-').reverse().join('/') : 'Não informado'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Relação do contato</dt><dd>{relationshipLabels[row.relationship]}</dd></div>
          </dl>
          {(!row.active || !row.patientAvailable || !row.doctorActive) && <p className="text-xs text-muted-foreground">{[!row.active && 'Vínculo indisponível', !row.patientAvailable && 'Paciente indisponível', !row.doctorActive && 'Médico indisponível'].filter(Boolean).join(' · ')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={page.isFetching || !row.active || !row.patientAvailable || !row.doctorActive} onClick={() => { setSaved(null); setEditing(row); }}>Corrigir relação de {row.patientName}</Button>
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={page.isFetching || (!row.active && (!row.patientAvailable || !row.doctorActive))} onClick={() => { setSaved(null); setChangingState(row); }}>{row.active ? 'Suspender' : 'Reativar'} vínculo de {row.patientName}</Button>
          </div>
        </li>)}</ul>
        <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? 'vínculo carregado' : 'vínculos carregados'}</p>
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        {verified && <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={page.isFetching} onClick={() => void page.refetch()}>Atualizar vínculos</Button>}
        {verified && page.hasNextPage && <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={page.isFetching} onClick={() => void page.fetchNextPage()}>{page.isFetchingNextPage ? 'Carregando vínculos…' : 'Carregar mais vínculos'}</Button>}
        <Button type="button" variant="outline" onClick={onClose}>Fechar vínculos</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
