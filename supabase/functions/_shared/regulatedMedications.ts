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

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function matches(name: string, list: string[]): string[] {
  const value = ` ${normalize(name).replace(/[^a-z0-9]+/g, ' ')} `;
  return list.filter((substance) => value.includes(` ${substance} `));
}

export function controlledSubstancesIn(name: string): string[] {
  return matches(name, CONTROLLED);
}

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
