import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { statuses, kinds, type ReceptionCase } from './contracts';
import { clinicDateLabel, clinicTime } from './dates';
import { useCaseDraft } from './useCaseDraft';
import { useRequestId } from './useRequestId';
import { ReceptionNotice } from './ReceptionNotice';
import { BookingDialog } from './BookingDialog';
import { DoctorSuggestion } from './DoctorSuggestion';

export function CaseWorkspace({ data }: { data: ReceptionCase }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const draft = useCaseDraft(data.id, data.draft);
  const request = useRequestId();
  const [target, setTarget] = useState('');
  const [doctor, setDoctor] = useState('');
  const [booking, setBooking] = useState(false);
  const [postError, setPostError] = useState<unknown>(null);
  const [posting, setPosting] = useState(false);
  const [older, setOlder] = useState<ReceptionCase['notes']>([]);
  const [olderBusy, setOlderBusy] = useState(false);
  const mine = data.assignedTo === access?.actorId;
  const editable = mine || !!access?.admin;
  const closed = ['resolved', 'cancelled'].includes(data.status);
  const change = useMutation({
    mutationFn: ({ action, value }: { action: string; value?: Record<string, unknown> }) =>
      receptionApi.updateCase(data.id, data.revision, action, value),
    onSettled: () => client.invalidateQueries({ queryKey: ['reception'] }),
  });
  async function post() {
    if (posting || !draft.body.trim()) return;
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
  return (
    <article className="rounded-xl border bg-card overflow-hidden">
      <header className="p-4 border-b space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold break-words">{data.contactName}</h2>
            <p className="text-xs text-muted-foreground break-words mt-1">{data.phone || 'Sem telefone cadastrado'}</p>
          </div>
          <span className="text-xs text-primary">{statuses[data.status]}</span>
        </div>
        <p className="text-sm break-words">{data.subject}</p>
        <p className="text-xs text-muted-foreground">
          {kinds[data.kind]} ·{' '}
          {data.doctorId
            ? (access?.doctors.find((d) => d.id === data.doctorId)?.name ?? 'Médico relacionado')
            : 'Médico a definir'}
        </p>
        <div className="flex flex-wrap gap-2">
          {closed ? (
            <Button size="sm" onClick={() => change.mutate({ action: 'reopen' })} disabled={change.isPending}>
              Reabrir atendimento
            </Button>
          ) : (
            <>
              {!data.assignedTo && (
                <Button size="sm" onClick={() => change.mutate({ action: 'claim' })} disabled={change.isPending}>
                  Assumir atendimento
                </Button>
              )}
              {data.assignedTo && !mine && (
                <p className="text-xs text-muted-foreground py-2">
                  Em atendimento por{' '}
                  {data.eligibleAssignees.find((a) => a.id === data.assignedTo)?.name ?? 'outro integrante'}.
                </p>
              )}
              {editable && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setBooking(true)}>
                    Agendar consulta
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ action: 'status', value: { status: 'resolved' } })}
                  >
                    Concluir atendimento
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </header>
      <div className="p-4 space-y-5">
        <ReceptionNotice error={change.error} />
        {!closed && editable && (
          <section className="space-y-3">
            <DoctorSuggestion doctors={access?.doctors ?? []} receptionCase={data} onSelect={setDoctor} />
            <div className="grid lg:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={'case-doctor-' + data.id}>Encaminhar para médico</Label>
                <select
                  id={'case-doctor-' + data.id}
                  className="w-full rounded-md border bg-background p-2 text-xs"
                  value={doctor}
                  onChange={(e) => setDoctor(e.target.value)}
                >
                  <option value="">Selecione uma agenda</option>
                  {access?.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={!doctor || change.isPending}
                  onClick={() => change.mutate({ action: 'route', value: { doctorId: doctor } })}
                >
                  Encaminhar
                </Button>
              </div>
              <div>
                <Label htmlFor={'case-transfer-' + data.id}>Transferir para atendente</Label>
                <select
                  id={'case-transfer-' + data.id}
                  className="w-full rounded-md border bg-background p-2 text-xs"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Selecione uma pessoa</option>
                  {data.eligibleAssignees
                    .filter((a) => a.id !== data.assignedTo)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={!target || change.isPending}
                  onClick={() => change.mutate({ action: 'transfer', value: { assigneeId: target } })}
                >
                  Transferir
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['assigned', 'waiting_patient', 'waiting_internal'] as const).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={data.status === status ? 'secondary' : 'ghost'}
                  disabled={change.isPending || !data.assignedTo || data.status === status}
                  onClick={() => change.mutate({ action: 'status', value: { status } })}
                >
                  {statuses[status]}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={change.isPending}
                onClick={() => change.mutate({ action: 'status', value: { status: 'cancelled' } })}
              >
                Cancelar demanda
              </Button>
            </div>
          </section>
        )}
        <section className="rounded-lg bg-muted/30 p-3 space-y-2">
          <h3 className="text-xs font-semibold">Vínculos administrativos confirmados</h3>
          {data.beneficiaries.length ? (
            data.beneficiaries.map((p) => (
              <p key={p.id} className="text-xs break-words">
                {p.name} · {access?.doctors.find((d) => d.id === p.doctorId)?.name ?? 'Médico'}
                {p.dateOfBirth ? ' · nascimento ' + p.dateOfBirth.split('-').reverse().join('/') : ''}
              </p>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Paciente ainda não confirmado. Confirme o beneficiário ao agendar; o telefone sozinho não identifica quem
              será atendido.
            </p>
          )}
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Acompanhamento administrativo</h3>
          {notes.length < data.noteCount && (
            <Button size="sm" variant="outline" disabled={olderBusy} onClick={() => void loadOlder()}>
              Carregar registros anteriores
            </Button>
          )}
          {!notes.length && <p className="text-xs text-muted-foreground">Nenhuma anotação registrada.</p>}
          {notes.map((note) => (
            <div key={note.id} className="border-l-2 pl-3 py-1">
              <p className="text-[0.625rem] text-muted-foreground">
                {note.actorName} · {clinicDateLabel(note.createdAt)} às {clinicTime(note.createdAt)}
              </p>
              <p className="text-sm whitespace-pre-wrap break-words mt-1">{note.body}</p>
            </div>
          ))}
        </section>
        <section className="space-y-2">
          <Label htmlFor={'case-note-' + data.id}>Seu rascunho de acompanhamento</Label>
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
            placeholder="Registre somente informações administrativas; não transcreva evolução clínica."
          />
          <p role="status" className="text-[0.625rem] text-muted-foreground">
            {draft.saving
              ? 'Salvando rascunho…'
              : draft.dirty
                ? 'Alterações aguardando salvamento'
                : 'Rascunho salvo para sua conta'}
          </p>
          <ReceptionNotice error={draft.error} />
          <ReceptionNotice error={postError} />
          {draft.error && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void draft.flush().catch(() => {})}>
                Tentar salvar novamente
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void draft.reload().catch(setPostError);
                }}
              >
                Recuperar versão do servidor
              </Button>
            </div>
          )}
          <Button size="sm" disabled={!editable || closed || posting || !draft.body.trim()} onClick={() => void post()}>
            {posting ? 'Registrando…' : 'Registrar anotação'}
          </Button>
          {!editable && !closed && (
            <p className="text-xs text-muted-foreground">
              Assuma ou solicite transferência para registrar a anotação. Seu rascunho é privado.
            </p>
          )}
        </section>
        <Link to="/recepcao/agenda" className="inline-block text-xs underline underline-offset-4">
          Ver agenda da equipe
        </Link>
      </div>
      {booking && <BookingDialog receptionCase={data} onClose={() => setBooking(false)} />}
    </article>
  );
}
