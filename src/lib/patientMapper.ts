import { Patient } from '@/types/patient';

export function mapPatientRow(row: any): Patient {
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    profession: row.profession ?? '',
    photoUrl: row.photo_url ?? undefined,
    lastVisit: row.last_visit,
    status: row.status as Patient['status'],
    diagnoses: Array.isArray(row.diagnoses) ? row.diagnoses : [],
    medications: Array.isArray(row.medications) ? row.medications : [],
    allergies: row.allergies ?? [],
    socialAnamnesis: row.social_anamnesis ?? undefined,
    medicalHistory: row.medical_history ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
  };
}
