import { clinicDay, clinicTime } from './dates';
import type { ReceptionAppointment } from './contracts';

function instant(value: string): bigint | null {
  // Administrative API timestamps have an explicit offset. Never interpret
  // ambiguous/local dates, JS-normalized impossible dates or PostgreSQL infinity.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || +value.slice(11, 13) > 23) return null;
  const time = Date.parse(value), civil = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(time) || !Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return BigInt(time) * 1000n + BigInt((fraction + '000000').slice(3, 6));
}
export function appointmentTiming(appointment: Pick<ReceptionAppointment, 'startTime' | 'endTime'>) {
  const start = instant(appointment.startTime), end = instant(appointment.endTime);
  return {
    valid: start !== null && end !== null && end > start,
    day: start !== null ? clinicDay(appointment.startTime) : null,
    label: `${start !== null ? clinicTime(appointment.startTime) : 'Início indisponível'}–${end !== null ? clinicTime(appointment.endTime) : 'Término indisponível'}`,
  };
}
