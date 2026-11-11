import { describe, expect, it } from 'vitest';
import { fromClinicWall, gridHours, nextHalfHour, toClinicWall } from './clinicWallTime';

const wall = (h: number, m = 0, d = 11) => new Date(2026, 10, d, h, m);

describe('clinic wall clock for the agenda grid', () => {
  it('shows a real instant at its São Paulo time whatever the browser zone', () => {
    const shown = toClinicWall(new Date('2026-11-11T12:30:00Z'));
    expect([shown.getFullYear(), shown.getMonth(), shown.getDate(), shown.getHours(), shown.getMinutes()]).toEqual([2026, 10, 11, 9, 30]);
  });

  it('converts a grid slot back to the same instant', () => {
    expect(fromClinicWall(wall(9, 30))).toBe('2026-11-11T12:30:00.000Z');
    expect(fromClinicWall(toClinicWall(new Date('2026-11-12T02:15:00Z')))).toBe('2026-11-12T02:15:00.000Z');
  });

  it.each([
    ['2026-11-11T08:21:00Z', '2026-11-11T08:30:00.000Z'],
    ['2026-11-11T08:30:00Z', '2026-11-11T08:30:00.000Z'],
    ['2026-11-11T08:45:10Z', '2026-11-11T09:00:00.000Z'],
  ])('rounds %s up to the next half hour', (now, expected) => {
    expect(nextHalfHour(new Date(now)).toISOString()).toBe(expected);
  });
});

describe('visible hours of the grid', () => {
  const hours = (events: Array<{ start: Date; end: Date }>) => {
    const { min, max } = gridHours(events);
    return [`${min.getHours()}:${min.getMinutes()}`, `${max.getHours()}:${max.getMinutes()}`];
  };
  it('defaults to 07:00–21:00', () => expect(hours([])).toEqual(['7:0', '21:0']));
  it('keeps the default for appointments inside it', () => expect(hours([{ start: wall(7), end: wall(21) }])).toEqual(['7:0', '21:0']));
  it('widens to the whole hour around an early or late appointment', () => {
    expect(hours([{ start: wall(6, 30), end: wall(7) }, { start: wall(21), end: wall(21, 15) }])).toEqual(['6:0', '22:0']);
  });
  it('reaches the end of the day for an appointment ending at midnight', () => {
    expect(hours([{ start: wall(23), end: wall(0, 0, 12) }])).toEqual(['7:0', '23:59']);
  });
  it('shows the whole day when an appointment crosses midnight', () => {
    expect(hours([{ start: wall(23, 30), end: wall(0, 30, 12) }])).toEqual(['0:0', '23:59']);
  });
});
