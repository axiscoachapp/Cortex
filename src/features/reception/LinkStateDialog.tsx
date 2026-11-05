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

type Props = { contactId: string; patientId: string; doctorId: string; contactName: string; targetActive: boolean; onClose: () => void; onSaved: () => void };
export function LinkStateDialog(props: Props) {
  const access = useClinicAccess();
  if (!access?.admin || !access.active || access.kind !== 'clinical' || !access.clinic)
    return <p role="alert">Somente a administração da clínica pode alterar este vínculo.</p>;
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
      if (signal.aborted) throw new Error('Conferência do vínculo cancelada.');
      if (value.contactId !== props.contactId || value.patientId !== props.patientId || value.doctorId !== props.doctorId)
        throw new Error('O vínculo não corresponde ao beneficiário selecionado. Atualize a lista.');
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
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{props.targetActive ? 'Reativar vínculo' : 'Suspender vínculo'}</DialogTitle><DialogDescription>Confira as pessoas envolvidas. O histórico, os prontuários e os agendamentos anteriores permanecem preservados.</DialogDescription></DialogHeader>
      <ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void recover()} />
      {snapshot.data && (fresh || hasVerified) && <div hidden={!fresh}><StateForm key={generation} {...props} loaded={snapshot.data} fresh={fresh} recovering={recovering} closeCheck={closeCheck} recoverCheck={recoverCheck} onRecover={() => void recover()} /></div>}
      {!fresh && <Button type="button" variant="outline" disabled={recovering} onClick={() => { if (!recoveryPending.current && closeCheck.current()) props.onClose(); }}>Voltar à lista</Button>}
    </DialogContent>
  </Dialog>;
}
function StateForm({ loaded, fresh, recovering, closeCheck, recoverCheck, onRecover, ...props }: Props & {
  loaded: LinkEdit; fresh: boolean; recovering: boolean; closeCheck: React.MutableRefObject<() => boolean>; recoverCheck: React.MutableRefObject<() => boolean>; onRecover: () => void;
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
    recoverCheck.current = () => !pending.current && !busy && (!confirmed || window.confirm('Recuperar o estado atual e descartar a conferência anterior?'));
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
  return <form onSubmit={event => void save(event)} className="space-y-4">
    <dl className="space-y-2 break-words text-sm"><div><dt className="text-muted-foreground">Contato</dt><dd>{props.contactName}</dd></div><div><dt className="text-muted-foreground">Beneficiário</dt><dd>{initial.patientName}</dd></div><div><dt className="text-muted-foreground">Nascimento</dt><dd>{initial.dateOfBirth ? initial.dateOfBirth.split('-').reverse().join('/') : 'Não informado'}</dd></div><div><dt className="text-muted-foreground">Médico</dt><dd>{initial.doctorName}</dd></div><div><dt className="text-muted-foreground">Relação do contato</dt><dd>{relationshipLabels[initial.relationship]}</dd></div></dl>
    <p className="rounded-lg border bg-muted/30 p-3 text-sm">{props.targetActive ? 'A reativação permite novos agendamentos para este vínculo, conforme as permissões da agenda.' : 'A suspensão impede novos agendamentos, remarcações e reabertura de reservas deste vínculo. Para cancelar uma reserva existente, use a agenda.'}</p>
    {achieved && matches && <p role="status" className="text-sm">O vínculo já está {props.targetActive ? 'ativo' : 'suspenso'}. Nenhuma nova alteração foi enviada.</p>}
    {!available && <p role="alert" className="text-sm">Paciente ou médico indisponível para reativação. A suspensão e o histórico permanecem preservados.</p>}
    {!matches && fresh && <p role="alert" className="text-sm">O vínculo mudou desde a conferência. Recupere o estado atual e confira novamente.</p>}
    <ReceptionNotice error={error} />
    {!!error && <p className="text-sm">Recupere o estado do servidor para verificar se a alteração foi aplicada. A confirmação anterior não será reenviada automaticamente.</p>}
    {!achieved && <label htmlFor={field} className="flex items-start gap-2 text-sm"><input id={field} className="mt-1 shrink-0 accent-primary" type="checkbox" checked={confirmed} disabled={busy || !canReview} onChange={event => setConfirmed(event.target.checked)} /><span>Conferi o contato, o beneficiário e o médico e quero {props.targetActive ? 'reativar' : 'suspender'} este vínculo.</span></label>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy} onClick={onRecover}>{recovering ? 'Recuperando estado…' : 'Recuperar estado do servidor'}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { if (close()) props.onClose(); }}>Voltar</Button>
      {!achieved && <Button type="submit" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!confirmed || busy || !canReview}>{saving ? 'Salvando…' : props.targetActive ? 'Confirmar reativação' : 'Confirmar suspensão'}</Button>}
    </div>
  </form>;
}
