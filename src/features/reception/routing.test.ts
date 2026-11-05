import { describe, expect, it } from 'vitest';
import { suggestDoctor } from './routing';

const doctors = [
  { id: 'a', name: 'Dra. A', specialty: null },
  { id: 'b', name: 'Dr. B', specialty: null },
];
const patient = (doctorId: string) => ({
  id: 'p-' + doctorId,
  name: 'Exemplo',
  dateOfBirth: null,
  doctorId,
  relationship: 'self' as const,
});
describe('administrative doctor suggestions', () => {
  it('honors a human-selected active physician', () => {
    expect(suggestDoctor(doctors, { doctorId: 'b', beneficiaries: [patient('a')] }).doctorId).toBe('b');
  });
  it('offers the single confirmed continuity link', () => {
    expect(suggestDoctor(doctors, { doctorId: null, beneficiaries: [patient('a'), patient('a')] }).doctorId).toBe('a');
  });
  it('requires a human decision for a family with multiple doctors', () => {
    expect(suggestDoctor(doctors, { doctorId: null, beneficiaries: [patient('a'), patient('b')] }).doctorId).toBeNull();
  });
  it('does not recommend inactive or undelegated doctors', () => {
    expect(suggestDoctor(doctors, { doctorId: 'revoked', beneficiaries: [patient('revoked')] }).doctorId).toBeNull();
  });
  it('does not guess a specialty from a new contact', () => {
    expect(suggestDoctor(doctors, { doctorId: null, beneficiaries: [] }).doctorId).toBeNull();
  });
  it('does not silently replace an unavailable indicated doctor with another continuity link', () => {
    const suggestion=suggestDoctor(doctors,{doctorId:'revoked',beneficiaries:[patient('a')]});
    expect(suggestion.doctorId).toBeNull();expect(suggestion.reason).toMatch(/indicado.*indisponível/);expect(suggestion.candidateIds).toEqual([]);
  });
  it('lists all permitted linked options without resolving a family tie', () => {
    const suggestion=suggestDoctor(doctors,{doctorId:null,beneficiaries:[patient('a'),patient('b'),patient('revoked')]});
    expect(suggestion.doctorId).toBeNull();expect(suggestion.candidateIds).toEqual(['a','b']);
  });
  it('explains the absence of authorized agendas without inferring a service or specialty', () => {
    const suggestion=suggestDoctor([],{doctorId:null,beneficiaries:[patient('a')]});
    expect(suggestion.doctorId).toBeNull();expect(suggestion.candidateIds).toEqual([]);expect(suggestion.reason).toMatch(/Nenhuma agenda autorizada/);
  });
});
