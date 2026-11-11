import { addDays, format, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatCalendarDay(date: Date): string {
  return format(date, "EEEE, d 'de' MMMM", { locale: ptBR });
}

/** The doctor's agenda weeks start on Monday. */
export const WEEK_STARTS_ON = 1;

const capitalize =(text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The period shown in the agenda toolbar: "Quarta, 11 de novembro",
 * "9–15 de novembro" (weeks start on Monday) or "Novembro de 2026".
 */
export function formatCalendarPeriod(view: 'day' | 'week' | 'month', date: Date): string {
  if (view === 'day') return capitalize(format(date, "EEEE, d 'de' MMMM", { locale: ptBR }).replace('-feira', ''));
  if (view === 'month') return capitalize(format(date, "MMMM 'de' yyyy", { locale: ptBR }));
  const start = startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
  return formatCalendarWeekRange({ start, end: addDays(start, 6) });
}

/** Display the inclusive bounds supplied by the calendar; never shift the range. */
export function formatCalendarWeekRange({ start, end }: { readonly start: Date; readonly end: Date }): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear && start.getMonth() === end.getMonth()) {
    return `${format(start, 'd')}–${format(end, "d 'de' MMMM", { locale: ptBR })}`;
  }
  const pattern = sameYear ? "d 'de' MMM'.'" : "d 'de' MMM'. de' yyyy";
  return `${format(start, pattern, { locale: ptBR })} – ${format(end, pattern, { locale: ptBR })}`;
}
