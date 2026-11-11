import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ChevronRight, CalendarX, ClipboardCheck } from 'lucide-react';
import { useClinicAccess } from '@/features/reception/accessContext';
import { IntakeAnswersDialog } from '@/features/intake/IntakePage';
import { intakeCall, type IntakeListItem } from '@/features/intake/intakeApi';
import { Button } from '@/components/ui/button';
import { Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { fetchAllRows } from '@/lib/pagination';
import { mapPatientRow } from '@/lib/patientMapper';
import { statusLook, typeLabel } from '@/lib/appointmentStatus';

interface Appointment {
  patient?:Parameters<typeof mapPatientRow>[0] | null;
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
  onSelectPatient: (patient: Patient, appointmentId?:string) => void;
  onNewConsultation?: () => void;
  userId: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Today's agenda inside the app sidebar while a consultation is on screen, to move
 * between today's patients. Not a navigation of its own; on the dashboard it is
 * hidden because the dashboard already shows the day.
 */
export function PatientSidebar({ patients, selectedPatient, onSelectPatient, onNewConsultation, userId }: PatientSidebarProps) {
  const clinicAccess=useClinicAccess();
  const navigate = useNavigate();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);

  // Pre-consultations answered for today's clinic appointments (only for clinic members).
  const [intakeFor, setIntakeFor] = useState<string | null>(null);
  const { data: intakeToday } = useQuery({
    queryKey: ['intake-list-today', clinicAccess?.clinic?.id ?? 'none', clinicAccess?.actorId ?? 'none', dayStart.toDateString()],
    queryFn: () => intakeCall<{ items: IntakeListItem[] }>('list', { from: dayStart.toISOString(), to: new Date(dayStart.getTime() + 86_400_000).toISOString() }),
    enabled: !!clinicAccess?.clinic && clinicAccess.kind === 'clinical',
    staleTime: 60_000, retry: false,
  });
  const answered = new Set((intakeToday?.items ?? []).filter((i) => i.state === 'answered').map((i) => i.appointmentId));

  const { data: todayApts = [], isLoading, isError, refetch } = useQuery<Appointment[]>({
    queryKey: ['appointments-today', userId, dayStart.toDateString()],
    queryFn: async () => {
      if (!userId) return [];
      return fetchAllRows((from, to) => supabase
        .from('appointments')
        .select('*,patient:patients!appointments_patient_owner_fk(id,name,age,date_of_birth,profession,last_visit,status,revision,phone,email)')
        .eq('user_id', userId)
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString())
        .order('start_time').order('id').range(from, to));
    },
    enabled: !!userId,
  });

  return (
    <section aria-labelledby="sidebar-today" className="!my-3 space-y-2 border-y py-3">
      {onNewConsultation && <Button variant="default" className="w-full min-h-11 h-auto py-2 gap-2 text-xs font-medium whitespace-normal" onClick={onNewConsultation}>
        <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />Iniciar atendimento
      </Button>}
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 id="sidebar-today" className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">Agenda de hoje</h2>
        {todayApts.length > 0 && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">{todayApts.length}</span>}
      </div>
      {isLoading ? (
        <div role="status" className="space-y-1.5"><span className="sr-only">Carregando agenda…</span>{[0, 1, 2].map(i => <div key={i} className="h-12 rounded-xl bg-card/60 animate-pulse" />)}</div>
      ) : isError ? (
        <div role="alert" className="space-y-2 px-1 py-3">
          <p className="text-xs">Não foi possível carregar a agenda.</p>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : todayApts.length === 0 ? (
        <div className="px-1 py-4 text-center">
          <CalendarX className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">Nenhuma consulta hoje</p>
          <button type="button" onClick={() => navigate('/agenda')} className="mt-1 min-h-11 text-xs font-medium text-primary hover:underline">Novo agendamento</button>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {todayApts.map(apt => {
            const patient = (apt.patient ? mapPatientRow(apt.patient) : patients.find(p => p.id === apt.patient_id));
            const isSelected = !!patient && selectedPatient?.id === patient.id;
            const label = patient?.name ?? apt.title;
            const look = statusLook(apt.status);
            return (
              <li key={apt.id} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => patient && onSelectPatient(patient,apt.id)}
                  disabled={!patient}
                  aria-current={isSelected ? 'true' : undefined}
                  title={!patient ? 'Consulta sem paciente vinculado' : undefined}
                  className={cn(
                    'min-h-11 w-full min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-card',
                    isSelected && 'bg-card shadow-sm ring-1 ring-primary/20',
                    !patient && 'cursor-default opacity-60 hover:bg-transparent',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('w-9 shrink-0 text-center text-[0.6875rem] font-bold tabular-nums', isSelected ? 'text-primary' : 'text-foreground/80')}>{formatTime(apt.start_time)}</span>
                    <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', look.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-xs font-medium leading-tight', isSelected ? 'text-primary' : 'text-foreground')}>{label}</span>
                      <span className={cn('mt-0.5 block text-[0.625rem] leading-tight text-muted-foreground', apt.status === 'cancelado' && 'line-through')}>{typeLabel(apt.type)} · {look.label}</span>
                    </span>
                    {patient && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  </span>
                </button>
                {answered.has(apt.id) && (
                  <button type="button" onClick={() => setIntakeFor(apt.id)} aria-label={`Ver a pré-consulta de ${label}`} title="Pré-consulta respondida"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ClipboardCheck className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <IntakeAnswersDialog appointmentId={intakeFor} open={!!intakeFor} onOpenChange={(o) => !o && setIntakeFor(null)} />
    </section>
  );
}
