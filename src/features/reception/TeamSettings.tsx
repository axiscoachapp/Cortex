import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { functionErrorMessage } from '@/lib/functionErrors';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { ReceptionNotice } from './ReceptionNotice';

export default function TeamSettings() {
  const access = useClinicAccess();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [doctors, setDoctors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [credentials, setCredentials] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const directory = useQuery({
    queryKey: ['reception', 'team-doctors', access?.clinic?.id, access?.actorId],
    queryFn: () => receptionApi.teamDoctors(access!.clinic!.id),
    enabled: !!access?.admin && !!access.clinic,
    staleTime: 30_000,
  });
  const teamDoctors = directory.isSuccess ? directory.data : [];
  if (!access?.admin) return <p role="alert">Somente o administrador pode gerenciar a equipe.</p>;
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !directory.isSuccess || !doctors.length) return;
    setBusy(true);
    setError(null);
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
        throw new Error('A criação retornou uma resposta inesperada. Atualize a equipe antes de tentar novamente.');
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
  async function update(id: string, doctorIds: string[], active: boolean) {
    if (busy || (active && !directory.isSuccess)) return;
    setBusy(true);
    setError(null);
    try {
      await receptionApi.updateStaff(id, doctorIds, active);
      await client.invalidateQueries({ queryKey: ['clinic-access'] });
      await client.invalidateQueries({ queryKey: ['reception'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Equipe e permissões</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure as agendas das secretárias. Seu acesso às agendas e aos prontuários é independente da gestão da equipe.
        </p>
        {access.clinic && <Button asChild variant="outline" className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"><Link to={`/permissoes-recepcao?clinica=${access.clinic.id}`}>Pedidos de acesso e aprovações médicas</Link></Button>}
        {!directory.isError && (
          <Button className="mt-3" size="sm" variant="outline" disabled={busy || directory.isFetching} onClick={() => void directory.refetch()}>
            Atualizar profissionais
          </Button>
        )}
      </div>
      <ReceptionNotice error={error} />
      <ReceptionNotice error={directory.error} loading={directory.isPending} onRetry={() => void directory.refetch()} />
      <section className="rounded-xl border bg-card p-4 space-y-4">
        <h2 className="font-semibold text-base">Criar conta de recepção</h2>
        <form onSubmit={create} className="space-y-4">
          <fieldset disabled={busy} className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="staff-name">Nome da secretária</Label>
              <Input
                id="staff-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={120}
                required
              />
            </div>
            <div>
              <Label htmlFor="staff-email">E-mail exclusivo da conta</Label>
              <Input
                id="staff-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
              />
            </div>
          </fieldset>
          <fieldset disabled={busy || !directory.isSuccess} className="space-y-2">
            <legend className="text-sm font-medium mb-2">Agendas permitidas</legend>
            {teamDoctors.map((d) => (
              <label key={d.id} className="flex items-start gap-2 text-sm">
                <input
                  className="mt-1 accent-primary"
                  type="checkbox"
                  checked={doctors.includes(d.id)}
                  onChange={(e) =>
                    setDoctors((old) => (e.target.checked ? [...old, d.id] : old.filter((id) => id !== d.id)))
                  }
                />
                {d.name}
              </label>
            ))}
          </fieldset>
          <Button className="h-auto min-h-10 max-w-full whitespace-normal" type="submit" disabled={busy || !directory.isSuccess || !doctors.length}>
            {busy ? 'Salvando…' : 'Criar conta com acesso restrito'}
          </Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-base">Contas cadastradas</h2>
        {!access.staff.length && <p className="text-sm text-muted-foreground">Nenhuma conta de recepção cadastrada.</p>}
        {access.staff.map((staff) => (
          <StaffCard
            key={staff.id + JSON.stringify(staff.doctorIds) + staff.active}
            staff={staff}
            doctors={teamDoctors}
            scopesReady={directory.isSuccess}
            busy={busy}
            onSave={(ids) => void update(staff.id, ids, true)}
            onDeactivate={() => void update(staff.id, [], false)}
          />
        ))}
      </section>
      <Dialog
        open={!!credentials}
        onOpenChange={(open) => {
          if (!open) setCredentials(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Credenciais temporárias</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Entregue estas credenciais à pessoa responsável por um canal seguro. Ela deverá trocar a senha no primeiro
            acesso.
          </p>
          <dl className="text-sm space-y-3">
            <div>
              <dt>E-mail</dt>
              <dd className="break-all font-medium">{credentials?.email}</dd>
            </div>
            <div>
              <dt>Senha temporária</dt>
              <dd className="break-all font-mono select-all bg-muted p-3 rounded">{credentials?.temporaryPassword}</dd>
            </div>
          </dl>
          <Button onClick={() => setCredentials(null)}>Concluir</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffCard({
  staff,
  doctors,
  busy,
  scopesReady,
  onSave,
  onDeactivate,
}: {
  staff: { id: string; name: string; active: boolean; doctorIds: string[] };
  doctors: { id: string; name: string }[];
  busy: boolean;
  scopesReady: boolean;
  onSave: (ids: string[]) => void;
  onDeactivate: () => void;
}) {
  const [selected, setSelected] = useState(staff.doctorIds);
  return (
    <article className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap gap-2 justify-between">
        <h3 className="font-medium">{staff.name}</h3>
        <span className="text-xs text-muted-foreground">{staff.active ? 'Ativa' : 'Desativada'}</span>
      </div>
      <fieldset disabled={busy || !scopesReady} className="flex flex-wrap gap-3">
        <legend className="sr-only">Agendas de {staff.name}</legend>
        {doctors.map((d) => (
          <label key={d.id} className="flex gap-2 items-start text-xs">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={selected.includes(d.id)}
              onChange={(e) =>
                setSelected((old) => (e.target.checked ? [...old, d.id] : old.filter((id) => id !== d.id)))
              }
            />
            {d.name}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" size="sm" variant="outline" disabled={busy || !scopesReady || !selected.length} onClick={() => onSave(selected)}>
          {staff.active ? 'Salvar permissões' : 'Reativar com estas agendas'}
        </Button>
        {staff.active && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDeactivate}>
            Desativar acesso
          </Button>
        )}
      </div>
    </article>
  );
}
