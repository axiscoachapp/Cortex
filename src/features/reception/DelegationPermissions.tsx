import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dialogLayout } from './dialogLayout';
import { FormError } from './FormError';
import { delegationApi, type DelegationAction, type DelegationCursor, type DelegationRequest } from './delegationApi';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { ReceptionNotice } from './ReceptionNotice';
import { useRequestId } from './useRequestId';
import { DisabledHint, selectClass } from './ReceptionControls';
import { OWN_AGENDA_TITLE, TEAM_TITLE } from './teamNames';

const labels: Record<DelegationRequest['state'], string> = { pending: 'Aguardando médico', approved: 'Aprovado', denied: 'Recusado', cancelled: 'Cancelado', revoked: 'Revogado' };
export default function DelegationPermissions({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const clinicId = params.get('clinica');
  if (clinicId !== null && !z.string().uuid().safeParse(clinicId).success) return <p role="alert" className="p-6">Clínica inválida. Confira o endereço da página.</p>;
  if (!user) return null;
  const content = <Permissions key={`${user.id}:${clinicId ?? 'mine'}`} actorId={user.id} clinicId={clinicId} embedded={embedded} />;
  return embedded ? content : <WorkspaceShell section={clinicId ? TEAM_TITLE : OWN_AGENDA_TITLE}>{content}</WorkspaceShell>;
}

function Permissions({ actorId, clinicId, embedded }: { actorId: string; clinicId: string | null; embedded: boolean }) {
  const titleId = useId();
  const Container = embedded ? 'section' : 'div', SectionHeading = embedded ? 'h3' : 'h2', RowHeading = embedded ? 'h4' : 'h3';
  const access = useClinicAccess();
  const client = useQueryClient();
  const operation = useRequestId();
  const mounted = useRef(true), submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [staffId, setStaffId] = useState(''), [doctorId, setDoctorId] = useState('');
  const [confirmation, setConfirmation] = useState<{ row: DelegationRequest; action: 'approve' | 'revoke' } | null>(null);
  const requests = useInfiniteQuery({
    queryKey: ['reception-delegations', actorId, clinicId],
    queryFn: ({ pageParam }) => delegationApi.list({ clinicId, cursor: pageParam }),
    initialPageParam: null as DelegationCursor | null,
    getNextPageParam: last => last.nextCursor ?? undefined,
    retry: false, staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 15_000,
  });
  const verified = requests.isSuccess && requests.isFetchedAfterMount;
  const canManage = verified && requests.data.pages[0].canManage;
  const currentClinic = !!clinicId && access?.actorId === actorId && access.admin && access.clinic?.id === clinicId;
  const directory = useQuery({
    queryKey: ['reception', 'team-doctors', clinicId, actorId],
    queryFn: () => receptionApi.teamDoctors(clinicId!),
    enabled: !!canManage && !!currentClinic, retry: false, staleTime: 0,
  });
  const staff = currentClinic ? access.staff.filter(s => s.active) : [];
  const rows = verified ? requests.data.pages.flatMap(p => p.items) : [];
  const ready = verified && !requests.isFetching && !busy;
  const formReady = ready && currentClinic && directory.isSuccess && !directory.isFetching;
  const confirmCurrent = confirmation && rows.some(r => r.id === confirmation.row.id && r.revision === confirmation.row.revision && (confirmation.action === 'approve' ? r.canDecide : r.canRevoke));

  async function mutate(body: { kind: 'request'; staffId: string; doctorId: string } | { kind: 'change'; row: DelegationRequest; action: DelegationAction }) {
    if (submitting.current || !ready) return;
    submitting.current = true; setBusy(true); setError(null); setNotice('');
    const payload = body.kind === 'request'
      ? { actorId, clinicId, staffId: body.staffId, doctorId: body.doctorId }
      : { actorId, requestId: body.row.id, revision: body.row.revision, action: body.action };
    try {
      const operationId = operation(payload);
      if (body.kind === 'request') await delegationApi.request({ clinicId: clinicId!, staffId: body.staffId, doctorId: body.doctorId, operationId });
      else await delegationApi.change({ requestId: body.row.id, revision: body.row.revision, action: body.action, operationId });
      if (!mounted.current) return;
      operation.reset(); setConfirmation(null);
      setNotice(body.kind === 'request' ? 'Pedido enviado. O acesso depende da aprovação do médico.' : 'Decisão registrada. A lista será atualizada.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['reception-delegations', actorId] }),
        client.invalidateQueries({ queryKey: ['clinic-access', actorId] }),
      ]);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure);
      if (failure && typeof failure === 'object' && 'code' in failure && ['40001', '42501'].includes(String(failure.code))) {
        setConfirmation(null);
        await client.invalidateQueries({ queryKey: ['reception-delegations', actorId] });
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <Container aria-labelledby={embedded ? titleId : undefined} className="space-y-6 min-w-0">
    {!embedded && clinicId && <Link to="/recepcao/equipe" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Voltar à equipe</Link>}
    <PageHeading id={titleId} headingLevel={embedded ? 2 : 1} title={clinicId ? TEAM_TITLE : OWN_AGENDA_TITLE} description={clinicId ? 'Pedidos de acesso às agendas. Cada acesso só vale depois da aprovação do médico.' : 'Você decide quem da recepção pode usar sua agenda na clínica.'} actions={
      <Button className="min-h-11" variant="outline" disabled={busy || requests.isFetching} onClick={() => void requests.refetch()}>Atualizar lista</Button>
    } />
    <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed">A aprovação permite atender contatos, operar a fila e gerenciar agendamentos da clínica. Os prontuários, evoluções e documentos clínicos continuam privados. Você pode revogar o acesso a qualquer momento.</p>
    <ReceptionNotice loading={requests.isPending} error={requests.error} onRetry={() => void requests.refetch()} />
    <ReceptionNotice error={error} />
    {notice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{notice}</p>}
    {canManage && <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="request-title">
      <SectionHeading id="request-title" className="font-semibold">Solicitar acesso para uma conta existente</SectionHeading>
      {!currentClinic ? <p role="alert" className="text-sm">Para pedir acesso para uma secretária, abra <Link to="/recepcao/equipe" className="underline underline-offset-4">{TEAM_TITLE}</Link>.</p> : <>
        <ReceptionNotice loading={directory.isPending} error={directory.error} onRetry={() => void directory.refetch()} />
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (formReady && staff.some(s => s.id === staffId) && directory.data?.some(d => d.id === doctorId)) void mutate({ kind: 'request', staffId, doctorId }); }}>
          <fieldset disabled={!formReady} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="delegation-staff">Conta de recepção</Label><select id="delegation-staff" className={selectClass} required value={staffId} onChange={event => setStaffId(event.target.value)}><option value="">Selecione uma conta ativa</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="delegation-doctor">Médico responsável</Label><select id="delegation-doctor" className={selectClass} required value={doctorId} onChange={event => setDoctorId(event.target.value)}><option value="">Selecione um médico</option>{directory.isSuccess && directory.data.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={!formReady || !staffId || !doctorId}>Enviar pedido ao médico</Button>{formReady && (!staffId || !doctorId) && <DisabledHint>Escolha a conta e o médico.</DisabledHint>}</div>
        </form>
      </>}
    </section>}
    {verified && <section className="space-y-3" aria-labelledby="requests-title">
      <SectionHeading id="requests-title" className="text-lg font-semibold">{clinicId ? 'Pedidos e aprovações da clínica' : 'Meus pedidos e aprovações'}</SectionHeading>
      {clinicId && <p className="text-sm text-muted-foreground">Acessos dados antes dos pedidos aparecem em {TEAM_TITLE}, em Ver quem autorizou.</p>}
      {!rows.length && <p className="rounded-xl border p-5 text-sm text-muted-foreground">Nenhum pedido encontrado.</p>}
      {rows.map(row => <article key={row.id} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 break-words"><RowHeading className="font-semibold">{row.staffName}</RowHeading><p className="mt-1 text-sm text-muted-foreground">{row.clinicName} · {row.doctorName}</p></div><span className="w-fit shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium">{labels[row.state]}</span></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span>{new Date(row.createdAt).toLocaleString('pt-BR')}</span><span>{row.effective ? 'Acesso ativo' : 'Sem acesso ativo'}</span></div>
        <div className="flex flex-wrap gap-2">
          {row.canDecide && <><Button disabled={!ready} onClick={() => setConfirmation({ row, action: 'approve' })}>Aprovar acesso</Button><Button variant="outline" disabled={!ready} onClick={() => void mutate({ kind: 'change', row, action: 'deny' })}>Recusar pedido</Button></>}
          {row.canCancel && <Button variant="outline" disabled={!ready} onClick={() => void mutate({ kind: 'change', row, action: 'cancel' })}>Cancelar pedido</Button>}
          {row.canRevoke && <Button variant="outline" disabled={!ready} onClick={() => setConfirmation({ row, action: 'revoke' })}>Revogar acesso</Button>}
        </div>
      </article>)}
      {requests.hasNextPage && <Button variant="outline" disabled={!ready} onClick={() => void requests.fetchNextPage()}>Carregar mais pedidos</Button>}
    </section>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) setConfirmation(null); }}>
      <DialogContent className={`max-w-lg ${dialogLayout.content}`}><DialogHeader className={dialogLayout.header}><DialogTitle>{confirmation?.action === 'approve' ? 'Aprovar acesso?' : 'Revogar acesso?'}</DialogTitle><DialogDescription>{confirmation?.row.staffName} · {confirmation?.row.clinicName} · {confirmation?.row.doctorName}</DialogDescription></DialogHeader>
        <div className={dialogLayout.body}>
          <p className="text-sm leading-relaxed">{confirmation?.action === 'approve' ? 'Esta conta poderá operar seus contatos, fila e agenda da clínica. Seus prontuários e documentos clínicos continuam privados.' : 'Esta conta perderá o acesso à sua agenda da clínica. O histórico é mantido.'}</p>
          {!confirmCurrent && <p role="alert" className="text-sm">O pedido mudou. Feche esta confirmação e atualize a lista.</p>}
        </div>
        <div className={dialogLayout.footer}>
          <FormError error={error} />
          <div className={dialogLayout.actions}><Button variant="outline" className={dialogLayout.button} disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</Button><Button className={dialogLayout.button} disabled={!ready || !confirmCurrent} onClick={() => { if (confirmation && confirmCurrent) void mutate({ kind: 'change', ...confirmation }); }}>{confirmation?.action === 'approve' ? 'Confirmar aprovação' : 'Confirmar revogação'}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </Container>;
}
