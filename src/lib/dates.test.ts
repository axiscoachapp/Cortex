import { describe, expect, it } from 'vitest';
import { ageAtDate, clinicDate, daysSinceDateOnly, formatDateOnly, lastConsultationLabel, relativeDayLabel } from './dates';
import { statusLook, typeLabel } from './appointmentStatus';

describe('one wording for the last consultation and for appointment status', () => {
  const now = new Date('2026-11-10T15:00:00Z');
  it('shows the date and how long ago, from a SQL date or a timestamp', () => {
    expect(lastConsultationLabel('2026-10-12', now)).toBe('12/10/2026 · há 29 dias');
    expect(lastConsultationLabel('2026-11-10T01:30:00Z', now)).toBe('09/11/2026 · ontem');
    expect(lastConsultationLabel('2026-11-10', now)).toBe('10/11/2026 · hoje');
    expect(lastConsultationLabel('2025-01-02', now)).toBe('02/01/2025 · há 1 ano');
    expect(lastConsultationLabel('2026-06-01', now)).toBe('01/06/2026 · há 5 meses');
  });
  it('says there is none for an empty or impossible date', () => {
    expect(lastConsultationLabel(null, now)).toBe('Sem consulta registrada');
    expect(lastConsultationLabel('2026-02-30', now)).toBe('Sem consulta registrada');
    expect(lastConsultationLabel('texto', now)).toBe('Sem consulta registrada');
  });
  it('words future days too', () => {
    expect(relativeDayLabel('2026-11-11', now)).toBe('amanhã');
    expect(relativeDayLabel('2026-11-13', now)).toBe('em 3 dias');
  });
  it('gives every status one label and falls back safely', () => {
    expect(statusLook('cancelado').label).toBe('Cancelado');
    expect(statusLook('cancelado').badge).toContain('line-through');
    expect(statusLook('algo-novo').label).toBe('Agendado');
    expect(typeLabel('novo')).toBe('Primeira consulta');
    expect(typeLabel(null)).toBe('Consulta');
  });
});

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
