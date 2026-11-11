// "Gerar e assinar" in the consultation panel (D17): generate once, then sign
// exactly the persisted document (its id and PDF hash), keeping the operation;
// a signature that does not complete never undoes nor repeats the generation.
// Functions simulated; synthetic patient and ids only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient } from '@/types/patient';
import { forgetOperation } from '@/lib/signatureClient';
import { ChatPanel } from './ChatPanel';
import { Toast, ToastProvider, ToastViewport } from '@/components/ui/toast';

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
  /** Held answers: the test resolves them after changing the context. */
  holdGenerate: null as null | Promise<unknown>,
  holdSign: null as null | Promise<unknown>,
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  forgetOperation('doctor', RX);
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, 'open').mockImplementation(mocks.open);
  mocks.composer = {};
  mocks.generated = { prescriptionId: RX, pdfSha256: HASH };
  mocks.sign = [];
  mocks.state = { active: true, configured: true };
  mocks.holdGenerate = null;
  mocks.holdSign = null;
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === 'signature-session/state') return { data: mocks.state, error: null };
    if (name === 'generate-prescription') {
      if (mocks.holdGenerate) await mocks.holdGenerate;
      return { data: { ...mocks.generated, accessCode: 'ABC123', previewUrl: 'https://storage.synthetic.invalid/unsigned.pdf', status: 'generated' }, error: null };
    }
    if (name === 'sign-document') {
      if (mocks.holdSign) await mocks.holdSign;
      return mocks.sign.shift() ?? { data: { status: 'completed' }, error: null };
    }
    return { data: { questions: [] }, error: null };
  });
});
afterEach(cleanup);

describe('Gerar e assinar from the consultation', () => {
  it('post-consultation documents bind the latest saved SOAP instead of a panel-level fallback',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><ChatPanel messages={['older','latest'].map(id=>({id,type:'soap' as const,title:'Evolução '+id,content:'SOAP '+id,timestamp:new Date(),consultationId:id}))} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} userId="doctor" patient={patient}/></QueryClientProvider>);
    const panel=await screen.findByRole('region',{name:'Pós-consulta'});expect(screen.getAllByRole('region',{name:'Pós-consulta'})).toHaveLength(1);
    fireEvent.click(within(panel).getByRole('button',{name:'Receita / Atestado'}));
    await waitFor(()=>expect(mocks.composer.signing).toEqual({active:true}));
    await act(async()=>{await mocks.composer.onGenerate!(sickNote(false));});
    expect(calls('generate-prescription')[0][1].body).toMatchObject({patientId:patient.id,consultationId:'latest'});
    expect(calls('sign-document')).toHaveLength(0);
  });
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

  it('a browser that cannot keep the operation signs nothing; the document stays generated (Codex 10:25, 3)', async () => {
    await openComposer();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await act(async () => { await mocks.composer.onGenerate!(sickNote(true)); });
    expect(calls('generate-prescription')).toHaveLength(1);
    expect(calls('sign-document')).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Atestado gerado, sem assinatura digital', description: expect.stringContaining('não conseguiu guardar'),
    }));
  });

  it('a normal "Gerar documento" does not sign and offers "Abrir PDF" instead of a pop-up after the await', async () => {
    await openComposer();
    await act(async () => { await mocks.composer.onGenerate!(sickNote(false)); });
    expect(calls('sign-document')).toHaveLength(0);
    // A window opened after the generation await is blocked as a pop-up.
    expect(mocks.open).not.toHaveBeenCalled();
    const result = mocks.toast.mock.calls.map(([toast]) => toast).find((toast) => toast.title === 'Atestado gerado');
    expect(result.description).toContain('ABC123');
    render(<ToastProvider><Toast open>{result.action}</Toast><ToastViewport /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir PDF' }));
    expect(mocks.open).toHaveBeenCalledWith('https://storage.synthetic.invalid/unsigned.pdf', '_blank', 'noopener,noreferrer');
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

// Codex 05/11 11:38: an answer that arrives after the doctor, the patient or
// the screen changed shows nothing of that document in the next context.
describe('late answers after the context changed', () => {
  const other: Patient = { ...patient, id: 'Q', name: 'Outra paciente sintética' };
  const hold = () => { let release!: () => void; const promise = new Promise<void>((r) => { release = r; }); return { promise, release }; };
  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (userId: string, who: Patient) => (
      <QueryClientProvider client={client}><ChatPanel messages={[]} onMessagesChange={vi.fn()} chiefComplaint="" preBriefing={null} briefingLoading={false} userId={userId} patient={who} /></QueryClientProvider>
    );
    const result = render(view('doctor', patient));
    return { ...result, switchTo: (userId: string, who: Patient) => result.rerender(view(userId, who)) };
  }
  const opened = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Receita \/ atestado/ }));
    await waitFor(() => expect(mocks.composer.signing).toEqual({ active: true }));
  };
  const nothingShown = () => {
    expect(mocks.open).not.toHaveBeenCalled();
    for (const [arg] of mocks.toast.mock.calls as Array<[{ title?: string; description?: string }]>) {
      expect(`${arg.title} ${arg.description}`).not.toMatch(/ABC123|assinad|gerad/i);
    }
  };

  for (const sign of [true, false]) {
    it(`generation answered after the patient changed (${sign ? 'Gerar e assinar' : 'Gerar documento'}): no code, preview, notice or signature`, async () => {
      const view = mount();
      await act(async () => {});
      await opened();
      const gate = hold();
      mocks.holdGenerate = gate.promise;
      let pending!: Promise<void>;
      act(() => { pending = mocks.composer.onGenerate!(sickNote(sign)); });
      view.switchTo('doctor', other);
      await act(async () => { gate.release(); await pending; });
      expect(calls('generate-prescription')).toHaveLength(1);
      expect(calls('sign-document')).toHaveLength(0);
      nothingShown();
    });
  }

  it('generation answered after the account changed: nothing signed nor shown', async () => {
    const view = mount();
    await act(async () => {});
    await opened();
    const gate = hold();
    mocks.holdGenerate = gate.promise;
    let pending!: Promise<void>;
    act(() => { pending = mocks.composer.onGenerate!(sickNote(true)); });
    view.switchTo('other-doctor', patient);
    await act(async () => { gate.release(); await pending; });
    expect(calls('sign-document')).toHaveLength(0);
    nothingShown();
  });

  for (const change of ['patient', 'account', 'unmount'] as const) {
    it(`signature answered after the ${change} changed: its result and code are not shown`, async () => {
      const view = mount();
      await act(async () => {});
      await opened();
      const gate = hold();
      mocks.holdSign = gate.promise;
      let pending!: Promise<void>;
      act(() => { pending = mocks.composer.onGenerate!(sickNote(true)); });
      await waitFor(() => expect(calls('sign-document')).toHaveLength(1));
      if (change === 'patient') view.switchTo('doctor', other);
      else if (change === 'account') view.switchTo('other-doctor', patient);
      else view.unmount();
      await act(async () => { gate.release(); await pending; });
      nothingShown();
      expect(localStorage.length).toBe(0); // the operation itself still ended normally
    });
  }
});
