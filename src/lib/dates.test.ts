import { describe, expect, it } from 'vitest';
import { clinicDate, formatDateOnly } from './dates';

describe('clinical calendar dates', () => {
  it('formats SQL dates without shifting them to yesterday', () => {
    expect(formatDateOnly('2026-10-27')).toBe('27/10/2026');
  });
  it('uses the clinic day even after UTC midnight', () => {
    expect(clinicDate(new Date('2026-10-28T01:30:00Z'))).toBe('2026-10-27');
  });
  it('rejects impossible dates instead of silently normalizing', () => {
    expect(formatDateOnly('2026-02-30')).toBe('Data inválida');
  });
});
