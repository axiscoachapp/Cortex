import { RequestError } from './http.ts';

interface Diagnosis { code?: string | null; description?: string | null }
interface Medication { name?: string | null; dosage?: string | null }
export interface PatientContext {
  name?: string | null;
  age?: number | null;
  diagnoses?: Array<string | Diagnosis> | null;
  medications?: Array<string | Medication> | null;
  allergies?: string[] | null;
  clinical_notes?: string | null;
  medical_history?: string | null;
  medicalHistory?: string | null;
  social_anamnesis?: string | null;
  socialAnamnesis?: string | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function optionalText(value: unknown, field: string): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new RequestError(`${field} deve ser texto.`);
  return value;
}

/** Validate the client context before formatting it or reserving paid work. */
export function readPatientContext(value: unknown): PatientContext | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new RequestError('Contexto do paciente inválido.');
  for (const field of ['name', 'clinical_notes', 'medical_history', 'medicalHistory', 'social_anamnesis', 'socialAnamnesis']) {
    optionalText(value[field], field);
  }
  if (value.age != null && (typeof value.age !== 'number' || !Number.isFinite(value.age))) {
    throw new RequestError('Idade do paciente inválida.');
  }
  for (const [field, keys] of [['diagnoses', ['code', 'description']], ['medications', ['name', 'dosage']]] as const) {
    const list = value[field];
    if (list == null) continue;
    if (!Array.isArray(list) || list.some(item => typeof item !== 'string' &&
      (!isRecord(item) || keys.some(key => item[key] != null && typeof item[key] !== 'string')))) {
      throw new RequestError(`${field} inválido.`);
    }
  }
  if (value.allergies != null && (!Array.isArray(value.allergies) || value.allergies.some(item => typeof item !== 'string'))) {
    throw new RequestError('Alergias inválidas.');
  }
  return value as PatientContext;
}

/** Match callGemini's complete text limit before the first possibly paid call.
 * extraCharacters reserves room for bounded context fetched after that call. */
export function assertPromptSize(text: string, system: string, extraCharacters = 0): void {
  if (text.length + system.length + extraCharacters > 128 * 1024) {
    throw new RequestError('Contexto muito grande. Reduza o texto e tente novamente; nenhum conteúdo foi omitido.', 413);
  }
}
