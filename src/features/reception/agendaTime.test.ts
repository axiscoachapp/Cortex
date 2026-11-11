import { describe, expect, it } from 'vitest';
import { addMinutes, bookingSummary, dayEntries, dayHeading, freeSlots, occupiedIntervals } from './agendaTime';
import { clinicTimestamp } from './dates';
import type { ReceptionAppointment, ScheduleBlock } from './contracts';
import type { BusyInterval } from './busyIntervals';

const day = '2099-11-03', doctor = 'd1', other = 'd2';
const at = (time: string) => clinicTimestamp(day, time);
const appointment = (id: string, start: string, end: string, over: Partial<ReceptionAppointment> = {}): ReceptionAppointment => ({
  id, doctorId: doctor, patientId: null, contactId: null, caseId: null, patientName: 'Pessoa ' + id, startTime: at(start), endTime: at(end),
  type: 'retorno', status: 'agendado', revision: 1, checkedInAt: null, googleSyncStatus: 'idle', ...over,
});
const block: ScheduleBlock = { id: 'b1', doctorId: doctor, startTime: at('12:00'), endTime: at('13:00'), reason: 'Almoço', revision: 1 };
const busy: BusyInterval = { doctorId: doctor, startTime: at('10:00'), endTime: at('11:00') };
const past = Date.parse('2000-01-01T00:00:00Z');

describe('agenda time helpers', () => {
  it('offers only starts where the whole duration fits between appointments, blocks and busy periods', () => {
    const items = [appointment('a', '08:00', '08:30'), appointment('x', '09:00', '09:30', { status: 'cancelado' }), appointment('o', '08:30', '09:00', { doctorId: other })];
    const occupied = occupiedIntervals(items, [block], [busy], doctor);
    const thirty = freeSlots(day, occupied, 30, past);
    expect(thirty.slice(0, 4)).toEqual(['08:30', '09:00', '09:30', '11:00']);
    expect(thirty).not.toContain('10:00');
    expect(thirty).not.toContain('12:00');
    expect(thirty.at(-1)).toBe('17:30');
    // An hour does not fit at 09:30 (busy at 10:00) nor at 11:30 (block at 12:00).
    expect(freeSlots(day, occupied, 60, past).slice(0, 3)).toEqual(['08:30', '09:00', '11:00']);
  });

  it('skips times already gone today', () => {
    expect(freeSlots(day, [], 30, Date.parse(at('16:10')))).toEqual(['16:30', '17:00', '17:30']);
  });

  it('lists blocks and busy periods in time order with the appointments, and the free time between them', () => {
    const entries = dayEntries(day, doctor, [appointment('a', '09:00', '09:30'), appointment('b', '14:00', '14:30')], [block], [busy], { withFree: true, now: past });
    expect(entries.map(e => e.kind === 'free' ? `free ${e.from}-${e.to}` : e.kind)).toEqual([
      'free 08:00-09:00', 'appointment', 'free 09:30-10:00', 'busy', 'free 11:00-12:00', 'block', 'free 13:00-14:00', 'appointment', 'free 14:30-18:00',
    ]);
    expect(dayEntries(day, other, [], [block], [busy])).toEqual([]);
  });

  it('keeps an overnight block on the next day when it ends a microsecond after midnight', () => {
    const late = { ...block, startTime: clinicTimestamp('2099-11-02', '23:00'), endTime: at('00:00').replace('.000Z', '.000001Z') };
    expect(dayEntries(day, doctor, [], [late], [])).toHaveLength(1);
    expect(dayEntries(day, doctor, [], [{ ...late, endTime: at('00:00') }], [])).toHaveLength(0);
  });

  it('names the day with its weekday and "Hoje"', () => {
    expect(dayHeading(day, day)).toBe('Hoje · terça-feira, 3 de novembro');
    expect(dayHeading('2099-11-04', day)).toBe('Amanhã · quarta-feira, 4 de novembro');
    expect(dayHeading('2099-11-06', day)).toBe('Sexta-feira, 6 de novembro');
  });

  it('puts the booking summary on the button', () => {
    expect(bookingSummary(day, '09:30', 'Dra. Ana')).toBe('Agendar ter 03/11 às 09:30 · Dra. Ana');
    expect(addMinutes('23:45', 30)).toBeNull();
    expect(addMinutes('09:30', 60)).toBe('10:30');
  });
});
