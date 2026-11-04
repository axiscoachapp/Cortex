import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentComposerModal } from './DocumentComposerModal';
import type { Patient } from '@/types/patient';

const settings = vi.hoisted(() => ({ value: { prescriber: { professionalPhone: '' }, isLoading: false } }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => settings.value }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));
vi.mock('@/hooks/useDocumentSnippets', () => ({
  useDocumentSnippets: () => ({
    snippets: [
      {
        id: 'snippet-uti',
        name: 'Infecção urinária',
        revision: 1,
        items: [{ name: 'Nitrofurantoína 100 mg', dosage: '1 cápsula', instructions: 'de 6 em 6 horas por 5 dias' }],
      },
      {
        id: 'snippet-pain',
        name: 'Dor leve',
        revision: 1,
        items: [{ name: 'Medicamento sintético C', dosage: '1 comprimido', instructions: 'se dor' }],
      },
    ],
    isLoading: false,
    isError: false,
    retry: () => {},
    saveSnippet: async () => ({ id: 'x', revision: 1 }),
    archiveSnippet: async () => {},
    isSaving: false,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = { select: () => query, or: () => query, limit: async () => ({ data: [], error: null }) };
      return query;
    },
  },
}));

const person = (extra: Partial<Patient> = {}): Patient => ({
  id: 'synthetic-patient',
  name: 'Pessoa sintética',
  age: null,
  dateOfBirth: '1990-05-10',
  profession: '',
  lastVisit: null,
  status: 'novo',
  diagnoses: [],
  medications: [{ name: 'Amoxicilina 500 mg', dosage: '1 cápsula', instructions: 'de 8 em 8 horas' }],
  allergies: [],
  ...extra,
});

async function openAntimicrobial(patient: Patient) {
  render(<DocumentComposerModal open onOpenChange={() => {}} patient={patient} onGenerate={async () => {}} isGenerating={false} />);
  await userEvent.setup().click(screen.getByRole('button', { name: /Antimicrobiano/ }));
}

describe('Antimicrobial prescription requirements (RDC 471/2021)', () => {
  it('lists every missing item before generating', async () => {
    settings.value = { prescriber: { professionalPhone: '' }, isLoading: false };
    await openAntimicrobial(person({ dateOfBirth: undefined, sex: 'nao_informado' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A receita de antimicrobiano exige seu telefone profissional (Configurações), a idade ou data de nascimento do paciente e o sexo do paciente. Complete antes de gerar (RDC 471/2021).',
    );
  });

  it('shows nothing when phone, age and sex are present', async () => {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000' }, isLoading: false };
    await openAntimicrobial(person({ sex: 'feminino' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not blame the phone while settings are still loading', async () => {
    settings.value = { prescriber: { professionalPhone: '' }, isLoading: true };
    await openAntimicrobial(person({ sex: 'masculino' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// R2: applying a template never removes a selected medication without an
// explicit choice, and cancel keeps the selection, doses and instructions.
describe('Prescription templates in the composer', () => {
  const A = { name: 'Medicamento sintético A', dosage: '1', instructions: 'x' };
  const UTI = { name: 'Nitrofurantoína 100 mg', dosage: '1 cápsula', instructions: 'de 6 em 6 horas por 5 dias' };
  const PAIN = { name: 'Medicamento sintético C', dosage: '1 comprimido', instructions: 'se dor' };
  function setup() {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000' }, isLoading: false };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    render(
      <DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino', medications: [A] })} onGenerate={onGenerate} isGenerating={false} />,
    );
    const user = userEvent.setup();
    const choose = (id: string) => user.selectOptions(screen.getByLabelText('Modelos de receita'), id);
    const generate = async () => {
      await user.click(screen.getByRole('button', { name: /Gerar/ }));
      return onGenerate.mock.calls.at(-1)?.[0];
    };
    return { user, choose, generate };
  }

  it('cancel keeps the selected medication in the prescription', async () => {
    const { user, choose, generate } = setup();
    await choose('snippet-uti');
    expect(screen.getByRole('group', { name: 'Como aplicar o modelo' })).toHaveTextContent('Há 1 medicamento selecionado: Medicamento sintético A.');
    await user.click(screen.getByRole('button', { name: 'Manter a seleção' }));
    expect(await generate()).toMatchObject({ docType: 'receita_simples', medications: [A] });
  });

  it('replaces the selection only when the doctor says so, and suggests the antimicrobial type', async () => {
    const { user, choose, generate } = setup();
    await choose('snippet-uti');
    await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));
    expect(screen.getByRole('button', { name: /Antimicrobiano/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('no lugar de 1 medicamento, que ficou desmarcado na lista');
    expect(await generate()).toMatchObject({ docType: 'receita_antimicrobiano', medications: [UTI] });
  });

  it('asks again when switching from one template to another', async () => {
    const { user, choose, generate } = setup();
    await choose('snippet-pain');
    await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));
    await choose('snippet-uti');
    expect(screen.getByRole('group', { name: 'Como aplicar o modelo' })).toHaveTextContent('Medicamento sintético C');
    await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));
    expect(await generate()).toMatchObject({ medications: [UTI] });
  });

  it('can add the template beside the current selection', async () => {
    const { user, choose, generate } = setup();
    await choose('snippet-pain');
    await user.click(screen.getByRole('button', { name: 'Adicionar aos selecionados' }));
    expect(await generate()).toMatchObject({ docType: 'receita_simples', medications: [A, PAIN] });
  });
});
