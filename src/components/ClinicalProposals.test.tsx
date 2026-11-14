import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicalProposals } from './ClinicalProposals';
import type { Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  sign: vi.fn(),
  download: vi.fn(),
  failed: false,
  files: [] as Record<string, unknown>[],
  visits: [] as Record<string, unknown>[],
}));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ createSignedUrl: mocks.sign, download: mocks.download }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        neq: () => query,
        order: () => query,
        single: async () => ({
          data: { revision: 7, medical_history: 'Histórico existente', social_anamnesis: '' },
          error: null,
        }),
        range: async (from: number) => ({
          data: from ? [] : table === 'patient_files' ? mocks.files : mocks.visits,
          error: mocks.failed ? new Error('offline') : null,
        }),
      };
      return query;
    },
  },
}));
const patient: Patient = {
  id: 'patient',
  name: 'Pessoa sintética',
  age: null,
  profession: '',
  lastVisit: null,
  status: 'novo',
  diagnoses: [],
  medications: [],
  allergies: [],
};
const renderProposals = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  render(
    <QueryClientProvider client={client}>
      <ClinicalProposals patient={patient} userId="doctor" />
    </QueryClientProvider>,
  );

describe('clinical proposal approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.failed = false;
    mocks.visits = [];
    mocks.files = [
      {
        id: 'source-file',
        file_name: 'Exame sintético',
        created_at: '2026-10-28T12:00:00Z',
        ai_summary: 'Resumo não revisado',
        ai_profile_proposal: 'Proposta original',
      },
    ];
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });
  it('locks the exact decision text and competing actions until the save resolves', async () => {
    mocks.rpc.mockImplementation(() => new Promise(() => {}));
    renderProposals();
    const editor = await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar ao prontuário' }));
    expect(editor).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dispensar sugestão' })).toBeDisabled();
  });
  it('sends only the exact edited and explicitly accepted note with the displayed chart revision', async () => {
    renderProposals();
    const editor = await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Texto corrigido pelo médico');
    expect(mocks.rpc).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar ao prontuário' }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('review_document_proposal', {
        p_file_id: 'source-file',
        p_expected_patient_revision: 7,
        p_note: 'Texto corrigido pelo médico',
        p_accept: true,
      }),
    );
  });
  it('refreshes the chart views the approved note changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderProposals(client);
    await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar ao prontuário' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['patient-consultations', 'patient'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['patient-detail', 'patient'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['patient-clinical-notes', 'patient'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['consultations', 'patient'] });
  });
  it('keeps an edited note after a revision conflict instead of replacing it with the AI proposal', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '40001' } });
    renderProposals();
    const editor = await screen.findByLabelText('Texto a acrescentar às notas clínicas');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Rascunho médico preservado');
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar ao prontuário' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/seu texto foi mantido/i);
    expect(editor).toHaveValue('Rascunho médico preservado');
  });
  it('requires an explicit history decision and binds both source and patient revisions', async () => {
    mocks.files = [];
    mocks.visits = [
      {
        id: 'visit',
        created_at: '2026-10-28T12:00:00Z',
        chief_complaint: 'Retorno sintético',
        soap_note: 'Fonte aprovada',
        revision: 4,
        history_proposals: { sourceConsultationId: 'visit', medicalHistory: ['Fato proposto'], socialAnamnesis: [] },
      },
    ];
    renderProposals();
    await screen.findByLabelText('Texto a acrescentar ao histórico médico');
    expect(mocks.rpc).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Dispensar sugestão' }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      'review_history_proposal',
      expect.objectContaining({
        p_consultation_id: 'visit',
        p_expected_patient_revision: 7,
        p_expected_consultation_revision: 4,
        p_accept: false,
      }),
    );
  });
  it('says what the card is and what each choice does, without internal ids', async () => {
    renderProposals();
    const card = await screen.findByRole('article', { name: 'Revisar Exame sintético' });
    expect(card).toHaveTextContent('Documento anexado em 28/10/2026');
    expect(card).toHaveTextContent('A IA leu este documento e sugere a anotação abaixo.');
    expect(card).toHaveTextContent('Dispensar não apaga o documento: ele continua em Arquivos.');
    expect(card).not.toHaveTextContent('source-file');
  });
  it('explains a document the AI read without suggesting a note, instead of an empty box and a dead button', async () => {
    mocks.files = [{ ...mocks.files[0], ai_profile_proposal: null }];
    renderProposals();
    const card = await screen.findByRole('article', { name: 'Revisar Exame sintético' });
    expect(card).toHaveTextContent('A IA leu este documento e não sugeriu anotação.');
    const add = screen.getByRole('button', { name: 'Acrescentar ao prontuário' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(/Para acrescentar, escreva o texto no campo acima\./);
    expect(screen.getByRole('button', { name: 'Dispensar sugestão' })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Texto a acrescentar às notas clínicas'), 'Laudo conferido');
    expect(add).toBeEnabled();
  });
  it('opens the document inside the app, in the viewer, with the file of that suggestion', async () => {
    mocks.files = [{ ...mocks.files[0], storage_path: 'patients/doctor/patient/exame.png', mime_type: 'image/png' }];
    const file = new Blob(['synthetic image'], { type: 'image/png' });
    mocks.download.mockResolvedValue({ data: file, error: null });
    // jsdom has no object URLs.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:cortex/source');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderProposals();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir o documento' }));
    const viewer = await screen.findByRole('dialog', { name: 'Exame sintético' });
    // The stored type decides how the file is shown: this one is an image, drawn from memory.
    expect(await within(viewer).findByRole('img', { name: 'Exame sintético' })).toHaveAttribute(
      'src',
      'blob:cortex/source',
    );
    expect(mocks.download).toHaveBeenCalledWith('patients/doctor/patient/exame.png');
    expect(createObjectURL).toHaveBeenCalledWith(file);
    // No browser tab and no one-minute link on the card any more.
    expect(open).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Não abriu/ })).toBeNull();
    open.mockRestore();
  });
  it('says so inside the viewer when the document cannot be opened', async () => {
    mocks.files = [
      { ...mocks.files[0], storage_path: 'patients/doctor/patient/exame.pdf', mime_type: 'application/pdf' },
    ];
    mocks.download.mockResolvedValue({ data: null, error: new Error('not found') });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderProposals();
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir o documento' }));
    const viewer = await screen.findByRole('dialog', { name: 'Exame sintético' });
    const alert = await within(viewer).findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível abrir o arquivo.');
    expect(within(alert).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(mocks.download).toHaveBeenCalledWith('patients/doctor/patient/exame.pdf');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it('reports unavailable proposals instead of asserting all reviews are complete', async () => {
    mocks.failed = true;
    renderProposals();
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
  });
});
