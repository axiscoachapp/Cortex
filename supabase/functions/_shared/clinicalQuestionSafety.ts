/** Conservative routing, not a validated interaction checker. Unknown language
 * can escape detection; the model contract must also prohibit safety clearance.
 * A routed question with a patient is answered in record mode (only what the chart records, then
 * the fixed notice); without a patient it gets the fixed notice. */
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A drug, a drug class or a word for medication. Names cover the pilot's specialty; suffixes catch
 * most generic names elsewhere. */
const drug = new RegExp([
  /medica|medicamento|farmaco|remedio|droga|comprimido|capsula|pomada|injecao|vacina/.source,
  /antibiotic|anti-?inflamatori|analgesic|antidepressiv|ansiolitic|anticoncepcional|contraceptiv|hormon|corticoid|antifungic|antiviral|anti-?hipertensiv|anticoagulante|antiemetic/.source,
  /\b(estrogen|estradiol|progesteron|progestagen|testosteron|levotiroxina|metformina|insulina|ibuprofeno|dipirona|paracetamol|amoxicilina|cefalexina|nitrofurantoina|fosfomicina|metronidazol|fluconazol|misoprostol|ocitocina|acido folico|sulfato ferroso|isotretinoina|varfarina|enoxaparina|aspirina|aas|paroxetina|sertralina|fluoxetina|propranolol|losartana|captopril|metildopa|nifedipino)/.source,
  /\b[a-z]{3,}(profeno|cilina|micina|floxacino|conazol|prazol|olol|pril|sartana|statina|tidina|triptana|azepam|zolam|formina|tiazida|parina|ciclina)\b/.source,
].join('|'));
const dose = /\bdoses?\b|dosage|dosagem|posolog|\b\d+([.,]\d+)?\s?(mg|mcg|g|ml|ui)\b|\bmg\b|\bmcg\b|quantos? (mg|comprimidos|gotas)|de \d+ em \d+ ?h/;
/** Words that make a question about a drug pair or a risk by themselves. */
const explicitRisk = /intera[cg]|contraindica|contraindicat|coadministr|interaction/;
/** Words that are only a risk question when a drug is mentioned. */
const pairing = /associa[rçc]|combina[cçr]|mistura[rç]|juntos|concomitant|together|combine/;
const modal = /\b(posso|pode|podem|podemos|devo|deve|deveria|seria|da para|can i|can we|should)\b/;
/** Verbs that are about taking or prescribing a drug even without naming it ("Posso tomar os dois?"). */
const takeVerb = /\b(tomar|prescrever|receitar|take|prescribe)\b/;
/** Verbs that are a regimen decision only about a drug ("pode manter os dois?", but not "pode manter o foco"). */
const regimenVerb = /\b(usar|manter|acrescentar|introduzir|iniciar|retirar|suspender|aumentar|reduzir|trocar|substituir|start|stop|increase|decrease)\b/;
const safety = /segur[oa]|\brisco|\btoxic|\bsafe\b|\bdanger|permitid|liberad|pode usar|indicad|evitar|\bajust/;
const pregnancyOrLactation = /gesta|gravid|gestante|trimestre|amament|lacta|puerper|\bsemanas de gestacao/;
/** "os dois", "isso", "ele"...: a follow-up that points back at drugs named earlier. */
const pointsBack = /\b(os dois|as duas|ambos|ambas|isso|esse|essa|esses|essas|eles|elas|both|them|it)\b/;

function regimenDecision(text: string, drugInContext: boolean): boolean {
  if (!modal.test(text)) return false;
  if (takeVerb.test(text)) return true;
  return regimenVerb.test(text) && (drug.test(text) || (drugInContext && pointsBack.test(text)));
}

function directMedicationQuestion(text: string, drugInContext: boolean): boolean {
  const mentionsDrug = drug.test(text);
  if (explicitRisk.test(text) || dose.test(text)) return true;
  if (regimenDecision(text, drugInContext)) return true;
  if (mentionsDrug && (pairing.test(text) || safety.test(text) || pregnancyOrLactation.test(text))) return true;
  return false;
}

export function requiresMedicationVerification(question: string, history: unknown): boolean {
  const current = normalize(question);
  const prior = Array.isArray(history) ? history.slice(-10).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    return value.type === 'user' && typeof value.content === 'string' ? [normalize(value.content.slice(0, 4000))] : [];
  }) : [];
  const drugInContext = prior.some((text) => drug.test(text));
  if (directMedicationQuestion(current, drugInContext)) return true;
  // A follow-up is routed only when it names a drug itself and an earlier question was already a
  // medication decision; "E qual foi a queixa?" after a medication question is an ordinary question.
  return drug.test(current) && prior.some((text) => directMedicationQuestion(text, false));
}

export const MEDICATION_VERIFICATION_REPLY = {
  message: 'O Cortex não tem uma base farmacológica validada conectada para confirmar ou descartar interações, contraindicações ou segurança de doses. O prontuário e respostas anteriores da IA não comprovam que uma associação seja segura. Consulte as bulas e uma referência farmacológica atualizada; a avaliação e a conduta precisam ser revisadas pelo médico.',
  credits: 0,
  sources: [],
  safety: { status: 'verification_required', topic: 'medication' },
} as const;
