import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentComposerModal } from './DocumentComposerModal';
import type { Patient } from '@/types/patient';

const settings = vi.hoisted(() => ({ value: { prescriber: { professionalPhone: '', prescriberCpf: '' } as { professionalPhone: string; prescriberCpf?: string }, isLoading: false } }));
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
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'or', 'neq', 'ilike', 'like', 'order']) query[op] = () => query;
      query.limit = async () => ({ data: table === 'exam_catalog' ? [{ code: '40304361', name: 'Exame laboratorial sintético' }] : [], error: null });
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

// Profile medications start unchecked: the doctor picks what goes on each prescription.
function checkProfileMedications() {
  for (const box of screen.queryAllByRole('checkbox')) if (!(box as HTMLInputElement).checked) fireEvent.click(box);
}

async function openAntimicrobial(patient: Patient) {
  render(<DocumentComposerModal open onOpenChange={() => {}} patient={patient} onGenerate={async () => {}} isGenerating={false} />);
  await userEvent.setup().click(screen.getByRole('button', { name: /Antimicrobiano/ }));
}

describe('Antimicrobial prescription requirements (RDC 471/2021)', { timeout: 20000 }, () => {
  it('lists every missing item before generating', async () => {
    settings.value = { prescriber: { professionalPhone: '' }, isLoading: false };
    await openAntimicrobial(person({ dateOfBirth: undefined, sex: 'nao_informado' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A receita de antimicrobiano exige o telefone profissional no cadastro do prescritor (solicite à equipe de implantação), a idade ou data de nascimento do paciente e o sexo do paciente. Complete antes de gerar (RDC 471/2021).',
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
describe('Prescription templates in the composer', { timeout: 20000 }, () => {
  const A = { name: 'Medicamento sintético A', dosage: '1', instructions: 'x' };
  const UTI = { name: 'Nitrofurantoína 100 mg', dosage: '1 cápsula', instructions: 'de 6 em 6 horas por 5 dias' };
  const PAIN = { name: 'Medicamento sintético C', dosage: '1 comprimido', instructions: 'se dor' };
  function setup() {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000' }, isLoading: false };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    render(
      <DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino', medications: [A] })} onGenerate={onGenerate} isGenerating={false} />,
    );
    checkProfileMedications();
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

describe('Composer while generating (R3)', { timeout: 20000 }, () => {
  it('locks the form during generation and keeps the pending template choice for after a failure', async () => {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000' }, isLoading: false };
    const A = { name: 'Medicamento sintético A', dosage: '1', instructions: 'x' };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    const composer = (isGenerating: boolean) => (
      <DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino', medications: [A] })} onGenerate={onGenerate} isGenerating={isGenerating} />
    );
    const user = userEvent.setup();
    const view = render(composer(false));
    checkProfileMedications();
    await user.selectOptions(screen.getByLabelText('Modelos de receita'), 'snippet-uti');

    // Generation starts (e.g. from a second click elsewhere): nothing in the form can change.
    view.rerender(composer(true));
    expect(screen.getByRole('button', { name: 'Substituir a seleção' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adicionar aos selecionados' })).toBeDisabled();
    expect(screen.getByLabelText('Modelos de receita')).toBeDisabled();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: /Antimicrobiano/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));

    // The request failed: the form is back, with the same selection and the choice still open.
    view.rerender(composer(false));
    expect(screen.getByRole('group', { name: 'Como aplicar o modelo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toMatchObject({ docType: 'receita_simples', medications: [A] });

    await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));
    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toMatchObject({
      docType: 'receita_antimicrobiano',
      medications: [{ name: 'Nitrofurantoína 100 mg', dosage: '1 cápsula', instructions: 'de 6 em 6 horas por 5 dias' }],
    });
  });
});

describe('Regulated drug warnings before generating', { timeout: 20000 }, () => {
  it('warns about a controlled drug known only by its brand', async () => {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000' }, isLoading: false };
    render(
      <DocumentComposerModal
        open
        onOpenChange={() => {}}
        patient={person({ sex: 'feminino', medications: [{ name: 'Rivotril 2mg', dosage: '1 comprimido', instructions: 'à noite' }] })}
        onGenerate={async () => {}}
        isGenerating={false}
      />,
    );
    checkProfileMedications();
    expect(screen.getByRole('alert')).toHaveTextContent('Medicamento sujeito a controle especial (clonazepam)');
  });

  it('suggests the antimicrobial type for a brand typed by hand', async () => {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000' }, isLoading: false };
    render(
      <DocumentComposerModal
        open
        onOpenChange={() => {}}
        patient={person({ sex: 'feminino', medications: [{ name: 'Bactrim F', dosage: '1 comprimido', instructions: '12/12 h' }] })}
        onGenerate={async () => {}}
        isGenerating={false}
      />,
    );
    checkProfileMedications();
    expect(screen.getByText(/Há antimicrobiano selecionado/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// D8: Receita de Controle Especial in the composer (synthetic data only).
describe('Receita de Controle Especial (D8)', { timeout: 20000 }, () => {
  it('still generates a valid C5 request after the managed profile is complete', async () => {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000', prescriberCpf: '11144477735' }, isLoading: false };
    const onGenerate = vi.fn();
    render(<DocumentComposerModal open onOpenChange={() => {}} patient={person({ cpf: '11144477735', sex: 'masculino', medications: [{ name: 'Testosterona', dosage: 'Uso sintético', instructions: 'Orientação sintética' }] })} onGenerate={onGenerate} isGenerating={false} />);
    checkProfileMedications();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Usar controle especial' }));
    await user.type(screen.getByLabelText('Concentração de Testosterona'), '1%');
    await user.type(screen.getByLabelText('Quantidade de Testosterona'), '1');
    await user.type(screen.getByLabelText('Unidade de Testosterona'), 'frasco');
    await user.type(screen.getByLabelText(/Endereço do paciente/), 'Endereço sintético 100');
    await user.type(screen.getByLabelText(/CID ou diagnóstico/), 'Z00');
    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ docType: 'receita_controle_especial', content: { cid: 'Z00', patientAddress: 'Endereço sintético 100' } });
  });
  it.each([
    [{ professionalPhone: '(41) 3000-0000', prescriberCpf: '' }, 'CPF'],
    [{ professionalPhone: '', prescriberCpf: '11144477735' }, 'telefone'],
  ])('explains a missing C5 field as implementation work without generating automatically: %s', async (prescriber, field) => {
    settings.value = { prescriber, isLoading: false };
    const onGenerate = vi.fn();
    render(<DocumentComposerModal open onOpenChange={() => {}} patient={person({ cpf: '11144477735', sex: 'masculino', medications: [{ name: 'Testosterona', dosage: 'Uso sintético', instructions: 'Orientação sintética' }] })} onGenerate={onGenerate} isGenerating={false} />);
    checkProfileMedications();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Usar controle especial' }));
    await user.type(screen.getByLabelText('Concentração de Testosterona'), '1%');
    await user.type(screen.getByLabelText('Quantidade de Testosterona'), '1');
    await user.type(screen.getByLabelText('Unidade de Testosterona'), 'frasco');
    await user.type(screen.getByLabelText(/Endereço do paciente/), 'Endereço sintético 100');
    const message = screen.getByText(/Antes de gerar:/);
    expect(message).toHaveTextContent('equipe de implantação'); expect(message).toHaveTextContent(field);
    expect(onGenerate).not.toHaveBeenCalled();
  });
  const SERTRALINE = { name: 'Sertralina', dosage: '1 comprimido', instructions: 'pela manhã' };
  function setup(patient: Partial<Patient> = {}) {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000', prescriberCpf: '' }, isLoading: false };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    render(
      <DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino', medications: [SERTRALINE], ...patient })} onGenerate={onGenerate} isGenerating={false} />,
    );
    checkProfileMedications();
    return { user: userEvent.setup(), onGenerate };
  }

  it('offers the controlled type when every controlled item fits it, and only then', async () => {
    const { user } = setup();
    expect(screen.getByRole('alert')).toHaveTextContent('use o tipo "Controle especial"');
    await user.click(screen.getByRole('button', { name: 'Usar controle especial' }));
    expect(screen.getByRole('button', { name: /Controle especial/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the notification for a drug the RCE cannot carry', () => {
    setup({ medications: [{ name: 'Rivotril 2mg', dosage: '1 comprimido', instructions: 'à noite' }] });
    expect(screen.getByRole('alert')).toHaveTextContent('notificação de receita em talão numerado');
    expect(screen.queryByRole('button', { name: 'Usar controle especial' })).toBeNull();
  });

  it('collects strength, quantity, address and document, checking the same rules as the server', async () => {
    const { user, onGenerate } = setup();
    await user.click(screen.getByRole('button', { name: /Controle especial/ }));
    expect(screen.getByText(/Antes de gerar: Informe a concentração de Sertralina/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Concentração de Sertralina'), '50 mg');
    await user.type(screen.getByLabelText('Quantidade de Sertralina'), '30');
    await user.type(screen.getByLabelText('Unidade de Sertralina'), 'comprimidos');
    expect(screen.getByText(/Antes de gerar: Informe o endereço completo/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Endereço do paciente/), 'Rua Sintética, 100 — Curitiba/PR');
    // No CPF in the registration: the doctor says which document identifies the patient.
    expect(screen.getByText(/Antes de gerar: Informe o CPF do paciente/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Passaporte'));
    await user.type(screen.getByLabelText('Número do passaporte'), 'X123');
    expect(screen.queryByText(/Antes de gerar/)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toEqual({
      docType: 'receita_controle_especial',
      medications: [{ ...SERTRALINE, concentration: '50 mg', quantity: 30, unit: 'comprimidos' }],
      content: { patientAddress: 'Rua Sintética, 100 — Curitiba/PR', patientDocument: { kind: 'passaporte', value: 'X123' } },
    });
  });

  it('prints the registration CPF when there is one and sends the CID and justification', async () => {
    const { user, onGenerate } = setup({ cpf: '529.982.247-25' });
    await user.click(screen.getByRole('button', { name: /Controle especial/ }));
    expect(screen.getByText('O CPF do cadastro do paciente será impresso.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Passaporte')).toBeNull();
    await user.type(screen.getByLabelText('Concentração de Sertralina'), '50 mg');
    await user.type(screen.getByLabelText('Quantidade de Sertralina'), '90');
    await user.type(screen.getByLabelText('Unidade de Sertralina'), 'comprimidos');
    await user.type(screen.getByLabelText(/Endereço do paciente/), 'Rua Sintética, 100 — Curitiba/PR');
    await user.type(screen.getByLabelText(/Justificativa/), 'Tratamento contínuo de 90 dias');
    expect(screen.getByText(/Antes de gerar: A justificativa .* precisa do CID/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/CID ou diagnóstico/), 'F32.1');
    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toMatchObject({
      content: { patientAddress: 'Rua Sintética, 100 — Curitiba/PR', cid: 'F32.1', justification: 'Tratamento contínuo de 90 dias' },
    });
    expect((onGenerate.mock.calls.at(-1)?.[0] as { content: object }).content).not.toHaveProperty('patientDocument');
  });

  it('refuses more than 3 medications before generating', async () => {
    const meds = [1, 2, 3, 4].map((n) => ({ ...SERTRALINE, name: `Sertralina ${n}` }));
    const { user } = setup({ medications: meds });
    await user.click(screen.getAllByRole('button', { name: 'Usar controle especial' })[0]);
    expect(screen.getByRole('alert')).toHaveTextContent('no máximo 3 medicamentos');
    expect(screen.getByRole('button', { name: /Gerar/ })).toBeDisabled();
  });
});

// Compounded formulas (manipulados) in the composer. Synthetic formulas only.
describe('Compounded formulas', { timeout: 20000 }, () => {
  function setup(medications: Patient['medications'] = []) {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000', prescriberCpf: '' }, isLoading: false };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    render(<DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino', medications })} onGenerate={onGenerate} isGenerating={false} />);
    return { user: userEvent.setup(), onGenerate };
  }

  it('builds a formula with two components and sends it with the prescription', async () => {
    const { user, onGenerate } = setup();
    await user.click(screen.getByRole('button', { name: 'Adicionar fórmula manipulada' }));
    await user.type(screen.getByLabelText('Nome da fórmula (opcional)'), 'Cápsulas sintéticas');
    await user.type(screen.getByLabelText('Componente 1'), 'Substância sintética A');
    await user.type(screen.getByLabelText('Quantidade do componente 1'), '100 mg');
    await user.click(screen.getByRole('button', { name: 'Adicionar componente' }));
    await user.type(screen.getByLabelText('Componente 2'), 'Substância sintética B');
    await user.type(screen.getByLabelText('Quantidade do componente 2'), '2 mg');
    await user.type(screen.getByLabelText('Excipiente ou veículo (opcional)'), 'Excipiente q.s.p. 1 cápsula');
    await user.type(screen.getByLabelText('Forma farmacêutica'), 'cápsula');
    await user.type(screen.getByLabelText('Quanto manipular'), '30 cápsulas');
    await user.click(screen.getByRole('button', { name: 'Adicionar à receita' }));
    expect(screen.getByText('MANIPULADO')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Dose de Cápsulas sintéticas'), '1 cápsula');
    await user.type(screen.getByLabelText('Posologia e instruções de Cápsulas sintéticas'), 'à noite');
    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toEqual({
      docType: 'receita_simples',
      medications: [{
        name: 'Cápsulas sintéticas', dosage: '1 cápsula', instructions: 'à noite',
        formula: {
          components: [{ substance: 'Substância sintética A', amount: '100 mg' }, { substance: 'Substância sintética B', amount: '2 mg' }],
          vehicle: 'Excipiente q.s.p. 1 cápsula', form: 'cápsula', quantity: '30 cápsulas',
        },
      }],
      content: undefined,
    });
  });

  it('applies the server rules before adding, and nothing is added on error', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Adicionar fórmula manipulada' }));
    await user.type(screen.getByLabelText('Componente 1'), 'Substância sintética A');
    await user.type(screen.getByLabelText('Quantidade do componente 1'), 'bastante');
    await user.type(screen.getByLabelText('Forma farmacêutica'), 'creme');
    await user.type(screen.getByLabelText('Quanto manipular'), '60 g');
    await user.click(screen.getByRole('button', { name: 'Adicionar à receita' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a quantidade de Substância sintética A');
    expect(screen.queryByText('MANIPULADO')).toBeNull();
  });

  it('treats a compounded controlled component like the registered drug', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Adicionar fórmula manipulada' }));
    await user.type(screen.getByLabelText('Componente 1'), 'Testosterona');
    await user.type(screen.getByLabelText('Quantidade do componente 1'), '1%');
    await user.type(screen.getByLabelText('Forma farmacêutica'), 'gel transdérmico');
    await user.type(screen.getByLabelText('Quanto manipular'), '60 g');
    await user.click(screen.getByRole('button', { name: 'Adicionar à receita' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Medicamento sujeito a controle especial (testosterona)');
    expect(screen.getByRole('button', { name: 'Usar controle especial' })).toBeInTheDocument();
  });
});

describe('Exam request with the TUSS catalog', { timeout: 20000 }, () => {
  it('adds the picked exam with its TUSS code to the list sent to the server', async () => {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000', prescriberCpf: '' }, isLoading: false };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    render(<DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino' })} onGenerate={onGenerate} isGenerating={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Solicitação de exames/ }));
    await user.type(screen.getByLabelText('Exames solicitados, um por linha'), 'Exame digitado à mão');
    await user.type(screen.getByLabelText('Buscar exame na tabela TUSS'), 'exa');
    await user.click(await screen.findByRole('button', { name: /Exame laboratorial sintético/ }));
    await user.click(screen.getByRole('button', { name: /Gerar/ }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toMatchObject({
      docType: 'solicitacao_exames',
      content: { exams: ['Exame digitado à mão', 'Exame laboratorial sintético (TUSS 40304361)'] },
    });
  }, 20000);
});

describe('Choosing what goes on the prescription', { timeout: 20000 }, () => {
  function setup(extra: Partial<Patient> = {}, signing: { active: boolean } | null = null) {
    settings.value = { prescriber: { professionalPhone: '(41) 3000-0000', prescriberCpf: '' }, isLoading: false };
    const onGenerate = vi.fn<(payload: unknown) => Promise<void>>(async () => {});
    render(<DocumentComposerModal open onOpenChange={() => {}} patient={person({ sex: 'feminino', ...extra })} onGenerate={onGenerate} isGenerating={false} signing={signing} />);
    return { user: userEvent.setup(), onGenerate };
  }

  it('does not pre-check the profile medications', async () => {
    const { user, onGenerate } = setup({ medications: [{ name: 'Medicamento sintético A', dosage: '1', instructions: 'x' }] });
    expect(screen.getByRole('checkbox', { name: 'Medicamento sintético A' })).not.toBeChecked();
    expect(screen.getByText('Marque os medicamentos que entram nesta receita.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar documento' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Medicamento sintético A' }));
    await user.click(screen.getByRole('button', { name: 'Gerar documento' }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toMatchObject({ medications: [{ name: 'Medicamento sintético A' }] });
  });

  it('adds a medication typed by hand with dose and instructions', async () => {
    const { user, onGenerate } = setup({ medications: [] });
    await user.click(screen.getByRole('button', { name: 'Adicionar medicamento manualmente' }));
    await user.click(screen.getByRole('button', { name: 'Adicionar à receita' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome do medicamento.');
    await user.type(screen.getByLabelText('Nome e concentração'), 'Produto sintético 10 mg');
    await user.type(screen.getByLabelText('Dose'), '1 comprimido');
    await user.type(screen.getByLabelText('Posologia e instruções'), 'à noite');
    await user.click(screen.getByRole('button', { name: 'Adicionar à receita' }));
    expect(screen.getByLabelText('Dose de Produto sintético 10 mg')).toHaveValue('1 comprimido');
    await user.click(screen.getByRole('button', { name: 'Gerar documento' }));
    expect(onGenerate.mock.calls.at(-1)?.[0]).toEqual({
      docType: 'receita_simples',
      medications: [{ name: 'Produto sintético 10 mg', dosage: '1 comprimido', instructions: 'à noite' }],
      content: undefined,
    });
  });

  it('says when the catalog has no match and offers to add the typed name by hand', async () => {
    const { user } = setup({ medications: [] });
    await user.type(screen.getByLabelText('Buscar medicamento na base Anvisa'), 'Inexistente');
    expect(await screen.findByText('Nenhum medicamento encontrado para “Inexistente”.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar “Inexistente” manualmente' }));
    expect(screen.getByLabelText('Nome e concentração')).toHaveValue('Inexistente');
  });

  it('describes the signature plainly', () => {
    setup({ medications: [] }, { active: false });
    expect(screen.getByText(/Use "Gerar e assinar" para assinar digitalmente/)).toBeInTheDocument();
    expect(screen.queryByText(/acoplada/)).toBeNull();
  });
});
