import { useId } from 'react';
import { addWeeks, format, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import type { Appointment } from '@/types/patient';

const weekdays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
export function CompactWeekHeader({ date }: { date: Date }) {
  return <span className="flex flex-col items-center leading-tight tracking-normal">
    <span aria-hidden="true" className="text-[0.625rem]">{weekdays[date.getDay()]}</span><span aria-hidden="true" className="text-xs">{format(date, 'dd')}</span>
    <span className="sr-only">{format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
  </span>;
}

/** Read-only companion to the seven-column grid; opens the existing editor only on human selection. */
export function CalendarWeekDetails({ date, appointments, onSelect }: { date: Date; appointments: Appointment[]; onSelect: (appointment: Appointment) => void }) {
  const heading = useId(), start = startOfWeek(date, { locale: ptBR }), end = addWeeks(start, 1);
  const rows = appointments.filter(appointment => appointment.startTime < end && appointment.endTime > start)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime() || a.id.localeCompare(b.id));
  const groups = new Map<string, { date: Date; rows: Appointment[] }>();
  for (const appointment of rows) {
    const visibleDay = appointment.startTime < start ? start : appointment.startTime;
    const key = format(visibleDay, 'yyyy-MM-dd'), group = groups.get(key) ?? { date: visibleDay, rows: [] };
    group.rows.push(appointment); groups.set(key, group);
  }
  return <section id="calendar-week-details" tabIndex={-1} aria-labelledby={heading} className="mt-4 scroll-mt-24 space-y-3 rounded-xl border bg-background p-4">
    <h2 id={heading} className="font-semibold">Consultas da semana</h2>
    <p className="text-sm text-muted-foreground">Horários e títulos completos. Selecione uma consulta para conferir os detalhes.</p>
    {!rows.length && <p className="text-sm">Nenhuma consulta nesta semana.</p>}
    {[...groups.entries()].map(([key, group]) => <div key={key} className="space-y-2">
      <h3 className="text-sm font-semibold">{format(group.date, 'EEEE, dd/MM', { locale: ptBR })}</h3>
      <ul className="space-y-2">{group.rows.map(appointment => <li key={appointment.id}>
        <Button type="button" variant="outline" className="h-auto min-h-11 w-full flex-col items-start gap-1 whitespace-normal p-3 text-left" onClick={() => onSelect(appointment)}>
          <span className="max-w-full break-words text-xs tabular-nums">{format(appointment.startTime, 'dd/MM HH:mm')} – {format(appointment.endTime, 'dd/MM HH:mm')}</span>
          <span className="max-w-full [overflow-wrap:anywhere]">{appointment.title}</span>
          {appointment.status === 'cancelado' && <span className="text-xs text-muted-foreground">Cancelado</span>}
        </Button>
      </li>)}</ul>
    </div>)}
  </section>;
}
