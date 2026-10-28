import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicalProposals } from './ClinicalProposals';
import type { Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), failed: false, files: [] as Record<string, unknown>[], visits: [] as Record<string, unknown>[] }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc,
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, not: () => query, neq: () => query, order: () => query,
      single: async () => ({ data: { revision: 7, medical_history: 'Histórico existente', social_anamnesis: '' }, error: null }),
      range: async (from: number) => ({ data: from ? [] : table === 'patient_files' ? mocks.files : mocks.visits, error: mocks.failed ? new Error('offline') : null }) };
    return query;
  },
} }));
const patient: Patient = { id: 'patient', name: 'Pessoa sintética', age: null, profession: '', lastVisit: null, status: 'novo', diagnoses: [], medications: [], allergies: [] };
const renderProposals = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ClinicalProposals patient={patient} userId="doctor" /></QueryClientProvider>);

describe('clinical proposal approval', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.failed = false; mocks.visits = [];
    mocks.files = [{ id: 'source-file', file_name: 'Exame sintético', created_at: '2026-10-28T12:00:00Z', ai_summary: 'Resumo não revisado', ai_profile_proposal: 'Proposta original' }];
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });
  it('locks the exact decision text and competing actions until the save resolves', async () => {
    mocks.rpc.mockImplementation(() => new Promise(() => {})); renderProposals();
    const editor=await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.click(screen.getByRole('button',{name:'Aprovar texto revisado'}));
    expect(editor).toBeDisabled();
    expect(screen.getByRole('button',{name:'Rejeitar proposta'})).toBeDisabled();
  });
  it('sends only the exact edited and explicitly accepted note with the displayed chart revision', async () => {
    renderProposals();
    const editor = await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.clear(editor); await userEvent.type(editor, 'Texto corrigido pelo médico');
    expect(mocks.rpc).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar texto revisado' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('review_document_proposal', { p_file_id: 'source-file', p_expected_patient_revision: 7, p_note: 'Texto corrigido pelo médico', p_accept: true }));
  });
  it('keeps an edited note after a revision conflict instead of replacing it with the AI proposal', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '40001' } });
    renderProposals();
    const editor = await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.clear(editor); await userEvent.type(editor, 'Rascunho médico preservado');
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar texto revisado' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/seu texto foi mantido/i);
    expect(editor).toHaveValue('Rascunho médico preservado');
  });
  it('requires an explicit history decision and binds both source and patient revisions', async () => {
    mocks.files = [];
    mocks.visits = [{ id: 'visit', created_at: '2026-10-28T12:00:00Z', chief_complaint: 'Retorno sintético', soap_note: 'Fonte aprovada', revision: 4, history_proposals: { sourceConsultationId: 'visit', medicalHistory: ['Fato proposto'], socialAnamnesis: [] } }];
    renderProposals();
    await screen.findByLabelText('Texto a acrescentar ao histórico médico');
    expect(mocks.rpc).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar proposta' }));
    expect(mocks.rpc).toHaveBeenCalledWith('review_history_proposal', expect.objectContaining({ p_consultation_id: 'visit', p_expected_patient_revision: 7, p_expected_consultation_revision: 4, p_accept: false }));
  });
  it('reports unavailable proposals instead of asserting all reviews are complete', async () => {
    mocks.failed = true; renderProposals();
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
  });
});
