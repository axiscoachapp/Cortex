import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentComposerModal } from './DocumentComposerModal';
import type { Patient } from '@/types/patient';

const settings = vi.hoisted(() => ({ value: { prescriber: { professionalPhone: '' }, isLoading: false } }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => settings.value }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));
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
