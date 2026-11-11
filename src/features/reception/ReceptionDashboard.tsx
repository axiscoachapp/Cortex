import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClinicAccess } from './accessContext';
import { clinicDay, clinicTimestamp, nextClinicDay } from './dates';
import { readWhatsAppDashboard } from './whatsappDashboard';
import { ReceptionDashboardSummary } from './ReceptionDashboardSummary';
import { ReceptionAccessNotice } from './ReceptionNotice';
import { SegmentedControl } from './ReceptionControls';

export const DASHBOARD_TITLE = 'Indicadores do WhatsApp';
type Period = { from: string; to: string };
type Preset = 'today' | '7d' | '30d' | 'custom';
const DAY = 86_400_000;
/** The latest instant the server accepts as the end of a period: a whole minute, one minute ago. */
const latestEnd = () => Math.floor((Date.now() - 60_000) / 60_000) * 60_000;
function presetPeriod(preset: Exclude<Preset, 'custom'>): Period {
  const end = latestEnd(), to = new Date(end).toISOString();
  if (preset === 'today') {
    const start = Date.parse(clinicTimestamp(clinicDay(to), '00:00'));
    return { from: new Date(Math.min(start, end - 60_000)).toISOString(), to };
  }
  return { from: new Date(end - (preset === '7d' ? 7 : 30) * DAY).toISOString(), to };
}
/** Whole clinic days, both included; the end stops at now. */
function customPeriod(fromDay: string, toDay: string): Period {
  if (![fromDay, toDay].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error('invalid');
  const from = Date.parse(clinicTimestamp(fromDay, '00:00'));
  const to = Math.min(Date.parse(clinicTimestamp(nextClinicDay(toDay), '00:00')), latestEnd());
  if (!(from < to) || to - from > 31 * DAY) throw new Error('invalid');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export default function ReceptionDashboard() {
  const access = useClinicAccess(), { user } = useAuth(), hidden = useSessionHidden();
  if (hidden) return null;
  if (!access?.active || !access.clinic || user?.id !== access.actorId ||
    !(access.kind === 'reception' || (access.kind === 'clinical' && access.admin))) {
    return <ReceptionAccessNotice title={DASHBOARD_TITLE} message="Acesso aos indicadores indisponível para a sua conta nesta clínica." />;
  }
  return <DashboardPeriod key={`${access.actorId}:${access.clinic.id}:${access.kind}:${access.admin}`} actor={access.actorId} clinic={access.clinic.id} />;
}

function DashboardPeriod({ actor, clinic }: { actor: string; clinic: string }) {
  const [preset, setPreset] = useState<Preset>('7d');
  const [period, setPeriod] = useState(() => presetPeriod('7d'));
  const [days, setDays] = useState(() => ({ from: clinicDay(period.from), to: clinicDay(period.to) }));
  const [editing, setEditing] = useState(false), [error, setError] = useState<object | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null), field = useId();
  useLayoutEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const choose = (value: Preset) => {
    setPreset(value); setError(null);
    if (value === 'custom') { setDays({ from: clinicDay(period.from), to: clinicDay(period.to) }); setEditing(true); return; }
    setEditing(false); setPeriod(presetPeriod(value));
  };
  // A preset moves with the clock: refreshing it reads up to now.
  const reload = preset === 'custom' ? undefined : () => setPeriod(presetPeriod(preset));
  return <div className="space-y-6 min-w-0 [overflow-wrap:anywhere]">
    <PageHeading title={DASHBOARD_TITLE} description="Conversas recebidas pelo WhatsApp da clínica e quem está com cada uma agora." />
    <div className="space-y-3">
      <SegmentedControl label="Período" value={preset} onChange={choose}
        options={[{ value: 'today', label: 'Hoje' }, { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' }, { value: 'custom', label: 'Outro período' }]} />
      {preset === 'custom' && <form noValidate className="rounded-xl border bg-card p-4 space-y-3" onSubmit={event => {
        event.preventDefault();
        try { setPeriod(customPeriod(days.from, days.to)); setError(null); setEditing(false); } catch { setError({}); }
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${field}-from`}>De</Label>
            <Input id={`${field}-from`} type="date" value={days.from} aria-describedby={`${field}-help`} className="h-11 w-full min-w-0"
              onChange={event => { setDays({ ...days, from: event.target.value }); setEditing(true); setError(null); }} />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${field}-to`}>Até</Label>
            <Input id={`${field}-to`} type="date" value={days.to} aria-describedby={`${field}-help`} className="h-11 w-full min-w-0"
              onChange={event => { setDays({ ...days, to: event.target.value }); setEditing(true); setError(null); }} />
          </div>
          <Button type="submit" className="min-h-11">Aplicar período</Button>
        </div>
        <p id={`${field}-help`} className="text-xs text-muted-foreground">Até 31 dias, os dois dias incluídos. Horário de Brasília.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">Escolha um início antes do fim e um período de até 31 dias, terminando hoje ou antes.</p>}
      </form>}
    </div>
    {editing ? <p role="status" className="text-sm">Aplique o período para ver os indicadores.</p>
      : <DashboardReader key={`${period.from}:${period.to}`} actor={actor} clinic={clinic} period={period} onReload={reload} />}
  </div>;
}

function DashboardReader({ actor, clinic, period, onReload }: { actor: string; clinic: string; period: Period; onReload?: () => void }) {
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
    if (before !== null) setBefore(null);
    else if (onReload && before === null && Date.parse(period.to) < Date.now() - 120_000) onReload();
    else void query.refetch();
  };
  return <div className="space-y-5" aria-busy={reading}>
    <div className="flex justify-end">
      <Button type="button" variant="outline" className="min-h-11 gap-2" disabled={reading} onClick={reload}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />Atualizar
      </Button>
    </div>
    {query.fetchStatus === 'paused' ? <p role="status">Aguardando conexão de rede para carregar os indicadores…</p>
      : reading ? <p role="status">Carregando indicadores…</p>
      : query.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3 text-sm">
        <p>Não foi possível carregar os indicadores. Verifique a conexão e tente de novo.</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={reload}>Tentar de novo</Button>
      </div> : null}
    {fresh && <ReceptionDashboardSummary data={query.data} pager={(before !== null || query.data.openNow.owners.nextBefore) ? <div className="flex flex-wrap gap-2">
      {before !== null && <Button type="button" variant="outline" className="min-h-11" onClick={() => withSnapshot(() => setBefore(null))}>Primeiras pessoas</Button>}
      {query.data.openNow.owners.nextBefore && <Button type="button" variant="outline" className="min-h-11"
        onClick={() => withSnapshot(() => setBefore(query.data.openNow.owners.nextBefore))}>Próximas pessoas</Button>}
    </div> : null} />}
  </div>;
}
