// One vocabulary and one look for appointment status and type, shared by the
// home list, the sidebar, the doctor's agenda and the reception agenda.
// Add a status or change a label here, never in a screen.

export type AppointmentStatus = 'agendado' | 'confirmado' | 'realizado' | 'cancelado';
export type AppointmentType = 'novo' | 'retorno' | 'seguimento' | 'urgencia';

type StatusLook = {
  label: string;
  /** Pill: `<span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', badge)}>`. */
  badge: string;
  /** Small marker beside a row. */
  dot: string;
  /** Solid colour for calendar grid events (white text passes AA on all four). */
  color: string;
};

export const appointmentStatus: Record<AppointmentStatus, StatusLook> = {
  agendado: { label: 'Agendado', badge: 'border-primary/30 bg-primary/10 text-primary', dot: 'bg-primary', color: '#8B3C58' },
  confirmado: { label: 'Confirmado', badge: 'border-emerald-700/30 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600', color: '#176C56' },
  realizado: { label: 'Realizado', badge: 'border-slate-300 bg-slate-100 text-slate-700', dot: 'bg-slate-500', color: '#475569' },
  // Cancelled is the only one drawn as an outline with the text struck through,
  // so it cannot be confused with "Realizado" by colour alone.
  cancelado: { label: 'Cancelado', badge: 'border-dashed border-slate-400 bg-transparent text-slate-600 line-through', dot: 'border border-slate-400 bg-transparent', color: '#64748B' },
};

export const appointmentTypeLabel: Record<AppointmentType, string> = {
  novo: 'Primeira consulta',
  retorno: 'Retorno',
  seguimento: 'Seguimento',
  urgencia: 'Encaixe',
};

const isStatus = (value: string): value is AppointmentStatus => value in appointmentStatus;

/** Unknown values fall back to "Agendado" so a new server status never breaks a list. */
export function statusLook(status: string | null | undefined): StatusLook {
  return appointmentStatus[status && isStatus(status) ? status : 'agendado'];
}

export function typeLabel(type: string | null | undefined): string {
  return type && type in appointmentTypeLabel ? appointmentTypeLabel[type as AppointmentType] : 'Consulta';
}
