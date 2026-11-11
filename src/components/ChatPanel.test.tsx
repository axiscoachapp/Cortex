import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient, ChatMessage } from '@/types/patient';
import { ChatPanel } from './ChatPanel';
vi.mock('@/components/ClinicalProposals', () => ({ ClinicalProposals: () => null }));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
  profileUpdate: vi.fn(),
  rescued: vi.fn(),
  capture: { isRecording: false, isStarting: false, isStopping: false },
  recording: { onStop: null as null | ((blob: Blob, mime: string, comments: string[]) => Promise<void>) },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: mocks.invoke },
    storage: { from: () => ({ upload: mocks.upload, download: mocks.download }) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ specialty: 'geral', liveCopilotEnabled: false, activeTemplateId: null }),
}));
vi.mock('@/hooks/useRecording', () => ({
  useRecording: (options: { onStop: typeof mocks.recording.onStop }) => {
    mocks.recording.onStop = options.onStop;
    return {
      ...mocks.capture,
      isPaused: false,
      stopConfirming: false,
      recordingSeconds: 0,
      audioLevel: 0,
      confirmStop: vi.fn(),
      cancelStop: vi.fn(),
      discard: vi.fn(),
    };
  },
}));
vi.mock('@/lib/consultationDrafts', () => ({
  loadConsultationDraft: mocks.loadDraft,
  saveConsultationDraft: mocks.saveDraft,
}));
vi.mock('@/lib/recordingRescue',()=>({listRescuedRecordings:mocks.rescued,saveRescuedRecording:vi.fn(),deleteRescuedRecording:vi.fn()}));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null, UsageOverBanner: () => null }));
vi.mock('@/components/LiveCopilotCard', () => ({ LiveCopilotCard: () => null }));
vi.mock('@/components/ConsultationReviewModal', () => ({
  ConsultationReviewModal: ({
    open,
    soapDraft,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    soapDraft: string;
    onConfirm: (comments: string) => void;
    onCancel: (comments: string, text: string) => void;
  }) =>
    open ? (
      <div>
        <p>{soapDraft}</p>
        <button onClick={() => onConfirm('')}>Confirmar revisão</button>
        <button onClick={() => onConfirm('Correção adicional')}>Regerar rascunho</button>
        <button onClick={() => onCancel('Comentários novos','Rascunho sintético editado')}>Voltar depois</button>
      </div>
    ) : null,
}));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/components/DocumentComposerModal', () => ({ DocumentComposerModal: () => null }));
vi.mock('@/components/RecordingModeDialog', () => ({ RecordingModeDialog: () => null }));

const patient = (id: string): Patient => ({
  id,
  name: `Paciente ${id}`,
  age: 40,
  profession: '',
  lastVisit: '2026-10-27',
  status: 'retorno',
  diagnoses: [],
  medications: [],
  allergies: [],
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReset();
  mocks.loadDraft.mockResolvedValue(null);
  mocks.rescued.mockResolvedValue([]);
  mocks.saveDraft.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({ error: null });
  mocks.download.mockResolvedValue({ data: new Blob(['audio']), error: null });
  Object.assign(mocks.capture, { isRecording: false, isStarting: false, isStopping: false });
  mocks.invoke.mockResolvedValue({ data: { questions: [] }, error: null });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
afterEach(()=>vi.restoreAllMocks());

describe('patient-scoped asynchronous clinical work', () => {
  it('offers post-consultation follow-up only for the latest persisted SOAP without issuing commands',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),work=vi.fn();
    const soap={id:'soap',type:'soap' as const,title:'Evolução salva',content:'SOAP sintético',timestamp:new Date(),consultationId:'consultation-A'};
    const tree=(messages:ChatMessage[])=><QueryClientProvider client={client}><ChatPanel patient={patient('A')} userId="doctor" messages={messages} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} onOpenPatientWork={work}/></QueryClientProvider>;
    const v=render(tree([soap]));const panel=await screen.findByRole('region',{name:'Pós-consulta'});
    fireEvent.click(within(panel).getByRole('button',{name:'Registrar orientações'}));expect(work).toHaveBeenCalledExactlyOnceWith(false,'instruction');expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button',{name:'Planejar retorno'}));expect(work).toHaveBeenLastCalledWith(false,'followup');
    v.rerender(tree([soap,{...soap,id:'draft',consultationId:undefined}]));expect(screen.queryByRole('region',{name:'Pós-consulta'})).not.toBeInTheDocument();
  });
  it('uses the saved SOAP content for an explicit post-consultation summary',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><ChatPanel patient={patient('A')} userId="doctor" messages={[{id:'soap',type:'soap',title:'Evolução salva',content:'SOAP da consulta escolhida',timestamp:new Date(),consultationId:'consultation-A'}]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false}/></QueryClientProvider>);
    const panel=await screen.findByRole('region',{name:'Pós-consulta'});expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button',{name:'Resumo para o paciente'}));
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('generate-document',expect.objectContaining({body:expect.objectContaining({type:'patient_summary',soapNote:'SOAP da consulta escolhida'})})));
  });
  it.each(['preserve','discard'])('does not reload while a %s draft mutation is pending', async mode => {
    const request=deferred();
    mocks.loadDraft.mockResolvedValue({id:'draft-A',patientId:'A',status:mode==='preserve'?'review':'error',soapDraft:'Rascunho sintético',chiefComplaint:'Queixa sintética'});
    if(mode==='preserve')mocks.saveDraft.mockReturnValue(request.promise);else mocks.invoke.mockReturnValue(request.promise);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    client.setQueryData(['consultation-recovery','doctor'],[]);
    client.setQueryData(['consultation-recovery','other-doctor'],[]);
    const props={messages:[],onMessagesChange:vi.fn(),chiefComplaint:'',preBriefing:null,briefingLoading:false,userId:'doctor',patient:patient('A')};
    const chart=(recoveryRequest:number)=><QueryClientProvider client={client}><ChatPanel {...props} recoveryRequest={recoveryRequest}/></QueryClientProvider>;
    const {rerender}=render(chart(0));
    const action=await screen.findByRole('button',{name:mode==='preserve'?'Voltar depois':'Excluir rascunho'});
    vi.spyOn(window,'confirm').mockReturnValue(true); fireEvent.click(action);
    await waitFor(()=>expect(mode==='preserve'?mocks.saveDraft:mocks.invoke).toHaveBeenCalledTimes(1));
    rerender(chart(1)); await act(async()=>{});
    expect(mocks.loadDraft).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Consulta em andamento'}));
    await act(async()=>request.resolve(mode==='preserve'?undefined:{data:{},error:null}));
    expect(mocks.loadDraft).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(['consultation-recovery','doctor'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['consultation-recovery','other-doctor'])?.isInvalidated).toBe(false);
  });
  it('rereads a saved draft when Home explicitly resumes the same mounted patient', async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    const props = { messages: [], onMessagesChange: vi.fn(), chiefComplaint: '', preBriefing: null, briefingLoading: false, userId: 'doctor' };
    const chart = (recoveryRequest: number) => <QueryClientProvider client={client}><ChatPanel {...props} patient={patient('A')} recoveryRequest={recoveryRequest} /></QueryClientProvider>;
    const {rerender}=render(chart(0));
    await waitFor(()=>expect(mocks.loadDraft).toHaveBeenCalledTimes(1));
    mocks.loadDraft.mockResolvedValue({id:'draft-A',patientId:'A',status:'review',soapDraft:'Revisão salva em outra aba',chiefComplaint:'Queixa sintética'});
    rerender(chart(1));
    expect(await screen.findByText('Revisão salva em outra aba')).toBeVisible();
    expect(mocks.loadDraft).toHaveBeenCalledTimes(2);
    expect(mocks.rescued).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
  it('preserves unsent text when the doctor declines a same-patient reload', async () => {
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const props={messages:[],onMessagesChange:vi.fn(),chiefComplaint:'',preBriefing:null,briefingLoading:false,userId:'doctor',patient:patient('A')};
    const chart=(recoveryRequest:number)=><QueryClientProvider client={client}><ChatPanel {...props} recoveryRequest={recoveryRequest}/></QueryClientProvider>;
    const {rerender}=render(chart(0)); await act(async()=>{});
    fireEvent.change(screen.getByLabelText('Pergunta ao assistente clínico'),{target:{value:'Texto sintético não enviado'}});
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    rerender(chart(1)); await act(async()=>{});
    expect(screen.getByLabelText('Pergunta ao assistente clínico')).toHaveValue('Texto sintético não enviado');
    expect(mocks.loadDraft).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Textos não salvos'));
    expect(mocks.rescued).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
  it('does not reset pending non-audio work or retry automatically after it finishes', async () => {
    const request=deferred(); mocks.invoke.mockReturnValue(request.promise);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const props={messages:[],onMessagesChange:vi.fn(),chiefComplaint:'',preBriefing:null,briefingLoading:false,userId:'doctor',patient:patient('A')};
    const chart=(recoveryRequest:number)=><QueryClientProvider client={client}><ChatPanel {...props} recoveryRequest={recoveryRequest}/></QueryClientProvider>;
    const {rerender}=render(chart(0)); await act(async()=>{});
    fireEvent.change(screen.getByLabelText('Pergunta ao assistente clínico'),{target:{value:'Pergunta sintética'}});
    fireEvent.click(screen.getByRole('button',{name:'Enviar pergunta'}));
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
    rerender(chart(1)); await act(async()=>{});
    expect(mocks.loadDraft).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Consulta em andamento'}));
    await act(async()=>request.resolve({data:{message:'Resposta sintética',sources:[]},error:null}));
    expect(mocks.loadDraft).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('generates questions only on request and clears checks for another patient with the same questions', async () => {
    mocks.invoke.mockResolvedValue({ data: { questions: ['Como está seu sono?'] }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { messages: [], onMessagesChange: vi.fn(), chiefComplaint: '', preBriefing: null, briefingLoading: false, userId: 'doctor' };
    const chart = (id: string) => <QueryClientProvider client={client}><ChatPanel {...props} patient={patient(id)} /></QueryClientProvider>;
    const { rerender } = render(chart('A'));
    await act(async () => {});
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar roteiro com IA' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Como está seu sono?' }));
    expect(screen.getByText('1/1')).toBeInTheDocument();
    rerender(chart('B'));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar roteiro com IA' }));
    expect(await screen.findByRole('checkbox', { name: 'Como está seu sono?' })).not.toBeChecked();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
  it('does not resend protocol-derived assistant replies in automatic chat history', async () => {
    mocks.invoke.mockResolvedValue({ data: { message: 'Resposta atual', questions: [], sources: [] }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const old = {
      id: 'old',
      type: 'assistant' as const,
      title: 'Anterior',
      content: 'Fonte posteriormente revogada',
      timestamp: new Date(),
      sources: [
        {
          id: 'doc',
          type: 'knowledge',
          label: 'Protocolo',
          date: '2026-10-28',
          excerpt: 'Trecho',
          authorizationRevision: 2,
          sourceReviewRevision: 3,
        },
      ],
    };
    render(
      <QueryClientProvider client={client}>
        <ChatPanel
          patient={patient('A')}
          messages={[old]}
          onMessagesChange={vi.fn()}
          chiefComplaint=""
          preBriefing={null}
          briefingLoading={false}
          userId="doctor"
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Pergunta ao assistente clínico'), { target: { value: 'Pergunta nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        'chat-assistant',
        expect.objectContaining({ body: expect.objectContaining({ chatHistory: [] }) }),
      ),
    );
  });
  it('accepts a reviewed medication change by revision even when storage uses the legacy dose shape', async () => {
    const legacyRow = {
      revision: 7,
      medications: [{ dose: '50 mg', name: 'Losartana' }],
      diagnoses: [],
      allergies: [],
    };
    mocks.from.mockImplementation(() => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: legacyRow, error: null }),
        update: (value: unknown) => {
          mocks.profileUpdate(value);
          return query;
        },
        maybeSingle: async () => ({ data: { id: 'A' }, error: null }),
      };
      return query;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const current = {
      ...patient('A'),
      revision: 7,
      medications: [{ name: 'Losartana', dosage: '50 mg', instructions: '' }],
    };
    const messages = [
      {
        id: 'profile',
        type: 'profile-update' as const,
        title: 'Atualizar',
        content: '',
        timestamp: new Date(),
        profileUpdates: {
          diagnoses: [],
          allergies: [],
          medications: [{ name: 'Losartana', dosage: '100 mg', instructions: '1x/dia' }],
        },
      },
    ];
    render(
      <QueryClientProvider client={client}>
        <ChatPanel
          patient={current}
          messages={messages}
          onMessagesChange={vi.fn()}
          chiefComplaint=""
          preBriefing={null}
          briefingLoading={false}
          userId="doctor"
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e salvar' }));
    await screen.findByText('Perfil clínico atualizado com as informações desta consulta.');
    expect(mocks.profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        medications: [expect.objectContaining({ name: 'Losartana', dosage: '100 mg', instructions: '1x/dia' })],
      }),
    );
  });
  for (const mode of ['question', 'comment'])
    it(`never appends patient A's delayed ${mode} result to patient B`, async () => {
      const pending = deferred();
      mocks.invoke.mockImplementation((name: string) =>
        name === (mode === 'question' ? 'chat-assistant' : 'process-comment')
          ? pending.promise
          : Promise.resolve({ data: { questions: [] }, error: null }),
      );
      const onMessagesChange = vi.fn();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const props = {
        messages: [],
        onMessagesChange,
        chiefComplaint: '',
        preBriefing: null,
        briefingLoading: false,
        userId: 'doctor',
      };
      const view = render(
        <QueryClientProvider client={client}>
          <ChatPanel {...props} patient={patient('A')} />
        </QueryClientProvider>,
      );
      if (mode === 'comment') fireEvent.click(screen.getByText('Comentário'));
      const input = screen.getByRole('textbox', {
        name: mode === 'question' ? 'Pergunta ao assistente clínico' : 'Comentário clínico para este paciente',
      });
      fireEvent.change(input, { target: { value: 'Informação exclusiva de A' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith(
          mode === 'question' ? 'chat-assistant' : 'process-comment',
          expect.anything(),
        ),
      );
      onMessagesChange.mockClear();
      view.rerender(
        <QueryClientProvider client={client}>
          <ChatPanel {...props} patient={patient('B')} />
        </QueryClientProvider>,
      );
      await act(async () => {
        pending.resolve({ data: { message: 'Resposta de A', summary: 'Alergia de A' }, error: null });
      });
      expect(onMessagesChange).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'Paciente B' })).toBeInTheDocument();
    });
});

describe('recoverable clinical review', () => {
  it('registers the source path again after its first save failed before uploading', async () => {
    let failPath = true;
    let registeredPath: string | null = null;
    mocks.saveDraft.mockImplementation(async (_user: string, draft: { audioStoragePath: string | null }) => {
      if (draft.audioStoragePath && failPath) { failPath = false; throw new Error('Synthetic path save failure'); }
      registeredPath = draft.audioStoragePath;
    });
    mocks.invoke.mockImplementation(async (name: string, args: { body: { audioStoragePath: string } }) => {
      if (name !== 'transcribe-consultation') return { error: null, data: { questions: [] } };
      expect(args.body.audioStoragePath).toBe(registeredPath);
      return { error: null, data: { transcription: 'Transcrição recuperada', soapNote: 'Revisão após reenviar', draftPersisted: true } };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChatPanel patient={patient('A')} messages={[]} onMessagesChange={vi.fn()} chiefComplaint="Dor" preBriefing={null} briefingLoading={false} userId="doctor" /></QueryClientProvider>);
    await act(async () => { await mocks.recording.onStop!(new Blob(['audio']), 'audio/webm', []); });
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar áudio' }));
    await screen.findByText('Revisão após reenviar');
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(registeredPath).toBeTruthy();
  });
  it('does not upsert an old recovery snapshot before processing stored audio', async () => {
    mocks.loadDraft.mockResolvedValue({ id: 'draft-A', patientId: 'A', chiefComplaint: 'Dor', status: 'error', audioStoragePath: 'consultations/doctor/draft-A.webm', audioMimeType: 'audio/webm', originalComments: ['Comentário antigo'] });
    mocks.invoke.mockImplementation(async (name: string) => ({ error: null, data: name === 'transcribe-consultation' ? { transcription: 'Nova transcrição', soapNote: '', draftPersisted: false, draftPersistenceFailed: true } : { questions: [] } }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChatPanel patient={patient('A')} messages={[]} onMessagesChange={vi.fn()} chiefComplaint="Dor" preBriefing={null} briefingLoading={false} userId="doctor" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar consulta' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('transcribe-consultation', expect.anything()));
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('reports capture busy while permission, recording, or a native stop event is pending', async () => {
    const onCaptureStateChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      patient: patient('A'),
      messages: [],
      onMessagesChange: vi.fn(),
      chiefComplaint: '',
      preBriefing: null,
      briefingLoading: false,
      userId: 'doctor',
      onCaptureStateChange,
    };
    const content = () => (
      <QueryClientProvider client={client}>
        <ChatPanel {...props} />
      </QueryClientProvider>
    );
    const view = render(content());
    for (const state of ['isStarting', 'isRecording', 'isStopping'] as const) {
      Object.assign(mocks.capture, { isStarting: false, isRecording: false, isStopping: false, [state]: true });
      view.rerender(content());
      await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(true));
    }
    mocks.capture.isStopping = false;
    view.rerender(content());
    await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(false));
  });
  it('keeps raw audio busy after a patient switch until its asynchronous upload finishes', async () => {
    const upload = deferred();
    mocks.upload.mockReturnValue(upload.promise);
    const onCaptureStateChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      messages: [],
      onMessagesChange: vi.fn(),
      chiefComplaint: '',
      preBriefing: null,
      briefingLoading: false,
      userId: 'doctor',
      onCaptureStateChange,
    };
    const view = render(
      <QueryClientProvider client={client}>
        <ChatPanel {...props} patient={patient('A')} />
      </QueryClientProvider>,
    );
    let processing!: Promise<void>;
    act(() => {
      processing = mocks.recording.onStop!(new Blob(['voice']), 'audio/webm', []);
    });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    view.rerender(
      <QueryClientProvider client={client}>
        <ChatPanel {...props} patient={patient('B')} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(true));
    await act(async () => {
      upload.resolve({ error: null });
      await processing;
    });
    await waitFor(() => expect(onCaptureStateChange).toHaveBeenLastCalledWith(false));
  });
  it.each([true, false])('does not overwrite a server checkpoint after processing (persisted=%s)', async (persisted) => {
    mocks.invoke.mockImplementation(async (name: string) => ({ error: null, data: name === 'transcribe-consultation'
      ? { transcription: 'Transcrição preservada', soapNote: 'Texto para revisão', whatsappMessage: '', clarifications: [], draftPersisted: persisted, draftPersistenceFailed: !persisted, aiMetadata: { transcription: { provider: 'openai', requestedModel: 'gpt-transcribe' } } }
      : { questions: [] } }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChatPanel patient={patient('A')} messages={[]} onMessagesChange={vi.fn()} chiefComplaint="Dor" preBriefing={null} briefingLoading={false} userId="doctor" /></QueryClientProvider>);
    await act(async () => { await mocks.recording.onStop!(new Blob(['audio']), 'audio/webm', []); });
    expect(screen.getByText('Texto para revisão')).toBeInTheDocument();
    expect(mocks.saveDraft.mock.calls.every(([, draft]) => draft.status === 'processing')).toBe(true);
  });
  it('never overwrites a server transcript when the processing response is interrupted', async () => {
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === 'transcribe-consultation') throw new Error('Synthetic interrupted response');
      return { error: null, data: { questions: [] } };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChatPanel patient={patient('A')} messages={[]} onMessagesChange={vi.fn()} chiefComplaint="Dor" preBriefing={null} briefingLoading={false} userId="doctor" /></QueryClientProvider>);
    await act(async () => { await mocks.recording.onStop!(new Blob(['audio']), 'audio/webm', []); });
    expect(mocks.saveDraft.mock.calls.every(([, draft]) => draft.status === 'processing')).toBe(true);
  });
  it('never autosaves a good draft; keeps physician comments when regenerating and saves only the reviewed revision', async () => {
    mocks.invoke.mockImplementation((name: string, { body }: { body: { saveDirect?: boolean } }) =>
      Promise.resolve({
        error: null,
        data:
          name === 'suggest-questions'
            ? { questions: [] }
            : name === 'transcribe-consultation'
              ? {
                  transcription: 'Consulta',
                  soapNote: 'Rascunho original',
                  whatsappMessage: '',
                  transcriptionQuality: 'good',
                  clarifications: [],
                }
              : body.saveDirect
                ? {
                    consultationId: 'saved',
                    soapNote: 'Rascunho corrigido',
                    whatsappMessage: '',
                    profileUpdates: { diagnoses: [], medications: [], allergies: [] },
                  }
                : { previewOnly: true, soapNote: 'Rascunho corrigido', whatsappMessage: '' },
      }),
    );
    const onMessagesChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ChatPanel
          patient={patient('A')}
          messages={[]}
          onMessagesChange={onMessagesChange}
          chiefComplaint="Dor"
          preBriefing={null}
          briefingLoading={false}
          userId="doctor"
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.loadDraft).toHaveBeenCalled());
    await act(async () => {
      await mocks.recording.onStop!(new Blob(['audio']), 'audio/webm', ['Correção durante gravação']);
    });
    const registeredPath = mocks.saveDraft.mock.calls.findIndex(([, draft]) => !!draft.audioStoragePath);
    expect(registeredPath).toBeGreaterThanOrEqual(0);
    expect(mocks.saveDraft.mock.invocationCallOrder[registeredPath]).toBeLessThan(
      mocks.upload.mock.invocationCallOrder[0],
    );
    expect(screen.getByText('Rascunho original')).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'finalize-consultation')).toHaveLength(0);
    fireEvent.click(screen.getByText('Regerar rascunho'));
    await screen.findByText('Rascunho corrigido');
    expect(mocks.invoke).toHaveBeenCalledWith('finalize-consultation', {
      body: expect.objectContaining({
        doctorComments: 'Correção durante gravação\n\nCorreção adicional',
        previewOnly: true,
      }),
    });
    expect(onMessagesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirmar revisão'));
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith('finalize-consultation', {
      body: expect.objectContaining({ saveDirect: true, reviewed: true, soapNote: 'Rascunho corrigido' }),
    });
  });
});
