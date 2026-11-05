// "Gerar e assinar" in the consultation panel (D17): generate once, then sign
// exactly the persisted document (its id and PDF hash), keeping the operation;
// a signature that does not complete never undoes nor repeats the generation.
// Functions simulated; synthetic patient and ids only.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient } from '@/types/patient';
import { ChatPanel } from './ChatPanel';

const RX = '55555555-5555-4555-8555-555555555555';
const HASH = 'f'.repeat(64);
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  open: vi.fn(),
  composer: {} as { onGenerate?: (payload: Record<string, unknown>) => Promise<void>; signing?: unknown },
  generated: { prescriptionId: '', pdfSha256: '' },
  sign: [] as Array<{ data: unknown; error: unknown }>,
  state: { active: true, configured: true } as Record<string, unknown>,
}));

vi.mock('@/components/ClinicalProposals', () => ({ ClinicalProposals: () => null }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children }: { to: string; children: unknown }) => <a href={to}>{children as never}</a> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => { const q: Record<string, unknown> = {}; for (const op of ['select', 'eq', 'order', 'limit', 'in', 'is']) q[op] = () => q; q.maybeSingle = async () => ({ data: null, error: null }); q.then = (r: (v: unknown) => void) => r({ data: [], error: null }); return q; },
    functions: { invoke: mocks.invoke },
    storage: { from: () => ({ upload: vi.fn() }) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ specialty: 'geral', liveCopilotEnabled: false, activeTemplateId: null }) }));
vi.mock('@/hooks/useRecording', () => ({
  useRecording: () => ({ isRecording: false, isStarting: false, isStopping: false, isPaused: false, stopConfirming: false, recordingSeconds: 0, audioLevel: 0, confirmStop: vi.fn(), cancelStop: vi.fn(), discard: vi.fn() }),
}));
vi.mock('@/lib/consultationDrafts', () => ({ loadConsultationDraft: async () => null, saveConsultationDraft: async () => undefined }));
vi.mock('@/components/UsageMeter', () => ({ UsageMeter: () => null, UsageOverBanner: () => null }));
vi.mock('@/components/LiveCopilotCard', () => ({ LiveCopilotCard: () => null }));
vi.mock('@/components/ConsultationReviewModal', () => ({ ConsultationReviewModal: () => null }));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/components/RecordingModeDialog', () => ({ RecordingModeDialog: () => null }));
// The composer is replaced by its contract: the props ChatPanel passes.
vi.mock('@/components/DocumentComposerModal', () => ({
  DocumentComposerModal: (props: { onGenerate: (payload: Record<string, unknown>) => Promise<void>; signing?: unknown }) => {
    mocks.composer.onGenerate = props.onGenerate;
    mocks.composer.signing = props.signing;
    return null;
  },
}));

const patient: Patient = { id: 'P', name: 'Paciente sintética', age: 40, profession: '', lastVisit: '2026-10-27', status: 'retorno', diagnoses: [], medications: [], allergies: [] };
const sickNote = (sign: boolean) => ({ docType: 'atestado', medications: [], content: { days: 1 }, ...(sign ? { sign: true } : {}) });
const calls = (name: string) => mocks.invoke.mock.calls.filter(([n]) => n === name);

async function openComposer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ChatPanel messages={[]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} userId="doctor" patient={patient} /></QueryClientProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Receita \/ atestado/ }));
  await waitFor(() => expect(mocks.composer.signing).toEqual({ active: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, 'open').mockImplementation(mocks.open);
  mocks.composer = {};
  mocks.generated = { prescriptionId: RX, pdfSha256: HASH };
  mocks.sign = [];
  mocks.state = { active: true, configured: true };
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === 'signature-session/state') return { data: mocks.state, error: null };
    if (name === 'generate-prescription') {
      return { data: { ...mocks.generated, accessCode: 'ABC123', previewUrl: 'https://storage.synthetic.invalid/unsigned.pdf', status: 'generated' }, error: null };
    }
    if (name === 'sign-document') return mocks.sign.shift() ?? { data: { status: 'completed' }, error: null };
    return { data: { questions: [] }, error: null };
  });
});
afterEach(cleanup);

describe('Gerar e assinar from the consultation', () => {
  it('generates once and signs that document by its id and PDF hash; the unsigned preview is not opened', async () => {
    await openComposer();
    await act(async () => { await mocks.composer.onGenerate!(sickNote(true)); });
    expect(calls('generate-prescription')).toHaveLength(1);
    expect(calls('sign-document')).toHaveLength(1);
    expect(calls('sign-document')[0][1]).toEqual({
      method: 'POST', body: { prescriptionId: RX, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), shownPdfSha256: HASH },
    });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Atestado gerado e assinado digitalmente' }));
    expect(localStorage.length).toBe(0); // the operation ended: forgotten
  });

  it('a PSC without answer keeps the document and the operation for "Tentar de novo"; nothing is generated again', async () => {
    mocks.sign = [{ data: { status: 'ambiguous' }, error: null }];
    await openComposer();
    await act(async () => { await mocks.composer.onGenerate!(sickNote(true)); });
    expect(calls('generate-prescription')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`cortex.signature.operation.doctor.${RX}`)!)).toMatchObject({ awaiting: 'ambiguous' });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Atestado gerado, sem assinatura digital' }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('a refused signature is not a generation failure: the document stays and says why', async () => {
    mocks.sign = [{ data: null, error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify({ error: 'Confirme o segundo fator para continuar.', mfaRequired: true }), { status: 403 }) }) }];
    await openComposer();
    await act(async () => { await mocks.composer.onGenerate!(sickNote(true)); });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Atestado gerado, sem assinatura digital', description: expect.stringContaining('Confirme o segundo fator'),
    }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Erro ao gerar documento' }));
  });

  it('without the persisted hash nothing is signed (never a hash made up by the client)', async () => {
    mocks.generated = { prescriptionId: RX, pdfSha256: '' };
    await openComposer();
    await act(async () => { await mocks.composer.onGenerate!(sickNote(true)); });
    expect(calls('sign-document')).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Atestado gerado, sem assinatura digital' }));
  });

  it('a normal "Gerar documento" is unchanged: opens the preview and does not sign', async () => {
    await openComposer();
    await act(async () => { await mocks.composer.onGenerate!(sickNote(false)); });
    expect(calls('sign-document')).toHaveLength(0);
    expect(mocks.open).toHaveBeenCalledWith('https://storage.synthetic.invalid/unsigned.pdf', '_blank');
  });

  it('passes no signing to the composer when it is not configured', async () => {
    mocks.state = { active: false, configured: false };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChatPanel messages={[]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} userId="doctor" patient={patient} /></QueryClientProvider>);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Receita \/ atestado/ }));
    await waitFor(() => expect(calls('signature-session/state')).toHaveLength(1));
    await act(async () => {});
    expect(mocks.composer.signing).toBeNull();
  });
});
