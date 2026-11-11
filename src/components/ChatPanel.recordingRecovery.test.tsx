import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient } from '@/types/patient';
import type { RescuedRecording } from '@/lib/recordingRescue';
import { CHECKPOINT_MS } from '@/hooks/useRecording';
import { ChatPanel } from './ChatPanel';

// End to end through the real recorder hook: audio captured during a
// consultation survives an abrupt end of the tab (no stop event, no unmount
// handler) and is offered and processed on the next visit, then cleared.

vi.mock('@/components/ClinicalProposals', () => ({ ClinicalProposals: () => null }));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), toast: vi.fn(), loadDraft: vi.fn(), saveDraft: vi.fn(), upload: vi.fn(),
  store: new Map<string, RescuedRecording>(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), functions: { invoke: mocks.invoke }, storage: { from: () => ({ upload: mocks.upload, download: vi.fn() }) } },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ specialty: 'geral', liveCopilotEnabled: false, activeTemplateId: null, prescriber: {} }) }));
vi.mock('@/lib/consultationDrafts', () => ({ loadConsultationDraft: mocks.loadDraft, saveConsultationDraft: mocks.saveDraft }));
// IndexedDB stand-in that survives the "tab" (the rendered tree).
vi.mock('@/lib/recordingRescue', () => ({
  listRescuedRecordings: async (userId: string) => [...mocks.store.values()].filter((entry) => entry.userId === userId),
  saveRescuedRecording: async (entry: RescuedRecording) => { mocks.store.set(entry.id, entry); },
  saveRecordingCheckpoint: async (entry: RescuedRecording) => { mocks.store.set(entry.id, entry); },
  deleteRescuedRecording: async (id: string) => { mocks.store.delete(id); },
}));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null, UsageOverBanner: () => null }));
vi.mock('@/components/LiveCopilotCard', () => ({ LiveCopilotCard: () => null }));
vi.mock('@/components/ConsultationReviewModal', () => ({
  ConsultationReviewModal: ({ open, soapDraft }: { open: boolean; soapDraft: string }) => (open ? <p>{soapDraft}</p> : null),
}));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/components/DocumentComposerModal', () => ({ DocumentComposerModal: () => null }));
vi.mock('@/components/RecordingModeDialog', () => ({
  RecordingModeDialog: ({ open, onSelect }: { open: boolean; onSelect: (mode: 'presencial', consent: { consentedAt: string }) => void }) =>
    open ? <button onClick={() => onSelect('presencial', { consentedAt: '2026-11-11T09:00:00.000Z' })}>Presencial</button> : null,
}));

const recorders: Array<{ emit: (text: string) => void; stop: () => void }> = [];
class Recorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state = 'inactive';
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor() { recorders.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  requestData() {}
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text]) }); }
}

const patient: Patient = { id: 'A', name: 'Paciente A', age: 40, profession: '', lastVisit: null, status: 'retorno', diagnoses: [], medications: [], allergies: [] } as unknown as Patient;
const tree = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ChatPanel patient={patient} userId="doctor" messages={[]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} />
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.loadDraft.mockResolvedValue(null);
  mocks.saveDraft.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({ error: null });
  mocks.invoke.mockImplementation(async (name: string) => name === 'transcribe-consultation'
    ? { data: { transcription: 'Transcrição', soapNote: 'Rascunho recuperado', draftPersisted: false }, error: null }
    : { data: { questions: [] }, error: null });
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    createAnalyser() { return { frequencyBinCount: 8, getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(128) }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    close() { return Promise.resolve(); }
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }], getAudioTracks: () => [] }) },
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('recording recovery after an abrupt end', () => {
  it('persists chunks during capture, offers them on the next visit and clears them after upload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const firstTab = render(tree());
    const record = await screen.findByRole('button', { name: 'Gravar consulta' });
    await waitFor(() => expect(record).toBeEnabled());
    fireEvent.click(record);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Presencial' })); });
    await screen.findByRole('button', { name: 'Finalizar gravação' });

    act(() => { recorders[0].emit('voz-1'); vi.advanceTimersByTime(CHECKPOINT_MS); });
    act(() => { recorders[0].emit('voz-2'); vi.advanceTimersByTime(CHECKPOINT_MS); });
    await act(async () => {});
    expect([...mocks.store.values()]).toEqual([expect.objectContaining({ userId: 'doctor', patientId: 'A', patientName: 'Paciente A', mimeType: 'audio/webm' })]);
    const [saved] = mocks.store.values();
    expect(saved.blob.size).toBe(10);

    // The tab dies: no stop event, no rescue on unmount.
    recorders[0].stop = () => {};
    firstTab.unmount();
    expect(mocks.store.get(saved.id)?.blob.size).toBe(10);
    vi.useRealTimers();

    render(tree());
    const process = await screen.findByRole('button', { name: 'Processar gravação' });
    await waitFor(() => expect(process).toBeEnabled());
    fireEvent.click(process);
    await screen.findByText('Rascunho recuperado');
    expect(mocks.upload).toHaveBeenCalledWith(`consultations/doctor/${saved.id}.webm`, expect.any(Blob), expect.anything());
    expect(mocks.upload.mock.calls[0][1].size).toBe(10);
    expect(mocks.store.size).toBe(0);
  });
});
