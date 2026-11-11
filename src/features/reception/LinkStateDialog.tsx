import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import type { LinkEdit } from './contracts';
import { ReceptionNotice } from './ReceptionNotice';
import { relationshipLabels } from './linkRelationships';
import { NoAccessNotice } from '@/features/shared/StatusNotice';
import { ConfirmCheck } from './ConfirmCheck';
import { FormError } from './FormError';
import { dialogLayout } from './dialogLayout';

type Props = { contactId: string; patientId: string; doctorId: string; contactName: string; targetActive: boolean; onClose: () => void; onSaved: () => void };
export function LinkStateDialog(props: Props) {
  const access = useClinicAccess();
  if (!access?.admin || !access.active || access.kind !== 'clinical' || !access.clinic)
    return <NoAccessNotice message="Sua conta não pode suspender nem reativar esta ligação." backTo={null} />;
  return <Editor key={`${access.actorId}:${access.clinic.id}:${props.contactId}:${props.patientId}:${props.doctorId}:${props.targetActive}`} {...props} actorId={access.actorId} clinicId={access.clinic.id} />;
}
function Editor(props: Props & { actorId: string; clinicId: string }) {
  const [generation, setGeneration] = useState(0), [recovering, setRecovering] = useState(false), [hasVerified, setHasVerified] = useState(false);
  const closeCheck = useRef(() => true), recoverCheck = useRef(() => true), mounted = useRef(true), recoveryPending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const snapshot = useQuery({
    queryKey: ['reception', props.actorId, 'link-state', props.clinicId, props.contactId, props.patientId, props.doctorId, props.targetActive],
    queryFn: async ({ signal }) => {
      const value = await receptionApi.linkEdit(props.contactId, props.patientId);
      if (signal.aborted) throw new Error('A consulta foi cancelada.');
      if (value.contactId !== props.contactId || value.patientId !== props.patientId || value.doctorId !== props.doctorId)
        throw new Error('Este paciente não corresponde ao selecionado. Atualize a lista.');
      return value;
    },
    retry: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const fresh = snapshot.isSuccess && snapshot.isFetchedAfterMount;
  useEffect(() => { if (fresh) setHasVerified(true); }, [fresh]);
  async function recover() {
    if (recoveryPending.current || !recoverCheck.current()) return;
    recoveryPending.current = true; setRecovering(true);
    try {
      const result = await snapshot.refetch();
      if (mounted.current && !result.error) setGeneration(value => value + 1);
    } finally { recoveryPending.current = false; if (mounted.current) setRecovering(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !recoveryPending.current && closeCheck.current()) props.onClose(); }}>
    <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
      <DialogHeader className={dialogLayout.header}><DialogTitle>{props.targetActive ? 'Reativar ligação' : 'Suspender ligação'}</DialogTitle><DialogDescription>Confira as pessoas. O histórico, os prontuários e os agendamentos anteriores são mantidos.</DialogDescription></DialogHeader>
      {snapshot.data && (fresh || hasVerified)
        ? <StateForm key={generation} {...props} loaded={snapshot.data} fresh={fresh} recovering={recovering} closeCheck={closeCheck} recoverCheck={recoverCheck} onRecover={() => void recover()}
          status={<ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void recover()} />} />
        : <>
          <div className={dialogLayout.body}><ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void recover()} /></div>
          <div className={dialogLayout.footer}><div className={dialogLayout.actions}><Button type="button" variant="outline" className={dialogLayout.button} disabled={recovering} onClick={() => { if (!recoveryPending.current && closeCheck.current()) props.onClose(); }}>Cancelar</Button></div></div>
        </>}
    </DialogContent>
  </Dialog>;
}
function StateForm({ loaded, fresh, recovering, closeCheck, recoverCheck, onRecover, status, ...props }: Props & {
  status: React.ReactNode; loaded: LinkEdit; fresh: boolean; recovering: boolean; closeCheck: React.MutableRefObject<() => boolean>; recoverCheck: React.MutableRefObject<() => boolean>; onRecover: () => void;
}) {
  // Recovery remounts this form. Background reads never advance the reviewed revision or invert the requested action.
  const [initial] = useState(loaded), [confirmed, setConfirmed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<unknown>(null);
  const pending = useRef(false), mounted = useRef(true), client = useQueryClient(), field = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = saving || recovering, achieved = initial.active === props.targetActive;
  const matches = fresh && loaded.revision === initial.revision && loaded.active === initial.active;
  const available = !props.targetActive || (initial.patientAvailable && initial.doctorActive && loaded.patientAvailable && loaded.doctorActive);
  const canReview = !achieved && matches && available && !error;
  const guard = useUnsavedChanges(confirmed || busy, busy ? 'Aguarde a confirmação do estado antes de sair.' : 'Há uma conferência não salva. Deseja descartá-la?', { blocking: busy });
  const close = () => !pending.current && !busy && guard(false);
  useLayoutEffect(() => {
    closeCheck.current = close;
    recoverCheck.current = () => !pending.current && !busy && (!confirmed || window.confirm('Descartar a conferência e recarregar a ligação?'));
    return () => { closeCheck.current = () => true; recoverCheck.current = () => true; };
  });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || busy || !canReview || !confirmed) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      const revision = await receptionApi.setLinkActive(initial.contactId, initial.patientId, initial.revision, props.targetActive);
      if (!mounted.current) return;
      if (revision !== initial.revision + 1) throw new Error('A alteração não pôde ser confirmada. Recupere o estado atual antes de tentar novamente.');
      props.onSaved();
      await client.invalidateQueries({ queryKey: ['reception'] });
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  return <form onSubmit={event => void save(event)} className="flex min-h-0 flex-1 flex-col">
    <div className={dialogLayout.body}>
      {status}
      <div hidden={!fresh} className="space-y-4">
        <dl className="space-y-2 break-words text-sm"><div><dt className="text-muted-foreground">Contato</dt><dd>{props.contactName}</dd></div><div><dt className="text-muted-foreground">Paciente</dt><dd>{initial.patientName}</dd></div><div><dt className="text-muted-foreground">Nascimento</dt><dd>{initial.dateOfBirth ? initial.dateOfBirth.split('-').reverse().join('/') : 'Não informado'}</dd></div><div><dt className="text-muted-foreground">Médico</dt><dd>{initial.doctorName}</dd></div><div><dt className="text-muted-foreground">Relação do contato</dt><dd>{relationshipLabels[initial.relationship]}</dd></div></dl>
        <p className="rounded-lg border bg-muted/30 p-3 text-sm">{props.targetActive ? 'Com a ligação reativada, o contato volta a poder agendar para este paciente.' : 'Com a ligação suspensa, o contato não agenda nem remarca para este paciente. Para cancelar uma reserva que já existe, use a agenda.'}</p>
        {achieved && matches && <p role="status" className="text-sm">A ligação já está {props.targetActive ? 'ativa' : 'suspensa'}. Nada foi alterado.</p>}
        {!available && <p role="alert" className="text-sm">Paciente ou médico indisponível para reativar. A ligação continua suspensa.</p>}
        {!matches && fresh && <p role="alert" className="text-sm">A ligação mudou desde que você abriu esta janela. Recarregue e confira de novo.</p>}
        {/* Kept on purpose: this decides whether the contact may book for another person. */}
        {!achieved && <ConfirmCheck id={field} checked={confirmed} disabled={busy || !canReview} onChange={setConfirmed}>Conferi o contato, o paciente e o médico e quero {props.targetActive ? 'reativar' : 'suspender'} esta ligação.</ConfirmCheck>}
        <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal px-2" disabled={busy} onClick={onRecover}>{recovering ? 'Recarregando…' : 'Descartar e recarregar'}</Button>
      </div>
    </div>
    <div className={dialogLayout.footer}>
      <FormError error={error} />
      {!!error && <p className="text-sm">Recarregue para ver se a alteração foi feita. Nada é reenviado sozinho.</p>}
      <div className={dialogLayout.actions}>
        <Button type="button" variant="outline" className={dialogLayout.button} disabled={busy} onClick={() => { if (close()) props.onClose(); }}>Cancelar</Button>
        {!achieved && <Button type="submit" className={dialogLayout.button} disabled={!confirmed || busy || !canReview}>{saving ? 'Salvando…' : props.targetActive ? 'Reativar ligação' : 'Suspender ligação'}</Button>}
      </div>
    </div>
  </form>;
}
