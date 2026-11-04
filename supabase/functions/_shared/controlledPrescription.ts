/**
 * Receita de Controle Especial (D8): pure rules shared by generate-prescription
 * and the composer. Contract: docs/prescriptions/RECEITA_CONTROLE_ESPECIAL.md
 * (Portaria 344/98 arts. 52, 55, 57, 59, 60; Lei 5.991/73 art. 35;
 * Lei 9.965/2000 for C5).
 */
import { controlledFindings, FORM_LABEL, type ControlledFinding } from './regulatedMedications.ts';

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function below1000(n: number): string {
  if (n === 100) return 'cem';
  const parts: string[] = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest > 0 && rest < 20) parts.push(UNITS[rest]);
  else if (rest >= 20) parts.push(rest % 10 ? `${TENS[Math.floor(rest / 10)]} e ${UNITS[rest % 10]}` : TENS[Math.floor(rest / 10)]);
  return parts.join(' e ');
}

/** Whole numbers 1–9999 in Portuguese words ("30" -> "trinta"). */
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('Quantidade fora do intervalo de 1 a 9999.');
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 0 ? '' : thousands === 1 ? 'mil' : `${below1000(thousands)} mil`;
  if (!rest) return head;
  if (!head) return below1000(rest);
  return rest < 100 || rest % 100 === 0 ? `${head} e ${below1000(rest)}` : `${head} ${below1000(rest)}`;
}

export interface ControlledItemInput { name: string; dosage?: string; instructions?: string; quantity?: unknown; unit?: unknown }
export interface ControlledContentInput {
  patientAddress?: unknown;
  patientDocument?: { kind?: unknown; value?: unknown } | null;
  justification?: unknown;
  cid?: unknown;
}

export interface ControlledPlan {
  items: Array<{ name: string; dosage: string; instructions: string; quantity: number; unit: string; quantityText: string; findings: ControlledFinding[] }>;
  patientAddress: string;
  patientDocumentLine: string;
  justification: string | null;
  cid: string | null;
  hasC5: boolean;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate a Receita de Controle Especial and prepare what is printed.
 * Returns { error } with a message the doctor can act on, or { plan }.
 */
export function planControlledPrescription(
  meds: ControlledItemInput[],
  content: ControlledContentInput | null | undefined,
  context: { patientCpf: string | null; prescriberCpf: string | null; prescriberPhone: string },
): { error: string } | { plan: ControlledPlan } {
  if (!meds.length) return { error: 'Inclua de 1 a 3 medicamentos controlados na receita de controle especial.' };
  if (meds.length > 3) return { error: 'A receita de controle especial aceita no máximo 3 medicamentos (Portaria 344/98, art. 57). Divida em mais de uma receita.' };
  const items: ControlledPlan['items'] = [];
  for (const m of meds) {
    const findings = controlledFindings(m.name);
    if (!findings.length) return { error: `${m.name.trim()} não é controlado: prescreva em receita simples ou de antimicrobiano.` };
    const other = findings.find((f) => f.form !== 'receita_controle_especial');
    if (other) {
      return { error: `${m.name.trim()} (${other.substance}, lista ${other.list}) não pode sair na receita de controle especial: exige ${FORM_LABEL[other.form]}${other.note ? ` (${other.note})` : ''}.` };
    }
    const quantity = typeof m.quantity === 'number' ? m.quantity : Number(text(m.quantity));
    const unit = text(m.unit);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999 || !unit) {
      return { error: `Informe a quantidade de ${m.name.trim()} em número inteiro e a unidade (ex.: 30 comprimidos).` };
    }
    if (!text(m.dosage) || !text(m.instructions)) return { error: `Informe a dose e a posologia de ${m.name.trim()}.` };
    items.push({ name: m.name.trim(), dosage: text(m.dosage), instructions: text(m.instructions), quantity, unit: unit.slice(0, 40), quantityText: numberInWords(quantity), findings });
  }

  const address = text(content?.patientAddress);
  if (address.length < 10) return { error: 'Informe o endereço completo do paciente (rua, número, cidade e UF): é obrigatório na receita de controle especial.' };

  let documentLine: string;
  if (context.patientCpf) documentLine = `CPF: ${context.patientCpf.slice(0, 3)}.${context.patientCpf.slice(3, 6)}.${context.patientCpf.slice(6, 9)}-${context.patientCpf.slice(9)}`;
  else {
    const kind = text(content?.patientDocument?.kind);
    const value = text(content?.patientDocument?.value).slice(0, 40);
    if (kind === 'nao_possui') documentLine = 'CPF: não possui';
    else if ((kind === 'passaporte' || kind === 'outro') && value) documentLine = `${kind === 'passaporte' ? 'Passaporte' : 'Documento'}: ${value}`;
    else return { error: 'Informe o CPF do paciente no cadastro, ou marque "não possui" ou outro documento: é obrigatório na receita de controle especial.' };
  }

  const hasC5 = items.some((i) => i.findings.some((f) => f.list === 'C5'));
  const cid = text(content?.cid).toUpperCase().slice(0, 20) || null;
  const justification = text(content?.justification).slice(0, 600) || null;
  if (hasC5) {
    if (!context.prescriberCpf) return { error: 'Anabolizante (lista C5): informe o seu CPF em Configurações (Lei 9.965/2000).' };
    if (!context.prescriberPhone) return { error: 'Anabolizante (lista C5): informe o telefone profissional em Configurações (Lei 9.965/2000).' };
    if (!cid) return { error: 'Anabolizante (lista C5): informe o CID (Lei 9.965/2000).' };
  }
  if (justification && !cid) return { error: 'A justificativa de quantidade acima do limite precisa do CID ou do diagnóstico (Portaria 344/98, art. 60).' };
  return { plan: { items, patientAddress: address.slice(0, 300), patientDocumentLine: documentLine, justification, cid, hasC5 } };
}
