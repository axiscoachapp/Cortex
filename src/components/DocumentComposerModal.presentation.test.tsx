// CMED presentation picker in the composer: fills the strength and suggests
// the unit, never prints the CMED text. Synthetic product; the presentation
// texts follow the official list's format (public data).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentComposerModal } from './DocumentComposerModal';
import type { Patient } from '@/types/patient';

const db = vi.hoisted(() => ({ presentationFilters: [] as Array<[string, unknown]>, failPresentations: false }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ prescriber: { professionalPhone: '', prescriberCpf: '' }, isLoading: false }) }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));
vi.mock('@/hooks/useDocumentSnippets', () => ({
  useDocumentSnippets: () => ({ snippets: [], isLoading: false, isError: false, retry: () => {}, saveSnippet: async () => ({ id: 'x', revision: 1 }), archiveSnippet: async () => {}, isSaving: false }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'or', 'neq', 'ilike', 'like', 'order']) query[op] = () => query;
      query.eq = (column: string, value: unknown) => { if (table === 'medication_presentations') db.presentationFilters.push([column, value]); return query; };
      query.limit = async () => {
        if (table === 'medication_catalog') {
          return { data: [{ id: 1, product_name: 'PRODUTO SINTÉTICO', active_ingredient: 'substância sintética', therapeutic_class: null, is_antimicrobial: false, anvisa_registration: '1.2345.6789' }], error: null };
        }
        if (table === 'medication_presentations') {
          if (db.failPresentations) return { data: null, error: new Error('offline') };
          return {
            data: [
              { presentation: '50 MG COM REV CT BL AL PLAS TRANS X 30', hospital_only: false },
              { presentation: '50 MG COM REV CT BL AL PLAS TRANS X 60', hospital_only: false },
              { presentation: '100 MG COM REV CT BL AL PLAS TRANS X 30', hospital_only: false },
              { presentation: '100 MG COM REV CT BL AL PLAS TRANS X 500', hospital_only: true },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      return query;
    },
  },
}));

const patient: Patient = {
  id: 'synthetic-patient', name: 'Pessoa sintética', age: null, dateOfBirth: '1990-05-10', profession: '', lastVisit: null,
  status: 'novo', diagnoses: [], medications: [], allergies: [],
};

async function addProduct() {
  render(<DocumentComposerModal open onOpenChange={() => {}} patient={patient} onGenerate={async () => {}} isGenerating={false} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Buscar medicamento na base Anvisa'), 'sint');
  await user.click(await screen.findByRole('button', { name: /PRODUTO SINTÉTICO/ }));
  return user;
}

describe('CMED presentation of a catalog medication', { timeout: 20000 }, () => {
  it('offers one option per strength and form, from the product registration, without hospital-only rows', async () => {
    db.presentationFilters = []; db.failPresentations = false;
    await addProduct();
    const picker = await screen.findByLabelText('Apresentação de Produto Sintético');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Concentração e forma (lista CMED, opcional)', '50 mg · comprimido revestido', '100 mg · comprimido revestido',
    ]);
    expect(db.presentationFilters).toContainEqual(['registration9', '123456789']);
  });

  it('adds the strength to the name and suggests the dose unit; the CMED text never appears', async () => {
    db.failPresentations = false;
    const user = await addProduct();
    await user.selectOptions(await screen.findByLabelText('Apresentação de Produto Sintético'), '50 mg · comprimido revestido');
    expect(screen.getByText('Produto Sintético 50 mg')).toBeInTheDocument();
    expect(screen.getByLabelText('Dose de Produto Sintético 50 mg')).toHaveAttribute('placeholder', 'ex.: 1 comprimido');
    expect(screen.queryByText(/CT BL AL/)).toBeNull();
    // Another choice replaces it; clearing restores the name.
    await user.selectOptions(screen.getByLabelText('Apresentação de Produto Sintético'), '100 mg · comprimido revestido');
    expect(screen.getByText('Produto Sintético 100 mg')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Apresentação de Produto Sintético'), 'Concentração e forma (lista CMED, opcional)');
    expect(screen.getByText('Produto Sintético')).toBeInTheDocument();
  });

  it('fills the strength and unit of the controlled-substance prescription when they are empty', async () => {
    db.failPresentations = false;
    const user = await addProduct();
    await user.selectOptions(await screen.findByLabelText('Apresentação de Produto Sintético'), '50 mg · comprimido revestido');
    await user.click(screen.getByRole('button', { name: /Controle especial/ }));
    expect(screen.getByLabelText('Concentração de Produto Sintético 50 mg')).toHaveValue('50 mg');
    expect(screen.getByLabelText('Unidade de Produto Sintético 50 mg')).toHaveValue('comprimidos');
    expect(screen.getByLabelText('Quantidade de Produto Sintético 50 mg')).toHaveValue(null); // the quantity is the doctor's
  });

  it('without presentations the item stays as before', async () => {
    db.failPresentations = true;
    await addProduct();
    expect(await screen.findByText('Produto Sintético')).toBeInTheDocument();
    expect(screen.queryByLabelText('Apresentação de Produto Sintético')).toBeNull();
  });
});
