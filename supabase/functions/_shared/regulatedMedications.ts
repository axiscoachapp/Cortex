/**
 * Safety net for prescriptions that cannot be issued as a simple prescription.
 * These are curated, NON-EXHAUSTIVE lists of commonly prescribed substances;
 * they catch the frequent cases (including free-text items that never went
 * through the catalog). They do not replace the physician's responsibility.
 *
 * - Controlled substances: Portaria SVS/MS 344/1998 (lists A, B and C), which
 *   require a Notificação de Receita or a Receituário de Controle Especial.
 * - Antimicrobials: RDC Anvisa 471/2021 (two copies, retention, 10-day validity).
 */

const CONTROLLED = [
  // A1/A2/A3 — entorpecentes e psicotrópicos (Notificação de Receita A)
  'morfina', 'codeina', 'tramadol', 'oxicodona', 'metadona', 'fentanil', 'petidina', 'meperidina', 'buprenorfina',
  'nalbufina', 'tapentadol', 'hidromorfona', 'metilfenidato', 'lisdexanfetamina', 'anfetamina', 'dexanfetamina',
  // B1/B2 — psicotrópicos (Notificação de Receita B)
  'alprazolam', 'bromazepam', 'clonazepam', 'diazepam', 'lorazepam', 'midazolam', 'nitrazepam', 'flunitrazepam',
  'clobazam', 'cloxazolam', 'zolpidem', 'zopiclona', 'eszopiclona', 'fenobarbital', 'sibutramina', 'anfepramona',
  'femproporex', 'mazindol',
  // C1 — controle especial
  'amitriptilina', 'nortriptilina', 'imipramina', 'clomipramina', 'fluoxetina', 'sertralina', 'paroxetina',
  'citalopram', 'escitalopram', 'fluvoxamina', 'venlafaxina', 'desvenlafaxina', 'duloxetina', 'bupropiona',
  'trazodona', 'mirtazapina', 'agomelatina', 'vortioxetina', 'gabapentina', 'pregabalina', 'carbamazepina',
  'oxcarbazepina', 'acido valproico', 'valproato', 'divalproato', 'lamotrigina', 'topiramato', 'levetiracetam',
  'fenitoina', 'quetiapina', 'risperidona', 'olanzapina', 'aripiprazol', 'haloperidol', 'clorpromazina',
  'ziprasidona', 'paliperidona', 'clozapina', 'litio', 'misoprostol', 'biperideno',
  // C2 — retinoides sistêmicos
  'isotretinoina', 'acitretina',
  // C3 — imunossupressores
  'talidomida',
  // C5 — anabolizantes
  'testosterona', 'nandrolona', 'oxandrolona', 'estanozolol', 'metandrostenolona', 'mesterolona',
];

const ANTIMICROBIALS = [
  'amoxicilina', 'ampicilina', 'penicilina', 'benzilpenicilina', 'azitromicina', 'claritromicina', 'eritromicina',
  'cefalexina', 'cefadroxila', 'cefuroxima', 'ceftriaxona', 'cefaclor', 'cefepima', 'ciprofloxacino',
  'levofloxacino', 'norfloxacino', 'moxifloxacino', 'ofloxacino', 'nitrofurantoina', 'fosfomicina', 'metronidazol',
  'secnidazol', 'tinidazol', 'sulfametoxazol', 'trimetoprima', 'doxiciclina', 'tetraciclina', 'minociclina',
  'clindamicina', 'gentamicina', 'linezolida', 'vancomicina', 'ceftazidima', 'cefazolina',
];

// Common Brazilian spellings that differ from the DCB name.
const SPELLINGS: Record<string, string> = {
  ciprofloxacina: 'ciprofloxacino', levofloxacina: 'levofloxacino', norfloxacina: 'norfloxacino',
  moxifloxacina: 'moxifloxacino', ofloxacina: 'ofloxacino',
};

// Frequent brand names, so a free-text item (or a catalog that was not
// refreshed) is still caught. The server also checks the Anvisa catalog's
// active ingredient; this list is only the fallback.
const BRANDS: Record<string, string> = {
  // controlled
  rivotril: 'clonazepam', frontal: 'alprazolam', lexotan: 'bromazepam', valium: 'diazepam', dormonid: 'midazolam',
  stilnox: 'zolpidem', tylex: 'codeina', tramal: 'tramadol', ritalina: 'metilfenidato', concerta: 'metilfenidato',
  venvanse: 'lisdexanfetamina', roacutan: 'isotretinoina', cytotec: 'misoprostol', prozac: 'fluoxetina',
  zoloft: 'sertralina', lexapro: 'escitalopram', wellbutrin: 'bupropiona', lyrica: 'pregabalina',
  tegretol: 'carbamazepina', depakote: 'divalproato', seroquel: 'quetiapina', risperdal: 'risperidona',
  // antimicrobial
  amoxil: 'amoxicilina', clavulin: 'amoxicilina', zitromax: 'azitromicina', keflex: 'cefalexina',
  cipro: 'ciprofloxacino', floxacin: 'norfloxacino', macrodantina: 'nitrofurantoina', monuril: 'fosfomicina',
  flagyl: 'metronidazol', secnidal: 'secnidazol', bactrim: 'sulfametoxazol', benzetacil: 'benzilpenicilina',
  vibramicina: 'doxiciclina', dalacin: 'clindamicina',
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function matches(name: string, list: string[]): string[] {
  // "Clonazepam2mg" -> "clonazepam 2 mg": a glued dose must not hide the drug.
  const words = normalize(name)
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => SPELLINGS[w] ?? BRANDS[w] ?? w);
  const value = ` ${words.join(' ')} `;
  return list.filter((substance) => value.includes(` ${substance} `));
}

export function controlledSubstancesIn(name: string): string[] {
  return matches(name, CONTROLLED);
}

/**
 * Portaria SVS/MS 344/98, Annex I (list in force: RDC 1.023/2026). Review on
 * every list update. Only C1 and C5, plus the dose "adendos" below, may go on
 * the Receita de Controle Especial (art. 55); the others need a numbered
 * notification printed from the health authority's numbering (art. 35).
 */
const LIST: Record<string, 'A1' | 'A2' | 'A3' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3' | 'C5'> = {
  morfina: 'A1', metadona: 'A1', fentanil: 'A1', petidina: 'A1', meperidina: 'A1', oxicodona: 'A1', hidromorfona: 'A1',
  tapentadol: 'A1', buprenorfina: 'A1',
  codeina: 'A2', tramadol: 'A2', nalbufina: 'A2',
  metilfenidato: 'A3', lisdexanfetamina: 'A3', anfetamina: 'A3', dexanfetamina: 'A3',
  alprazolam: 'B1', bromazepam: 'B1', clonazepam: 'B1', diazepam: 'B1', lorazepam: 'B1', midazolam: 'B1', nitrazepam: 'B1',
  flunitrazepam: 'B1', clobazam: 'B1', cloxazolam: 'B1', zolpidem: 'B1', zopiclona: 'B1', eszopiclona: 'B1', fenobarbital: 'B1',
  sibutramina: 'B2', anfepramona: 'B2', femproporex: 'B2', mazindol: 'B2',
  isotretinoina: 'C2', acitretina: 'C2',
  talidomida: 'C3',
  testosterona: 'C5', nandrolona: 'C5', oxandrolona: 'C5', estanozolol: 'C5', metandrostenolona: 'C5', mesterolona: 'C5',
};

export type ControlledForm =
  | 'receita_controle_especial'
  | 'notificacao_a'
  | 'notificacao_b'
  | 'notificacao_b2'
  | 'notificacao_especial_retinoides'
  | 'notificacao_talidomida'
  | 'uso_hospitalar';

export interface ControlledFinding {
  substance: string;
  list: 'A1' | 'A2' | 'A3' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3' | 'C5';
  form: ControlledForm;
  note?: string;
}

/** Highest "N mg" in the item text; null when no dose is written. */
function maxMg(name: string): number | null {
  const doses = [...normalize(name).replace(/,/g, '.').matchAll(/(\d+(?:\.\d+)?)\s*mg\b/g)].map((m) => Number(m[1]));
  return doses.length ? Math.max(...doses) : null;
}

/**
 * Which controlled substances an item has and which form each one needs.
 * Dose adendos: codeine and tramadol up to 100 mg per unit (A2, adendos 2/3)
 * and phenobarbital (B1, adendo) go on the Receita de Controle Especial.
 * Misoprostol (C1) is restricted to registered hospitals.
 */
export function controlledFindings(name: string): ControlledFinding[] {
  return [...new Set(controlledSubstancesIn(name))].map((substance): ControlledFinding => {
    const list = LIST[substance] ?? 'C1';
    if (substance === 'misoprostol') return { substance, list, form: 'uso_hospitalar', note: 'uso restrito a hospitais cadastrados' };
    if (substance === 'codeina' || substance === 'tramadol') {
      const mg = maxMg(name);
      return mg != null && mg <= 100
        ? { substance, list, form: 'receita_controle_especial', note: 'até 100 mg por unidade (adendo da lista A2)' }
        : { substance, list, form: 'notificacao_a', note: mg == null ? 'informe a dose: até 100 mg por unidade vai em receita de controle especial' : 'acima de 100 mg por unidade' };
    }
    if (substance === 'fenobarbital') return { substance, list, form: 'receita_controle_especial', note: 'adendo da lista B1' };
    const form: ControlledForm =
      list === 'C1' || list === 'C5' ? 'receita_controle_especial'
        : list === 'A1' || list === 'A2' || list === 'A3' ? 'notificacao_a'
        : list === 'B1' ? 'notificacao_b'
        : list === 'B2' ? 'notificacao_b2'
        : list === 'C2' ? 'notificacao_especial_retinoides'
        : 'notificacao_talidomida';
    return { substance, list, form };
  });
}

/** Plain-language name of each form, for refusal messages. */
export const FORM_LABEL: Record<ControlledForm, string> = {
  receita_controle_especial: 'Receita de Controle Especial',
  notificacao_a: 'Notificação de Receita A (amarela, talão numerado)',
  notificacao_b: 'Notificação de Receita B (azul, talão numerado)',
  notificacao_b2: 'Notificação de Receita B2 (azul, talão numerado)',
  notificacao_especial_retinoides: 'Notificação de Receita Especial para retinoides (talão numerado)',
  notificacao_talidomida: 'Notificação de Receita de Talidomida',
  uso_hospitalar: 'uso restrito a hospitais cadastrados; não pode ser prescrito em consultório',
};

export function antimicrobialsIn(name: string): string[] {
  return matches(name, ANTIMICROBIALS);
}

// ---------------------------------------------------------------------------
// Receita de Controle Especial (D8): pure rules shared by generate-prescription
// and the composer. Contract: docs/prescriptions/RECEITA_CONTROLE_ESPECIAL.md
// (Portaria 344/98 arts. 52, 55, 57, 59, 60; Lei 5.991/73 art. 35; Lei
// 9.965/2000 for C5). Kept in this module so the edge test harnesses, which
// map each imported module, need no new entry.

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

/** `ingredients`: active ingredients from the Anvisa catalog for a brand name. */
export interface ControlledItemInput { name: string; dosage?: string; instructions?: string; quantity?: unknown; unit?: unknown; ingredients?: string[] }

/** Findings from the item name and, for a brand, from its catalog ingredients
 *  (read with the name so a dose like "30 mg" still counts for the adendos). */
function findingsOf(m: ControlledItemInput): ControlledFinding[] {
  const all = [m.name, ...(m.ingredients ?? []).map((i) => `${i} ${m.name}`)].flatMap(controlledFindings);
  const bySubstance = new Map<string, ControlledFinding>();
  for (const f of all) if (!bySubstance.has(f.substance)) bySubstance.set(f.substance, f);
  return [...bySubstance.values()];
}
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
    const findings = findingsOf(m);
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

/**
 * Make text drawable with the PDF standard fonts (WinAnsi). Unsupported
 * characters used to abort the whole issuance with a 500.
 */
const REPLACEMENTS: Record<string, string> = {
  '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '⇒': '=>', '✓': 'v', '✔': 'v', '✗': 'x', '−': '-', '×': 'x',
  'α': 'alfa', 'β': 'beta', 'γ': 'gama', 'δ': 'delta', 'µ': 'µ', 'μ': 'µ', '₂': '2', '₃': '3', '²': '²', '³': '³',
  ' ': ' ', ' ': ' ', ' ': ' ',
};
const WIN_ANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
export function toWinAnsi(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) out += char;
    else if (char === '\n' || char === '\t') out += ' ';
    else if (REPLACEMENTS[char] !== undefined) out += REPLACEMENTS[char];
    else {
      const stripped = char.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const base = stripped.codePointAt(0) ?? 0;
      out += stripped && base >= 0x20 && base <= 0xff ? stripped : '?';
    }
  }
  return out;
}
