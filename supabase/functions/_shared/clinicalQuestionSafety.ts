/** Conservative routing, not a validated interaction checker. Unknown language
 * can escape detection; the model contract must also prohibit safety clearance. */
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const medication = /medica|medicamento|farmaco|remedio|droga|posolog|dosagem|\bdose\b|\bmg\b|comprimido|paroxetina|propranolol/;
const explicitRisk = /intera[cg]|contraindica|concomitant|associa[rçc]|combina[cçr]|mistura[rç]|juntos|interaction|contraindicat|coadministr|together/;
const regimenDecision = /\b(posso|pode|podem|devo|deve|deveria|seria|can i|can we|should)\b.{0,100}\b(usar|tomar|manter|acrescentar|introduzir|iniciar|prescrever|retirar|suspender|aumentar|reduzir|trocar|substituir|take|combine|stop|start|increase|decrease)\b/;
const safetyDecision = /segur[oa]|\brisco|\btoxic|\bsafe\b|\bdanger|\badjust|ajust|aument.*dose|reduz.*dose|suspend.*medica/;
const followUp = /\b(e |entao|nesse caso|neste caso|os dois|ambos|essa|esse|assim|continua|manter|dose|segur|pode|posso|devo|should|both|what about)/;

export function requiresMedicationVerification(question: string, history: unknown): boolean {
  const current = normalize(question);
  if (explicitRisk.test(current) || regimenDecision.test(current)) return true;
  if (medication.test(current) && safetyDecision.test(current)) return true;
  const prior = Array.isArray(history) ? history.slice(-10).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    return value.type === 'user' && typeof value.content === 'string' ? [normalize(value.content.slice(0, 4000))] : [];
  }).join('\n') : '';
  return followUp.test(current) && (explicitRisk.test(prior) || regimenDecision.test(prior) || medication.test(prior));
}

export const MEDICATION_VERIFICATION_REPLY = {
  message: 'O Cortex não tem uma base farmacológica validada conectada para confirmar ou descartar interações, contraindicações ou segurança de doses. O prontuário e respostas anteriores da IA não comprovam que uma associação seja segura. Consulte as bulas e uma referência farmacológica atualizada; a avaliação e a conduta precisam ser revisadas pelo médico.',
  credits: 0,
  sources: [],
  safety: { status: 'verification_required', topic: 'medication' },
} as const;
