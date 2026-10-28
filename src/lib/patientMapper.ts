import { Patient } from '@/types/patient';

type PatientRow = Record<string, unknown> & { id: string; name: string; age: number; last_visit: string; status: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';

export function mapPatientRow(row: PatientRow): Patient {
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    revision: typeof row.revision === 'number' ? row.revision : 0,
    profession: text(row.profession),
    photoUrl: text(row.photo_url) || undefined,
    lastVisit: row.last_visit,
    status: row.status as Patient['status'],
    diagnoses: Array.isArray(row.diagnoses) ? row.diagnoses.map(value => { const d = object(value); return { code: text(d.code ?? d.icd), description: text(d.description ?? d.name) }; }) : [],
    medications: Array.isArray(row.medications) ? row.medications.map(value => { const m = object(value); return { name: text(m.name), dosage: text(m.dosage ?? m.dose), instructions: text(m.instructions), startedAt: text(m.startedAt) || undefined }; }) : [],
    allergies: Array.isArray(row.allergies) ? row.allergies.filter((value): value is string => typeof value === 'string') : [],
    socialAnamnesis: text(row.social_anamnesis) || undefined,
    medicalHistory: text(row.medical_history) || undefined,
    phone: text(row.phone) || undefined,
    email: text(row.email) || undefined,
  };
}
