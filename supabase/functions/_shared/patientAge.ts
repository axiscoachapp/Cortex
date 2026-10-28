import { clinicDate } from './clinicDate.ts';

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Calendar-date age at the clinic; an invalid known DOB never falls back to
 * a stale numeric age. Missing DOB preserves an explicitly recorded age zero. */
export function currentPatientAge(value: unknown, onDate = clinicDate()): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const patient = value as Record<string, unknown>;
  const birthDate = patient.date_of_birth ?? patient.dateOfBirth;
  if (birthDate != null && birthDate !== '') {
    if (!validDate(birthDate) || !validDate(onDate) || birthDate > onDate) return null;
    const age = Number(onDate.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (onDate.slice(5) < birthDate.slice(5) ? 1 : 0);
    return age >= 0 && age <= 150 ? age : null;
  }
  return typeof patient.age === 'number' && Number.isInteger(patient.age) && patient.age >= 0 && patient.age <= 150 ? patient.age : null;
}
