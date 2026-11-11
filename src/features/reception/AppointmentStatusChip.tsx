import { statusLook } from '@/lib/appointmentStatus';
import { cn } from '@/lib/utils';
import { clinicTime } from './dates';
import type { ReceptionAppointment } from './contracts';

const chip = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap';

/**
 * Status in the app-wide words and colours (`statusLook`). Arrival is reception's own state on top of
 * an open appointment, so it reads "Chegou 08:52" in the confirmed colour.
 */
export function StatusChip({ appointment: a }: { appointment: Pick<ReceptionAppointment, 'status' | 'checkedInAt'> }) {
  const open = a.status !== 'cancelado' && a.status !== 'realizado';
  if (open && a.checkedInAt) return <span className={cn(chip, statusLook('confirmado').badge)}>Chegou {clinicTime(a.checkedInAt)}</span>;
  const look = statusLook(a.status);
  return <span className={cn(chip, look.badge)}>{look.label}</span>;
}
