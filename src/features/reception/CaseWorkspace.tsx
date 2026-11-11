import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { statuses, kinds, type ReceptionCase } from './contracts';
import { clinicDateLabel, clinicTime } from './dates';
import { useCaseDraft } from './useCaseDraft';
import { useRequestId } from './useRequestId';
import { ReceptionNotice } from './ReceptionNotice';
import { BookingDialog } from './BookingDialog';
import { DoctorSuggestion } from './DoctorSuggestion';
import { LinkRelationshipDialog } from './LinkRelationshipDialog';
import { relationshipLabels } from './linkRelationships';
import { DisabledHint, SegmentedControl, selectClass } from './ReceptionControls';
import { displayPhone, useMinuteClock, waitingLabel } from './queueTime';

const workingStatuses = ['assigned', 'waiting_patient', 'waiting_internal'] as const;

// stale: the last refetch of this case failed. Everything stays mounted (open
// dialogs, the draft) but actions on the case wait for a fresh read.
export function CaseWorkspace({ data, stale = false }: { data: ReceptionCase; stale?: boolean }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const draft = useCaseDraft(data.id, data.draft, access?.actorId);
  const request = useRequestId();
  const now = useMinuteClock();
  const moreId = useId();
  const [target, setTarget] = useState('');
  const [doctor, setDoctor] = useState('');
  const [more, setMore] = useState(false);
  const [booking, setBooking] = useState(false);
  const [editingLink, setEditingLink] = useState<ReceptionCase['beneficiaries'][number] | null>(null);
  const [linkNotice, setLinkNotice] = useState(false);
  useEffect(() => { if (!access?.admin) { setEditingLink(null); setLinkNotice(false); } }, [access?.admin]);
  const [postError, setPostError] = useState<unknown>(null);
  const [posting, setPosting] = useState(false);
  const [older, setOlder] = useState<ReceptionCase['notes']>([]);
  const [olderBusy, setOlderBusy] = useState(false);
  const mine = data.assignedTo === access?.actorId;
  const editable = mine || !!access?.admin;
  const doctorAuthorized = !!doctor && !!access?.doctors.some(option => option.id === doctor);
  const closed = ['resolved', 'cancelled'].includes(data.status);
  const change = useMutation({
    mutationFn: ({ action, value }: { action: string; value?: Record<string, unknown> }) =>
      receptionApi.updateCase(data.id, data.revision, action, value),
    onSettled: () => client.invalidateQueries({ queryKey: ['reception'] }),
  });
  const busy = stale || change.isPending;
  async function post() {
    if (posting || stale || !draft.body.trim()) return;
    setPosting(true);
    setPostError(null);
    try {
      await draft.flush();
      const body = draft.body.trim();
      const posted = await receptionApi.addNote(data.id, body, request({ caseId: data.id, body }));
      draft.acceptSaved(posted.draft);
      request.reset();
      await client.invalidateQueries({ queryKey: ['reception', access?.actorId, 'case', data.id] });
    } catch (err) {
      setPostError(err);
    } finally {
      setPosting(false);
    }
  }
  async function loadOlder() {
    const first = [...older, ...data.notes].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )[0];
    if (!first) return;
    setOlderBusy(true);
    setPostError(null);
    try {
      const page = await receptionApi.case(data.id, first.id);
      setOlder((previous) => Array.from(new Map([...page.notes, ...previous].map((n) => [n.id, n])).values()));
    } catch (err) {
      setPostError(err);
    } finally {
      setOlderBusy(false);
    }
  }
  const notes = Array.from(new Map([...older, ...data.notes].map((n) => [n.id, n])).values()).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const doctorName = data.doctorId ? (access?.doctors.find((d) => d.id === data.doctorId)?.name ?? 'Médico relacionado') : null;
  const owner = data.assignedTo && !mine ? (data.eligibleAssignees.find((a) => a.id === data.assignedTo)?.name ?? 'outra pessoa da equipe') : null;
  const waiting = waitingLabel(data.createdAt, now);
  const noteHint = !editable ? null : closed ? 'Reabra o atendimento para registrar uma anotação.' : !draft.body.trim() ? 'Escreva a anotação para registrar.' : null;
  return (
    <article className="rounded-xl border bg-card overflow-hidden">
      <header className="p-4 border-b space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{data.contactName}</h2>
            <p className="text-sm text-muted-foreground tabular-nums mt-1">{data.phone ? displayPhone(data.phone) : 'Sem telefone cadastrado'}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{statuses[data.status]}</span>
            {waiting && !closed && <span className="text-xs text-muted-foreground tabular-nums">Aberto {waiting}</span>}
          </div>
        </div>
        <p className="text-sm [overflow-wrap:anywhere]">{data.subject}</p>
        <p className="text-xs text-muted-foreground">{kinds[data.kind]} · {doctorName ?? 'Médico a definir'}</p>
        <div className="flex flex-wrap items-center gap-2">
          {closed ? (
            <Button className="min-h-11" onClick={() => change.mutate({ action: 'reopen' })} disabled={busy}>
              Reabrir atendimento
            </Button>
          ) : (
            <>
              {!data.assignedTo && (
                <Button className="min-h-11" onClick={() => change.mutate({ action: 'claim' })} disabled={busy}>
                  Assumir atendimento
                </Button>
              )}
              {owner && <p className="text-sm text-muted-foreground py-2">Em atendimento por {owner}.</p>}
              {editable && (
                <>
                  {/* After claiming, booking is the next step: it is the primary action. */}
                  <Button className="min-h-11" variant={data.assignedTo ? 'default' : 'outline'} disabled={stale} onClick={() => setBooking(true)}>
                    Agendar consulta
                  </Button>
                  <ConfirmAction label="Concluir atendimento" confirmLabel="Concluir atendimento" dismissLabel="Cancelar" disabled={busy}
                    description="O atendimento sai da fila em aberto. Se precisar retomar, use Reabrir atendimento: ele volta para a fila sem responsável."
                    onConfirm={() => change.mutate({ action: 'status', value: { status: 'resolved' } })} />
                </>
              )}
            </>
          )}
        </div>
      </header>
      <div className="p-4 space-y-5">
        {stale && <p role="status" className="text-xs text-muted-foreground">Atualize o atendimento para continuar. O rascunho e o que foi preenchido continuam preservados.</p>}
        <ReceptionNotice error={change.error} />
        {!closed && editable && (
          <section className="space-y-3" aria-label="Situação e outras ações">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SegmentedControl label="Situação" showLabel value={data.status as (typeof workingStatuses)[number]}
                disabled={busy || !data.assignedTo}
                options={workingStatuses.map(status => ({ value: status, label: statuses[status] }))}
                onChange={status => change.mutate({ action: 'status', value: { status } })} />
              <ConfirmAction label="Cancelar atendimento" confirmLabel="Cancelar atendimento" dismissLabel="Manter atendimento" variant="ghost" disabled={busy}
                description="Use quando o contato desistiu ou o pedido não procede. O atendimento sai da fila em aberto; reabrir depois o devolve sem responsável."
                onConfirm={() => change.mutate({ action: 'status', value: { status: 'cancelled' } })} />
            </div>
            {!data.assignedTo && <DisabledHint>Assuma o atendimento para mudar a situação.</DisabledHint>}
            <Button type="button" variant="ghost" className="min-h-11 gap-2 px-2" aria-expanded={more} aria-controls={moreId} onClick={() => setMore(value => !value)}>
              Mais ações
              <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
            {more && <div id={moreId} className="space-y-3 rounded-lg border p-3">
              <DoctorSuggestion doctors={access?.doctors ?? []} receptionCase={data} onSelect={setDoctor} disabled={change.isPending} />
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor={'case-doctor-' + data.id}>Encaminhar para médico</Label>
                  <select id={'case-doctor-' + data.id} className={selectClass} value={doctor} disabled={change.isPending} onChange={(e) => setDoctor(e.target.value)}>
                    <option value="">Selecione um médico</option>
                    {access?.doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {doctor && !doctorAuthorized && <p role="alert" className="text-xs">Este médico deixou de estar disponível para você. Escolha outro antes de encaminhar.</p>}
                  <Button className="min-h-11" variant="outline" disabled={busy || !doctorAuthorized}
                    onClick={() => { if (!stale && doctorAuthorized && !change.isPending) change.mutate({ action: 'route', value: { doctorId: doctor } }); }}>
                    Encaminhar
                  </Button>
                  {!doctor && <DisabledHint>Escolha o médico para encaminhar.</DisabledHint>}
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor={'case-transfer-' + data.id}>Transferir para atendente</Label>
                  <select id={'case-transfer-' + data.id} className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Selecione uma pessoa</option>
                    {data.eligibleAssignees.filter((a) => a.id !== data.assignedTo).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <Button className="min-h-11" variant="outline" disabled={busy || !target}
                    onClick={() => change.mutate({ action: 'transfer', value: { assigneeId: target } })}>
                    Transferir
                  </Button>
                  {!target && <DisabledHint>Escolha a pessoa que vai continuar o atendimento.</DisabledHint>}
                </div>
              </div>
            </div>}
          </section>
        )}
        <section className="rounded-lg bg-muted/30 p-3 space-y-2">
          <h3 className="text-xs font-semibold">Pacientes ligados a este contato</h3>
          {data.beneficiaries.length ? (
            data.beneficiaries.map((p) => (
              <div key={p.id} className="space-y-1"><p className="text-xs break-words">
                {p.name} · {access?.doctors.find((d) => d.id === p.doctorId)?.name ?? 'Médico'}
                {p.dateOfBirth ? ' · nascimento ' + p.dateOfBirth.split('-').reverse().join('/') : ''}
                {' · ' + relationshipLabels[p.relationship]}
              </p>
              {access?.admin && <Button size="sm" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={stale} onClick={() => { setLinkNotice(false); setEditingLink(p); }}>Corrigir relação de {p.name}</Button>}</div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum paciente ligado ainda. Ao agendar, confirme quem será atendido: o telefone sozinho não identifica a pessoa.
            </p>
          )}
        </section>
        {linkNotice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">Relação corrigida.</p>}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Anotações</h3>
          {notes.length < data.noteCount && (
            <Button size="sm" variant="outline" className="min-h-11" disabled={olderBusy} onClick={() => void loadOlder()}>
              Carregar anotações anteriores
            </Button>
          )}
          {!notes.length && <p className="text-xs text-muted-foreground">Nenhuma anotação registrada.</p>}
          {notes.map((note) => (
            <div key={note.id} className="border-l-2 pl-3 py-1">
              <p className="text-xs text-muted-foreground">
                {note.actorName} · {clinicDateLabel(note.createdAt)} às {clinicTime(note.createdAt)}
              </p>
              <p className="text-sm whitespace-pre-wrap break-words mt-1">{note.body}</p>
            </div>
          ))}
        </section>
        <section className="space-y-2">
          <Label htmlFor={'case-note-' + data.id}>Anotação</Label>
          <Textarea
            id={'case-note-' + data.id}
            rows={4}
            value={draft.body}
            maxLength={4000}
            onChange={(e) => draft.setBody(e.target.value)}
            onBlur={() => {
              void draft.flush().catch(() => {});
            }}
            disabled={posting}
            placeholder="O que foi combinado com o contato? (sem informações clínicas)"
          />
          <p role="status" className="text-xs text-muted-foreground">
            {draft.saving ? 'Salvando rascunho…' : draft.dirty ? 'Alterações aguardando salvamento' : 'Rascunho salvo'}
          </p>
          <ReceptionNotice error={draft.error} />
          <ReceptionNotice error={postError} />
          {draft.error && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => void draft.flush().catch(() => {})}>
                Tentar salvar novamente
              </Button>
              <Button size="sm" variant="ghost" className="min-h-11" onClick={() => { void draft.reload().catch(setPostError); }}>
                Descartar e recarregar
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button className="min-h-11" disabled={stale || !editable || closed || posting || !draft.body.trim()} onClick={() => void post()}>
              {posting ? 'Registrando…' : 'Registrar anotação'}
            </Button>
            {noteHint && <DisabledHint>{noteHint}</DisabledHint>}
          </div>
          {!editable && !closed && (
            <p className="text-xs text-muted-foreground">
              Assuma ou peça a transferência do atendimento para registrar a anotação. Seu rascunho só você vê.
            </p>
          )}
        </section>
        <Link to="/recepcao/agenda" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          Ver agenda da equipe
        </Link>
      </div>
      {booking && <BookingDialog receptionCase={data} paused={stale} onClose={() => setBooking(false)} />}
      {editingLink && access?.admin && <LinkRelationshipDialog key={`${access.actorId}:${data.id}:${editingLink.id}`} contactId={data.contactId} patientId={editingLink.id} doctorId={editingLink.doctorId} contactName={data.contactName} onClose={() => setEditingLink(null)} onSaved={() => { setEditingLink(null); setLinkNotice(true); }} />}
    </article>
  );
}

/** A case action that cannot be undone with one click: it asks first and says what happens. */
function ConfirmAction({ label, confirmLabel, dismissLabel, description, disabled, onConfirm, variant = 'outline' }: {
  label: string; confirmLabel: string; dismissLabel: string; description: string; disabled: boolean;
  onConfirm: () => void; variant?: 'outline' | 'ghost';
}) {
  return <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button className="min-h-11" variant={variant} disabled={disabled}>{label}</Button>
    </AlertDialogTrigger>
    <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl">
      <AlertDialogHeader className="text-left">
        <AlertDialogTitle>{label}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="gap-2 sm:space-x-0">
        <AlertDialogCancel className="mt-0 min-h-11">{dismissLabel}</AlertDialogCancel>
        <AlertDialogAction className="min-h-11" disabled={disabled} onClick={() => { if (!disabled) onConfirm(); }}>{confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
