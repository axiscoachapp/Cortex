import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClinicAccess } from './accessContext';
import { clinicDay, clinicTime, clinicTimestamp, nextClinicDay } from './dates';
import { readWhatsAppDashboard } from './whatsappDashboard';
import { ReceptionDashboardSummary } from './ReceptionDashboardSummary';

type Period = { from: string; to: string };
const wallTime = (iso: string) => `${clinicDay(iso)}T${clinicTime(iso)}`;
function initialPeriod(): Period {
  const to = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  return { from: clinicTimestamp(nextClinicDay(clinicDay(to), -7), clinicTime(to)), to };
}
function parsePeriod(from: string, to: string): Period {
  if (![from, to].every(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))) throw new Error('invalid');
  const period = { from: clinicTimestamp(from.slice(0, 10), from.slice(11)), to: clinicTimestamp(to.slice(0, 10), to.slice(11)) };
  const duration = Date.parse(period.to) - Date.parse(period.from);
  if (duration <= 0 || duration > 31 * 86_400_000) throw new Error('invalid');
  return period;
}

export default function ReceptionDashboard() {
  const access = useClinicAccess(), { user } = useAuth(), hidden = useSessionHidden();
  if (hidden) return null;
  if (!access?.active || !access.clinic || user?.id !== access.actorId ||
    !(access.kind === 'reception' || (access.kind === 'clinical' && access.admin))) {
    return <p role="alert">Acesso ao painel indisponível.</p>;
  }
  return <DashboardPeriod key={`${access.actorId}:${access.clinic.id}:${access.kind}:${access.admin}`} actor={access.actorId} clinic={access.clinic.id} />;
}

function DashboardPeriod({ actor, clinic }: { actor: string; clinic: string }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [from, setFrom] = useState(() => ({ day: wallTime(period.from).slice(0, 10), time: wallTime(period.from).slice(11) }));
  const [to, setTo] = useState(() => ({ day: wallTime(period.to).slice(0, 10), time: wallTime(period.to).slice(11) }));
  const [editing, setEditing] = useState(false), [error, setError] = useState<object | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null), field = useId();
  useLayoutEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const edit = () => { setEditing(true); setError(null); };
  return <div className="space-y-6 min-w-0 [overflow-wrap:anywhere]">
    <PageHeading title="Painel da recepção" description="Entradas pelo WhatsApp e distribuição das conversas em aberto." />
    <form noValidate className="rounded-xl border bg-card p-4 md:p-5 space-y-3" onSubmit={event => {
      event.preventDefault();
      try { setPeriod(parsePeriod(`${from.day}T${from.time}`, `${to.day}T${to.time}`)); setError(null); setEditing(false); } catch { setError({}); }
    }}>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] gap-4 items-end">
        {([{ name: 'from', title: 'Início do período', date: 'Data inicial', time: 'Hora inicial', value: from, set: setFrom },
          { name: 'to', title: 'Fim do período', date: 'Data final', time: 'Hora final', value: to, set: setTo }]).map(control =>
          <fieldset key={control.name} className="min-w-0 space-y-3">
            <legend className="text-sm font-medium">{control.title}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${field}-${control.name}-date`}>{control.date}</Label>
                <Input id={`${field}-${control.name}-date`} type="date" value={control.value.day} aria-describedby={`${field}-help`} className="h-12 w-full min-w-0 max-w-full"
                  onChange={event => { control.set({ ...control.value, day: event.target.value }); edit(); }} />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${field}-${control.name}-time`}>{control.time}</Label>
                <Input id={`${field}-${control.name}-time`} type="time" value={control.value.time} aria-describedby={`${field}-help`} className="h-12 w-full min-w-0 max-w-full"
                  onChange={event => { control.set({ ...control.value, time: event.target.value }); edit(); }} />
              </div>
            </div>
          </fieldset>)}
        <Button type="submit" disabled={!editing} className="h-auto min-h-12 whitespace-normal md:col-span-2 xl:col-span-1">Aplicar período</Button>
      </div>
      <p id={`${field}-help`} className="text-xs text-muted-foreground">Horário da clínica (São Paulo). Máximo de 31 dias; o instante final não é incluído.</p>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">Informe um início anterior ao fim e um intervalo de até 31 dias, com datas e horários válidos.</p>}
    </form>
    {editing ? <p role="status" className="text-sm">Aplique o período para consultar o painel.</p>
      : <DashboardReader key={`${period.from}:${period.to}`} actor={actor} clinic={clinic} period={period} />}
  </div>;
}

function DashboardReader({ actor, clinic, period }: { actor: string; clinic: string; period: Period }) {
  const [before, setBefore] = useState<string | null>(null);
  const client = useQueryClient(), reader = useId(), mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryKey = ['reception', actor, 'dashboard', clinic, period.from, period.to, before, reader];
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => readWhatsAppDashboard({ ...period, before, limit: 10 }, signal),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = query.isSuccess && query.isFetchedAfterMount && query.fetchStatus === 'idle';
  const reading = query.isPending || query.fetchStatus !== 'idle';
  const withSnapshot = (action: () => void) => {
    const latest = client.getQueryState(queryKey);
    if (mounted.current && fresh && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === query.data) action();
  };
  const reload = () => {
    const latest = client.getQueryState(queryKey);
    if (!mounted.current || latest?.fetchStatus !== 'idle') return;
    if (before !== null) setBefore(null); else void query.refetch();
  };
  return <div className="space-y-5" aria-busy={reading}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">Leitura sob consulta. Atualize para conferir mudanças.</p>
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={reading} onClick={reload}>Atualizar painel</Button>
    </div>
    {query.fetchStatus === 'paused' ? <p role="status">Aguardando conexão de rede para carregar o painel…</p>
      : reading ? <p role="status">Carregando painel…</p>
      : query.isError ? <div role="alert" className="rounded-xl border p-5 space-y-3">
        <p>Não foi possível carregar o painel. Verifique o acesso e tente novamente.</p>
        <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={reload}>Tentar carregar painel</Button>
      </div> : null}
    {fresh && <>
      <ReceptionDashboardSummary data={query.data} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">Até 10 responsáveis por página. Os totais incluem toda a clínica; cada página é uma nova leitura.</p>
        <div className="flex flex-wrap gap-2">
          {before !== null && <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => withSnapshot(() => setBefore(null))}>Primeiros responsáveis</Button>}
          {query.data.openNow.owners.nextBefore && <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal"
            onClick={() => withSnapshot(() => setBefore(query.data.openNow.owners.nextBefore))}>Próximos responsáveis</Button>}
        </div>
      </div>
    </>}
  </div>;
}
