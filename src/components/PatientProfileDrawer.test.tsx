import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientProfileDrawer } from './PatientProfileDrawer';
import type { Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({ revision: 2, eq: vi.fn(), update: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/PatientFiles', () => ({ PatientFiles: () => null }));
vi.mock('@/components/PrescriptionList', () => ({ PrescriptionList: () => null }));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null }));
vi.mock('@/lib/printDoc', () => ({ printSoap: vi.fn(), printDossier: vi.fn(), escapeHtml: (value: string) => value }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = {
    select: () => query, order: () => query,
    eq: (field: string, value: unknown) => { mocks.eq(field, value); return query; },
    single: () => Promise.resolve({ error: null, data: { revision: mocks.revision, ai_insights: null, social_anamnesis: '', medical_history: mocks.revision === 2 ? 'Histórico anterior' : 'Atualização de outro atendimento', clinical_notes: '' } }),
    range: () => Promise.resolve({ error: null, data: [] }),
    update: (patch: unknown) => { mocks.update(patch); return query; },
    maybeSingle: () => { mocks.revision = 3; return Promise.resolve({ data: null, error: null }); },
  }; return query;
} } }));

const patient: Patient = { id: 'patient', name: 'Pessoa de teste', age: 40, profession: '', status: 'retorno', lastVisit: '2026-05-01', diagnoses: [], medications: [], allergies: [] };

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
