// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPatientSummary } from '../../supabase/functions/_shared/gemini';
import { readPatientContext } from '../../supabase/functions/_shared/modelInput';

afterEach(()=>vi.useRealTimers());
describe('server patient age at the clinic calendar date',()=>{
  it('recalculates stale age on the birthday at São Paulo midnight',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T02:59:59Z'));
    const patient={name:'Pessoa sintética',age:12,date_of_birth:'2000-10-28'};
    expect(readPatientContext(patient)?.age).toBe(25);
    expect(buildPatientSummary(patient,'')).toContain('25 anos');
    vi.setSystemTime(new Date('2026-10-28T03:00:00Z'));
    expect(readPatientContext(patient)?.age).toBe(26);
    expect(buildPatientSummary(patient,'')).toContain('26 anos');
  });
  it('preserves a real newborn and a recorded zero while keeping missing age unknown',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    expect(readPatientContext({age:7,dateOfBirth:'2026-10-28'})?.age).toBe(0);
    expect(readPatientContext({age:0})?.age).toBe(0);
    expect(readPatientContext({age:null})?.age).toBeNull();
    expect(buildPatientSummary({name:'Pessoa',age:null},'')).toContain('idade não informada');
    expect(buildPatientSummary({name:'Pessoa',age:null},'')).not.toContain('null anos');
  });
  it('does not substitute static age when the provided birth date is impossible or in the future',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    for(const birth of ['2000-02-31','2026-10-29','28/10/2000','invalid']) {
      expect(readPatientContext({age:99,date_of_birth:birth})?.age).toBeNull();
      expect(buildPatientSummary({name:'Pessoa',age:99,date_of_birth:birth},'')).toContain('idade não informada');
    }
  });
  it('handles leap-day birthdays without converting a calendar date into an instant',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2027-02-28T12:00:00Z'));
    expect(readPatientContext({date_of_birth:'2000-02-29'})?.age).toBe(26);
    vi.setSystemTime(new Date('2027-03-01T12:00:00Z'));
    expect(readPatientContext({date_of_birth:'2000-02-29'})?.age).toBe(27);
  });
});
