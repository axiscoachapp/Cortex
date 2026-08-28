import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Brain, CalendarDays, Sparkles, FileStack, BookOpen, Users, ChevronRight, CalendarX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Appointment {
  id: string;
  patient_id: string | null;
  title: string;
  start_time: string;
  type: string;
  status: string;
}

interface PatientSidebarProps {
  patients: Patient[];
  selectedPatient: Patient | null;
  onSelectPatient: (patient: Patient) => void;
  onNewConsultation?: () => void;
  userId: string;
}

const typeLabels: Record<string, string> = {
  novo: 'Novo', retorno: 'Retorno', seguimento: 'Seguimento', urgencia: 'Urgência',
};
const statusDot: Record<string, string> = {
  agendado: 'bg-blue-500', confirmado: 'bg-green-500',
  cancelado: 'bg-slate-300', realizado: 'bg-slate-400',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const NAV_ITEMS = [
  { to: '/assistente',           icon: Sparkles,    label: 'Assistente' },
  { to: '/modelos',              icon: FileStack,   label: 'Modelos' },
  { to: '/conhecimento',         icon: BookOpen,    label: 'Conhecimento' },
  { to: '/gerenciar-pacientes',  icon: Users,       label: 'Pacientes' },
  { to: '/agenda',               icon: CalendarDays,label: 'Agenda' },
];

export function PatientSidebar({ patients, selectedPatient, onSelectPatient, onNewConsultation, userId }: PatientSidebarProps) {
  const navigate = useNavigate();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);

  const { data: todayApts = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ['appointments-today', userId, dayStart.toDateString()],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase
        .from('appointments')
        .select('id, patient_id, title, start_time, type, status')
        .eq('user_id', userId)
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString())
        .order('start_time');
      return data ?? [];
    },
    enabled: !!userId,
  });

  return (
    <aside className="w-full h-full flex flex-col bg-[hsl(215_40%_98%)] border-r border-border/60">

      {/* Logo + Nova Consulta */}
      <div className="px-4 pt-5 pb-4">
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 mb-5 w-full text-left">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%) 0%, hsl(220 70% 40%) 100%)' }}>
            <Brain className="text-white" style={{ width: '18px', height: '18px' }} />
          </div>
          <span className="font-bold text-foreground tracking-tight">Cortex</span>
        </button>

        <Button
          variant="default"
          className="w-full h-9 gap-2 text-sm font-medium shadow-sm"
          style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%) 0%, hsl(220 70% 40%) 100%)' }}
          onClick={onNewConsultation}
        >
          <Plus className="w-4 h-4" />
          Nova Consulta
        </Button>
      </div>

      {/* Today's agenda */}
      <div className="px-4 pb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
          Agenda de hoje
        </span>
        {todayApts.length > 0 && (
          <span className="text-[10px] font-medium text-medical-blue bg-medical-blue-light rounded-full px-1.5 py-0.5">
            {todayApts.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        {isLoading ? (
          <div className="space-y-1.5 px-1 pt-1">
            {[0, 1, 2].map(i => <div key={i} className="h-12 rounded-xl bg-white/60 animate-pulse" />)}
          </div>
        ) : todayApts.length === 0 ? (
          <div className="py-8 px-3 text-center">
            <CalendarX className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/70">Nenhuma consulta hoje</p>
            <button onClick={() => navigate('/agenda')} className="mt-2 text-[11px] font-medium text-medical-blue hover:underline">
              Agendar consulta
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {todayApts.map(apt => {
              const patient = patients.find(p => p.id === apt.patient_id);
              const isSelected = !!patient && selectedPatient?.id === patient.id;
              const label = patient?.name ?? apt.title;
              const initials = label.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <button
                  key={apt.id}
                  onClick={() => patient && onSelectPatient(patient)}
                  disabled={!patient}
                  title={!patient ? 'Consulta sem paciente vinculado' : undefined}
                  className={cn(
                    'w-full px-2.5 py-2 rounded-xl text-left transition-all duration-150',
                    'hover:bg-white/80 hover:shadow-sm',
                    isSelected ? 'bg-white shadow-sm border border-medical-blue/20 ring-1 ring-medical-blue/10' : 'bg-transparent',
                    !patient && 'opacity-60 cursor-default hover:bg-transparent hover:shadow-none',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="text-center shrink-0 w-9">
                      <p className={cn('text-[11px] font-bold', isSelected ? 'text-medical-blue' : 'text-foreground/80')}>
                        {formatTime(apt.start_time)}
                      </p>
                    </div>
                    <div className={cn('w-1 h-8 rounded-full shrink-0', statusDot[apt.status] ?? 'bg-slate-300')} />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium truncate leading-tight', isSelected ? 'text-medical-blue' : 'text-foreground')}>
                        {label}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">
                        {typeLabels[apt.type] ?? apt.type}
                      </p>
                    </div>
                    {patient && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Navigation rail */}
      <nav className="px-2 py-2 border-t border-border/50 bg-white/60 space-y-0.5">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className={cn(
              'w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-xs font-medium',
              'text-muted-foreground hover:text-foreground hover:bg-white transition-all',
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
