import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  View,
  SlotInfo,
} from 'react-big-calendar';
import { format, parse, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay, getDay, addMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { ArrowLeft, Plus, CalendarDays, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Appointment, Patient } from '@/types/patient';
import { mapPatientRow } from '@/lib/patientMapper';
import { AppointmentModal } from '@/components/AppointmentModal';
import { useToast } from '@/hooks/use-toast';
import { fetchAllRows } from '@/lib/pagination';
import type { Tables } from '@/integrations/supabase/types';

// ── Localizer ───────────────────────────────────────────────────────────────
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { locale: ptBR }),
  getDay,
  locales: { 'pt-BR': ptBR },
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function mapRow(row: Tables<'appointments'>): Appointment {
  return {
    id: row.id,
    userId: row.user_id,
    patientId: row.patient_id,
    title: row.title,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    type: row.type as Appointment['type'],
    notes: row.notes ?? undefined,
    status: row.status as Appointment['status'],
    googleEventId: row.google_event_id ?? undefined,
    reminderSent: row.reminder_sent ?? false,
  };
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Appointment;
}

const STATUS_COLORS: Record<string, string> = {
  agendado: '#3B82F6',
  confirmado: '#10B981',
  cancelado: '#94A3B8',
  realizado: '#475569',
};

const STATUS_LABELS: Record<string, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  realizado: 'Realizado',
};

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

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [view, setView] = useState<View>(() => typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week');
  const [date, setDate] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [defaultSlot, setDefaultSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setView(e.matches ? 'day' : 'week');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Check Google Calendar connection — uses a SECURITY DEFINER RPC so the
  // raw OAuth token columns are never exposed to the client.
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .rpc('get_integration_status', { p_user_id: user.id })
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast({ title: 'Não foi possível verificar o Google Calendar', description: 'Você pode tentar conectar novamente.' });
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
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ['patients', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const data = await fetchAllRows((from, to) => supabase.from('patients').select('*').order('name').order('id').range(from, to));
      return data.map(mapPatientRow);
    },
    enabled: !!user?.id,
  });

  // Load appointments
  const periodStart = view === 'day' ? startOfDay(date) : startOfWeek(view === 'month' ? startOfMonth(date) : date, { locale: ptBR });
  const periodEnd = view === 'day' ? endOfDay(date) : endOfWeek(view === 'month' ? endOfMonth(date) : date, { locale: ptBR });
  const { data: appointments = [], isLoading, isError, refetch } = useQuery<Appointment[]>({
    queryKey: ['appointments', user?.id, periodStart.toISOString(), periodEnd.toISOString()],
    queryFn: async () => {
      if (!user?.id) return [];
      const data = await fetchAllRows((from, to) => supabase
        .from('appointments')
        .select('*')
        .eq('user_id', user.id)
        .gte('end_time', periodStart.toISOString())
        .lte('start_time', periodEnd.toISOString())
        .order('start_time').order('id').range(from, to));
      return data.map(mapRow);
    },
    enabled: !!user?.id,
  });

  // Map appointments to react-big-calendar events
  const events = appointments.map(a => ({
    id: a.id,
    title: a.title,
    start: a.startTime,
    end: a.endTime,
    resource: a,
  }));

  const handleSelectSlot = useCallback((slot: SlotInfo) => {
    setSelectedAppointment(null);
    setDefaultSlot({
      start: slot.start,
      end: slot.end instanceof Date ? slot.end : addMinutes(slot.start, 30),
    });
    setModalOpen(true);
  }, []);

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedAppointment(event.resource);
    setDefaultSlot(null);
    setModalOpen(true);
  }, []);

  const handleNewAppointment = () => {
    setSelectedAppointment(null);
    setDefaultSlot({ start: new Date(), end: addMinutes(new Date(), 30) });
    setModalOpen(true);
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
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('Invalid authorization URL');
      window.location.assign(url.href);
    } catch {
      toast({ title: 'Não foi possível conectar o Google Calendar', description: 'Tente novamente. Se o problema continuar, fale com o suporte.', variant: 'destructive' });
      setConnectingGoogle(false);
    }
  };

  // Custom event style by status
  const eventPropGetter = useCallback((event: CalendarEvent) => {
    const appointment = event.resource;
    const bg = STATUS_COLORS[appointment.status] ?? STATUS_COLORS.agendado;
    return {
      style: {
        backgroundColor: bg,
        borderColor: bg,
        borderRadius: '6px',
        color: '#fff',
        fontSize: '12px',
        padding: '2px 6px',
      },
    };
  }, []);

  const todayLabel = format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-3 md:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <CalendarDays className="h-5 w-5 md:h-6 md:w-6 text-medical-blue shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-semibold text-foreground leading-tight">Agenda</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">{todayLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Status legend — desktop only */}
            <div className="hidden md:flex items-center gap-2 mr-2">
              {Object.entries(STATUS_LABELS).map(([status, label]) => (
                <div key={status} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>

            {/* Google Calendar — icon-only on mobile */}
            {checkingGoogle ? (
              <Button variant="outline" size="sm" disabled aria-label="Verificando Google Calendar">
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                Google
              </Button>
            ) : googleConnected ? (
              <Badge variant="outline" aria-label="Google Calendar conectado" className="flex gap-1.5 py-1.5 px-3 text-success border-success/30">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Google Calendar</span>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" aria-label="Conectar Google Calendar" disabled={connectingGoogle} onClick={handleGoogleConnect} className="gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Conectar Google</span>
              </Button>
            )}

            {/* New appointment */}
            <Button variant="medical" size="sm" aria-label="Novo Agendamento" onClick={handleNewAppointment} className="gap-1.5">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Novo Agendamento</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Calendar */}
      <main className="flex-1 container mx-auto px-2 md:px-4 py-3 md:py-6">
        <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden" style={{ height: isMobile ? 'calc(100dvh - 110px)' : 'calc(100vh - 140px)' }}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-medical-blue" />
            </div>
          ) : isError ? (
            <div role="alert" className="h-full flex flex-col items-center justify-center gap-3">
              <p>Não foi possível carregar a agenda.</p>
              <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
            </div>
          ) : (
            <BigCalendar
              localizer={localizer}
              events={events}
              view={view}
              views={isMobile ? ['day', 'week', 'month'] : ['month', 'week', 'day']}
              date={date}
              onView={setView}
              onNavigate={setDate}
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              selectable
              eventPropGetter={eventPropGetter}
              messages={messages}
              culture="pt-BR"
              style={{ height: '100%', padding: '8px' }}
            />
          )}
        </div>
      </main>

      <AppointmentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        appointment={selectedAppointment}
        defaultStart={defaultSlot?.start}
        defaultEnd={defaultSlot?.end}
        patients={patients}
        userId={user?.id ?? ''}
        googleConnected={googleConnected}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['appointments', user?.id] });
          // Dashboard "Agenda de Hoje" uses its own key — refresh it too.
          queryClient.invalidateQueries({ queryKey: ['appointments-today'] });
        }}
      />
    </div>
  );
}
