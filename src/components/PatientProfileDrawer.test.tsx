import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientProfileDrawer } from './PatientProfileDrawer';
import type { Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({
  revision: 2,
  eq: vi.fn(),
  update: vi.fn(),
  detailError: null as unknown,
  detailRead: null as Promise<unknown> | null,
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
    single: () => mocks.detailRead ?? Promise.resolve({ error: mocks.detailError, data: { revision: mocks.revision, ai_insights: { summary: 'Resumo sintético anterior' }, social_anamnesis: 'Anamnese sintética anterior', medical_history: mocks.revision === 2 ? 'Histórico anterior' : 'Atualização de outro atendimento', clinical_notes: 'Anotação sintética anterior' } }),
    range: () => Promise.resolve({ error: null, data: [] }),
    update: (patch: unknown) => { mocks.update(patch); return query; },
    maybeSingle: () => { mocks.revision = 3; return Promise.resolve({ data: null, error: null }); },
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
    expect(screen.getByRole('button', { name: 'Editar Histórico Médico' })).toBeDisabled();
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
    await user.click(screen.getByRole('button', { name: 'Editar Histórico Médico' }));
    await user.type(screen.getByLabelText('Histórico Médico'), ' — rascunho de teste');
    mocks.detailError = new Error('offline');
    await act(async () => { await client.invalidateQueries({ queryKey: ['patient-detail', patient.id] }); });
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Histórico Médico')).toHaveValue('Histórico anterior — rascunho de teste');
    expect(screen.getByLabelText('Histórico Médico')).toBeDisabled();
    mocks.detailError = null;
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByLabelText('Histórico Médico')).toBeEnabled());
    expect(screen.getByLabelText('Histórico Médico')).toHaveValue('Histórico anterior — rascunho de teste');
  });
});

describe('Concurrent clinical history editing', () => {
  it('preserves the draft and requires review when the patient revision changed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PatientProfileDrawer patient={patient} open onOpenChange={vi.fn()} /></QueryClientProvider>);
    const edit = await screen.findByRole('button', { name: 'Editar Histórico Médico' });
    await waitFor(() => expect(edit).toBeEnabled());
    const user = userEvent.setup();
    await user.click(edit);
    await user.type(screen.getByLabelText('Histórico Médico'), ' — minha revisão');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/outro atendimento/i);
    expect(mocks.eq).toHaveBeenCalledWith('revision', 2);
    expect(screen.getByLabelText('Histórico Médico')).toHaveValue('Histórico anterior — minha revisão');
    expect(screen.getByLabelText('Histórico Médico')).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: /conferi a versão atual/i }));
    expect(screen.getByLabelText('Histórico Médico')).toBeEnabled();
  });
});
