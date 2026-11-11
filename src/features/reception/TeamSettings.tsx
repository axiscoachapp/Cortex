import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeading } from '@/components/PageHeading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { functionErrorMessage } from '@/lib/functionErrors';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { delegationApi } from './delegationApi';
import { ReceptionAccessNotice, ReceptionNotice } from './ReceptionNotice';
import { StaffAccessProvenance } from './StaffAccessProvenance';
import { WithdrawDelegation } from './WithdrawDelegation';
import { DisabledHint } from './ReceptionControls';
import { TEAM_TITLE } from './teamNames';
import { dialogLayout } from './dialogLayout';
import type { ClinicAccess } from './contracts';


export default function TeamSettings({ embedded = false }: { embedded?: boolean }) {
  const access = useClinicAccess();
  if (!access?.admin) return <ReceptionAccessNotice title={TEAM_TITLE} headingLevel={embedded ? 2 : 1} message="Esta página é só para o administrador da clínica." grantedBy={null} />;
  return <TeamSection key={`${access.actorId}:${access.clinic?.id ?? 'none'}`} access={access} embedded={embedded} />;
}

function TeamSection({ access, embedded }: { access: ClinicAccess; embedded: boolean }) {
  const titleId = useId(), createHint = useId();
  const Container = embedded ? 'section' : 'div', SectionHeading = embedded ? 'h3' : 'h2';
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [doctors, setDoctors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [credentials, setCredentials] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const directory = useQuery({
    queryKey: ['reception', 'team-doctors', access?.clinic?.id, access?.actorId],
    queryFn: () => receptionApi.teamDoctors(access.clinic!.id),
    enabled: !!access.clinic,
    staleTime: 30_000,
  });
  const teamDoctors = directory.isSuccess ? directory.data : [];
  const requestLink = access.clinic ? `/permissoes-recepcao?clinica=${access.clinic.id}` : null;
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !directory.isSuccess || !doctors.length) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('create-clinic-receptionist', {
        body: { name, email, doctorIds: doctors },
      });
      if (error) throw new Error(await functionErrorMessage(error, 'Não foi possível criar a conta.'));
      const result = z
        .object({ success: z.literal(true), email: z.string(), temporaryPassword: z.string().min(12) })
        .strict()
        .safeParse(data);
      if (!result.success)
        throw new Error('Não foi possível confirmar a criação. Atualize a lista antes de tentar de novo.');
      const parsed = result.data;
      setCredentials({ email: parsed.email, temporaryPassword: parsed.temporaryPassword });
      setName('');
      setEmail('');
      setDoctors([]);
      await client.invalidateQueries({ queryKey: ['clinic-access'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function reissue(id: string) {
    if (busy) return;
    if (!window.confirm('Gerar uma nova senha temporária? Só é possível enquanto a pessoa ainda não definiu a própria senha. A anterior deixa de funcionar.')) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('reissue-temporary-password', { body: { userId: id } });
      if (error) throw new Error(await functionErrorMessage(error, 'Não foi possível gerar a nova senha temporária.'));
      const result = z
        .object({ success: z.literal(true), email: z.string(), temporaryPassword: z.string().min(12) })
        .strict()
        .safeParse(data);
      if (!result.success) throw new Error('A operação retornou uma resposta inesperada. Tente novamente.');
      setCredentials({ email: result.data.email, temporaryPassword: result.data.temporaryPassword });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function update(id: string, doctorIds: string[], active: boolean) {
    if (busy || (active && !directory.isSuccess)) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const confirmed = await receptionApi.updateStaff(id, doctorIds, active);
      if (confirmed !== true) throw new Error('Não foi possível confirmar a atualização da conta. Atualize a lista antes de tentar de novo.');
      if (active && doctorIds.length === 0) setNotice('Conta reativada, sem agendas. Use Pedir acesso a uma agenda para enviar o pedido ao médico.');
      if (!active) setNotice('Acesso desativado.');
      await client.invalidateQueries({ queryKey: ['clinic-access'] });
      await client.invalidateQueries({ queryKey: ['reception'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const missing = !name.trim() || !email.trim() ? 'Preencha nome, e-mail e ao menos uma agenda.'
    : !doctors.length ? 'Escolha ao menos uma agenda.' : null;
  return (
    <Container aria-labelledby={embedded ? titleId : undefined} className="space-y-6 min-w-0">
      <PageHeading id={titleId} headingLevel={embedded ? 2 : 1} title={TEAM_TITLE} description="Contas das secretárias e as agendas que cada uma pode usar. Os prontuários continuam só com os médicos." actions={
        <div className="flex flex-wrap gap-2">
          {requestLink && <Button asChild variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal"><Link to={requestLink}>Pedir acesso a uma agenda</Link></Button>}
          {!directory.isError && (
            <Button className="min-h-11 gap-2" variant="outline" disabled={busy || directory.isFetching} onClick={() => void directory.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Atualizar lista
            </Button>
          )}
        </div>
      } />
      <ReceptionNotice error={error} />
      {notice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{notice}</p>}
      <ReceptionNotice error={directory.error} loading={directory.isPending} onRetry={() => void directory.refetch()} />
      <section className="rounded-xl border bg-card p-4 space-y-4">
        <SectionHeading className="font-semibold text-base">Nova conta</SectionHeading>
        <form onSubmit={create} className="space-y-4">
          <fieldset disabled={busy} className="grid md:grid-cols-2 gap-4">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="staff-name">Nome</Label>
              <Input id="staff-name" className="h-11" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="staff-email">E-mail de acesso</Label>
              <Input id="staff-email" className="h-11" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required />
              <p className="text-xs text-muted-foreground">Um e-mail só desta pessoa; é com ele que ela entra no Cortex.</p>
            </div>
          </fieldset>
          <fieldset disabled={busy || !directory.isSuccess} className="space-y-1">
            <legend className="text-sm font-medium mb-1">Agendas</legend>
            {teamDoctors.map((d) => (
              <div key={d.id} className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox id={`new-staff-${d.id}`} checked={doctors.includes(d.id)} disabled={busy || !directory.isSuccess}
                  onCheckedChange={(checked) => setDoctors((old) => (checked === true ? [...old, d.id] : old.filter((id) => id !== d.id)))} />
                <Label htmlFor={`new-staff-${d.id}`} className="font-normal">{d.name}</Label>
              </div>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button className="min-h-11" type="submit" aria-describedby={missing ? createHint : undefined} disabled={busy || !directory.isSuccess || !doctors.length}>
              {busy ? 'Salvando…' : 'Criar conta'}
            </Button>
            {!busy && (directory.isSuccess ? missing && <DisabledHint id={createHint}>{missing}</DisabledHint>
              : <DisabledHint id={createHint}>Atualize a lista de médicos para escolher as agendas.</DisabledHint>)}
          </div>
        </form>
      </section>
      <section className="space-y-3">
        <SectionHeading className="font-semibold text-base">Contas cadastradas</SectionHeading>
        {!access.staff.length && <p className="text-sm text-muted-foreground">Nenhuma conta de recepção cadastrada.</p>}
        {access.staff.map((staff) => (
          <StaffCard
            key={staff.id + JSON.stringify(staff.doctorIds) + staff.active}
            actorId={access.actorId}
            clinicId={access.clinic?.id ?? null}
            staff={staff}
            embedded={embedded}
            provenance={access.clinic ? <StaffAccessProvenance actorId={access.actorId} clinicId={access.clinic.id} staffId={staff.id} staffName={staff.name} /> : null}
            doctors={teamDoctors}
            scopesReady={directory.isSuccess}
            busy={busy}
            onSave={(ids) => void update(staff.id, ids, true)}
            onReactivate={() => void update(staff.id, [], true)}
            onDeactivate={() => void update(staff.id, [], false)}
            onReissue={() => void reissue(staff.id)}
          />
        ))}
      </section>
      <Dialog
        open={!!credentials}
        onOpenChange={(open) => {
          if (!open) setCredentials(null);
        }}
      >
        <DialogContent className={`max-w-lg ${dialogLayout.content}`}>
          <DialogHeader className={dialogLayout.header}>
            <DialogTitle>Credenciais temporárias</DialogTitle>
            <DialogDescription>
              Entregue estas credenciais à pessoa responsável por um canal seguro. Ela deverá trocar a senha no primeiro
              acesso, em até 72 horas.
            </DialogDescription>
          </DialogHeader>
          <div className={dialogLayout.body}><dl className="text-sm space-y-3">
            <div>
              <dt>E-mail</dt>
              <dd className="break-all font-medium">{credentials?.email}</dd>
            </div>
            <div>
              <dt>Senha temporária</dt>
              <dd className="break-all font-mono select-all bg-muted p-3 rounded">{credentials?.temporaryPassword}</dd>
            </div>
          </dl></div>
          <div className={dialogLayout.footer}><div className={dialogLayout.actions}>
            <Button className={dialogLayout.button} onClick={() => setCredentials(null)}>Concluir</Button>
          </div></div>
        </DialogContent>
      </Dialog>
    </Container>
  );
}

function StaffCard({
  actorId, clinicId, staff, embedded, provenance, doctors, busy, scopesReady, onSave, onReactivate, onDeactivate, onReissue,
}: {
  actorId: string;
  clinicId: string | null;
  staff: { id: string; name: string; active: boolean; doctorIds: string[] };
  embedded: boolean;
  provenance: React.ReactNode;
  doctors: { id: string; name: string }[];
  busy: boolean;
  scopesReady: boolean;
  onSave: (ids: string[]) => void;
  onReactivate: () => void;
  onDeactivate: () => void;
  onReissue: () => void;
}) {
  const Heading = embedded ? 'h4' : 'h3';
  const client = useQueryClient();
  const hintPrefix = useId();
  const [selected, setSelected] = useState(staff.doctorIds);
  // Who authorized each current agenda. An agenda the doctor approved is not a checkbox: the old
  // list cannot remove it (the server refuses), so it shows the doctor's approval and its revoke.
  const originKey = ['reception', 'staff-card-origin', actorId, clinicId, staff.id];
  const origin = useQuery({
    queryKey: originKey,
    queryFn: () => delegationApi.permissions({ clinicId: clinicId!, staffId: staff.id, limit: 100 }),
    enabled: staff.active && !!clinicId && staff.doctorIds.length > 0,
    retry: false, staleTime: 0,
  });
  const originReady = staff.doctorIds.length === 0 || origin.isSuccess;
  const approved = new Map((origin.data?.items ?? []).flatMap(row => row.source === 'physician_approval' && staff.doctorIds.includes(row.doctorId) ? [[row.doctorId, row.requestId] as const] : []));
  const editable = staff.doctorIds.filter(id => !approved.has(id));
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: originKey }),
    client.invalidateQueries({ queryKey: ['clinic-access'] }),
    client.invalidateQueries({ queryKey: ['reception', 'staff-permission-origin'] }),
  ]);
  const locked = busy || !scopesReady || !originReady;
  return (
    <article className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap gap-2 justify-between">
        <Heading className="font-medium">{staff.name}</Heading>
        <span className="text-xs text-muted-foreground">{staff.active ? 'Ativa' : 'Desativada'}</span>
      </div>
      {staff.active ? <>
        {origin.isPending && origin.fetchStatus !== 'idle' && <ReceptionNotice loading />}
        {origin.isError && <ReceptionNotice error={new Error('Não foi possível conferir quem autorizou as agendas desta conta.')} onRetry={() => void origin.refetch()} />}
        <fieldset disabled={locked} className="space-y-1">
          <legend className="sr-only">Agendas de {staff.name}</legend>
          {doctors.map((d) => {
            const requestId = approved.get(d.id);
            if (requestId && clinicId) return <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-b-0">
              <div className="min-w-0">
                <p>{d.name}</p>
                <p className="text-xs text-muted-foreground">Aprovado pelo médico</p>
              </div>
              <WithdrawDelegation key={requestId} actorId={actorId} clinicId={clinicId} staffId={staff.id} doctorId={d.id} requestId={requestId} doctorName={d.name} disabled={busy || origin.isFetching} onRevoked={refresh} />
            </div>;
            const current = staff.doctorIds.includes(d.id);
            const hint = `${hintPrefix}-${d.id}`;
            return <div key={d.id} className="py-1">
              <div className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox id={`${hintPrefix}-box-${d.id}`} disabled={locked || !current} aria-describedby={current ? undefined : hint}
                  checked={selected.includes(d.id)}
                  onCheckedChange={(checked) => setSelected((old) => (checked === true ? [...old, d.id] : old.filter((id) => id !== d.id)))} />
                <Label htmlFor={`${hintPrefix}-box-${d.id}`} className="font-normal">{d.name}</Label>
              </div>
              {!current && <p id={hint} className="pl-8 text-xs text-muted-foreground">Depende da aprovação de {d.name}. Use Pedir acesso a uma agenda.</p>}
            </div>;
          })}
        </fieldset>
        {!staff.doctorIds.length && <p className="text-sm text-muted-foreground">Conta ativa, sem agendas. Use Pedir acesso a uma agenda para enviar o pedido ao médico.</p>}
      </> : <p className="text-sm text-muted-foreground">As agendas anteriores não serão restauradas. Reative a conta e peça de novo o acesso a cada agenda.</p>}
      <div className="flex flex-wrap gap-2">
        {staff.active ? editable.length > 0 && (
          <Button className="h-auto min-h-11 max-w-full whitespace-normal" variant="outline" disabled={locked}
            onClick={() => onSave(staff.doctorIds.filter(id => approved.has(id) || selected.includes(id)))}>
            Salvar agendas
          </Button>
        ) : (
          <Button className="h-auto min-h-11 max-w-full whitespace-normal" variant="outline" disabled={busy || !scopesReady} onClick={onReactivate}>
            Reativar conta
          </Button>
        )}
        {staff.active && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="min-h-11" variant="ghost" disabled={busy}>Desativar acesso</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl">
              <AlertDialogHeader className="text-left">
                <AlertDialogTitle>Desativar acesso</AlertDialogTitle>
                <AlertDialogDescription>O que acontece com a conta de {staff.name}:</AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>Ela deixa de entrar no Cortex.</li>
                <li>Perde o acesso a todas as agendas. Para voltar, cada médico precisa aprovar de novo.</li>
                <li>Os atendimentos com ela voltam para a fila, sem responsável.</li>
              </ul>
              <AlertDialogFooter className="gap-2 sm:space-x-0">
                <AlertDialogCancel className="mt-0 min-h-11">Cancelar</AlertDialogCancel>
                <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy} onClick={() => { if (!busy) onDeactivate(); }}>Desativar acesso</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {staff.active && (
          <Button className="min-h-11" variant="ghost" disabled={busy} onClick={onReissue}>
            Nova senha temporária
          </Button>
        )}
      </div>
      {provenance}
    </article>
  );
}
