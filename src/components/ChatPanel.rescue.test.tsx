import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient } from '@/types/patient';
import { ChatPanel } from './ChatPanel';

// A recording that did not reach the server is parked in IndexedDB. It must
// stay there until the draft and the audio are both on the server, and it must
// never become a second draft for a patient that already has one.

vi.mock('@/components/ClinicalProposals', () => ({ ClinicalProposals: () => null }));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), toast: vi.fn(), loadDraft: vi.fn(), saveDraft: vi.fn(), upload: vi.fn(), download: vi.fn(), exists: vi.fn(),
  rescued: vi.fn(), saveRescued: vi.fn(), deleteRescued: vi.fn(), order: [] as string[],
  capture: { isRecording: false, isStarting: false, isStopping: false },
  onStop: null as null | ((blob: Blob, mime: string, comments: string[], capture?: { captureId: string; startedAt: string }) => Promise<void>),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), functions: { invoke: mocks.invoke }, storage: { from: () => ({ upload: mocks.upload, download: mocks.download, exists: mocks.exists }) } },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ specialty: 'geral', liveCopilotEnabled: false, activeTemplateId: null, prescriber: {} }) }));
vi.mock('@/hooks/useRecording', () => ({
  useRecording: (options: { onStop: typeof mocks.onStop }) => {
    mocks.onStop = options.onStop;
    return { ...mocks.capture, isPaused: false, stopConfirming: false, recordingSeconds: 0, audioLevel: 0, confirmStop: vi.fn(), cancelStop: vi.fn(), discard: vi.fn() };
  },
}));
vi.mock('@/lib/consultationDrafts', () => ({ loadConsultationDraft: mocks.loadDraft, saveConsultationDraft: mocks.saveDraft }));
vi.mock('@/lib/recordingRescue', () => ({
  listRescuedRecordings: mocks.rescued, saveRescuedRecording: mocks.saveRescued, saveRecordingCheckpoint: vi.fn(), deleteRescuedRecording: mocks.deleteRescued,
}));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null, UsageOverBanner: () => null }));
vi.mock('@/components/LiveCopilotCard', () => ({ LiveCopilotCard: () => null }));
vi.mock('@/components/ConsultationReviewModal', () => ({
  ConsultationReviewModal: ({ open, soapDraft }: { open: boolean; soapDraft: string }) => (open ? <p>{soapDraft}</p> : null),
}));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/components/DocumentComposerModal', () => ({ DocumentComposerModal: () => null }));
vi.mock('@/components/RecordingModeDialog', () => ({ RecordingModeDialog: () => null }));

const patient: Patient = { id: 'A', name: 'Paciente A', age: 40, profession: '', lastVisit: null, status: 'retorno', diagnoses: [], medications: [], allergies: [] } as unknown as Patient;
const entry = { id: 'rescue-1', userId: 'doctor', patientId: 'A', patientName: 'Paciente A', mimeType: 'audio/webm', blob: new Blob(['voice']), comments: [], createdAt: '2026-11-10T12:00:00.000Z' };
const tree = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ChatPanel patient={patient} userId="doctor" messages={[]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} />
  </QueryClientProvider>
);
const transcribed = { data: { transcription: 'Transcrição', soapNote: 'Rascunho gerado', draftPersisted: false }, error: null };

beforeEach(() => {
  vi.clearAllMocks(); mocks.order.length = 0;
  Object.assign(mocks.capture, { isRecording: false, isStarting: false, isStopping: false });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.rescued.mockResolvedValue([entry]);
  mocks.loadDraft.mockResolvedValue(null);
  mocks.saveDraft.mockImplementation(async (_user: string, draft: { id: string; audioStoragePath: string | null }) => { mocks.order.push(`save-draft:${draft.id}:${draft.audioStoragePath ? 'path' : 'nopath'}`); });
  mocks.saveRescued.mockImplementation(async (saved: { id: string }) => { mocks.order.push('park:' + saved.id); });
  mocks.deleteRescued.mockImplementation(async (id: string) => { mocks.order.push('delete-from-indexeddb:' + id); });
  mocks.upload.mockImplementation(async (path: string) => { mocks.order.push('upload:' + path); return { error: null }; });
  mocks.exists.mockResolvedValue({ data: true, error: null });
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === 'transcribe-consultation') { mocks.order.push('transcribe'); return transcribed; }
    return { data: { questions: [] }, error: null };
  });
});
afterEach(cleanup);

describe('rescued recording', () => {
  it('keeps the IndexedDB copy and the notice when the first save fails, then deletes it only after a successful retry', async () => {
    mocks.saveDraft.mockRejectedValueOnce(new Error('Failed to fetch'));
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Processar gravação' }));
    // Said above the composer (not a toast), with where the audio is.
    expect(await screen.findByText(/^Sem conexão com o servidor\. .*O áudio ainda não foi enviado e continua guardado neste navegador/)).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(mocks.deleteRescued).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    // No phantom draft: the parked recording is still the one offered.
    expect(screen.queryByText(/guardado apenas nesta aba/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenviar áudio' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Não foi possível enviar esta gravação. Ela continua guardada neste navegador'))).toBe(true);
    expect(mocks.order).toContain('park:rescue-1');

    mocks.order.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar enviar de novo' }));
    await screen.findByText('Rascunho gerado');
    expect(mocks.order).toEqual([
      'save-draft:rescue-1:nopath',
      'save-draft:rescue-1:path',
      'upload:consultations/doctor/rescue-1.webm',
      'delete-from-indexeddb:rescue-1',
      'transcribe',
    ]);
    expect(screen.queryByRole('button', { name: /Processar gravação|Tentar enviar de novo/ })).not.toBeInTheDocument();
  });

  it('keeps the copy when the upload fails after the draft was saved, and resends it from this browser', async () => {
    // A thrown network error skips the retry backoff.
    mocks.upload.mockRejectedValue(new TypeError('Failed to fetch'));
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Processar gravação' }));
    await screen.findByRole('button', { name: 'Reenviar áudio' });
    expect(mocks.deleteRescued).not.toHaveBeenCalled();
    expect(screen.getByText(/está guardado neste navegador/)).toBeInTheDocument();
    // The parked recording is represented by the pending draft, not offered twice.
    expect(screen.queryByRole('button', { name: /Processar gravação|Tentar enviar de novo/ })).not.toBeInTheDocument();

    mocks.upload.mockImplementation(async (path: string) => { mocks.order.push('upload:' + path); return { error: null }; });
    mocks.order.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar áudio' }));
    await screen.findByText('Rascunho gerado');
    expect(mocks.order).toEqual(['upload:consultations/doctor/rescue-1.webm', 'delete-from-indexeddb:rescue-1', 'transcribe']);
  });

  it('on success deletes the IndexedDB copy only after the draft and the upload', async () => {
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Processar gravação' }));
    await screen.findByText('Rascunho gerado');
    expect(mocks.order).toEqual([
      'save-draft:rescue-1:nopath',
      'save-draft:rescue-1:path',
      'upload:consultations/doctor/rescue-1.webm',
      'delete-from-indexeddb:rescue-1',
      'transcribe',
    ]);
  });

  const reviewDraft = { id: 'draft-existing', patientId: 'A', status: 'review', soapDraft: 'Rascunho anterior', chiefComplaint: '', audioStoragePath: 'consultations/doctor/draft-existing.webm', audioMimeType: 'audio/webm', originalComments: [], clarifications: [], differentialDiagnoses: [], drugInteractionAlerts: [], transcription: '', whatsappDraft: '', transcriptionQuality: 'good' };
  it.each([
    ['a review is open', () => mocks.loadDraft.mockResolvedValue(reviewDraft), /consulta em revisão deste paciente/],
    ['a recovery draft is pending', () => mocks.loadDraft.mockResolvedValue({ ...reviewDraft, status: 'error' }), /consulta preservada deste paciente. Conclua ou exclua/],
    ['drafts are still loading', () => mocks.loadDraft.mockReturnValue(new Promise(() => {})), /Verificando os rascunhos/],
    ['drafts could not be loaded', () => mocks.loadDraft.mockRejectedValue(new Error('offline')), /Não foi possível verificar os rascunhos deste paciente/],
    ['a recording is in progress', () => { mocks.capture.isRecording = true; }, /Termine a gravação em andamento/],
  ])('disables "Processar gravação" with a reason while %s', async (_state, arrange, reason) => {
    arrange();
    render(tree());
    expect(await screen.findByText(reason)).toBeInTheDocument();
    const process = screen.getByRole('button', { name: 'Processar gravação' });
    expect(process).toBeDisabled();
    fireEvent.click(process);
    await act(async () => {});
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.deleteRescued).not.toHaveBeenCalled();
  });
});

describe('recording captured in this tab', () => {
  const capture = { captureId: 'capture-1', startedAt: '2026-11-11T09:00:00.000Z' };
  it('parks the audio under the capture id instead of inventing a draft when the first save fails', async () => {
    mocks.rescued.mockResolvedValue([]);
    mocks.saveDraft.mockRejectedValueOnce(new Error('Failed to fetch'));
    render(tree());
    await waitFor(() => expect(mocks.loadDraft).toHaveBeenCalled());
    await act(async () => { await mocks.onStop!(new Blob(['voice']), 'audio/webm', ['Comentário'], capture); });
    expect(mocks.saveRescued).toHaveBeenCalledWith(expect.objectContaining({ id: 'capture-1', patientId: 'A', userId: 'doctor', comments: ['Comentário'] }));
    expect(mocks.deleteRescued).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tentar enviar de novo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenviar áudio' })).not.toBeInTheDocument();
  });

  it('clears the checkpoint of a capture after its upload succeeds', async () => {
    mocks.rescued.mockResolvedValue([]);
    render(tree());
    await waitFor(() => expect(mocks.loadDraft).toHaveBeenCalled());
    await act(async () => { await mocks.onStop!(new Blob(['voice']), 'audio/webm', [], capture); });
    expect(mocks.order).toEqual([
      'save-draft:capture-1:nopath',
      'save-draft:capture-1:path',
      'upload:consultations/doctor/capture-1.webm',
      'delete-from-indexeddb:capture-1',
      'transcribe',
    ]);
    expect(mocks.saveRescued).not.toHaveBeenCalled();
  });
});

describe('"Recuperar consulta"', () => {
  const stored = { id: 'draft-A', patientId: 'A', chiefComplaint: 'Dor', status: 'error', audioStoragePath: 'consultations/doctor/draft-A.webm', audioMimeType: 'audio/webm', originalComments: [] };
  it('processes by storage path without downloading the audio', async () => {
    mocks.rescued.mockResolvedValue([]);
    mocks.loadDraft.mockResolvedValue(stored);
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar consulta' }));
    await screen.findByText('Rascunho gerado');
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith('transcribe-consultation', expect.objectContaining({ body: expect.objectContaining({ audioStoragePath: stored.audioStoragePath }) }));
  });

  it('says the audio is missing on the server when the stored object does not exist', async () => {
    mocks.rescued.mockResolvedValue([]);
    mocks.loadDraft.mockResolvedValue(stored);
    mocks.exists.mockResolvedValue({ data: false, error: new Error('Object not found') });
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar consulta' }));
    expect(await screen.findByText(/^Áudio não encontrado no servidor/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith('transcribe-consultation', expect.anything());
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
