import type { Patient } from '@/types/patient';

export function administrativeValues(patient?: Patient) {
  return {phone:patient?.phone??'',email:patient?.email??'',cpf:patient?.cpf??'',sex:patient?.sex??'',healthInsurance:patient?.healthInsurance??''};
}

export interface RegistrationInput {
  name: string; age?: number | null; profession?: string; phone?: string; email?: string;
  cpf?: string; sex?: string; healthInsurance?: string;
}
export const normalizeCpf = (value: string) => value.replace(/\D/g, '');
export function validCpf(value: string): boolean {
  if (!/^[\d.\-\s]+$/.test(value)) return false;
  const digits=normalizeCpf(value);
  if(!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits))return false;
  for(let length=9;length<=10;length++) {
    let sum=0;for(let i=0;i<length;i++)sum+=Number(digits[i])*(length+1-i);
    const digit=(sum*10)%11;
    if(Number(digits[length])!==(digit===10?0:digit))return false;
  }
  return true;
}
const repeatedLetters=(value:string)=>/^(\p{L})\1{2,}$/u.test(value.toLocaleLowerCase('pt-BR').replace(/[^\p{L}]/gu,''));

export type RegistrationField = 'name' | 'age' | 'profession' | 'phone' | 'email' | 'cpf' | 'sex' | 'healthInsurance';
export type RegistrationErrors = Partial<Record<RegistrationField, string>>;
export type AdministrativeField = 'phone' | 'email' | 'cpf' | 'healthInsurance' | 'sex';
/** Id of a field in PatientAdministrativeFields, so a form can focus the first one with a problem. */
export const administrativeFieldId = (prefix: string, field: AdministrativeField) => `${prefix}-${field}`;

/** Every problem keyed by field, in form order, so each message can sit under its field.
 * Syntax/consistency checks do not establish a person's identity. */
export function patientRegistrationErrors(value: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const name=value.name.trim();
  if(name.length<2 || name.length>200 || !/\p{L}/u.test(name) || repeatedLetters(name))errors.name='Informe um nome válido, com 2 a 200 caracteres.';
  if(value.age!=null && (!Number.isInteger(value.age)||value.age<0||value.age>130))errors.age='Informe uma idade inteira entre 0 e 130 anos, ou deixe em branco.';
  if(value.profession && (value.profession.trim().length>200 || repeatedLetters(value.profession)))errors.profession='Revise a profissão informada ou deixe o campo em branco.';
  if(value.phone?.trim() && (!/^[+\d\s().-]+$/.test(value.phone) || !/^\d{10,15}$/.test(value.phone.replace(/\D/g,''))))errors.phone='Informe um telefone com DDD, ou deixe em branco.';
  if(value.email?.trim() && (value.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())))errors.email='Informe um e-mail válido, ou deixe em branco.';
  if(value.cpf?.trim() && !validCpf(value.cpf))errors.cpf='CPF inválido. Confira os dígitos ou deixe o campo em branco.';
  if(value.sex && !['feminino','masculino','intersexo','nao_informado'].includes(value.sex))errors.sex='Selecione uma opção válida para sexo.';
  if((value.healthInsurance?.length??0)>120)errors.healthInsurance='Informe um convênio de até 120 caracteres.';
  return errors;
}

/** The first problem, for callers that show a single message (the import preview). */
export function validatePatientRegistration(value: RegistrationInput): string | null {
  return Object.values(patientRegistrationErrors(value))[0] ?? null;
}

/** Only the fields the person changed are checked, so an unrelated edit never asks to
 * correct legacy data. */
export function patientChangeErrors(value: RegistrationInput, previous: RegistrationInput): RegistrationErrors {
  const changed: RegistrationInput = {name:'Paciente'};
  for (const key of Object.keys(value) as (keyof RegistrationInput)[]) {
    if(value[key] !== previous[key]) Object.assign(changed,{[key]:value[key]});
  }
  return patientRegistrationErrors(changed);
}

export function validatePatientChanges(value: RegistrationInput, previous: RegistrationInput): string | null {
  return Object.values(patientChangeErrors(value, previous))[0] ?? null;
}
