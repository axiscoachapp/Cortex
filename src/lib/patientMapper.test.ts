import { describe, it, expect } from 'vitest';
import { mapPatientRow } from './patientMapper';

describe('mapPatientRow', () => {
  const baseRow = {
    id: 'abc-123',
    name: 'Maria Silva',
    age: 42,
    profession: 'Professora',
    photo_url: null,
    last_visit: '2026-05-01',
    status: 'retorno',
    diagnoses: [{ name: 'Hipertensão', icd: 'I10' }],
    medications: [{ name: 'Losartana', dose: '50mg' }],
    allergies: ['Penicilina'],
    social_anamnesis: 'Não fuma.',
    medical_history: 'Hipertensa há 5 anos.',
    phone: '+55 11 99999-0000',
    email: null,
  };

  it('maps all fields correctly', () => {
    const patient = mapPatientRow(baseRow);
    expect(patient.id).toBe('abc-123');
    expect(patient.name).toBe('Maria Silva');
    expect(patient.age).toBe(42);
    expect(patient.profession).toBe('Professora');
    expect(patient.lastVisit).toBe('2026-05-01');
    expect(patient.status).toBe('retorno');
    expect(patient.diagnoses).toHaveLength(1);
    expect(patient.medications).toHaveLength(1);
    expect(patient.allergies).toEqual(['Penicilina']);
    expect(patient.socialAnamnesis).toBe('Não fuma.');
    expect(patient.medicalHistory).toBe('Hipertensa há 5 anos.');
    expect(patient.phone).toBe('+55 11 99999-0000');
  });

  it('defaults missing optional fields', () => {
    const sparse = {
      id: 'x', name: 'João', age: 30, last_visit: '2026-01-01', status: 'novo',
    };
    const patient = mapPatientRow(sparse);
    expect(patient.profession).toBe('');
    expect(patient.photoUrl).toBeUndefined();
    expect(patient.diagnoses).toEqual([]);
    expect(patient.medications).toEqual([]);
    expect(patient.allergies).toEqual([]);
    expect(patient.socialAnamnesis).toBeUndefined();
    expect(patient.medicalHistory).toBeUndefined();
    expect(patient.phone).toBeUndefined();
    expect(patient.email).toBeUndefined();
  });

  it('coerces non-array diagnoses/medications to empty arrays', () => {
    const patient = mapPatientRow({ ...baseRow, diagnoses: null, medications: 'wrong' });
    expect(patient.diagnoses).toEqual([]);
    expect(patient.medications).toEqual([]);
  });

  it('maps photo_url to photoUrl', () => {
    const patient = mapPatientRow({ ...baseRow, photo_url: 'https://example.com/photo.jpg' });
    expect(patient.photoUrl).toBe('https://example.com/photo.jpg');
  });
});
