import { format } from 'date-fns';
import { clinicDay, clinicTime, clinicTimestamp } from '@/features/reception/dates';

// The doctor's agenda grid (react-big-calendar) lays events out with the
// browser's local clock. Appointments are clinic time (America/Sao_Paulo), so
// the grid works on "wall" dates: local Date objects whose fields equal the
// clinic's clock. Convert on the way in and out, never compare a wall date
// with a real instant.

/** A real instant as a local Date showing the clinic's wall clock. */
export function toClinicWall(instant: Date): Date {
  const [year, month, day] = clinicDay(instant.toISOString()).split('-').map(Number);
  const [hour, minute] = clinicTime(instant.toISOString()).split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/** A wall date from the grid back to the real instant (ISO). */
export function fromClinicWall(wall: Date): string {
  return clinicTimestamp(format(wall, 'yyyy-MM-dd'), format(wall, 'HH:mm'));
}

const HALF_HOUR = 30 * 60_000;

/**
 * The next half hour from now (now itself when it is exactly on one). The
 * clinic's offset is a whole number of hours, so rounding the instant rounds
 * the clinic clock too.
 */
export function nextHalfHour(now = new Date()): Date {
  return new Date(Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR);
}

/**
 * Visible hours of the day and week grids: 07:00–21:00, widened to the whole
 * hour around any appointment that starts earlier or ends later. Takes wall
 * dates.
 */
export function gridHours(events: ReadonlyArray<{ start: Date; end: Date }>): { min: Date; max: Date } {
  let first = 7;
  let last = 21;
  const dayOf = (date: Date) => format(date, 'yyyy-MM-dd');
  for (const { start, end } of events) {
    const endsAtMidnight = end.getHours() === 0 && end.getMinutes() === 0;
    const lastMinute = endsAtMidnight ? new Date(end.getTime() - 60_000) : end;
    // Spans more than one clinic day: show the whole day.
    if (dayOf(start) !== dayOf(lastMinute)) return { min: new Date(1970, 0, 1, 0, 0), max: new Date(1970, 0, 1, 23, 59) };
    first = Math.min(first, start.getHours());
    last = Math.max(last, endsAtMidnight ? 24 : end.getHours() + (end.getMinutes() > 0 ? 1 : 0));
  }
  return { min: new Date(1970, 0, 1, first, 0), max: last >= 24 ? new Date(1970, 0, 1, 23, 59) : new Date(1970, 0, 1, last, 0) };
}
