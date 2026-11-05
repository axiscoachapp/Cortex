// CMED presentations (Anvisa price list, public data) as a helper for the
// prescription item. Contract in docs/prescriptions/CATALOGOS_E_MANIPULADOS.md:
// the abbreviated text ("50 MG COM REV CT BL AL X 30") is never printed; it
// only fills the strength and suggests the unit. Anything the parser cannot
// read with confidence (no strength, kits, unknown forms) is left out.

export interface ParsedPresentation {
  /** As written on a prescription: "50 mg", "2,5 mg/mL", "3 mg + 0,03 mg". */
  strength: string;
  /** Pharmaceutical form in words: "comprimido revestido". */
  form: string;
  /** Plural unit for the dispensed quantity (RCE): "comprimidos", "frascos". */
  unit: string | null;
  /** Singular unit of one dose, when it is countable: "comprimido". */
  doseUnit: string | null;
}

export interface PresentationOption extends ParsedPresentation {
  key: string;
  label: string;
}

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const UNIT = String.raw`(?:MCG|MG|MEQ|MMOL|MUI|ML|NG|KG|KUI|UI|U|G|L|%)`;
const PER = String.raw`(?:\s*/\s*(?:${NUM}\s*)?(?:ML|G|L|DOSE|GOTA|JATO|H))?`;
const AMOUNT = String.raw`(?:\(\s*${NUM}(?:\s*\+\s*${NUM})+\s*\)|${NUM})\s*${UNIT}${PER}`;
// An equivalent in parentheses may follow: "0,5 MEQ/ML (54 MG/ML)".
const TERM = String.raw`${AMOUNT}(?:\s*\(\s*${NUM}\s*${UNIT}${PER}\s*\))?`;
const STRENGTH = new RegExp(String.raw`^(${TERM}(?:\s*\+\s*${TERM})*)\s+(?=[A-Z])`);

const UNIT_TEXT: Record<string, string> = {
  MCG: 'mcg', MG: 'mg', MEQ: 'mEq', MMOL: 'mmol', MUI: 'MUI', ML: 'mL', NG: 'ng', KG: 'kg', KUI: 'KUI', UI: 'UI', U: 'U', G: 'g', L: 'L',
  DOSE: 'dose', GOTA: 'gota', JATO: 'jato', H: 'h',
};

function strengthText(raw: string): string {
  return raw
    .replace(/[A-Z]+/g, (word) => UNIT_TEXT[word] ?? word.toLowerCase())
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/(\d)\s*([a-zA-Z])/g, '$1 $2')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/(\d),0+(?![\d.,])/g, '$1') // "25,0 mg" -> "25 mg"
    .replace(/\s+/g, ' ')
    .trim();
}

// Where the form ends and the packaging begins.
const PACKAGING = new Set(['CT', 'CX', 'FR', 'FA', 'AMP', 'BG', 'PT', 'BL', 'ENV', 'SER', 'EST', 'TB', 'STRIP', 'KIT', 'EMB', 'CJ', 'X', 'DISPLAY', 'BD', 'CAR']);
const RELEASE: Record<string, string> = { PROL: 'prolongada', RETARD: 'retardada', CONTR: 'controlada', MODIF: 'modificada' };
// Spellings of the same abbreviation in the official file.
const ALIAS: Record<string, string> = { SUSP: 'SUS', COMP: 'COM', CR: 'CREM', CREME: 'CREM', XAMP: 'SHAMP', INFU: 'INFUS', EFEV: 'EFERV', INALACAO: 'INAL', OC: 'OFT' };
const TABLET: Record<string, string> = {
  REV: 'revestido', SUBL: 'sublingual', DISP: 'dispersível', EFERV: 'efervescente', MAST: 'mastigável', VAG: 'vaginal', ORODISP: 'orodispersível',
};

type Kind = 'solid' | 'injectable' | 'other';
// Ordered: the first pattern that matches the start of the form wins.
const FORMS: Array<[RegExp, string, Kind, string | null, string | null]> = [
  // pattern, form, kind, plural unit (null: from the packaging), singular dose unit
  [/^DRG\b/, 'drágea', 'solid', 'drágeas', 'drágea'],
  [/^PAST\b/, 'pastilha', 'solid', 'pastilhas', 'pastilha'],
  [/^(OVL|OVU)\b/, 'óvulo', 'solid', 'óvulos', 'óvulo'],
  [/^SUP\b/, 'supositório', 'solid', 'supositórios', 'supositório'],
  [/^ADES\b/, 'adesivo transdérmico', 'solid', 'adesivos', 'adesivo'],
  [/^ANEL VAG\b/, 'anel vaginal', 'solid', 'anéis', 'anel'],
  [/^(SIST LIB INTRAUT|SIU|DIU)\b/, 'sistema intrauterino', 'solid', 'unidades', null],
  [/^IMPL\b/, 'implante', 'solid', 'implantes', 'implante'],
  [/^GOMA\b/, 'goma de mascar', 'solid', 'gomas', 'goma'],
  [/^SOL INJ\b/, 'solução injetável', 'injectable', null, null],
  [/^SUS INJ\b/, 'suspensão injetável', 'injectable', null, null],
  [/^EMU INJ\b/, 'emulsão injetável', 'injectable', null, null],
  [/^PO LIOF (P\/ )?SOL INJ\b/, 'pó liofilizado para solução injetável', 'injectable', null, null],
  [/^PO (P\/ )?SOL INJ\b/, 'pó para solução injetável', 'injectable', null, null],
  [/^PO (P\/ )?SUS INJ\b/, 'pó para suspensão injetável', 'injectable', null, null],
  [/^PO INJ\b/, 'pó injetável', 'injectable', null, null],
  [/^PO LIOF\b.*\b(INJ|INFUS)\b/, 'pó liofilizado injetável', 'injectable', null, null],
  [/^PO (P\/ )?SOL INFUS\b/, 'pó para solução para infusão', 'injectable', null, null],
  [/^(SOL|SUS) INFUS\b/, 'solução para infusão', 'injectable', null, null],
  [/^SOL DIL\b/, 'solução para diluição', 'injectable', null, null],
  [/^SOL OR\b/, 'solução oral', 'other', null, null],
  [/^SUS OR\b/, 'suspensão oral', 'other', null, null],
  [/^EMU OR\b/, 'emulsão oral', 'other', null, null],
  [/^PO (P\/ )?SUS OR\b/, 'pó para suspensão oral', 'other', null, null],
  [/^XPE\b/, 'xarope', 'other', null, null],
  [/^ELX\b/, 'elixir', 'other', null, null],
  [/^SUS GOT OR\b/, 'suspensão oral', 'other', null, null],
  [/^SOL (GOT )?OFT\b/, 'solução oftálmica', 'other', null, null],
  [/^SUS (GOT )?OFT\b/, 'suspensão oftálmica', 'other', null, null],
  [/^POM OFT\b/, 'pomada oftálmica', 'other', null, null],
  [/^((SOL|SUS) )?SPR NAS\b/, 'spray nasal', 'other', null, null],
  [/^SOL NAS\b/, 'solução nasal', 'other', null, null],
  [/^SUS (AQUOSA )?NAS\b/, 'suspensão nasal', 'other', null, null],
  [/^(SOL|SUS) INAL\b/, 'solução para inalação', 'other', null, null],
  [/^PO INAL\b/, 'pó para inalação', 'other', null, null],
  [/^EMU\b/, 'emulsão', 'other', null, null],
  [/^SHAMP\b/, 'xampu', 'other', null, null],
  [/^SAB\b/, 'sabonete', 'other', null, null],
  [/^CREM VAG\b/, 'creme vaginal', 'other', null, null],
  [/^GEL VAG\b/, 'gel vaginal', 'other', null, null],
  [/^CREM\b/, 'creme', 'other', null, null],
  [/^POM\b/, 'pomada', 'other', null, null],
  [/^GEL\b/, 'gel', 'other', null, null],
  [/^LOC\b/, 'loção', 'other', null, null],
  [/^SOL CAPI?\b/, 'solução capilar', 'other', null, null],
  [/^SOL (TOP|DERM)\b/, 'solução tópica', 'other', null, null],
  [/^SPR\b/, 'spray', 'other', null, null],
  [/^AER\b/, 'aerossol', 'other', null, null],
  [/^GRAN\b/, 'granulado', 'other', null, null],
  [/^PO EFERV\b/, 'pó efervescente', 'other', null, null],
  [/^SUS\b/, 'suspensão', 'other', null, null],
];

const CONTAINERS: Record<Kind, Record<string, string>> = {
  injectable: { AMP: 'ampolas', FA: 'frascos-ampola', SER: 'seringas', CAR: 'carpules', FR: 'frascos' },
  other: { BG: 'bisnagas', PT: 'potes', TB: 'tubos', ENV: 'envelopes', FR: 'frascos' },
  solid: {},
};

/** The product's own container: the first one named (a diluent listed later does not count). */
function packagingUnit(tokens: string[], kind: Kind): string | null {
  for (const token of tokens) if (CONTAINERS[kind][token]) return CONTAINERS[kind][token];
  return null;
}

/** Strength, form and units of a CMED presentation text, or null when not read with confidence. */
export function parsePresentation(text: string | null | undefined): ParsedPresentation | null {
  const upper = (text ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const match = STRENGTH.exec(upper);
  if (!match) return null;
  const tokens = upper.slice(match[0].length).split(' ').map((t) => ALIAS[t] ?? t);
  const end = tokens.findIndex((t) => PACKAGING.has(t));
  const formTokens = end < 0 ? tokens : tokens.slice(0, end);
  const phrase = formTokens.join(' ');
  if (!phrase || /\+\s*\d/.test(phrase)) return null; // kits: several products in one box
  const packaging = end < 0 ? [] : tokens.slice(end);
  const strength = strengthText(match[1]);
  const release = / LIB (PROL|RETARD|CONTR|MODIF)\b/.exec(phrase);
  const releaseText = release ? ` de liberação ${RELEASE[release[1]]}` : '';
  if (/^COM\b/.test(phrase)) {
    const qualifier = TABLET[formTokens[1] ?? ''];
    return { strength, form: `comprimido${qualifier ? ` ${qualifier}` : ''}${releaseText}`, unit: 'comprimidos', doseUnit: 'comprimido' };
  }
  if (/^CAP\b/.test(phrase)) {
    const vaginal = formTokens.includes('VAG') ? ' vaginal' : '';
    return { strength, form: `cápsula${vaginal}${releaseText}`, unit: 'cápsulas', doseUnit: 'cápsula' };
  }
  for (const [pattern, form, kind, unit, doseUnit] of FORMS) {
    if (pattern.test(phrase)) return { strength, form, unit: unit ?? packagingUnit(packaging, kind), doseUnit };
  }
  return null;
}

const leadingNumber = (strength: string) => Number((/\d+(?:[.,]\d+)*/.exec(strength)?.[0] ?? '0').replace(/\./g, '').replace(',', '.'));

/** One option per strength and form, in numeric order; hospital-only and unreadable rows are left out. */
export function presentationOptions(rows: Array<{ presentation: string | null; hospital_only: boolean }>): PresentationOption[] {
  const options = new Map<string, PresentationOption>();
  for (const row of rows) {
    if (row.hospital_only) continue;
    const parsed = parsePresentation(row.presentation);
    if (!parsed) continue;
    const key = `${parsed.strength}|${parsed.form}|${parsed.unit ?? ''}`;
    if (!options.has(key)) options.set(key, { ...parsed, key, label: `${parsed.strength} · ${parsed.form}` });
  }
  return [...options.values()].sort((a, b) => leadingNumber(a.strength) - leadingNumber(b.strength) || a.label.localeCompare(b.label, 'pt-BR'));
}

/** The 9-digit Anvisa product registration (CMED REGISTRO has 13: product + presentation). */
export function registration9Of(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(0, 9) : null;
}

export interface PresentationTarget {
  name: string;
  baseName?: string;
  presentationKey?: string;
  concentration?: string;
  unit?: string;
  doseUnit?: string;
}

const HAS_STRENGTH = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ui|ml|%)(?![a-z])/i;

/**
 * Applies a chosen option (or clears it): the strength goes after the name
 * unless the name already has one, and the strength and unit fields are
 * filled only when empty or still holding what the previous choice filled.
 */
export function applyPresentation<T extends PresentationTarget>(item: T, option: PresentationOption | null): T {
  const base = item.baseName ?? item.name;
  const [previousStrength = '', , previousUnit = ''] = item.presentationKey?.split('|') ?? [];
  const replace = (current: string | undefined, previous: string, next: string) =>
    !current?.trim() || current === previous ? next : current;
  return {
    ...item,
    name: option && !HAS_STRENGTH.test(base) ? `${base} ${option.strength}` : base,
    baseName: option ? base : undefined,
    presentationKey: option?.key,
    concentration: replace(item.concentration, previousStrength, option?.strength ?? ''),
    unit: replace(item.unit, previousUnit, option?.unit ?? ''),
    doseUnit: option?.doseUnit ?? undefined,
  };
}
