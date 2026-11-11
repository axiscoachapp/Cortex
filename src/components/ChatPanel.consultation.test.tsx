// Consultation screen behaviours from the 2026-11-10 review (round 2): the
// safety row below the desktop frame, long recordings, comment proposals,
// failed questions, saved-note edits and the first card. Synthetic data only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage, Patient } from '@/types/patient';
import { ChatPanel } from './ChatPanel';
import { lastConsultationLabel } from '@/lib/dates';
import { FAILURE_SENTENCES } from '@/lib/functionErrors';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
  capture: { isRecording: false, isStarting: false, isStopping: false, recordedBytes: 0, recordingSeconds: 0 },
  recording: {
    onStop: null as null | ((blob: Blob, mime: string, comments: string[], capture?: { captureId: string; startedAt: string }) => Promise<void>),
  },
}));
vi.mock('@/components/ClinicalProposals', () => ({ ClinicalProposals: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: mocks.invoke },
    storage: { from: () => ({ upload: mocks.upload, download: mocks.download, exists: async () => ({ data: true }) }) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ specialty: 'geral', liveCopilotEnabled: false, activeTemplateId: null, prescriber: {} }),
}));
vi.mock('@/hooks/useRecording', () => ({
  useRecording: (options: { onStop: typeof mocks.recording.onStop }) => {
    mocks.recording.onStop = options.onStop;
    return { ...mocks.capture, isPaused: false, stopConfirming: false, audioLevel: 0, mode: 'presencial', confirmStop: vi.fn(), cancelStop: vi.fn(), discard: vi.fn(), stop: vi.fn(), pauseToggle: vi.fn(), start: vi.fn() };
  },
}));
vi.mock('@/lib/consultationDrafts', () => ({ loadConsultationDraft: mocks.loadDraft, saveConsultationDraft: mocks.saveDraft }));
vi.mock('@/lib/recordingRescue', () => ({
  listRescuedRecordings: async () => [],
  saveRescuedRecording: vi.fn(async () => undefined),
  saveRecordingCheckpoint: vi.fn(async () => undefined),
  deleteRescuedRecording: vi.fn(async () => undefined),
}));
vi.mock('@/lib/recordingCaptureLock', () => ({ capturesInProgress: async () => new Set(), tryHoldCaptureLock: async () => () => {} }));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null, UsageOverBanner: () => null }));
vi.mock('@/components/LiveCopilotCard', () => ({ LiveCopilotCard: () => null }));
vi.mock('@/components/ConsultationReviewModal', () => ({
  ConsultationReviewModal: ({ open, onConfirm }: { open: boolean; onConfirm: (comments: string) => void }) =>
    open ? <button onClick={() => onConfirm('')}>Confirmar revisão</button> : null,
}));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/components/DocumentComposerModal', () => ({ DocumentComposerModal: () => null }));
vi.mock('@/components/RecordingModeDialog', () => ({ RecordingModeDialog: () => null }));

const base: Patient = {
  id: 'A', name: 'Paciente sintética', age: 40, profession: '', lastVisit: '2026-10-12', status: 'retorno',
  diagnoses: [], medications: [], allergies: [],
};
const httpError = (status: number, body: Record<string, unknown>) => ({ context: { status, json: async () => body } });

/** A chain for supabase.from(table) answering the latest-consultation read and the note edit. */
function tables(options: { latest?: Record<string, unknown> | null; update?: () => Promise<unknown> } = {}) {
  mocks.from.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit']) chain[op] = () => chain;
    let updating = false;
    chain.update = () => { updating = true; return chain; };
    chain.maybeSingle = () => updating && options.update ? options.update()
      : Promise.resolve({ data: updating ? { id: 'consultation-A' } : options.latest === undefined ? { soap_note: 'S: nota antiga', revision: 3 } : options.latest, error: null });
    return chain;
  });
}

function renderPanel(props: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onMessagesChange = vi.fn();
  const onWorkStateChange = vi.fn();
  const tree = (extra: Partial<Parameters<typeof ChatPanel>[0]> = {}) => (
    <QueryClientProvider client={client}>
      <ChatPanel patient={base} userId="doctor" messages={[]} onMessagesChange={onMessagesChange} onWorkStateChange={onWorkStateChange}
        chiefComplaint="" preBriefing={null} briefingLoading={false} {...props} {...extra} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, onMessagesChange, onWorkStateChange, rerenderWith: (extra: Partial<Parameters<typeof ChatPanel>[0]>) => view.rerender(tree(extra)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadDraft.mockResolvedValue(null);
  mocks.saveDraft.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({ error: null });
  mocks.download.mockResolvedValue({ data: new Blob(['audio']), error: null });
  Object.assign(mocks.capture, { isRecording: false, isStarting: false, isStopping: false, recordedBytes: 0, recordingSeconds: 0 });
  mocks.invoke.mockResolvedValue({ data: { questions: [] }, error: null });
  tables({ latest: null });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('clinical safety row (below the desktop frame)', () => {
  it('shows each allergy in red, the medication count and the main diagnoses, opening the patient panel', async () => {
    const onOpenPatientPanel = vi.fn();
    renderPanel({
      onOpenPatientPanel,
      patient: { ...base, allergies: ['Dipirona', 'Penicilina'], medications: [{ name: 'Losartana', dosage: '50 mg', instructions: '' }],
        diagnoses: [{ code: 'N95.1', description: 'Menopausa' }, { code: '', description: 'Hipertensão' }, { code: 'E11', description: 'Diabetes' }] },
    });
    const row = await screen.findByRole('button', { name: /Abrir painel do paciente/ });
    expect(row.className).toContain('shell:hidden');
    expect(within(row).getByText('Alergia: Dipirona').className).toContain('text-destructive');
    expect(within(row).getByText('Alergia: Penicilina')).toBeInTheDocument();
    expect(within(row).getByText('1 medicação em uso')).toBeInTheDocument();
    expect(within(row).getByText('N95.1')).toBeInTheDocument();
    expect(within(row).getByText('Hipertensão')).toBeInTheDocument();
    expect(within(row).getByText('+1')).toBeInTheDocument();
    fireEvent.click(row);
    expect(onOpenPatientPanel).toHaveBeenCalledTimes(1);
  });

  it('says so when no allergy is recorded', async () => {
    renderPanel({ onOpenPatientPanel: vi.fn() });
    const row = await screen.findByRole('button', { name: /Abrir painel do paciente/ });
    expect(within(row).getByText('Sem alergias registradas')).toBeInTheDocument();
    expect(within(row).getByText('Sem medicações em uso')).toBeInTheDocument();
  });
});

describe('long recordings', () => {
  it('never uploads audio above the server limit and offers what can still be done', async () => {
    const onOpenPatientWork = vi.fn();
    renderPanel({ onOpenPatientWork });
    await act(async () => {});
    const huge = new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: 'audio/webm' });
    await act(async () => { await mocks.recording.onStop!(huge, 'audio/webm', [], { captureId: 'capture-1', startedAt: '2026-11-11T09:00:00.000Z' }); });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith('transcribe-consultation', expect.anything());
    // Said above the composer, not in a toast.
    expect(await screen.findByText(/passa de 25 MB e não pode ser processada pela IA/)).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(await screen.findByText(/passa do limite de 25 MB/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tentar enviar de novo|Processar gravação|Reenviar áudio/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar cópia do áudio' })).toBeInTheDocument();
    // The header has its own "Escrever evolução"; the card's is the last one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Escrever evolução' }).at(-1)!);
    expect(onOpenPatientWork).toHaveBeenCalledWith(true);
  });

  it('answers a 413 for a stored recording with the available actions instead of a retry', async () => {
    mocks.loadDraft.mockResolvedValue({
      id: 'draft-A', patientId: 'A', status: 'error', audioStoragePath: 'consultations/doctor/draft-A.webm', audioMimeType: 'audio/webm',
      originalComments: [], chiefComplaint: '', transcription: '', soapDraft: '', whatsappDraft: '', clarifications: [],
    });
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'transcribe-consultation'
        ? { data: null, error: httpError(413, { error: 'Áudio vazio ou acima de 25 MB. Divida a gravação antes de processar.' }) }
        : { data: { questions: [] }, error: null });
    renderPanel({ onOpenPatientWork: vi.fn() });
    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar consulta' }));
    expect(await screen.findByText('Esta gravação é grande demais para a IA processar.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recuperar consulta' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir rascunho' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar cópia do áudio' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalled());
  });

  it('warns in the recording banner before the size limit, with the time left', async () => {
    Object.assign(mocks.capture, { isRecording: true, recordedBytes: 21 * 1024 * 1024, recordingSeconds: 21 * 60 });
    renderPanel();
    expect(await screen.findByText(/Gravação perto do limite de tamanho \(cerca de 3 min restantes\)/)).toBeInTheDocument();
  });
});

describe('open consultation while away from it', () => {
  it('the capture banner names the patient as a link back to the consultation', async () => {
    Object.assign(mocks.capture, { isRecording: true });
    const onReturnToConsultation = vi.fn();
    renderPanel({ onReturnToConsultation });
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar à consulta de Paciente sintética' }));
    expect(onReturnToConsultation).toHaveBeenCalledTimes(1);
  });
});

describe('comment proposals', () => {
  const card = (status?: 'pending' | 'done' | 'dismissed'): ChatMessage => ({
    id: 'proposal-1', type: 'comment-proposal', title: 'Revisar', content: 'alergia a dipirona', timestamp: new Date(),
    commentProposal: { patientId: 'A', comment: 'alergia a dipirona', expectedRevision: 2, status,
      proposal: { allergies: ['Dipirona'], medicationsAdd: [], medicationsRemove: [], diagnoses: [], addendum: '', longTermNote: '', summary: '' } },
  });

  it('counts a pending proposal as unsaved work and keeps its outcome on the message', async () => {
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'process-comment' ? { data: { applied: true, summary: 'Alergia adicionada' }, error: null } : { data: { questions: [] }, error: null });
    const { onWorkStateChange, onMessagesChange, rerenderWith } = renderPanel({ messages: [card()] });
    await waitFor(() => expect(onWorkStateChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: /Aplicar selecionados/ }));
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalled());
    const update = onMessagesChange.mock.calls[0][0] as (previous: ChatMessage[]) => ChatMessage[];
    const [stored] = update([card()]);
    expect(stored.commentProposal).toMatchObject({ status: 'done', summary: 'Alergia adicionada' });
    rerenderWith({ messages: [stored] });
    await waitFor(() => expect(onWorkStateChange).toHaveBeenLastCalledWith(false));
  });
});

describe('failed questions and server messages', () => {
  it('keeps a failed question in the thread with a retry, and says why', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: httpError(409, { error: 'Esta pergunta já está em processamento.' }) })
      .mockResolvedValueOnce({ data: { message: 'Resposta sintética', sources: [] }, error: null });
    let messages: ChatMessage[] = [];
    const { rerenderWith } = renderPanel({
      onMessagesChange: (value) => { messages = typeof value === 'function' ? value(messages) : value; },
    });
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Pergunta ao assistente clínico'), { target: { value: 'Qual a conduta?' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' })); });
    rerenderWith({ messages, onMessagesChange: (value) => { messages = typeof value === 'function' ? value(messages) : value; } });
    expect(screen.getByText('Qual a conduta?')).toBeInTheDocument();
    expect(screen.getByText(/Não enviada/)).toBeInTheDocument();
    // A fixed sentence above the composer, never the server's own text, and no toast.
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE_SENTENCES.question);
    expect(screen.queryByText('Esta pergunta já está em processamento.')).not.toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pergunta ao assistente clínico')).toHaveValue('');
    const firstTurn = mocks.invoke.mock.calls[0][1].body.conversationId;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); });
    expect(mocks.invoke.mock.calls[1][1].body).toMatchObject({ conversationId: firstTurn, userMessage: 'Qual a conduta?' });
    rerenderWith({ messages, onMessagesChange: (value) => { messages = typeof value === 'function' ? value(messages) : value; } });
    expect(screen.queryByText(/Não enviada/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(messages.filter((message) => message.type === 'user')).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'chat-assistant')).toHaveLength(2);
  });

  it('shows the server message when the reviewed note cannot be saved', async () => {
    mocks.loadDraft.mockResolvedValue({ id: 'draft-A', patientId: 'A', status: 'review', soapDraft: 'S: rascunho', originalComments: [], chiefComplaint: '' });
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'finalize-consultation'
        ? { data: null, error: httpError(409, { error: 'Esta consulta já foi registrada com outro conteúdo.' }) }
        : { data: { questions: [] }, error: null });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar revisão' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Erro ao gerar evolução', description: 'Esta consulta já foi registrada com outro conteúdo.',
    })));
  });
});

describe('editing a saved note in the chat', () => {
  const soap: ChatMessage = { id: 'soap-1', type: 'soap', title: 'Evolução', content: 'S: nota antiga', timestamp: new Date(), consultationId: 'consultation-A' };

  it('can be cancelled without saving', async () => {
    tables();
    renderPanel({ messages: [soap] });
    fireEvent.click(await screen.findByRole('button', { name: 'Editar evolução' }));
    fireEvent.change(await screen.findByLabelText('Editar evolução clínica'), { target: { value: 'S: mudou' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edição da evolução' }));
    expect(screen.queryByLabelText('Editar evolução clínica')).not.toBeInTheDocument();
    expect(screen.getByText('S: nota antiga')).toBeInTheDocument();
  });

  it('sends one update for a double click on save', async () => {
    let finish!: (value: unknown) => void;
    const update = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    tables({ update });
    renderPanel({ messages: [soap] });
    fireEvent.click(await screen.findByRole('button', { name: 'Editar evolução' }));
    await screen.findByLabelText('Editar evolução clínica');
    const save = screen.getByRole('button', { name: 'Salvar edição da evolução' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { id: 'consultation-A' }, error: null }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Erro ao salvar alterações' }));
  });
});

describe('first card of the chart', () => {
  it('names the last consultation in a neutral card, shows its note on request and summarises only on request', async () => {
    tables({ latest: { id: 'c1', created_at: '2026-10-12T13:00:00.000Z', chief_complaint: 'Retorno com exames', soap_note: '**S:** Sem queixas.' } });
    const onRetryBriefing = vi.fn();
    renderPanel({ onRetryBriefing });
    const card = await screen.findByRole('region', { name: 'Antes da consulta' });
    const label = lastConsultationLabel('2026-10-12T13:00:00.000Z');
    expect(label).toMatch(/^12\/10\/2026 · /);
    expect(await within(card).findByRole('heading', { name: `Última consulta: ${label} — Retorno com exames` })).toBeInTheDocument();
    expect(card.className).not.toContain('alert-briefing');
    expect(within(card).queryByText(/Prontuário aberto para visualização/)).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Ver evolução' }));
    expect(within(card).getByText(/Sem queixas/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith('generate-prebriefing', expect.anything());
    fireEvent.click(within(card).getByRole('button', { name: 'Resumir com IA' }));
    expect(onRetryBriefing).toHaveBeenCalledTimes(1);
  });

  it('labels the record button and drops the idle hint line', async () => {
    renderPanel();
    const record = await screen.findByRole('button', { name: 'Gravar consulta' });
    expect(within(record).getByText('Gravar consulta')).toBeInTheDocument();
    expect(screen.queryByText(/Grave com o botão vermelho/)).not.toBeInTheDocument();
  });
});

// Round 3 (2026-11-11): calm on a phone, errors where the doctor is looking.
describe('consultation header and composer on a phone (M 3, M 13)', () => {
  it('puts the actions in one "Ações" menu below sm, with the agreed names, and keeps the buttons from sm up', async () => {
    const onOpenPatientWork = vi.fn();
    renderPanel({ onOpenPatientWork });
    const menu = await screen.findByRole('button', { name: 'Ações' });
    expect(menu.className).toContain('sm:hidden');
    const desktop = screen.getByRole('button', { name: 'Pendências e retornos' }).parentElement!;
    expect(desktop.className).toContain('hidden sm:flex');
    expect(within(desktop).getByRole('button', { name: 'Escrever evolução' })).toBeInTheDocument();
    expect(within(desktop).getByRole('button', { name: /Receita \/ atestado/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consulta manual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acompanhamento' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(menu);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Escrever evolução', 'Pendências e retornos', 'Receita / atestado', 'Anexar documento',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Pendências e retornos' }));
    expect(onOpenPatientWork).toHaveBeenCalledWith(false);
  });

  it('keeps the safety chips under the name next to the menu', async () => {
    renderPanel({ onOpenPatientPanel: vi.fn(), patient: { ...base, allergies: ['Dipirona'] } });
    const row = await screen.findByRole('button', { name: /Abrir painel do paciente/ });
    expect(within(row).getByText('Alergia: Dipirona')).toBeInTheDocument();
    expect(row.className.split(' ')).not.toContain('hidden');
  });

  it('is one row on the phone: mode switch, field (with send inside) and microphone; no usage chip or hint row', async () => {
    renderPanel();
    const field = await screen.findByLabelText('Pergunta ao assistente clínico');
    const toggle = screen.getByRole('button', { name: 'Modo pergunta. Trocar para comentário' });
    expect(toggle.className).toContain('sm:hidden');
    const row = toggle.parentElement!;
    expect(within(row).getByLabelText('Pergunta ao assistente clínico')).toBe(field);
    expect(within(row).getByRole('button', { name: 'Gravar consulta' })).toBeInTheDocument();
    expect(field.parentElement).toContainElement(screen.getByRole('button', { name: 'Enviar pergunta' }));
    // The Pergunta/Comentário segments, the hint and the usage chip share a row hidden below sm.
    const segments = screen.getByRole('button', { name: 'Pergunta', pressed: true }).parentElement!.parentElement!;
    expect(segments.className).toContain('hidden sm:flex');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Comentário clínico para este paciente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modo comentário. Trocar para pergunta' })).toBeInTheDocument();
  });
});

describe('failures above the composer (M 11)', () => {
  const comment = async (text: string) => {
    fireEvent.click(await screen.findByRole('button', { name: 'Comentário', pressed: false }));
    fireEvent.change(screen.getByLabelText('Comentário clínico para este paciente'), { target: { value: text } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adicionar comentário' })); });
  };

  it('shows a failed comment as a plain alert right above the composer, puts the text back, and can be closed', async () => {
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'process-comment'
        ? { data: null, error: httpError(500, { error: 'TypeError: Cannot read properties of undefined' }) }
        : { data: { questions: [] }, error: null });
    renderPanel();
    await comment('alergia a dipirona');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(FAILURE_SENTENCES.comment);
    expect(alert).not.toHaveTextContent(/TypeError/);
    expect(mocks.toast).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Comentário clínico para este paciente');
    // Right above the composer: the next element is the box holding the field.
    expect(alert.nextElementSibling).toContainElement(field);
    expect(field).toHaveValue('alergia a dipirona');
    fireEvent.click(within(alert).getByRole('button', { name: 'Fechar aviso' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a written 422 instruction from our function, since it says what to fix', async () => {
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'process-comment'
        ? { data: null, error: httpError(422, { error: 'Informe qual medicamento deve ser suspenso.' }) }
        : { data: { questions: [] }, error: null });
    renderPanel();
    await comment('suspender');
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe qual medicamento deve ser suspenso.');
  });

  it("does not carry one patient's failure to the next patient", async () => {
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'process-comment' ? { data: null, error: httpError(500, {}) } : { data: { questions: [] }, error: null });
    const { rerenderWith } = renderPanel();
    await comment('nota');
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE_SENTENCES.comment);
    rerenderWith({ patient: { ...base, id: 'B', name: 'Outra paciente sintética' } });
    expect(screen.queryByText(FAILURE_SENTENCES.comment)).not.toBeInTheDocument();
  });

  it('says a full AI quota above the composer with what to do', async () => {
    mocks.invoke.mockImplementation(async (name: string) =>
      name === 'chat-assistant'
        ? { data: null, error: httpError(429, { error: 'quota', quotaExceeded: true }) }
        : { data: { questions: [] }, error: null });
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Pergunta ao assistente clínico'), { target: { value: 'Qual a conduta?' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/limite diário de uso da IA foi atingido.*registre manualmente/);
    expect(screen.getByLabelText('Pergunta ao assistente clínico')).toHaveValue('Qual a conduta?');
  });
});
