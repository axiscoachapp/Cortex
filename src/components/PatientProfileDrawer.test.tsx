import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientProfileDrawer } from './PatientProfileDrawer';
import type { Patient } from '@/types/patient';
import { lastConsultationLabel } from '@/lib/dates';

const mocks = vi.hoisted(() => ({
  revision: 2,
  eq: vi.fn(),
  update: vi.fn(),
  detailError: null as unknown,
  detailRead: null as Promise<unknown> | null,
  writeOk: false,
  consultations: [] as Array<Record<string, unknown>>,
  history: null as string | null,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/PatientFiles', () => ({ PatientFiles: () => null }));
vi.mock('@/components/PrescriptionList', () => ({ PrescriptionList: () => null }));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null }));
vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ prescriber: { doctorName: '', crmNumber: '', crmUf: '', professionalAddress: '' } }),
}));
vi.mock('@/lib/printDoc', () => ({ printSoap: vi.fn(), printDossier: vi.fn(), escapeHtml: (value: string) => value }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = {
    select: () => query, order: () => query,
    eq: (field: string, value: unknown) => { mocks.eq(field, value); return query; },
    single: () => mocks.detailRead ?? Promise.resolve({ error: mocks.detailError, data: { revision: mocks.revision, ai_insights: { summary: 'Resumo sintético anterior' }, social_anamnesis: 'Anamnese sintética anterior', medical_history: mocks.history ?? (mocks.revision === 2 ? 'Histórico anterior' : 'Atualização de outro atendimento'), clinical_notes: 'Anotação sintética anterior' } }),
    range: (from: number) => Promise.resolve({ error: null, data: from ? [] : mocks.consultations }),
    update: (patch: unknown) => { mocks.update(patch); return query; },
    maybeSingle: () => {
      if (mocks.writeOk) return Promise.resolve({ data: { id: 'patient' }, error: null });
      mocks.revision = 3;
      return Promise.resolve({ data: null, error: null });
    },
  }; return query;
} } }));

const patient: Patient = { id: 'patient', name: 'Pessoa de teste', age: 40, profession: '', status: 'retorno', lastVisit: '2026-05-01', diagnoses: [], medications: [], allergies: [] };

function renderProfile(value: Patient = patient) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PatientProfileDrawer patient={value} open onOpenChange={vi.fn()} /></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  mocks.revision = 2;
  mocks.detailError = null;
  mocks.detailRead = null;
  mocks.writeOk = false;
  mocks.consultations = [];
  mocks.history = null;
  vi.clearAllMocks();
});

describe('Clinical detail read states', () => {
  it('waits for the clinical read without presenting fallback data or empty-state prompts', async () => {
    mocks.detailRead = new Promise(() => {});
    renderProfile({ ...patient, medicalHistory: 'Histórico antigo da lista', socialAnamnesis: 'Anamnese antiga da lista' });
    expect(screen.getByText('Carregando os dados clínicos…')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Histórico antigo da lista')).not.toBeInTheDocument();
    expect(screen.queryByText('Anamnese antiga da lista')).not.toBeInTheDocument();
    expect(screen.queryByText(/Adicione cirurgias/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar histórico médico' })).toBeDisabled();
  });

  it('removes cached clinical fields, notes and insights after a failed refresh', async () => {
    const client = renderProfile();
    await screen.findByText('Histórico anterior');
    expect(screen.getByText('Anotação sintética anterior')).toBeInTheDocument();
    expect(screen.getByText('Resumo sintético anterior')).toBeInTheDocument();
    mocks.detailError = new Error('offline');
    await act(async () => { await client.invalidateQueries({ queryKey: ['patient-detail', patient.id] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar os dados clínicos/i);
    expect(screen.queryByText('Histórico anterior')).not.toBeInTheDocument();
    expect(screen.queryByText('Anamnese sintética anterior')).not.toBeInTheDocument();
    expect(screen.queryByText('Anotação sintética anterior')).not.toBeInTheDocument();
    expect(screen.queryByText('Resumo sintético anterior')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dossiê' })).toBeDisabled();
  });

  it('keeps a clinical draft through read failure and recovery', async () => {
    const client = renderProfile();
    await screen.findByText('Histórico anterior');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editar histórico médico' }));
    await user.type(screen.getByLabelText('Histórico médico'), ' — rascunho de teste');
    mocks.detailError = new Error('offline');
    await act(async () => { await client.invalidateQueries({ queryKey: ['patient-detail', patient.id] }); });
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Histórico médico')).toHaveValue('Histórico anterior — rascunho de teste');
    expect(screen.getByLabelText('Histórico médico')).toBeDisabled();
    mocks.detailError = null;
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByLabelText('Histórico médico')).toBeEnabled());
    expect(screen.getByLabelText('Histórico médico')).toHaveValue('Histórico anterior — rascunho de teste');
  });
});

describe('Concurrent clinical history editing', () => {
  it('preserves the draft and requires review when the patient revision changed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PatientProfileDrawer patient={patient} open onOpenChange={vi.fn()} /></QueryClientProvider>);
    const edit = await screen.findByRole('button', { name: 'Editar histórico médico' });
    await waitFor(() => expect(edit).toBeEnabled());
    const user = userEvent.setup();
    await user.click(edit);
    await user.type(screen.getByLabelText('Histórico médico'), ' — minha revisão');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/outro atendimento/i);
    expect(mocks.eq).toHaveBeenCalledWith('revision', 2);
    expect(screen.getByLabelText('Histórico médico')).toHaveValue('Histórico anterior — minha revisão');
    expect(screen.getByLabelText('Histórico médico')).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: /conferi a versão atual/i }));
    expect(screen.getByLabelText('Histórico médico')).toBeEnabled();
  });
});

describe('Medical history groups', () => {
  it('shows headed groups with their facts, loose facts apart, and folds a long group', async () => {
    const problems = Array.from({ length: 10 }, (_, i) => `- 20${10 + i}: problema sintético ${i + 1}`);
    mocks.history = ['Tipo sanguíneo: O+', 'Cirurgias:', '- 2018: hérnia de hiato', '- 2024: colecistectomia', 'Problemas anteriores:', ...problems].join('\n');
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'Cirurgias' })).toBeInTheDocument();
    expect(screen.getByText('2018: hérnia de hiato')).toBeInTheDocument();
    expect(screen.getByText('Tipo sanguíneo: O+')).toBeInTheDocument();
    expect(screen.queryByText('Cirurgias:')).not.toBeInTheDocument();
    // Ten facts: six on screen, the rest one click away.
    expect(screen.getByText('2015: problema sintético 6')).toBeInTheDocument();
    expect(screen.queryByText('2016: problema sintético 7')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Mostrar mais 4 de Problemas anteriores' });
    await userEvent.click(more);
    expect(screen.getByText('2019: problema sintético 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mostrar menos/ })).toHaveAttribute('aria-expanded', 'true');
  });
  it('edits the stored text as it is, headings included', async () => {
    mocks.history = 'Cirurgias:\n- 2018: hérnia de hiato';
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar histórico médico' }));
    expect(screen.getByRole('textbox', { name: 'Histórico médico' })).toHaveValue('Cirurgias:\n- 2018: hérnia de hiato');
  });
});

describe('Imported records in the history', () => {
  it('shows the title of an imported record as a title, and keeps "Queixa" for a consultation made here', async () => {
    mocks.consultations = [
      { id: 'c2', created_at: '2026-10-12T13:00:00.000Z', chief_complaint: 'Dor pélvica', soap_note: '**S (Subjetivo):** Dor.\n\n**P (Plano):** Retorno.', whatsapp_message: null, transcription: null },
      { id: 'c1', created_at: '2024-01-05T13:00:00.000Z', chief_complaint: 'Pré-natal; exames do terceiro trimestre', soap_note: '[Importado do PersonalMed em 2026-11-13 · registro de Médica A]\n\ntexto sintético', whatsapp_message: null, transcription: null },
    ];
    renderProfile();
    await userEvent.click(await screen.findByRole('tab', { name: /Histórico \(2\)/ }));
    const imported = screen.getByText('Pré-natal; exames do terceiro trimestre');
    expect(imported.closest('p')).not.toHaveTextContent('Queixa:');
    expect(screen.getByText('Importado')).toBeInTheDocument();
    expect(screen.getByText('Dor pélvica').closest('p')).toHaveTextContent('Queixa: Dor pélvica');
    const [, importedDetails] = screen.getAllByRole('button', { name: 'Detalhes' });
    await userEvent.click(importedDetails);
    expect(screen.getByRole('heading', { name: 'Registro importado' })).toBeInTheDocument();
  });
});

describe('Profile header', () => {
  it('summarises visits in one line and does not show the AI usage meter', async () => {
    renderProfile({ ...patient, medications: [{ name: 'Medicamento sintético', dosage: '1', instructions: '' }] });
    expect(await screen.findByText('0 consultas · 1 medicação ativa')).toBeInTheDocument();
    expect(screen.queryByText(/limite diário/i)).not.toBeInTheDocument();
  });

  it('names the last consultation like the rest of the app: "Última consulta: 12/10/2026 · há N dias" (M 25)', async () => {
    mocks.consultations = [
      { id: 'c2', created_at: '2026-10-12T13:00:00.000Z', chief_complaint: 'Retorno', soap_note: null, whatsapp_message: null, transcription: null },
      { id: 'c1', created_at: '2026-01-05T13:00:00.000Z', chief_complaint: 'Primeira', soap_note: null, whatsapp_message: null, transcription: null },
    ];
    renderProfile();
    const label = lastConsultationLabel('2026-10-12T13:00:00.000Z');
    expect(label).toMatch(/^12\/10\/2026 · /);
    expect(await screen.findByText(`Última consulta: ${label} · 2 consultas · 0 medicações ativas`)).toBeInTheDocument();
    expect(screen.queryByText(/primeira há/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sugestões da IA' })).toBeInTheDocument();
    expect(screen.queryByText('Insights da IA')).not.toBeInTheDocument();
  });
});

describe('AI insights proposal', () => {
  const proposal = { insights: { summary: 'Resumo sugerido sintético', family_history: ['Mãe com HAS'] }, createdAt: '2026-11-11T12:00:00Z' };
  function renderWithProposal() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['ai-insights-proposal', 'patient', 'doctor'], proposal);
    render(<QueryClientProvider client={client}><PatientProfileDrawer patient={patient} open onOpenChange={vi.fn()} /></QueryClientProvider>);
    return client;
  }

  it('shows suggested insights apart from the saved ones and writes them only on accept', async () => {
    mocks.writeOk = true;
    const client = renderWithProposal();
    expect(await screen.findByText('Sugestão da IA para revisar')).toBeInTheDocument();
    expect(screen.getByText('Resumo sugerido sintético')).toBeInTheDocument();
    expect(await screen.findByText('Resumo sintético anterior')).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Aceitar sugestões' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ ai_insights: proposal.insights }));
    expect(mocks.eq).toHaveBeenCalledWith('revision', 2);
    await waitFor(() => expect(screen.queryByText('Sugestão da IA para revisar')).not.toBeInTheDocument());
    expect(client.getQueryData(['ai-insights-proposal', 'patient', 'doctor'])).toBeNull();
  });

  it('keeps the suggestion when the chart changed elsewhere', async () => {
    renderWithProposal();
    const user = userEvent.setup();
    const accept = await screen.findByRole('button', { name: 'Aceitar sugestões' });
    await waitFor(() => expect(accept).toBeEnabled());
    await user.click(accept);
    expect(await screen.findByRole('alert')).toHaveTextContent('alterado em outra tela');
    expect(screen.getByText('Resumo sugerido sintético')).toBeInTheDocument();
  });

  it('discards the suggestion only after confirmation, without writing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProposal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Descartar' }));
    expect(screen.getByText('Sugestão da IA para revisar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(screen.queryByText('Sugestão da IA para revisar')).not.toBeInTheDocument());
    expect(mocks.update).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
