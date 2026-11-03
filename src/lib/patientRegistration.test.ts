import { describe, expect, it } from 'vitest';
import { validatePatientRegistration, validatePatientChanges, normalizeCpf } from './patientRegistration';

describe('patient registration boundaries', () => {
  it('does not require correcting untouched legacy fields for an unrelated edit',()=>{
    const legacy={name:'hhh',profession:'jjj',email:'old-invalid',phone:'123',age:0};
    expect(validatePatientChanges({...legacy,healthInsurance:'Plano sintético'},legacy)).toBeNull();
    expect(validatePatientChanges({...legacy,email:'new-invalid'},legacy)).toMatch(/e-mail/);
  });
  it('preserves newborn and unknown ages and accepts short genuine names', () => {
    expect(validatePatientRegistration({name:'Li',age:0})).toBeNull();
    expect(validatePatientRegistration({name:'Ana',age:null})).toBeNull();
  });
  it.each([{name:'hhh'},{name:'1234'},{name:'Ana',profession:'jjj'},{name:'Ana',age:-1},{name:'Ana',age:1.5},{name:'Ana',email:'invalido'},{name:'Ana',phone:'12'},{name:'Ana',cpf:'11111111111'}])('rejects malformed registration %j', value => {
    expect(validatePatientRegistration(value)).toBeTruthy();
  });
  it('validates CPF check digits while permitting omission and formatting', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(validatePatientRegistration({name:'Pessoa sintética',cpf:'529.982.247-25'})).toBeNull();
    expect(validatePatientRegistration({name:'Pessoa sintética',cpf:'52998224724'})).toMatch(/CPF/);
    expect(validatePatientRegistration({name:'Pessoa sintética',cpf:''})).toBeNull();
  });
});
