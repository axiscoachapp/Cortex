import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isBelowMobileBreakpoint, useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar as BigCalendar, dateFnsLocalizer, SlotInfo, type EventProps } from 'react-big-calendar';
import {
  format,
  parse,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  getDay,
  addDays,
  addMonths,
  addMinutes,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Plus, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Appointment, Patient } from '@/types/patient';
import { mapPatientRow } from '@/lib/patientMapper';
import { AppointmentModal } from '@/components/AppointmentModal';
import { CalendarWeekDetails, CompactWeekHeader } from '@/components/CalendarWeekDetails';
import { SchedulingFollowups } from '@/components/SchedulingFollowups';
import { formatCalendarDay, formatCalendarPeriod, formatCalendarWeekRange, WEEK_STARTS_ON } from '@/lib/calendarLabels';
import { appointmentStatus, statusLook, typeLabel } from '@/lib/appointmentStatus';
import { fromClinicWall, gridHours, nextHalfHour, toClinicWall } from '@/lib/clinicWallTime';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { fetchAllRows } from '@/lib/pagination';
import type { Tables } from '@/integrations/supabase/types';
import { WorkspaceShell } from '@/components/WorkspaceShell';

// ── Localizer ───────────────────────────────────────────────────────────────
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: WEEK_STARTS_ON }),
  getDay,
  locales: { 'pt-BR': ptBR },
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function mapRow(row: Tables<'appointments'>): Appointment {
  return {
    id: row.id,
    revision: row.revision,
    userId: row.user_id,
    patientId: row.patient_id,
    receptionManaged: row.clinic_id != null,
    title: row.title,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    type: row.type as Appointment['type'],
    notes: row.notes ?? undefined,
    status: row.status as Appointment['status'],
    googleEventId: row.google_event_id ?? undefined,
    googleSyncStatus: row.google_sync_status as Appointment['googleSyncStatus'],
    googleSyncError: row.google_sync_error ?? undefined,
    reminderSent: row.reminder_sent ?? false,
  };
}

/** Grid events carry clinic wall dates (see clinicWallTime.ts); `resource` keeps the real appointment. */
interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Appointment;
}

type GridView = 'day' | 'week' | 'month';
const GRID_VIEWS: ReadonlyArray<{ value: GridView | 'waitlist'; label: string }> = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'waitlist', label: 'Lista de espera' },
];

// ── Messages (pt-BR) ─────────────────────────────────────────────────────────
const messages = {
  allDay: 'Dia todo',
  previous: 'Anterior',
  next: 'Próximo',
  today: 'Hoje',
  month: 'Mês',
  week: 'Semana',
  day: 'Dia',
  agenda: 'Agenda',
  date: 'Data',
  time: 'Hora',
  event: 'Consulta',
  noEventsInRange: 'Nenhuma consulta neste período.',
  showMore: (n: number) => `+${n} mais`,
};

const timeRange = (start: Date, end: Date) => `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`;

/** Day and week grid: the patient's name first, the time on a second line. */
function AgendaEvent({ event }: EventProps<CalendarEvent>) {
  return (
    <span className="block min-w-0 leading-[1.15]">
      <span className="block truncate font-semibold">{event.title}</span>
      <span className="block truncate text-[0.9em] tabular-nums opacity-90">{timeRange(event.start, event.end)}</span>
    </span>
  );
}

/** Grid look of each status; cancelled is an outline with the text struck through. */
function eventStyle(status: string) {
  const look = statusLook(status);
  if (status === 'cancelado')
    return {
      backgroundColor: 'hsl(var(--card))',
      color: '#475569',
      outline: `1px dashed ${look.color}`,
      outlineOffset: '-1px',
      textDecoration: 'line-through',
    };
  return { backgroundColor: look.color, color: '#fff' };
}

function rangeOf(view: GridView, date: Date): { start: Date; end: Date } {
  if (view === 'day') return { start: startOfDay(date), end: addDays(startOfDay(date), 1) };
  if (view === 'week') {
    const start = startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
    return { start, end: addDays(start, 7) };
  }
  return {
    start: startOfWeek(startOfMonth(date), { weekStartsOn: WEEK_STARTS_ON }),
    end: addDays(startOfDay(endOfWeek(endOfMonth(date), { weekStartsOn: WEEK_STARTS_ON })), 1),
  };
}

function step(view: GridView, date: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(date, direction);
  if (view === 'week') return addDays(date, 7 * direction);
  return addMonths(date, direction);
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const waitlistOpen = params.get('queue') === 'scheduling';
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Same rule as the CSS (useIsMobile). The view is only a starting choice:
  // resizing never overrides the view the doctor picked.
  const isMobile = useIsMobile();
  const [gridView, setGridView] = useState<GridView>(() => (isBelowMobileBreakpoint() ? 'day' : 'week'));
  // A clinic wall date (see clinicWallTime.ts).
  const [date, setDate] = useState(() => toClinicWall(new Date()));
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [defaultSlot, setDefaultSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const view: GridView | 'waitlist' = waitlistOpen ? 'waitlist' : gridView;

  const chooseView = (next: GridView | 'waitlist') => {
    const query = new URLSearchParams(params);
    if (next === 'waitlist') query.set('queue', 'scheduling');
    else {
      query.delete('queue');
      setGridView(next);
    }
    if (query.toString() !== params.toString()) setParams(query);
  };

  // Check Google Calendar connection — uses a SECURITY DEFINER RPC so the
  // raw OAuth token columns are never exposed to the client.
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .rpc('get_integration_status', { p_user_id: user.id })
      .maybeSingle()
      .then(({ data, error }) => {
        if (error)
          toast({
            title: 'Não foi possível verificar o Google Calendar',
            description: 'Você pode tentar conectar novamente.',
          });
        setGoogleConnected(data?.google_connected ?? false);
        setCheckingGoogle(false);
      });
  }, [user?.id, toast]);

  // Check if just connected via OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true' && googleConnected) {
      toast({ title: 'Google Calendar conectado com sucesso!' });
      window.history.replaceState({}, '', '/agenda');
    }
  }, [googleConnected, toast]);

  // Load patients for modal
  const {
    data: patients = [],
    isError: patientsError,
    isLoading: patientsLoading,
    refetch: retryPatients,
  } = useQuery<Patient[]>({
    queryKey: ['patients', user?.id, 'all'],
    queryFn: async () => {
      if (!user?.id) return [];
      const data = await fetchAllRows((from, to) =>
        supabase.from('patients').select('*').is('archived_at', null).order('name').order('id').range(from, to),
      );
      return data.map(mapPatientRow);
    },
    enabled: !!user?.id,
  });

  // Load the appointments of the visible clinic days. Rows booked by the
  // reception for this doctor carry the doctor's user_id and appear here too.
  const range = rangeOf(gridView, date);
  const periodStart = fromClinicWall(range.start);
  const periodEnd = fromClinicWall(range.end);
  const {
    data: appointments = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Appointment[]>({
    queryKey: ['appointments', user?.id, periodStart, periodEnd],
    queryFn: async () => {
      if (!user?.id) return [];
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('appointments')
          .select('*')
          .eq('user_id', user.id)
          .gt('end_time', periodStart)
          .lt('start_time', periodEnd)
          .order('start_time')
          .order('id')
          .range(from, to),
      );
      return data.map(mapRow);
    },
    enabled: !!user?.id && !waitlistOpen,
  });

  const patientNames = useMemo(() => new Map(patients.map((p) => [p.id, p.name])), [patients]);
  const events = useMemo<CalendarEvent[]>(
    () =>
      appointments.map((a) => ({
        id: a.id,
        title: (a.patientId && patientNames.get(a.patientId)) || a.title,
        start: toClinicWall(a.startTime),
        end: toClinicWall(a.endTime),
        resource: a,
      })),
    [appointments, patientNames],
  );
  const hours = useMemo(() => gridHours(events), [events]);
  const wallAppointments = useMemo(
    () => events.map((event) => ({ ...event.resource, title: event.title, startTime: event.start, endTime: event.end })),
    [events],
  );

  const openNew = useCallback((start: Date, end: Date) => {
    setSelectedAppointment(null);
    setDefaultSlot({ start, end });
    setModalOpen(true);
  }, []);

  const handleSelectSlot = useCallback((slot: SlotInfo) => {
    // Month-view day clicks and the all-day row report midnight-to-midnight.
    // Default those to a normal 09:00–09:30 slot on the first selected day.
    const start = slot.start;
    const wholeDay =
      start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      slot.end instanceof Date &&
      slot.end.getHours() === 0 &&
      slot.end.getMinutes() === 0 &&
      slot.end.getTime() > start.getTime();
    const wallStart = wholeDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0) : start;
    const wallEnd = !wholeDay && slot.end instanceof Date && slot.end > start ? slot.end : addMinutes(wallStart, 30);
    try {
      openNew(new Date(fromClinicWall(wallStart)), new Date(fromClinicWall(wallEnd)));
    } catch {
      const start = nextHalfHour();
      openNew(start, addMinutes(start, 30));
    }
  }, [openNew]);

  const handleSelectAppointment = useCallback(
    (appointment: Appointment) => {
      // Wall copies (mobile week list) map back to the real row by id.
      setSelectedAppointment(appointments.find((row) => row.id === appointment.id) ?? appointment);
      setDefaultSlot(null);
      setModalOpen(true);
    },
    [appointments],
  );
  const handleSelectEvent = useCallback((event: CalendarEvent) => handleSelectAppointment(event.resource), [handleSelectAppointment]);

  const handleNewAppointment = () => {
    const start = nextHalfHour();
    openNew(start, addMinutes(start, 30));
  };

  const handleGoogleConnect = async () => {
    if (connectingGoogle) return;
    setConnectingGoogle(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { redirectUri: `${window.location.origin}/google-oauth-callback` },
      });
      if (error || !data?.authorizationUrl) throw error ?? new Error('Missing authorization URL');
      const url = new URL(data.authorizationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com')
        throw new Error('Invalid authorization URL');
      window.location.assign(url.href);
    } catch {
      toast({
        title: 'Não foi possível conectar o Google Calendar',
        description: 'Tente novamente. Se o problema continuar, fale com o suporte.',
        variant: 'destructive',
      });
      setConnectingGoogle(false);
    }
  };

  const eventPropGetter = useCallback((event: CalendarEvent) => ({ style: eventStyle(event.resource.status) }), []);
  const tooltip = useCallback(
    (event: CalendarEvent) =>
      `${event.title} · ${timeRange(event.start, event.end)} · ${statusLook(event.resource.status).label} · ${typeLabel(event.resource.type)}`,
    [],
  );

  const retrySync = async (appointmentId: string) => {
    if (syncingId) return;
    setSyncingId(appointmentId);
    try {
      const { data, error } = await supabase.functions.invoke('sync-google-calendar', {
        body: { action: 'update', appointment: { id: appointmentId } },
      });
      if (error || data?.success !== true) throw new Error('Sync pending');
      toast({ title: 'Sincronização concluída' });
    } catch {
      toast({
        title: 'Sincronização pendente',
        description: 'A consulta permanece salva. Tente novamente ou confira a conexão Google.',
        variant: 'destructive',
      });
    } finally {
      setSyncingId(null);
      queryClient.invalidateQueries({ queryKey: ['appointments', user?.id] });
    }
  };

  const pendingSync = googleConnected
    ? appointments.filter((item) => item.googleSyncStatus === 'pending' || item.googleSyncStatus === 'failed')
    : [];

  // Sizes are in rem at the 135% type scale: 2.25rem is about 49 px, above the 44 px target.
  const previousButton = (
    <Button variant="outline" size="icon" className="h-[2.25rem] w-[2.25rem] shrink-0" aria-label="Período anterior" onClick={() => setDate((d) => step(gridView, d, -1))}>
      <ChevronLeft />
    </Button>
  );
  const nextButton = (
    <Button variant="outline" size="icon" className="h-[2.25rem] w-[2.25rem] shrink-0" aria-label="Próximo período" onClick={() => setDate((d) => step(gridView, d, 1))}>
      <ChevronRight />
    </Button>
  );
  const todayButton = (
    <Button variant="outline" className="h-[2.25rem] shrink-0 px-2.5 text-xs" onClick={() => setDate(toClinicWall(new Date()))}>
      Hoje
    </Button>
  );
  const heading = (
    <h1 aria-live="polite" className={cn('min-w-0 font-semibold leading-tight', isMobile ? 'text-sm' : 'text-base')}>
      <span className="sr-only">Agenda: </span>
      {view === 'waitlist' ? 'Lista de espera e confirmações' : formatCalendarPeriod(gridView, date)}
    </h1>
  );
  const viewSwitch = isMobile ? (
    <Select value={view} onValueChange={(value) => chooseView(value as GridView | 'waitlist')}>
      <SelectTrigger aria-label="Visualização da agenda" className="h-[2.25rem] w-auto shrink-0 gap-1.5 px-2.5 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GRID_VIEWS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : (
    <div role="group" aria-label="Visualização da agenda" className="flex shrink-0 rounded-lg border bg-muted/40 p-0.5">
      {GRID_VIEWS.map((option) => (
        <Button
          key={option.value}
          variant={view === option.value ? 'default' : 'ghost'}
          aria-pressed={view === option.value}
          className="h-[2.1rem] px-2 text-xs"
          onClick={() => chooseView(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
  const newButton = (
    <Button
      variant="medical"
      onClick={handleNewAppointment}
      className={cn('h-auto min-h-[2.25rem] gap-1.5 px-2.5 text-xs leading-tight', isMobile && 'min-w-0 flex-1 whitespace-normal')}
    >
      <Plus aria-hidden="true" />
      <span>Novo agendamento</span>
    </Button>
  );

  return (
    <WorkspaceShell section="Agenda" contentClassName="space-y-4">
      {isMobile ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            {view !== 'waitlist' && previousButton}
            <div className="min-w-0 flex-1 text-center">{heading}</div>
            {view !== 'waitlist' && nextButton}
          </div>
          <div className="flex items-stretch gap-1.5">
            {view !== 'waitlist' && todayButton}
            {viewSwitch}
            {newButton}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {view !== 'waitlist' && (
            <div className="flex shrink-0 items-center gap-1">
              {previousButton}
              {todayButton}
              {nextButton}
            </div>
          )}
          <div className="min-w-[8rem] flex-1 basis-0 px-1">{heading}</div>
          {viewSwitch}
          {newButton}
        </div>
      )}

      {patientsError && (
        <div role="alert" className="rounded-xl border bg-card p-4 text-sm flex flex-wrap items-center gap-3">
          <p>Não foi possível carregar os pacientes. Atualize a lista antes de criar ou alterar um agendamento.</p>
          <Button variant="outline" className="min-h-11" onClick={() => retryPatients()}>
            Recarregar pacientes
          </Button>
        </div>
      )}

      {view === 'waitlist' ? (
        <div id="calendar-followups">
          <SchedulingFollowups />
        </div>
      ) : (
        <div className="min-w-0 space-y-3">
          {isMobile && view === 'week' && !isLoading && !isError && (
            <a href="#calendar-week-details" className="inline-block text-sm text-primary underline underline-offset-4">
              Ver horários e títulos completos
            </a>
          )}
          <div
            className="min-h-[24rem] overflow-hidden rounded-xl border border-border bg-card"
            style={{ height: isMobile ? 'min(48rem, calc(100dvh - 15rem))' : 'min(48rem, calc(100dvh - 11rem))' }}
          >
            {isLoading ? (
              <div role="status" className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-medical-blue" aria-hidden="true" />
                <span className="sr-only">Carregando agenda…</span>
              </div>
            ) : isError ? (
              <div role="alert" className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                <p>Não foi possível carregar a agenda.</p>
                <Button variant="outline" className="min-h-11" onClick={() => refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <BigCalendar
                toolbar={false}
                min={hours.min}
                max={hours.max}
                scrollToTime={hours.min}
                getNow={() => toClinicWall(new Date())}
                localizer={localizer}
                formats={{ dayRangeHeaderFormat: formatCalendarWeekRange, dayHeaderFormat: formatCalendarDay }}
                events={events}
                view={view}
                className={cn('[&_.rbc-event-label]:hidden', view !== 'month' && '[&_.rbc-timeslot-group]:min-h-[3.5rem]', view === 'week' && 'calendar-compact-week')}
                components={
                  view === 'month'
                    ? undefined
                    : { event: AgendaEvent, ...(view === 'week' ? { header: CompactWeekHeader } : {}) }
                }
                views={['month', 'week', 'day']}
                date={date}
                onView={(next) => (next === 'day' || next === 'week' || next === 'month') && chooseView(next)}
                onNavigate={setDate}
                onSelectSlot={handleSelectSlot}
                onSelectEvent={handleSelectEvent}
                selectable
                eventPropGetter={eventPropGetter}
                tooltipAccessor={tooltip}
                messages={messages}
                culture="pt-BR"
                style={{ height: '100%', padding: '8px' }}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ul aria-label="Legenda dos agendamentos" className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {Object.entries(appointmentStatus).map(([status, look]) => (
                <li key={status} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={status === 'cancelado' ? { border: `1px dashed ${look.color}` } : { backgroundColor: look.color }} />
                  <span className={status === 'cancelado' ? 'line-through' : undefined}>{look.label}</span>
                </li>
              ))}
            </ul>
            {checkingGoogle ? (
              <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Verificando Google Calendar…
              </span>
            ) : googleConnected ? (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Google Calendar conectado
              </span>
            ) : (
              <Button variant="outline" size="sm" disabled={connectingGoogle} onClick={handleGoogleConnect} className="min-h-11 gap-1.5 text-xs">
                <CalendarDays aria-hidden="true" />
                Conectar Google Calendar
              </Button>
            )}
          </div>

          {pendingSync.length > 0 && (
            <section aria-label="Sincronizações pendentes" className="rounded-xl border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold">Google Calendar · sincronizações pendentes</h2>
              {pendingSync.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 text-sm border rounded-lg p-3 bg-background">
                  <div className="min-w-0">
                    <p className="[overflow-wrap:anywhere]">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.googleSyncStatus === 'failed'
                        ? 'Falha no envio; consulta salva no Cortex.'
                        : 'Alteração aguardando sincronização.'}
                    </p>
                  </div>
                  <Button variant="outline" className="min-h-11" disabled={!!syncingId} onClick={() => retrySync(item.id)}>
                    {syncingId === item.id ? 'Sincronizando…' : 'Tentar novamente'}
                  </Button>
                </div>
              ))}
            </section>
          )}

          {isMobile && view === 'week' && !isLoading && !isError && (
            <CalendarWeekDetails date={date} appointments={wallAppointments} onSelect={handleSelectAppointment} />
          )}
        </div>
      )}

      <AppointmentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        appointment={selectedAppointment}
        defaultStart={defaultSlot?.start}
        defaultEnd={defaultSlot?.end}
        patients={patients}
        patientLookupUnavailable={patientsError || patientsLoading}
        userId={user?.id ?? ''}
        googleConnected={googleConnected}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['appointments', user?.id] });
          // Dashboard "Agenda de Hoje" uses its own key — refresh it too.
          queryClient.invalidateQueries({ queryKey: ['appointments-today'] });
        }}
      />
    </WorkspaceShell>
  );
}
