import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** Display the inclusive bounds supplied by the calendar; never shift the range. */
export function formatCalendarWeekRange({ start, end }: { readonly start: Date; readonly end: Date }): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear && start.getMonth() === end.getMonth()) {
    return `${format(start, 'd')}–${format(end, "d 'de' MMMM", { locale: ptBR })}`;
  }
  const pattern = sameYear ? "d 'de' MMM'.'" : "d 'de' MMM'. de' yyyy";
  return `${format(start, pattern, { locale: ptBR })} – ${format(end, pattern, { locale: ptBR })}`;
}
