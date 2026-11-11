import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneProblem } from './contactPhone';

describe('contact phone check (mirrors normalize_reception_phone)', () => {
  it.each(['', '(41) 99999-0001', '41 3333-4444', '+351 912 345 678'])('accepts %j', value => expect(phoneProblem(value)).toBeNull());
  it.each([
    ['123', 'Faltam números'],
    ['41 9999-abc', 'Use só números'],
    ['+1234567890123456', 'Número longo demais'],
  ])('explains %j', (value, message) => expect(phoneProblem(value)).toContain(message));
  it('normalizes Brazilian numbers with the country code, like the server', () => {
    expect(normalizePhone('(41) 99999-0001')).toBe('5541999990001');
    expect(normalizePhone('+55 41 99999-0001')).toBe('5541999990001');
    expect(normalizePhone('+351 912 345 678')).toBe('351912345678');
    expect(normalizePhone('123')).toBeNull();
  });
});
