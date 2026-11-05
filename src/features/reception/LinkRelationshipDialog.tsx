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
import { relationshipLabels } from './linkRelationships';

type Props = { contactId: string; patientId: string; doctorId: string; contactName: string; onClose: () => void; onSaved: () => void };
export function LinkRelationshipDialog(props: Props) {
  const access = useClinicAccess();
  if (!access?.admin || !access.active || access.kind !== 'clinical' || !access.clinic) return <p role="alert">Somente a administração da clínica pode corrigir esta relação.</p>;
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
        throw new Error('O vínculo não corresponde ao beneficiário selecionado. Atualize o atendimento.');
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
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Corrigir relação do contato</DialogTitle><DialogDescription>Corrige somente a relação administrativa. O beneficiário, o médico, os prontuários e os agendamentos anteriores são preservados.</DialogDescription></DialogHeader>
      <ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void snapshot.refetch()} />
      {snapshot.data && (fresh || hasVerified) && <div hidden={!fresh}><RelationshipForm key={generation} initial={snapshot.data} contactName={props.contactName} fresh={fresh} currentAvailable={snapshot.data.active && snapshot.data.patientAvailable && snapshot.data.doctorActive} recovering={recovering} closeCheck={closeCheck} onRecover={() => void recover()} onClose={props.onClose} onSaved={props.onSaved} /></div>}
    </DialogContent>
  </Dialog>;
}
function RelationshipForm({ initial: loaded, contactName, fresh, currentAvailable, recovering, closeCheck, onRecover, onClose, onSaved }: {
  initial: LinkEdit; contactName: string; fresh: boolean; currentAvailable: boolean; recovering: boolean; closeCheck: React.MutableRefObject<() => boolean>;
  onRecover: () => void; onClose: () => void; onSaved: () => void;
}) {
  const [initial] = useState(loaded);
  const [relationship, setRelationship] = useState(initial.relationship), [confirmed, setConfirmed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<unknown>(null);
  const pending = useRef(false), mounted = useRef(true), client = useQueryClient(), field = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = relationship !== initial.relationship, busy = saving || recovering;
  const available = initial.active && initial.patientAvailable && initial.doctorActive && currentAvailable && fresh;
  const guard = useUnsavedChanges(dirty || busy, saving ? 'Aguarde a confirmação da relação antes de sair.' : recovering ? 'Aguarde a recuperação do vínculo antes de sair.' : 'Há uma relação não salva. Deseja descartar o preenchimento?', { blocking: busy });
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
  return <form onSubmit={event => void save(event)} className="space-y-4">
    <dl className="space-y-2 break-words text-sm"><div><dt className="text-muted-foreground">Contato</dt><dd>{contactName}</dd></div><div><dt className="text-muted-foreground">Beneficiário</dt><dd>{initial.patientName}</dd></div><div><dt className="text-muted-foreground">Nascimento</dt><dd>{initial.dateOfBirth ? initial.dateOfBirth.split('-').reverse().join('/') : 'Não informado'}</dd></div><div><dt className="text-muted-foreground">Médico</dt><dd>{initial.doctorName}</dd></div></dl>
    {!available && <p role="alert" className="text-sm">Vínculo, beneficiário ou médico indisponível para correção. O histórico permanece preservado.</p>}
    <ReceptionNotice error={error} />
    <fieldset disabled={busy || !available} className="space-y-4">
      <div className="space-y-2"><Label htmlFor={field}>Relação do contato com o beneficiário</Label><select id={field} value={relationship} onChange={event => { setRelationship(event.target.value as LinkEdit['relationship']); setConfirmed(false); }} className="block min-h-11 w-full rounded-md border bg-background px-3 text-sm">{Object.entries(relationshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1 accent-primary" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Conferi o contato, o beneficiário, o médico e a relação escolhida.</label>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy} onClick={() => { if (!dirty || window.confirm('Substituir a relação preenchida pela versão atual do servidor?')) onRecover(); }}>{recovering ? 'Recuperando vínculo…' : 'Recuperar relação do servidor'}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { if (close()) onClose(); }}>Voltar</Button>
      <Button type="submit" disabled={!dirty || !confirmed || busy || !available}>{saving ? 'Salvando…' : 'Salvar relação'}</Button>
    </div>
  </form>;
}
