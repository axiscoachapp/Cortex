import { clinicDay, clinicTime, clinicTimestamp, nextClinicDay } from './dates';
import { appointmentTiming } from './appointmentTiming';
import type { ReceptionAppointment, ScheduleBlock } from './contracts';
import type { BusyInterval } from './busyIntervals';

// No per-clinic durations exist yet; these are the front-desk defaults.
export const typeMinutes: Record<ReceptionAppointment['type'], number> = { novo: 60, retorno: 30, seguimento: 30, urgencia: 30 };
export const typeLabels: Record<ReceptionAppointment['type'], string> = {
  novo: 'Primeira consulta', retorno: 'Retorno', seguimento: 'Seguimento', urgencia: 'Encaixe',
};
// Hours offered as free time and slot chips; anything booked outside still shows.
export const WORK_START = '08:00';
export const WORK_END = '18:00';
export const SLOT_STEP = 30;

const toMinutes = (time: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? +match[1] * 60 + +match[2] : NaN;
};
const fromMinutes = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** The wall time `minutes` after `time`, or null when it would leave the day. */
export function addMinutes(time: string, minutes: number): string | null {
  const total = toMinutes(time) + minutes;
  return Number.isFinite(total) && total >= 0 && total < 24 * 60 ? fromMinutes(total) : null;
}
export function minutesBetween(start: string, end: string): number {
  return toMinutes(end) - toMinutes(start);
}

export interface Occupied { start: number; end: number }
const ms = (iso: string) => Date.parse(iso);

/** Everything that occupies the doctor's time on the booking conflict rule. */
export function occupiedIntervals(
  items: ReceptionAppointment[], blocks: ScheduleBlock[], busy: BusyInterval[], doctor: string, ignore?: string,
): Occupied[] {
  return [
    ...items.filter(a => a.doctorId === doctor && a.status !== 'cancelado' && a.id !== ignore && appointmentTiming(a).valid),
    ...blocks.filter(b => b.doctorId === doctor),
    ...busy.filter(b => b.doctorId === doctor),
  ].map(x => ({ start: ms(x.startTime), end: ms(x.endTime) })).filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start);
}
const overlaps = (list: Occupied[], start: number, end: number) => list.some(x => x.start < end && x.end > start);

/** Start times (clinic wall time) where `duration` minutes fit inside working hours. */
export function freeSlots(day: string, occupied: Occupied[], duration: number, now = Date.now()): string[] {
  const slots: string[] = [];
  for (let at = toMinutes(WORK_START); at + duration <= toMinutes(WORK_END); at += SLOT_STEP) {
    const start = fromMinutes(at), end = fromMinutes(at + duration);
    let startMs: number, endMs: number;
    try { startMs = ms(clinicTimestamp(day, start)); endMs = ms(clinicTimestamp(day, end)); } catch { continue; }
    if (startMs < now || overlaps(occupied, startMs, endMs)) continue;
    slots.push(start);
  }
  return slots;
}

export type AgendaEntry =
  | { kind: 'appointment'; start: number; appointment: ReceptionAppointment }
  | { kind: 'block'; start: number; end: number; block: ScheduleBlock }
  | { kind: 'busy'; start: number; end: number; interval: BusyInterval }
  | { kind: 'free'; start: number; end: number; from: string; to: string };

/**
 * One doctor's day in time order: appointments, blocks and busy periods, with
 * the free stretches of working hours between them when `withFree` is set.
 */
export function dayEntries(
  day: string, doctor: string, items: ReceptionAppointment[], blocks: ScheduleBlock[], busy: BusyInterval[],
  { withFree = false, minimum = SLOT_STEP, now = Date.now() } = {},
): AgendaEntry[] {
  const dayStart = clinicTimestamp(day, '00:00'), dayEnd = clinicTimestamp(nextClinicDay(day), '00:00');
  // Positive overlap with this day at the server's microsecond precision; the end is exclusive.
  const within = (x: { startTime: string; endTime: string }) =>
    appointmentTiming({ startTime: x.startTime, endTime: dayEnd }).valid && appointmentTiming({ startTime: dayStart, endTime: x.endTime }).valid;
  const entries: AgendaEntry[] = [
    ...items.filter(a => a.doctorId === doctor && appointmentTiming(a).day === day)
      .map(appointment => ({ kind: 'appointment' as const, start: ms(appointment.startTime), appointment })),
    ...blocks.filter(b => b.doctorId === doctor && within(b))
      .map(block => ({ kind: 'block' as const, start: ms(block.startTime), end: ms(block.endTime), block })),
    ...busy.filter(b => b.doctorId === doctor && within(b))
      .map(interval => ({ kind: 'busy' as const, start: ms(interval.startTime), end: ms(interval.endTime), interval })),
  ];
  if (withFree) {
    const occupied = occupiedIntervals(items, blocks, busy, doctor).sort((a, b) => a.start - b.start);
    let cursor = Math.max(ms(clinicTimestamp(day, WORK_START)), now);
    const close = ms(clinicTimestamp(day, WORK_END));
    // Free time starts on a whole slot, so the offered start is a time people say.
    const step = SLOT_STEP * 60_000, open = ms(clinicTimestamp(day, WORK_START));
    cursor = open + Math.ceil((cursor - open) / step) * step;
    for (const busySpan of [...occupied, { start: close, end: close }]) {
      const end = Math.min(busySpan.start, close);
      if (end - cursor >= minimum * 60_000) {
        entries.push({ kind: 'free', start: cursor, end, from: clinicTime(new Date(cursor).toISOString()), to: clinicTime(new Date(end).toISOString()) });
      }
      cursor = Math.max(cursor, busySpan.end);
      if (cursor >= close) break;
    }
  }
  const order = { busy: 0, block: 0, appointment: 1, free: 2 };
  return entries.sort((a, b) => a.start - b.start || order[a.kind] - order[b.kind]);
}

const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long' });

/** "Hoje · terça-feira, 10 de novembro" */
export function dayHeading(day: string, today = clinicDay(new Date().toISOString())): string {
  const date = new Date(day + 'T12:00:00Z');
  const label = `${weekday.format(date)}, ${dayMonth.format(date)}`;
  if (day === today) return `Hoje · ${label}`;
  if (day === nextClinicDay(today)) return `Amanhã · ${label}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "Agendar ter 10/11 às 09:30 · Dra. Ana" */
export function bookingSummary(day: string, start: string, doctorName?: string): string {
  const date = new Date(day + 'T12:00:00Z');
  const short = weekdayShort.format(date).replace('.', '');
  const [, month, dd] = day.split('-');
  return `Agendar ${short} ${dd}/${month} às ${start}${doctorName ? ' · ' + doctorName : ''}`;
}
