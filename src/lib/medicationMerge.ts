import type { Medication } from '@/types/patient';

/** Called only after the clinician accepts the displayed reconciliation. */
export function mergeMedications(existing: Medication[], incoming: Medication[]): Medication[] {
  const result = existing.map(med => ({ ...med }));
  for (const med of incoming) {
    const key = med.name.trim().toLocaleLowerCase('pt-BR');
    if (!key) continue;
    const index = result.findIndex(item => item.name.trim().toLocaleLowerCase('pt-BR') === key);
    if (index >= 0) result[index] = { ...result[index], ...med, startedAt: result[index].startedAt };
    else result.push({ ...med, startedAt: new Date().toISOString().slice(0, 10) });
  }
  return result;
}
