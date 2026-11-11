import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clinicTime } from './dates';
import { dayEntries, typeLabels } from './agendaTime';
import { appointmentTiming } from './appointmentTiming';
import type { ReceptionAppointment, ScheduleBlock } from './contracts';
import type { BusyInterval } from './busyIntervals';

export const BUSY_LABEL = 'Ocupado · agenda do médico';
const span = (start: string, end: string) => `${clinicTime(start)}–${clinicTime(end)}`;

/**
 * One doctor's day in a single chronological list: appointments, blocks, the
 * doctor's own busy periods (anonymous) and, when asked, the free time between them.
 */
export function DayAgenda({ day, doctor, items, blocks, busy, withFree = false, renderAppointment, onBook, renderBlockAction, emptyText = 'Nenhum agendamento.' }: {
  day: string; doctor: string; items: ReceptionAppointment[]; blocks: ScheduleBlock[]; busy: BusyInterval[];
  withFree?: boolean;
  renderAppointment?: (appointment: ReceptionAppointment) => ReactNode;
  onBook?: (start: string) => void;
  renderBlockAction?: (block: ScheduleBlock) => ReactNode;
  emptyText?: string;
}) {
  const entries = dayEntries(day, doctor, items, blocks, busy, { withFree });
  if (!entries.length) return <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="space-y-1.5">
      {entries.map(entry => {
        if (entry.kind === 'appointment') return <li key={entry.appointment.id}>
          {renderAppointment ? renderAppointment(entry.appointment) : <CompactAppointment appointment={entry.appointment} />}
        </li>;
        if (entry.kind === 'block') return <li key={'b' + entry.block.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed bg-muted px-3 py-2 text-sm">
          <span className="font-semibold tabular-nums">{span(entry.block.startTime, entry.block.endTime)}</span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Bloqueado · {entry.block.reason}</span>
          {renderBlockAction?.(entry.block)}
        </li>;
        if (entry.kind === 'busy') return <li key={'o' + entry.interval.startTime} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{span(entry.interval.startTime, entry.interval.endTime)}</span>
          <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden />{BUSY_LABEL}</span>
        </li>;
        return <li key={'f' + entry.start} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-emerald-600/30 px-3 py-1.5 text-sm">
          <span className="tabular-nums text-emerald-800 dark:text-emerald-300">{entry.from}–{entry.to}</span>
          <span className="flex-1 text-xs text-muted-foreground">Livre</span>
          {onBook && <Button type="button" size="sm" variant="ghost" className="min-h-9" onClick={() => onBook(entry.from)}
            aria-label={`Agendar às ${entry.from}`}>Agendar neste horário</Button>}
        </li>;
      })}
    </ul>
  );
}

function CompactAppointment({ appointment: a }: { appointment: ReceptionAppointment }) {
  return <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm ${a.status === 'cancelado' ? 'line-through opacity-60' : ''}`}>
    <span className="font-semibold tabular-nums">{appointmentTiming(a).label}</span>
    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{a.patientName}</span>
    <span className="text-xs text-muted-foreground">{a.status === 'cancelado' ? 'Cancelado' : typeLabels[a.type]}</span>
  </div>;
}
