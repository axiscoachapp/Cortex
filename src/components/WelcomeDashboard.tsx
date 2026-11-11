import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronRight, Clock, Users, Shield, Bell, MessageCircle, Mail, Loader2 } from 'lucide-react';
import { SpecialtySettingsSheet } from '@/components/SpecialtySettingsSheet';
import { OnboardingCard } from '@/components/OnboardingCard';
import { ConsultationRecoveryNotice } from '@/components/ConsultationRecoveryNotice';
import { LocalRecordingRecoveryNotice } from '@/components/LocalRecordingRecoveryNotice';
import { Button } from '@/components/ui/button';
import { Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { lastConsultationLabel } from '@/lib/dates';
import { typeLabel } from '@/lib/appointmentStatus';
import { fetchAllRows } from '@/lib/pagination';
import { mapPatientRow } from '@/lib/patientMapper';
import { canRemindAppointment } from '../../supabase/functions/_shared/reminders';
import { DailyAgenda } from './DailyAgenda';
import { PatientShortcut } from './PatientShortcut';

interface Appointment {
  patient?: Parameters<typeof mapPatientRow>[0] | null;
  id: string;
  patient_id: string | null;
  title: string;
  start_time: string;
  end_time: string;
  type: string;
  status: string;
  notes: string | null;
  reminder_sent: boolean;
}

interface WelcomeDashboardProps {
  counts?: { total: number; new: number; returns: number };
  patients: Patient[];
  onSelectPatient: (patient: Patient, appointmentId?: string) => void;
  onNewConsultation: () => void;
  userId: string;
  onResumeConsultation?: (patientId: string) => void;
  /** Retries the patient directory behind the counters and lists. */
  onRetryPatients?: () => void;
  /** A consultation still open behind the dashboard, with the way back to it. */
  openConsultation?: { name: string; onReturn: () => void };
  /** Whether the patient directory behind the counters has loaded. */
  patientsState?: 'loading' | 'error' | 'ready';
}

const lastConsultation = (value: string | null | undefined) =>
  value ? `Última consulta: ${lastConsultationLabel(value)}` : lastConsultationLabel(value);

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function todayLabel(): string {
  const label = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "qua, 11 nov" for the one-line phone header. */
function shortDayLabel(): string {
  const parts = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => (parts.find(item => item.type === type)?.value ?? '').replace('.', '');
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function WelcomeDashboard({
  patients,
  counts,
  onSelectPatient,
  onNewConsultation,
  userId,
  onResumeConsultation,
  onRetryPatients,
  openConsultation,
  patientsState = 'ready',
}: WelcomeDashboardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [sentReminderIds, setSentReminderIds] = useState<Set<string>>(new Set());
  const [reminderLinks, setReminderLinks] = useState<Record<string, string>>({});

  // Local-time day bounds. toISOString() is UTC — in Brazil (UTC-3) it rolls
  // to "tomorrow" at 21:00 local and the agenda showed the wrong day.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  const {
    data: todayApts = [],
    isLoading: aptsLoading,
    isError: aptsError,
    refetch: refetchApts,
  } = useQuery<Appointment[]>({
    queryKey: ['appointments-today', userId, dayStart.toDateString()],
    queryFn: async () => {
      if (!userId) return [];
      // Throw on failure so isError is set — otherwise a failed load looks
      // identical to an empty agenda, telling a doctor no one is coming in.
      return fetchAllRows((from, to) =>
        supabase
          .from('appointments')
          .select(
            '*,patient:patients!appointments_patient_owner_fk(id,name,age,date_of_birth,profession,last_visit,status,revision,phone,email)',
          )
          .eq('user_id', userId)
          .gte('start_time', dayStart.toISOString())
          .lte('start_time', dayEnd.toISOString())
          .order('start_time')
          .order('id')
          .range(from, to),
      );
    },
    enabled: !!userId,
  });

  // Stats
  const totalPatients = counts?.total ?? patients.length;
  const newPatients = counts?.new ?? patients.filter((p) => p.status === 'novo').length;
  const pendingReturns = counts?.returns ?? patients.filter((p) => p.status === 'retorno').length;

  const hasConsultation = patients.some((patient) => patient.status !== 'novo');
  // Same rule as OnboardingCard, so the disclosure never opens on an empty card,
  // and nothing claims "no patients" before the directory has loaded.
  const onboardingDismissed = (() => {
    try { return localStorage.getItem(`cortex_onboarding_dismissed_${userId}`) === '1'; } catch { return false; }
  })();
  const showOnboarding = patientsState === 'ready' && !onboardingDismissed && !(totalPatients > 0 && hasConsultation);
  // One banner for the page instead of an error line in every card.
  const loadError = patientsState === 'error' || aptsError;
  const counterValue = (value: number) => (patientsState === 'ready' ? value : patientsState === 'loading' ? '…' : '—');

  // Recent patients (last 5 by lastVisit)
  const recentPatients = [...patients]
    .sort((a, b) => new Date(b.lastVisit ?? 0).getTime() - new Date(a.lastVisit ?? 0).getTime())
    .slice(0, 5);

  // Upcoming returns (patients with status === 'retorno', sorted by lastVisit asc = overdue first)
  const returnPatients = patients
    .filter((p) => p.status === 'retorno')
    .sort((a, b) => new Date(a.lastVisit ?? 0).getTime() - new Date(b.lastVisit ?? 0).getTime())
    .slice(0, 4);

  // Today's appointments needing reminders
  const pendingReminderApts = todayApts.filter((apt) => {
    if (apt.reminder_sent || sentReminderIds.has(apt.id) || !canRemindAppointment(apt.status, apt.start_time))
      return false;
    const patient = apt.patient ? mapPatientRow(apt.patient) : patients.find((p) => p.id === apt.patient_id);
    return !!(patient?.phone || patient?.email);
  });

  const handleSendReminder = async (apt: Appointment) => {
    const patient = apt.patient ? mapPatientRow(apt.patient) : patients.find((p) => p.id === apt.patient_id);
    if (!patient) return;
    const hasPhone = !!patient.phone;
    const type = hasPhone ? 'whatsapp' : 'email';
    setSendingReminder(apt.id);
    try {
      const { data, error } = await supabase.functions.invoke('send-appointment-reminder', {
        body: { appointmentId: apt.id, type, userId },
      });
      if (error) throw error;
      if (type === 'whatsapp') {
        if (typeof data?.waLink !== 'string') throw new Error('Link ausente');
        const link = new URL(data.waLink);
        if (link.protocol !== 'https:' || link.hostname !== 'wa.me') throw new Error('Link inválido');
        setReminderLinks((previous) => ({ ...previous, [apt.id]: link.href }));
        // Keep a real link visible: browser popup blocking and opening WhatsApp
        // do not establish whether the user sent the message.
        window.open(link.href, '_blank', 'noopener,noreferrer');
        toast({
          title: 'Link do WhatsApp pronto',
          description: 'Abra o link para revisar e enviar a mensagem. O lembrete continua pendente.',
        });
      } else {
        if (data?.success !== true) throw new Error('Envio não confirmado');
        setSentReminderIds((prev) => new Set([...prev, apt.id]));
        toast({ title: 'Lembrete enviado por email!' });
      }
      queryClient.invalidateQueries({ queryKey: ['appointments-today'] });
    } catch {
      toast({ title: 'Erro ao enviar lembrete', variant: 'destructive' });
    } finally {
      setSendingReminder(null);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background scrollbar-thin">
      <div className="mx-auto max-w-[90rem] space-y-6 px-4 py-5 md:px-8 md:py-8 xl:px-10">
        {/* Phone: one line (greeting · date) and one full-width primary action; areas and account live in "Mais". */}
        <header className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b pb-4 shell:flex-nowrap shell:items-start shell:gap-4 shell:pb-6">
          <div className="min-w-0 flex-1 shell:space-y-2">
            <p className="hidden text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-primary shell:block">Seu consultório</p>
            <h1 className="text-lg font-semibold tracking-tight shell:text-2xl">{greeting()}<span className="text-sm font-normal text-muted-foreground shell:hidden"> · {shortDayLabel()}</span></h1>
            <p className="hidden text-sm text-muted-foreground shell:block">{todayLabel()}</p>
          </div>
          <div className="order-2 shrink-0 shell:order-3"><SpecialtySettingsSheet /></div>
          <Button onClick={onNewConsultation} className="order-3 h-auto min-h-12 w-full gap-2 px-5 py-3 text-sm font-semibold shell:order-2 shell:w-auto"><Plus className="h-4 w-4 shrink-0" aria-hidden="true" />Iniciar atendimento</Button>
        </header>
        {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="min-w-0 text-sm">Não foi possível carregar seus dados.</p>
          <Button variant="outline" className="min-h-11" onClick={() => { if (patientsState === 'error') onRetryPatients?.(); if (aptsError) void refetchApts(); }}>Tentar novamente</Button>
        </div>}
        {openConsultation && (
          <div role="region" aria-label="Consulta aberta" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="min-w-0 text-sm [overflow-wrap:anywhere]">A consulta de <strong>{openConsultation.name}</strong> continua aberta.</p>
            <Button onClick={openConsultation.onReturn} className="min-h-11 h-auto whitespace-normal">
              Voltar à consulta de {openConsultation.name}
            </Button>
          </div>
        )}
        {onResumeConsultation && <ConsultationRecoveryNotice userId={userId} onResume={onResumeConsultation} />}
        {onResumeConsultation && <LocalRecordingRecoveryNotice userId={userId} onResume={onResumeConsultation} />}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)]">
          <div className="min-w-0 space-y-6">
            {!aptsError && <DailyAgenda appointments={todayApts} patients={patients} loading={aptsLoading} error={aptsError} onRetry={() => void refetchApts()} onOpenAgenda={() => navigate('/agenda')} onSelectPatient={onSelectPatient} />}
            {pendingReminderApts.length > 0 && <section aria-labelledby="home-reminders" className="rounded-2xl border bg-card p-4 md:p-5 space-y-4">
              <div className="space-y-1"><h2 id="home-reminders" className="flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4 text-primary" />Lembretes pendentes<span className="text-xs font-normal text-muted-foreground">({pendingReminderApts.length})</span></h2><p className="text-xs leading-relaxed text-muted-foreground">Prepare o contato de quem ainda precisa de um lembrete.</p></div>
              <div className="divide-y">{pendingReminderApts.map(apt => {
                const patient = apt.patient ? mapPatientRow(apt.patient) : patients.find(row => row.id === apt.patient_id);
                const hasPhone = !!patient?.phone, isSending = sendingReminder === apt.id;
                return <div key={apt.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="text-xs font-semibold tabular-nums">{formatTime(apt.start_time)}</span>
                  <div className="min-w-0 flex-1 basis-40"><p className="text-sm font-medium [overflow-wrap:anywhere]">{patient?.name ?? apt.title}</p><p className="text-xs text-muted-foreground">{typeLabel(apt.type)}</p>{reminderLinks[apt.id] && <a href={reminderLinks[apt.id]} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp para ${patient?.name ?? apt.title}`} className="mt-2 block text-xs text-primary underline">Abrir WhatsApp para revisar e enviar</a>}</div>
                  <Button variant="outline" className="h-auto min-h-11 gap-2 text-xs" disabled={isSending} onClick={() => handleSendReminder(apt)}>{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : hasPhone ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}Lembrar</Button>
                </div>;
              })}</div>
            </section>}
            {showOnboarding && <details className="rounded-xl border bg-card px-4 py-3" open={totalPatients === 0 ? true : undefined}>
              <summary className="cursor-pointer py-1 text-sm font-medium">Primeiros passos no consultório</summary>
              <div className="pt-4"><OnboardingCard onNewConsultation={onNewConsultation} patientCount={totalPatients} hasConsultation={hasConsultation} userId={userId} /></div>
            </details>}
          </div>
          <aside className="min-w-0 space-y-5" aria-label="Continuidade dos pacientes">
            <section className="rounded-2xl border bg-card p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-3 pt-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4 text-primary" />Pacientes recentes</h2><Button variant="ghost" className="h-auto min-h-11 gap-1 px-1 text-xs" onClick={() => navigate('/gerenciar-pacientes')}>Ver todos<ChevronRight className="h-3 w-3" /></Button></div>
              {recentPatients.length ? <div className="space-y-1">{recentPatients.map(patient => <PatientShortcut key={patient.id} patient={patient} dateLabel={lastConsultation(patient.lastVisit)} onSelect={onSelectPatient} />)}</div> : <p className="px-2 py-5 text-sm text-muted-foreground">Os pacientes atendidos aparecerão aqui para facilitar o retorno ao prontuário.</p>}
            </section>
            <section className="rounded-xl border bg-card p-5 space-y-4" aria-label="Seu cadastro de pacientes">
              <h2 className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4 text-primary" />Seu cadastro de pacientes</h2>
              <dl aria-busy={patientsState === 'loading'} className="grid grid-cols-3 gap-3">{([['Pacientes', totalPatients], ['Novos', newPatients], ['Em retorno', pendingReturns]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dd className="text-xl font-semibold tabular-nums [overflow-wrap:anywhere]">{counterValue(value)}</dd><dt className="mt-1 text-[0.625rem] text-muted-foreground">{label}</dt></div>)}</dl>
            </section>
            {returnPatients.length > 0 && <details className="rounded-xl border bg-card px-4 py-3"><summary className="cursor-pointer py-1 text-sm font-medium">Pacientes em retorno<span className="ml-2 text-xs font-normal text-muted-foreground">{pendingReturns}</span></summary><p className="py-2 text-xs text-muted-foreground">Cadastros marcados como retorno; não representam consultas já agendadas.</p>{returnPatients.map(patient => <PatientShortcut key={patient.id} patient={patient} dateLabel={lastConsultation(patient.lastVisit)} onSelect={onSelectPatient} />)}</details>}
          </aside>
        </div>
        <footer className="border-t pb-4 pt-4"><Link to="/privacidade" className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><Shield className="h-3.5 w-3.5" />Privacidade e dados</Link></footer>
      </div>
    </div>
  );
}
