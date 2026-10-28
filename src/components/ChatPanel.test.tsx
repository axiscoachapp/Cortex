import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient } from '@/types/patient';
import { ChatPanel } from './ChatPanel';
vi.mock('@/components/ClinicalProposals',()=>({ClinicalProposals:()=>null}));
vi.mock('react-router-dom',()=>({Link:({to,children,...props})=><a href={to} {...props}>{children}</a>}));

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), loadDraft: vi.fn(), saveDraft: vi.fn(),
  upload: vi.fn(), from: vi.fn(), profileUpdate: vi.fn(),
  capture: { isRecording: false, isStarting: false, isStopping: false },
  recording: { onStop: null as null | ((blob: Blob, mime: string, comments: string[]) => Promise<void>) } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, functions: { invoke: mocks.invoke }, storage: { from: () => ({ upload: mocks.upload }) } } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ specialty: 'geral', liveCopilotEnabled: false, activeTemplateId: null }) }));
vi.mock('@/hooks/useRecording', () => ({ useRecording: (options: { onStop: typeof mocks.recording.onStop }) => {
  mocks.recording.onStop = options.onStop;
  return { ...mocks.capture, isPaused: false, stopConfirming: false, recordingSeconds: 0, audioLevel: 0, confirmStop: vi.fn(), cancelStop: vi.fn(), discard: vi.fn() };
} }));
vi.mock('@/lib/consultationDrafts', () => ({ loadConsultationDraft: mocks.loadDraft, saveConsultationDraft: mocks.saveDraft }));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null, UsageOverBanner: () => null }));
vi.mock('@/components/QuestionChecklistCard', () => ({ QuestionChecklistCard: () => null }));
vi.mock('@/components/LiveCopilotCard', () => ({ LiveCopilotCard: () => null }));
vi.mock('@/components/ConsultationReviewModal', () => ({ ConsultationReviewModal: ({ open, soapDraft, onConfirm }: { open: boolean; soapDraft: string; onConfirm: (comments: string) => void }) => open ? <div>
  <p>{soapDraft}</p><button onClick={() => onConfirm('')}>Confirmar revisão</button><button onClick={() => onConfirm('Correção adicional')}>Regerar rascunho</button>
</div> : null }));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/components/DocumentComposerModal', () => ({ DocumentComposerModal: () => null }));
vi.mock('@/components/RecordingModeDialog', () => ({ RecordingModeDialog: () => null }));

const patient = (id: string): Patient => ({ id, name: `Paciente ${id}`, age: 40, profession: '', lastVisit: '2026-10-27', status: 'retorno', diagnoses: [], medications: [], allergies: [] });
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReset();
  mocks.loadDraft.mockResolvedValue(null);
  mocks.saveDraft.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({ error: null });
  Object.assign(mocks.capture, { isRecording: false, isStarting: false, isStopping: false });
  mocks.invoke.mockResolvedValue({ data: { questions: [] }, error: null });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('patient-scoped asynchronous clinical work', () => {
  it('does not resend protocol-derived assistant replies in automatic chat history',async()=>{
    mocks.invoke.mockResolvedValue({data:{message:'Resposta atual',questions:[],sources:[]},error:null});
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const old={id:'old',type:'assistant' as const,title:'Anterior',content:'Fonte posteriormente revogada',timestamp:new Date(),sources:[{id:'doc',type:'knowledge',label:'Protocolo',date:'2026-10-28',excerpt:'Trecho',authorizationRevision:2,sourceReviewRevision:3}]};
    render(<QueryClientProvider client={client}><ChatPanel patient={patient('A')} messages={[old]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} userId="doctor"/></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('Pergunta ao assistente clínico'),{target:{value:'Pergunta nova'}});fireEvent.click(screen.getByRole('button',{name:'Enviar pergunta'}));
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('chat-assistant',expect.objectContaining({body:expect.objectContaining({chatHistory:[]})})));
  });
  it('accepts a reviewed medication change by revision even when storage uses the legacy dose shape', async () => {
    const legacyRow = { revision: 7, medications: [{ dose: '50 mg', name: 'Losartana' }], diagnoses: [], allergies: [] };
    mocks.from.mockImplementation(() => {
      const query = { select: () => query, eq: () => query, single: async () => ({ data: legacyRow, error: null }),
        update: (value: unknown) => { mocks.profileUpdate(value); return query; }, maybeSingle: async () => ({ data: { id: 'A' }, error: null }) };
      return query;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const current = { ...patient('A'), revision: 7, medications: [{ name: 'Losartana', dosage: '50 mg', instructions: '' }] };
    const messages = [{ id: 'profile', type: 'profile-update' as const, title: 'Atualizar', content: '', timestamp: new Date(), profileUpdates: { diagnoses: [], allergies: [], medications: [{ name: 'Losartana', dosage: '100 mg', instructions: '1x/dia' }] } }];
    render(<QueryClientProvider client={client}><ChatPanel patient={current} messages={messages} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} userId="doctor" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e salvar' }));
    await screen.findByText('Perfil clínico atualizado com as informações desta consulta.');
    expect(mocks.profileUpdate).toHaveBeenCalledWith(expect.objectContaining({ medications: [expect.objectContaining({ name: 'Losartana', dosage: '100 mg', instructions: '1x/dia' })] }));
  });
  for (const mode of ['question', 'comment']) it(`never appends patient A's delayed ${mode} result to patient B`, async () => {
    const pending = deferred();
    mocks.invoke.mockImplementation((name: string) => name === (mode === 'question' ? 'chat-assistant' : 'process-comment')
      ? pending.promise : Promise.resolve({ data: { questions: [] }, error: null }));
    const onMessagesChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { messages: [], onMessagesChange, chiefComplaint: '', preBriefing: null, briefingLoading: false, userId: 'doctor' };
    const view = render(<QueryClientProvider client={client}><ChatPanel {...props} patient={patient('A')} /></QueryClientProvider>);
    if (mode === 'comment') fireEvent.click(screen.getByText('Comentário'));
    const input = screen.getByPlaceholderText(mode === 'question' ? /Pergunte ao assistente/ : /Comentário — ex/);
    fireEvent.change(input, { target: { value: 'Informação exclusiva de A' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(mode === 'question' ? 'chat-assistant' : 'process-comment', expect.anything()));
    onMessagesChange.mockClear();
    view.rerender(<QueryClientProvider client={client}><ChatPanel {...props} patient={patient('B')} /></QueryClientProvider>);
    await act(async () => { pending.resolve({ data: { message: 'Resposta de A', summary: 'Alergia de A' }, error: null }); });
    expect(onMessagesChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Paciente B' })).toBeInTheDocument();
  });
});

describe('recoverable clinical review', () => {
  it('reports capture busy while permission, recording, or a native stop event is pending', async () => {
    const onCaptureStateChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { patient: patient('A'), messages: [], onMessagesChange: vi.fn(), chiefComplaint: '', preBriefing: null, briefingLoading: false, userId: 'doctor', onCaptureStateChange };
    const content = () => <QueryClientProvider client={client}><ChatPanel {...props} /></QueryClientProvider>;
    const view = render(content());
    for (const state of ['isStarting', 'isRecording', 'isStopping'] as const) {
      Object.assign(mocks.capture, { isStarting: false, isRecording: false, isStopping: false, [state]: true });
      view.rerender(content());
      await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(true));
    }
    mocks.capture.isStopping = false; view.rerender(content());
    await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(false));
  });
  it('keeps raw audio busy after a patient switch until its asynchronous upload finishes', async () => {
    const upload = deferred(); mocks.upload.mockReturnValue(upload.promise);
    const onCaptureStateChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { messages: [], onMessagesChange: vi.fn(), chiefComplaint: '', preBriefing: null, briefingLoading: false, userId: 'doctor', onCaptureStateChange };
    const view = render(<QueryClientProvider client={client}><ChatPanel {...props} patient={patient('A')} /></QueryClientProvider>);
    let processing!: Promise<void>;
    act(() => { processing = mocks.recording.onStop!(new Blob(['voice']), 'audio/webm', []); });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    view.rerender(<QueryClientProvider client={client}><ChatPanel {...props} patient={patient('B')} /></QueryClientProvider>);
    await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(true));
    await act(async () => { upload.resolve({ error: null }); await processing; });
    await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(false));
  });
  it('never autosaves a good draft; keeps physician comments when regenerating and saves only the reviewed revision', async () => {
    mocks.invoke.mockImplementation((name: string, { body }: { body: { saveDirect?: boolean } }) => Promise.resolve({ error: null,
      data: name === 'suggest-questions' ? { questions: [] }
        : name === 'transcribe-consultation' ? { transcription: 'Consulta', soapNote: 'Rascunho original', whatsappMessage: '', transcriptionQuality: 'good', clarifications: [] }
        : body.saveDirect ? { consultationId: 'saved', soapNote: 'Rascunho corrigido', whatsappMessage: '', profileUpdates: { diagnoses: [], medications: [], allergies: [] } }
        : { previewOnly: true, soapNote: 'Rascunho corrigido', whatsappMessage: '' },
    }));
    const onMessagesChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChatPanel patient={patient('A')} messages={[]} onMessagesChange={onMessagesChange} chiefComplaint="Dor" preBriefing={null} briefingLoading={false} userId="doctor" /></QueryClientProvider>);
    await waitFor(() => expect(mocks.loadDraft).toHaveBeenCalled());
    await act(async () => { await mocks.recording.onStop!(new Blob(['audio']), 'audio/webm', ['Correção durante gravação']); });
    const registeredPath = mocks.saveDraft.mock.calls.findIndex(([, draft]) => !!draft.audioStoragePath);
    expect(registeredPath).toBeGreaterThanOrEqual(0);
    expect(mocks.saveDraft.mock.invocationCallOrder[registeredPath]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
    expect(screen.getByText('Rascunho original')).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'finalize-consultation')).toHaveLength(0);
    fireEvent.click(screen.getByText('Regerar rascunho'));
    await screen.findByText('Rascunho corrigido');
    expect(mocks.invoke).toHaveBeenCalledWith('finalize-consultation', { body: expect.objectContaining({ doctorComments: 'Correção durante gravação\n\nCorreção adicional', previewOnly: true }) });
    expect(onMessagesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirmar revisão'));
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith('finalize-consultation', { body: expect.objectContaining({ saveDirect: true, reviewed: true, soapNote: 'Rascunho corrigido' }) });
  });
});
