// "Gerar e assinar" in the document composer (D17): shown only when signing
// is configured and the type is signed in Phase 1; usable only with an open
// session; the normal "Gerar documento" stays. Synthetic patient only.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentComposerModal } from './DocumentComposerModal';
import type { Patient } from '@/types/patient';

vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ prescriber: { professionalPhone: '', prescriberCpf: '' }, isLoading: false }) }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));
vi.mock('@/hooks/useDocumentSnippets', () => ({
  useDocumentSnippets: () => ({
    snippets: [], isLoading: false, isError: false, retry: () => {},
    saveSnippet: async () => ({ id: 'x', revision: 1 }), archiveSnippet: async () => {}, isSaving: false,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'or', 'neq', 'ilike', 'like', 'order']) query[op] = () => query;
      query.limit = async () => ({ data: [], error: null });
      return query;
    },
  },
}));

const patient: Patient = {
  id: 'synthetic-patient', name: 'Pessoa sintética', age: null, dateOfBirth: '1990-05-10', profession: '',
  lastVisit: null, status: 'novo', diagnoses: [], medications: [], allergies: [],
};
const composer = (signing: { active: boolean } | null, onGenerate = vi.fn(async (payload: Record<string, unknown>) => { void payload; })) => {
  render(<DocumentComposerModal open onOpenChange={() => {}} patient={patient} onGenerate={onGenerate} isGenerating={false} signing={signing} />);
  return onGenerate;
};
const pickType = async (label: RegExp) => userEvent.click(screen.getByRole('button', { name: label }));

describe('Gerar e assinar', () => {
  it('generates and signs a sick note with an open session; "Gerar documento" stays as it was', async () => {
    const onGenerate = composer({ active: true });
    await pickType(/^Atestado médico/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar e assinar' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ docType: 'atestado', sign: true });
    await userEvent.click(screen.getByRole('button', { name: 'Gerar documento' }));
    expect(onGenerate.mock.calls[1][0]).not.toHaveProperty('sign');
  });

  it('without an open session the action is disabled and says how to open one', async () => {
    const onGenerate = composer({ active: false });
    await pickType(/^Atestado médico/);
    expect(screen.getByRole('button', { name: 'Gerar e assinar' })).toBeDisabled();
    expect(screen.getByText(/abra a sessão de assinatura \(com o segundo fator ativo\) na lista de documentos/)).toBeInTheDocument();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('is not offered when signing is not configured, nor for types signed only in Phase 2', async () => {
    composer(null);
    await pickType(/^Atestado médico/);
    expect(screen.queryByRole('button', { name: 'Gerar e assinar' })).not.toBeInTheDocument();
  });

  it('is not offered for controlled or antimicrobial prescriptions', async () => {
    composer({ active: true });
    await pickType(/^Antimicrobiano/);
    expect(screen.queryByRole('button', { name: 'Gerar e assinar' })).not.toBeInTheDocument();
    await pickType(/^Controle especial/);
    expect(screen.queryByRole('button', { name: 'Gerar e assinar' })).not.toBeInTheDocument();
  });
});
