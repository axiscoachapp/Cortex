import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import type { LinkEdit } from './contracts';
import { ReceptionNotice } from './ReceptionNotice';
import { NoAccessNotice } from '@/features/shared/StatusNotice';
import { ConfirmCheck } from './ConfirmCheck';
import { FormError } from './FormError';
import { dialogLayout } from './dialogLayout';
import { relationshipLabels } from './linkRelationships';
import { selectClass } from './ReceptionControls';

type Props = { contactId: string; patientId: string; doctorId: string; contactName: string; onClose: () => void; onSaved: () => void };
export function LinkRelationshipDialog(props: Props) {
  const access = useClinicAccess();
  if (!access?.admin || !access.active || access.kind !== 'clinical' || !access.clinic) return <NoAccessNotice message="Sua conta não pode corrigir a relação deste contato." backTo={null} />;
  return <Editor key={`${access.actorId}:${access.clinic.id}:${props.contactId}:${props.patientId}:${props.doctorId}`} {...props} actorId={access.actorId} clinicId={access.clinic.id} />;
}
function Editor(props: Props & { actorId: string; clinicId: string }) {
  const [generation, setGeneration] = useState(0), [recovering, setRecovering] = useState(false);
  const closeCheck = useRef(() => true), mounted = useRef(true), recoveryPending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const snapshot = useQuery({
    queryKey: ['reception', props.actorId, 'link-edit', props.clinicId, props.contactId, props.patientId, props.doctorId],
    queryFn: async () => {
      const value = await receptionApi.linkEdit(props.contactId, props.patientId);
      if (value.contactId !== props.contactId || value.patientId !== props.patientId || value.doctorId !== props.doctorId)
        throw new Error('Este paciente não corresponde ao selecionado. Atualize a lista.');
      return value;
    },
    retry: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const fresh = snapshot.isSuccess && snapshot.isFetchedAfterMount;
  const [hasVerified, setHasVerified] = useState(false);
  useEffect(() => { if (fresh) setHasVerified(true); }, [fresh]);
  async function recover() {
    if (recoveryPending.current) return;
    recoveryPending.current = true; setRecovering(true);
    try {
      const result = await snapshot.refetch();
      if (mounted.current && !result.error) setGeneration(value => value + 1);
    } finally { recoveryPending.current = false; if (mounted.current) setRecovering(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && closeCheck.current()) props.onClose(); }}>
    <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
      <DialogHeader className={dialogLayout.header}><DialogTitle>Corrigir relação</DialogTitle><DialogDescription>Muda só a relação do contato com o paciente. Prontuários e agendamentos não mudam.</DialogDescription></DialogHeader>
      {snapshot.data && (fresh || hasVerified)
        ? <RelationshipForm key={generation} initial={snapshot.data} contactName={props.contactName} fresh={fresh} currentAvailable={snapshot.data.active && snapshot.data.patientAvailable && snapshot.data.doctorActive} recovering={recovering} closeCheck={closeCheck} onRecover={() => void recover()} onClose={props.onClose} onSaved={props.onSaved}
          status={<ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void snapshot.refetch()} />} />
        : <>
          <div className={dialogLayout.body}><ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void snapshot.refetch()} /></div>
          <div className={dialogLayout.footer}><div className={dialogLayout.actions}><Button type="button" variant="outline" className={dialogLayout.button} onClick={() => { if (closeCheck.current()) props.onClose(); }}>Cancelar</Button></div></div>
        </>}
    </DialogContent>
  </Dialog>;
}
function RelationshipForm({ initial: loaded, contactName, fresh, currentAvailable, recovering, closeCheck, onRecover, onClose, onSaved, status }: {
  initial: LinkEdit; contactName: string; fresh: boolean; currentAvailable: boolean; recovering: boolean; closeCheck: React.MutableRefObject<() => boolean>; status: React.ReactNode;
  onRecover: () => void; onClose: () => void; onSaved: () => void;
}) {
  const [initial] = useState(loaded);
  const [relationship, setRelationship] = useState(initial.relationship), [confirmed, setConfirmed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<unknown>(null);
  const pending = useRef(false), mounted = useRef(true), client = useQueryClient(), field = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = relationship !== initial.relationship, busy = saving || recovering;
  const available = initial.active && initial.patientAvailable && initial.doctorActive && currentAvailable && fresh;
  const guard = useUnsavedChanges(dirty || busy, saving ? 'Aguarde a confirmação da relação antes de sair.' : recovering ? 'Aguarde o recarregamento antes de sair.' : 'Há uma relação não salva. Deseja descartar o preenchimento?', { blocking: busy });
  const close = () => !pending.current && !busy && guard(false);
  useLayoutEffect(() => { closeCheck.current = close; return () => { closeCheck.current = () => true; }; });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || busy || !available || !dirty || !confirmed) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      const revision = await receptionApi.updateLinkRelationship(initial.contactId, initial.patientId, initial.revision, relationship);
      if (!mounted.current) return;
      if (revision !== initial.revision + 1) throw new Error('A correção não pôde ser confirmada. Preserve o preenchimento e recupere a relação atual.');
      onSaved();
      await client.invalidateQueries({ queryKey: ['reception'] });
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  return <form onSubmit={event => void save(event)} className="flex min-h-0 flex-1 flex-col">
    <div className={dialogLayout.body}>
      {status}
      <div hidden={!fresh} className="space-y-4">
        <dl className="space-y-2 break-words text-sm"><div><dt className="text-muted-foreground">Contato</dt><dd>{contactName}</dd></div><div><dt className="text-muted-foreground">Paciente</dt><dd>{initial.patientName}</dd></div><div><dt className="text-muted-foreground">Nascimento</dt><dd>{initial.dateOfBirth ? initial.dateOfBirth.split('-').reverse().join('/') : 'Não informado'}</dd></div><div><dt className="text-muted-foreground">Médico</dt><dd>{initial.doctorName}</dd></div></dl>
        {!available && <p role="alert" className="text-sm">A ligação, o paciente ou o médico não está disponível para correção. O histórico foi mantido.</p>}
        <fieldset disabled={busy || !available} className="min-w-0 space-y-4">
          <div className="space-y-2"><Label htmlFor={field}>Relação do contato com o paciente</Label><select id={field} value={relationship} onChange={event => { setRelationship(event.target.value as LinkEdit['relationship']); setConfirmed(false); }} className={selectClass}>{Object.entries(relationshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {/* Kept on purpose: the relation decides who may book and speak for this patient. */}
          <ConfirmCheck id={field + 'confirm'} checked={confirmed} onChange={setConfirmed}>Conferi o contato, o paciente, o médico e a relação escolhida.</ConfirmCheck>
        </fieldset>
        <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal px-2" disabled={busy} onClick={() => { if (!dirty || window.confirm('Descartar a relação escolhida e recarregar a atual?')) onRecover(); }}>{recovering ? 'Recarregando…' : 'Descartar e recarregar'}</Button>
      </div>
    </div>
    <div className={dialogLayout.footer}>
      <FormError error={error} />
      <div className={dialogLayout.actions}>
        <Button type="button" variant="outline" className={dialogLayout.button} disabled={busy} onClick={() => { if (close()) onClose(); }}>Cancelar</Button>
        <Button type="submit" className={dialogLayout.button} disabled={!dirty || !confirmed || busy || !available}>{saving ? 'Salvando…' : 'Salvar relação'}</Button>
      </div>
    </div>
  </form>;
}
