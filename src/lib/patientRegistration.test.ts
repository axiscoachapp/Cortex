import { describe, expect, it } from 'vitest';
import { validatePatientRegistration, validatePatientChanges, normalizeCpf, patientRegistrationErrors, patientChangeErrors } from './patientRegistration';

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
  it('keys every problem by field so forms show each under its field', () => {
    const value={name:'x',email:'invalido',cpf:'11111111111'};
    expect(Object.keys(patientRegistrationErrors(value))).toEqual(['name','email','cpf']);
    expect(validatePatientRegistration(value)).toBe(patientRegistrationErrors(value).name);
    const legacy={name:'hhh',email:'old-invalid'};
    expect(patientChangeErrors({...legacy,phone:'12'},legacy)).toEqual({phone:expect.stringMatching(/telefone/)});
  });
  it('validates CPF check digits while permitting omission and formatting', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(validatePatientRegistration({name:'Pessoa sintética',cpf:'529.982.247-25'})).toBeNull();
    expect(validatePatientRegistration({name:'Pessoa sintética',cpf:'52998224724'})).toMatch(/CPF/);
    expect(validatePatientRegistration({name:'Pessoa sintética',cpf:''})).toBeNull();
  });
});
