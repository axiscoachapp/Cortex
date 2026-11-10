import { CalendarDays, CalendarX, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { mapPatientRow } from '@/lib/patientMapper';
import type { Patient } from '@/types/patient';

export interface DailyAppointment {
  patient?: Parameters<typeof mapPatientRow>[0] | null;
  id: string; patient_id: string | null; title: string; start_time: string; end_time: string;
  type: string; status: string; notes: string | null; reminder_sent: boolean;
}
const types: Record<string, string> = { novo: 'Primeira consulta', retorno: 'Retorno', seguimento: 'Seguimento', urgencia: 'Urgência' };
const statuses: Record<string, string> = { agendado: 'Agendado', confirmado: 'Confirmado', cancelado: 'Cancelado', realizado: 'Realizado' };
const time = (value: string) => new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function DailyAgenda({ appointments, patients, loading, error, onRetry, onOpenAgenda, onSelectPatient }: {
  appointments: DailyAppointment[]; patients: Patient[]; loading: boolean; error: boolean;
  onRetry: () => void; onOpenAgenda: () => void; onSelectPatient: (patient: Patient, appointmentId: string) => void;
}) {
  return <section aria-labelledby="home-agenda-heading" className="min-w-0 rounded-2xl border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 md:p-5">
      <div className="space-y-1"><h2 id="home-agenda-heading" className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Agenda de hoje</h2><p className="text-xs text-muted-foreground">Abra o paciente a partir do horário agendado.</p></div>
      <Button variant="ghost" className="min-h-11 h-auto gap-1 px-2 text-xs" onClick={onOpenAgenda}>Abrir agenda<ChevronRight className="h-3.5 w-3.5" /></Button>
    </div>
    {loading ? <div role="status" className="space-y-3 p-5"><span className="sr-only">Carregando agenda…</span>{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      : error ? <div role="alert" className="p-6 space-y-3"><p className="text-sm">Não foi possível carregar a agenda.</p><Button variant="outline" className="min-h-11" onClick={onRetry}>Tentar novamente</Button></div>
      : appointments.length === 0 ? <div className="flex flex-col items-start gap-3 p-6 md:p-8"><CalendarX className="h-7 w-7 text-muted-foreground" /><h3 className="font-medium">Seu dia ainda está livre</h3><p className="text-sm text-muted-foreground">Nenhuma consulta agendada para hoje. Sua agenda continua disponível para organizar os próximos atendimentos.</p><Button variant="outline" className="min-h-11" onClick={onOpenAgenda}>Agendar consulta</Button></div>
      : <ol className="divide-y">{appointments.map(appointment => {
        const patient = appointment.patient ? mapPatientRow(appointment.patient) : patients.find(row => row.id === appointment.patient_id);
        return <li key={appointment.id}><button type="button" disabled={!patient} onClick={() => patient && onSelectPatient(patient, appointment.id)}
          className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 p-4 text-left transition-colors hover:bg-primary/5 disabled:cursor-default disabled:opacity-60 md:p-5">
          <span className="space-y-1 tabular-nums"><span className="block text-sm font-semibold">{time(appointment.start_time)}</span><span className="block text-[0.625rem] text-muted-foreground">{time(appointment.end_time)}</span></span>
          <span className="min-w-0 space-y-2"><span className="block text-sm font-medium [overflow-wrap:anywhere]">{patient?.name ?? appointment.title}</span><span className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className={appointment.status === 'confirmado' ? 'bg-success-light text-success' : ''}>{statuses[appointment.status] ?? appointment.status}</Badge><span className="text-xs text-muted-foreground">{types[appointment.type] ?? appointment.type}</span></span>{appointment.notes && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{appointment.notes}</span>}{!patient && <span className="block text-xs text-muted-foreground">Sem paciente vinculado</span>}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button></li>;
      })}</ol>}
  </section>;
}
