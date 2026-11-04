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
