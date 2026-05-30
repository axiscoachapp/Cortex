import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays, Plus, ChevronRight, Clock, Users, UserPlus,
  RefreshCw, Stethoscope, CalendarX, Shield, Bell, MessageCircle, Mail, Loader2,
} from 'lucide-react';
import { SpecialtySettingsSheet } from '@/components/SpecialtySettingsSheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Appointment {
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
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  onNewConsultation: () => void;
  userId: string;
}

const typeLabels: Record<string, string> = {
  novo: 'Novo', retorno: 'Retorno', seguimento: 'Seguimento', urgencia: 'Urgência',
};
const statusColor: Record<string, string> = {
  agendado: 'bg-blue-500', confirmado: 'bg-green-500',
  cancelado: 'bg-slate-400', realizado: 'bg-slate-500',
};

function relativeDate(dateString: string): string {
  const days = Math.floor((Date.now() - new Date(dateString).getTime()) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return `há ${Math.floor(days / 7)} sem.`;
  return `há ${Math.floor(days / 30)} meses`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function todayLabel(): string {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function WelcomeDashboard({ patients, onSelectPatient, onNewConsultation, userId }: WelcomeDashboardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const today = new Date().toISOString().split('T')[0];
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [sentReminderIds, setSentReminderIds] = useState<Set<string>>(new Set());

  const { data: todayApts = [], isLoading: aptsLoading } = useQuery<Appointment[]>({
    queryKey: ['appointments-today', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', userId)
        .gte('start_time', `${today}T00:00:00`)
        .lte('start_time', `${today}T23:59:59`)
        .order('start_time');
      return data ?? [];
    },
    enabled: !!userId,
  });

  // Stats
  const totalPatients = patients.length;
  const newPatients = patients.filter(p => p.status === 'novo').length;
  const pendingReturns = patients.filter(p => p.status === 'retorno').length;

  // Recent patients (last 5 by lastVisit)
  const recentPatients = [...patients]
    .sort((a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime())
    .slice(0, 5);

  // Upcoming returns (patients with status === 'retorno', sorted by lastVisit asc = overdue first)
  const returnPatients = patients
    .filter(p => p.status === 'retorno')
    .sort((a, b) => new Date(a.lastVisit).getTime() - new Date(b.lastVisit).getTime())
    .slice(0, 4);

  // Today's appointments needing reminders
  const pendingReminderApts = todayApts.filter(apt => {
    if (apt.reminder_sent || sentReminderIds.has(apt.id) || apt.status === 'cancelado') return false;
    const patient = patients.find(p => p.id === apt.patient_id);
    return !!(patient?.phone || patient?.email);
  });

  const handleSendReminder = async (apt: Appointment) => {
    const patient = patients.find(p => p.id === apt.patient_id);
    if (!patient) return;
    const hasPhone = !!patient.phone;
    const type = hasPhone ? 'whatsapp' : 'email';
    setSendingReminder(apt.id);
    try {
      const { data, error } = await supabase.functions.invoke('send-appointment-reminder', {
        body: { appointmentId: apt.id, type, userId },
      });
      if (error) throw error;
      if (type === 'whatsapp' && data?.waLink) window.open(data.waLink, '_blank');
      setSentReminderIds(prev => new Set([...prev, apt.id]));
      toast({ title: 'Lembrete enviado!', description: type === 'whatsapp' ? 'Link WhatsApp aberto.' : 'Email enviado.' });
    } catch {
      toast({ title: 'Erro ao enviar lembrete', variant: 'destructive' });
    } finally {
      setSendingReminder(null);
    }
  };

  return (
    <div className="h-full w-full bg-card overflow-y-auto scrollbar-thin">
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6 md:space-y-8">

        {/* Greeting */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{greeting()}</h1>
            <p className="text-muted-foreground mt-0.5 capitalize">{todayLabel()}</p>
          </div>
          <SpecialtySettingsSheet />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Users,     value: totalPatients,  label: 'Pacientes',      color: 'text-medical-blue',  bg: 'bg-medical-blue-light' },
            { icon: UserPlus,  value: newPatients,     label: 'Novos',          color: 'text-green-600',     bg: 'bg-green-50' },
            { icon: RefreshCw, value: pendingReturns,  label: 'Retornos',       color: 'text-amber-600',     bg: 'bg-amber-50' },
          ].map(({ icon: Icon, value, label, color, bg }) => (
            <div key={label} className="rounded-xl border border-border/50 bg-white p-3 md:p-4 shadow-[0_1px_4px_hsl(0_0%_0%/0.06)]">
              <div className={cn('w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center mb-2 md:mb-3', bg)}>
                <Icon className={cn('w-3.5 h-3.5 md:w-4 md:h-4', color)} />
              </div>
              <p className="text-xl md:text-2xl font-bold text-foreground leading-none">{value}</p>
              <p className="text-[11px] md:text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Pending reminders */}
        {pendingReminderApts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-medical-blue" />
              Lembretes Pendentes
              <span className="ml-1 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                {pendingReminderApts.length}
              </span>
            </h2>
            <div className="space-y-2">
              {pendingReminderApts.map(apt => {
                const patient = patients.find(p => p.id === apt.patient_id);
                const hasPhone = !!patient?.phone;
                const isSending = sendingReminder === apt.id;
                return (
                  <div
                    key={apt.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-white shadow-[0_1px_4px_hsl(0_0%_0%/0.05)]"
                  >
                    <div className="text-center shrink-0 w-10">
                      <p className="text-xs font-bold text-medical-blue">{formatTime(apt.start_time)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {patient?.name ?? apt.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {typeLabels[apt.type] ?? apt.type}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 shrink-0 text-xs"
                      disabled={isSending}
                      onClick={() => handleSendReminder(apt)}
                    >
                      {isSending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : hasPhone
                        ? <MessageCircle className="w-3.5 h-3.5 text-whatsapp-green" />
                        : <Mail className="w-3.5 h-3.5" />}
                      Lembrar
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Today's agenda */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-medical-blue" />
              Agenda de Hoje
            </h2>
            <button
              onClick={() => navigate('/agenda')}
              className="text-xs text-medical-blue hover:text-medical-blue-dark font-medium flex items-center gap-1"
            >
              Ver tudo <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {aptsLoading ? (
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : todayApts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-6 text-center">
              <CalendarX className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma consulta agendada para hoje</p>
              <button
                onClick={() => navigate('/agenda')}
                className="mt-3 text-xs font-medium text-medical-blue hover:underline"
              >
                Agendar consulta →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {todayApts.map(apt => {
                const patient = patients.find(p => p.id === apt.patient_id);
                return (
                  <button
                    key={apt.id}
                    onClick={() => patient && onSelectPatient(patient)}
                    disabled={!patient}
                    className={cn(
                      'w-full flex items-center gap-4 px-4 py-3 rounded-xl border border-border/50 bg-white',
                      'shadow-[0_1px_4px_hsl(0_0%_0%/0.05)] text-left',
                      'hover:border-medical-blue/30 hover:shadow-md transition-all',
                      !patient && 'opacity-60 cursor-default',
                    )}
                  >
                    <div className="text-center shrink-0 w-12">
                      <p className="text-xs font-bold text-medical-blue">{formatTime(apt.start_time)}</p>
                      <p className="text-[10px] text-muted-foreground">{formatTime(apt.end_time)}</p>
                    </div>
                    <div className={cn('w-1 h-8 rounded-full shrink-0', statusColor[apt.status] ?? 'bg-slate-300')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {patient?.name ?? apt.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {typeLabels[apt.type] ?? apt.type}
                        {apt.notes ? ` · ${apt.notes}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded-full',
                        apt.status === 'confirmado' ? 'bg-green-100 text-green-700' :
                        apt.status === 'cancelado' ? 'bg-slate-100 text-slate-500' :
                        'bg-blue-50 text-blue-600',
                      )}>
                        {apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}
                      </span>
                      {patient && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent patients */}
        {recentPatients.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-medical-blue" />
              Pacientes Recentes
            </h2>
            <div className="space-y-1.5">
              {recentPatients.map(patient => {
                const initials = patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <button
                    key={patient.id}
                    onClick={() => onSelectPatient(patient)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-white',
                      'shadow-[0_1px_4px_hsl(0_0%_0%/0.04)] text-left',
                      'hover:border-medical-blue/30 hover:shadow-md hover:bg-medical-blue-light/30 transition-all group',
                    )}
                  >
                    {patient.photoUrl ? (
                      <img src={patient.photoUrl} alt={patient.name}
                        className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-border/40" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-medical-blue bg-medical-blue-light">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{patient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {patient.age} anos
                        {patient.profession ? ` · ${patient.profession}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground/60">{relativeDate(patient.lastVisit)}</span>
                      <Badge variant={patient.status} className="text-[9px] h-4 px-1.5">
                        {patient.status === 'retorno' ? 'Retorno' :
                         patient.status === 'novo' ? 'Novo' :
                         patient.status === 'seguimento' ? 'Seguimento' : 'Atend.'}
                      </Badge>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-medical-blue transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Upcoming returns */}
        {returnPatients.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
              <Stethoscope className="w-4 h-4 text-amber-500" />
              Retornos Pendentes
              <span className="ml-1 text-[10px] font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                {pendingReturns}
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {returnPatients.map(patient => {
                const initials = patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                const daysSince = Math.floor((Date.now() - new Date(patient.lastVisit).getTime()) / 86400000);
                return (
                  <button
                    key={patient.id}
                    onClick={() => onSelectPatient(patient)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-white text-left',
                      'shadow-[0_1px_4px_hsl(0_0%_0%/0.04)]',
                      'hover:border-amber-300/60 hover:shadow-md hover:bg-amber-50/40 transition-all group',
                      daysSince > 60 ? 'border-amber-200/70' : 'border-border/50',
                    )}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold text-amber-700 bg-amber-100">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate leading-tight">{patient.name}</p>
                      <p className="text-[10px] text-muted-foreground/70">{relativeDate(patient.lastVisit)}</p>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-amber-500 transition-colors shrink-0" />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Quick actions */}
        <div className="flex gap-3 pt-2">
          <Button onClick={onNewConsultation} className="gap-2 shadow-sm" style={{
            background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 40%))',
          }}>
            <Plus className="w-4 h-4" />
            Nova Consulta
          </Button>
          <Button variant="outline" onClick={() => navigate('/agenda')} className="gap-2">
            <CalendarDays className="w-4 h-4" />
            Ver Agenda
          </Button>
        </div>

        <div className="pb-4">
          <Link
            to="/privacidade"
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <Shield className="w-3 h-3" />
            Privacidade & Dados (LGPD)
          </Link>
        </div>

      </div>
    </div>
  );
}
