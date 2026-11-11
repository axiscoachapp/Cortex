import { describe, expect, it } from 'vitest';
import { formatCalendarDay, formatCalendarPeriod, formatCalendarWeekRange } from './calendarLabels';

describe('agenda toolbar period', () => {
  it.each([
    ['day', new Date(2026, 10, 11), 'Quarta, 11 de novembro'],
    ['day', new Date(2026, 10, 14), 'Sábado, 14 de novembro'],
    ['week', new Date(2026, 10, 11), '9–15 de novembro'],
    ['week', new Date(2026, 10, 15), '9–15 de novembro'],
    ['week', new Date(2026, 10, 16), '16–22 de novembro'],
    ['month', new Date(2026, 10, 11), 'Novembro de 2026'],
  ] as const)('labels a %s view of %s as %s', (view, date, expected) => {
    expect(formatCalendarPeriod(view, date)).toBe(expected);
  });
});

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

describe('Portuguese calendar day caption', () => {
  it.each([
    [new Date(2026, 10, 5), 'quinta-feira, 5 de novembro'],
    [new Date(2024, 1, 29), 'quinta-feira, 29 de fevereiro'],
    [new Date(2027, 0, 1), 'sexta-feira, 1 de janeiro'],
  ])('labels %s as %s', (date, expected) => {
    expect(formatCalendarDay(date)).toBe(expected);
  });

  it('preserves the supplied date and time', () => {
    const date = new Date(2026, 10, 5, 18, 42, 17, 321), before = date.getTime();
    expect(formatCalendarDay(date)).toBe('quinta-feira, 5 de novembro');
    expect(date.getTime()).toBe(before);
  });
});
