import { CalendarDays, CalendarX, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mapPatientRow } from '@/lib/patientMapper';
import { statusLook, typeLabel } from '@/lib/appointmentStatus';
import { clinicTime } from '@/features/reception/dates';
import { cn } from '@/lib/utils';
import type { Patient } from '@/types/patient';

export interface DailyAppointment {
  patient?: Parameters<typeof mapPatientRow>[0] | null;
  id: string; patient_id: string | null; title: string; start_time: string; end_time: string;
  type: string; status: string; notes: string | null; reminder_sent: boolean;
}

// Loading, error and empty states keep about the height of three rows, so the
// home page does not jump when the agenda arrives.
const BODY = 'min-h-[15rem]';
const ROW = 'grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 p-4 text-left md:p-5';

export function DailyAgenda({ appointments, patients, loading, error, onRetry, onOpenAgenda, onSelectPatient }: {
  appointments: DailyAppointment[]; patients: Patient[]; loading: boolean; error: boolean;
  onRetry: () => void; onOpenAgenda: () => void; onSelectPatient: (patient: Patient, appointmentId: string) => void;
}) {
  return <section aria-labelledby="home-agenda-heading" className="min-w-0 rounded-2xl border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 md:p-5">
      <div className="space-y-1"><h2 id="home-agenda-heading" className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Agenda de hoje</h2><p className="text-xs text-muted-foreground">Abra o paciente a partir do horário agendado.</p></div>
      <Button variant="ghost" className="min-h-11 h-auto gap-1 px-2 text-xs" onClick={onOpenAgenda}>Abrir agenda<ChevronRight className="h-3.5 w-3.5" /></Button>
    </div>
    {loading ? <div role="status" data-testid="daily-agenda-loading" className={BODY}><span className="sr-only">Carregando agenda…</span>
        <ol aria-hidden="true" className="divide-y">{[1, 2, 3].map(i => <li key={i} className={ROW}>
          <span className="space-y-1"><span className="block h-4 w-11 animate-pulse rounded bg-muted" /><span className="block h-3 w-9 animate-pulse rounded bg-muted/70" /></span>
          <span className="space-y-2"><span className="block h-4 w-2/3 animate-pulse rounded bg-muted" /><span className="block h-5 w-1/3 animate-pulse rounded-full bg-muted/70" /></span>
          <span className="h-4 w-4" />
        </li>)}</ol>
      </div>
      : error ? <div role="alert" className={cn(BODY, 'flex flex-col items-start justify-center gap-3 p-6 md:p-8')}><p className="text-sm">Não foi possível carregar a agenda de hoje.</p><Button variant="outline" className="min-h-11" onClick={onRetry}>Tentar novamente</Button></div>
      : appointments.length === 0 ? <div className={cn(BODY, 'flex flex-col items-start gap-3 p-6 md:p-8')}><CalendarX className="h-7 w-7 text-muted-foreground" /><h3 className="font-medium">Seu dia ainda está livre</h3><p className="text-sm text-muted-foreground">Nenhuma consulta agendada para hoje. Sua agenda continua disponível para organizar os próximos atendimentos.</p><Button variant="outline" className="min-h-11" onClick={onOpenAgenda}>Agendar consulta</Button></div>
      : <ol className="divide-y">{appointments.map(appointment => {
        const patient = appointment.patient ? mapPatientRow(appointment.patient) : patients.find(row => row.id === appointment.patient_id);
        const look = statusLook(appointment.status);
        return <li key={appointment.id}><button type="button" disabled={!patient} onClick={() => patient && onSelectPatient(patient, appointment.id)}
          className={cn(ROW, 'transition-colors hover:bg-primary/5 disabled:cursor-default disabled:opacity-60')}>
          <span className="space-y-1 tabular-nums"><span className="block text-sm font-semibold">{clinicTime(appointment.start_time)}</span><span className="block text-[0.625rem] text-muted-foreground">{clinicTime(appointment.end_time)}</span></span>
          <span className="min-w-0 space-y-2"><span className={cn('block text-sm font-medium [overflow-wrap:anywhere]', appointment.status === 'cancelado' && 'line-through text-muted-foreground')}>{patient?.name ?? appointment.title}</span><span className="flex flex-wrap items-center gap-2"><span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', look.badge)}>{look.label}</span><span className="text-xs text-muted-foreground">{typeLabel(appointment.type)}</span></span>{appointment.notes && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{appointment.notes}</span>}{!patient && <span className="block text-xs text-muted-foreground">Sem paciente vinculado</span>}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button></li>;
      })}</ol>}
  </section>;
}
