import { describe, expect, it } from 'vitest';
import { formatCalendarWeekRange } from './calendarLabels';

describe('Portuguese calendar week caption', () => {
  it.each([
    [new Date(2026, 10, 1), new Date(2026, 10, 7), '1–7 de novembro'],
    [new Date(2026, 6, 5), new Date(2026, 6, 11), '5–11 de julho'],
    [new Date(2026, 10, 29), new Date(2026, 11, 5), '29 de nov. – 5 de dez.'],
    [new Date(2026, 11, 27), new Date(2027, 0, 2), '27 de dez. de 2026 – 2 de jan. de 2027'],
    [new Date(2024, 1, 25), new Date(2024, 2, 2), '25 de fev. – 2 de mar.'],
  ])('labels %s through %s as %s', (start, end, expected) => {
    expect(formatCalendarWeekRange({ start, end })).toBe(expected);
  });

  it('formats the supplied inclusive bounds without mutating or replacing them', () => {
    const start = new Date(2026, 10, 1, 9, 17), end = new Date(2026, 10, 7, 18, 42);
    const before = [start.getTime(), end.getTime()];
    expect(formatCalendarWeekRange({ start, end })).toBe('1–7 de novembro');
    expect([start.getTime(), end.getTime()]).toEqual(before);
  });
});
