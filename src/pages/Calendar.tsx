import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  View,
  SlotInfo,
} from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { ArrowLeft, Plus, CalendarDays, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Appointment, Patient } from '@/types/patient';
import { AppointmentModal } from '@/components/AppointmentModal';
import { useToast } from '@/hooks/use-toast';

// ── Localizer ───────────────────────────────────────────────────────────────
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { locale: ptBR }),
  getDay,
  locales: { 'pt-BR': ptBR },
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function mapRow(row: any): Appointment {
  return {
    id: row.id,
    userId: row.user_id,
    patientId: row.patient_id,
    title: row.title,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    type: row.type,
    notes: row.notes ?? undefined,
    status: row.status,
    googleEventId: row.google_event_id ?? undefined,
    reminderSent: row.reminder_sent ?? false,
  };
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

const VIEW_LABELS: Record<string, string> = {
  month: 'Mês',
  week: 'Semana',
  day: 'Dia',
};

// ── Messages (pt-BR) ─────────────────────────────────────────────────────────
const messages = {
  allDay: 'Dia todo',
  previous: '‹',
  next: '›',
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

  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [defaultSlot, setDefaultSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);

  // Check Google Calendar connection
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_integrations')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setGoogleConnected(!!data);
        setCheckingGoogle(false);
      });
  }, [user?.id]);

  // Check if just connected via OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      setGoogleConnected(true);
      toast({ title: 'Google Calendar conectado com sucesso!' });
      window.history.replaceState({}, '', '/agenda');
    }
  }, []);

  // Load patients for modal
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ['patients', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase.from('patients').select('*').order('name');
      return (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        age: row.age,
        profession: row.profession ?? '',
        photoUrl: row.photo_url ?? undefined,
        lastVisit: row.last_visit,
        status: row.status,
        diagnoses: Array.isArray(row.diagnoses) ? row.diagnoses : [],
        medications: Array.isArray(row.medications) ? row.medications : [],
        allergies: row.allergies ?? [],
        phone: row.phone ?? undefined,
        email: row.email ?? undefined,
      }));
    },
    enabled: !!user?.id,
  });

  // Load appointments
  const { data: appointments = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ['appointments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', user.id)
        .order('start_time');
      if (error) throw error;
      return (data ?? []).map(mapRow);
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

  const handleSelectEvent = useCallback((event: any) => {
    setSelectedAppointment(event.resource as Appointment);
    setDefaultSlot(null);
    setModalOpen(true);
  }, []);

  const handleNewAppointment = () => {
    setSelectedAppointment(null);
    setDefaultSlot({ start: new Date(), end: addMinutes(new Date(), 30) });
    setModalOpen(true);
  };

  const handleGoogleConnect = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      toast({
        title: 'Google Client ID não configurado',
        description: 'Adicione VITE_GOOGLE_CLIENT_ID ao arquivo .env',
        variant: 'destructive',
      });
      return;
    }
    const redirectUri = `${window.location.origin}/google-oauth-callback`;
    const scope = 'https://www.googleapis.com/auth/calendar.events';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${user?.id}`;
    window.location.href = url;
  };

  // Custom event style by status
  const eventPropGetter = useCallback((event: any) => {
    const appointment = event.resource as Appointment;
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
        <div className="container mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <CalendarDays className="h-6 w-6 text-medical-blue" />
            <div>
              <h1 className="text-lg font-semibold text-foreground leading-tight">Agenda</h1>
              <p className="text-xs text-muted-foreground">{todayLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Status legend */}
            <div className="hidden md:flex items-center gap-2 mr-2">
              {Object.entries(STATUS_LABELS).map(([status, label]) => (
                <div key={status} className="flex items-center gap-1">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[status] }}
                  />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>

            {/* View switcher */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(['month', 'week', 'day'] as View[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v
                      ? 'bg-medical-blue text-white'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {VIEW_LABELS[v as string]}
                </button>
              ))}
            </div>

            {/* Google Calendar */}
            {checkingGoogle ? (
              <Button variant="outline" size="sm" disabled>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                Google
              </Button>
            ) : googleConnected ? (
              <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-success border-success/30">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Google Calendar
              </Badge>
            ) : (
              <Button variant="outline" size="sm" onClick={handleGoogleConnect} className="gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" />
                Conectar Google
              </Button>
            )}

            {/* New appointment */}
            <Button variant="medical" size="sm" onClick={handleNewAppointment} className="gap-1.5">
              <Plus className="w-4 h-4" />
              Nova Consulta
            </Button>
          </div>
        </div>
      </header>

      {/* Calendar */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 140px)' }}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-medical-blue" />
            </div>
          ) : (
            <BigCalendar
              localizer={localizer}
              events={events}
              view={view}
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
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['appointments', user?.id] })}
      />
    </div>
  );
}
