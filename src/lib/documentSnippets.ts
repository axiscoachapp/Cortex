// Prescription templates (document_snippets, migrations 20261104110000 and
// 20261105110000 for compounded formulas): pure helpers shared by the hook,
// the picker and their tests.
import { formulaError, type CompoundedFormula } from '../../supabase/functions/_shared/regulatedMedications';

export interface SnippetItem {
  name: string;
  dosage: string;
  instructions: string;
  /** Compounded formula (manipulado), same shape and rules as the server. */
  formula?: CompoundedFormula;
}

export interface DocumentSnippet {
  id: string;
  name: string;
  items: SnippetItem[];
  revision: number;
}

/** Defensive read of the jsonb column: drop anything that is not a named item. */
export function parseSnippetItems(value: unknown): SnippetItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || !row.name.trim()) return [];
    return [{
      name: row.name.trim(),
      dosage: typeof row.dosage === 'string' ? row.dosage : '',
      instructions: typeof row.instructions === 'string' ? row.instructions : '',
      // A stored formula that no longer passes the rules is dropped, not guessed.
      ...(row.formula !== undefined && formulaError(row.formula) === null ? { formula: row.formula as CompoundedFormula } : {}),
    }];
  });
}

/** Items to store from the composer selection; null when it cannot be a template. */
export function snippetItemsFrom(selection: Array<{ name: string; dosage?: string; instructions?: string; formula?: CompoundedFormula }>): SnippetItem[] | null {
  const items = selection
    .filter((m) => m.name?.trim() && (m.formula === undefined || formulaError(m.formula) === null))
    .map((m) => ({
      name: m.name.trim(), dosage: (m.dosage ?? '').trim(), instructions: (m.instructions ?? '').trim(),
      ...(m.formula ? { formula: m.formula } : {}),
    }));
  return items.length >= 1 && items.length <= 15 && items.length === selection.length ? items : null;
}

/** User-facing message for an RPC refusal. Server messages are already Portuguese. */
export function snippetErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const message = error?.message ?? '';
  switch (error?.code) {
    case '22023':
    case 'P0002':
    case '55000':
    case '54000':
      return message || 'Não foi possível salvar o modelo.';
    case '40001':
      return /outra sessão/.test(message) ? message : 'Outra operação estava em andamento. Tente de novo.';
    case '42501':
      return 'Esta sessão não pode alterar modelos. Entre novamente com o segundo fator.';
    default:
      return 'Não foi possível salvar o modelo. Tente novamente.';
  }
}
