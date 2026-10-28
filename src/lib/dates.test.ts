import { describe, expect, it } from 'vitest';
import { ageAtDate, clinicDate, daysSinceDateOnly, formatDateOnly } from './dates';

describe('clinical calendar dates', () => {
  it('computes age at the encounter date while preserving newborn zero and unknown invalid dates',()=>{
    expect(ageAtDate('2000-10-29','2026-10-28')).toBe(25);
    expect(ageAtDate('2000-10-28','2026-10-28')).toBe(26);
    expect(ageAtDate('2026-10-28','2026-10-28')).toBe(0);
    expect(ageAtDate('2027-01-01','2026-10-28')).toBeNull();
    expect(ageAtDate('2026-02-30','2026-10-28')).toBeNull();
  });
  it('formats SQL dates without shifting them to yesterday', () => {
    expect(formatDateOnly('2026-10-27')).toBe('27/10/2026');
  });
  it('uses the clinic day even after UTC midnight', () => {
    expect(clinicDate(new Date('2026-10-28T01:30:00Z'))).toBe('2026-10-27');
  });
  it('computes elapsed calendar days instead of elapsed UTC midnights', () => {
    expect(daysSinceDateOnly('2026-10-27', new Date('2026-10-28T01:30:00Z'))).toBe(0);
    expect(daysSinceDateOnly('2026-10-26', new Date('2026-10-28T01:30:00Z'))).toBe(1);
  });
  it('rejects impossible dates instead of silently normalizing', () => {
    expect(formatDateOnly('2026-02-30')).toBe('Data inválida');
  });
});
