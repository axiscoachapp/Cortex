// Signing from the documents list (D17): the session bar and the sign action,
// with the functions simulated. Synthetic rows and ids only.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrescriptionList } from './PrescriptionList';

const HASH = 'b'.repeat(64);
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  invoke: vi.fn(),
  state: { data: { active: true, configured: true, expiresAt: '2026-11-05T21:00:00Z' } as unknown, error: null as unknown },
  signAnswers: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query, eq: () => query, order: () => query,
        range: async (from: number) => ({ error: null, data: from ? [] : [
          { id: 'signable', doc_type: 'receita_simples', status: 'generated', secret_code: 'SIGN', created_at: '2026-11-05', expires_at: '2099-01-01',
            issuance_verified_at: '2026-11-05', issuance_snapshot: { pdf_sha256: 'b'.repeat(64) } },
          { id: 'legacy', doc_type: 'atestado', status: 'generated', secret_code: 'OLD', created_at: '2026-01-01', expires_at: '2099-01-01',
            issuance_snapshot: { pdf_sha256: 'c'.repeat(64) } },
          { id: 'controlled', doc_type: 'receita_controle_especial', status: 'generated', secret_code: 'CTRL', created_at: '2026-11-05', expires_at: '2099-01-01',
            issuance_verified_at: '2026-11-05', issuance_snapshot: { pdf_sha256: 'd'.repeat(64) } },
          { id: 'already', doc_type: 'atestado', status: 'signed', secret_code: 'DONE', created_at: '2026-11-05', expires_at: '2099-01-01',
            issuance_verified_at: '2026-11-05', signature_verified_at: '2026-11-05', issuance_snapshot: { pdf_sha256: 'e'.repeat(64) } },
        ] }),
      };
      return query;
    },
    functions: { invoke: mocks.invoke },
  },
}));

const renderList = () => render(<QueryClientProvider client={new QueryClient()}><PrescriptionList patientId="patient" /></QueryClientProvider>);
const signCalls = () => mocks.invoke.mock.calls.filter(([name]) => name === 'sign-document');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.toast.mockReset();
  mocks.signAnswers = [];
  mocks.state = { data: { active: true, configured: true, expiresAt: '2026-11-05T21:00:00Z' }, error: null };
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === 'signature-session/state') return mocks.state;
    if (name === 'sign-document') return mocks.signAnswers.shift() ?? { data: { status: 'completed' }, error: null };
    if (name === 'signature-session/start') return { data: { authorizeUrl: 'https://psc.synthetic.invalid/oauth/authorize?state=x' }, error: null };
    if (name === 'signature-session/revoke') return { data: { revoked: true }, error: null };
    throw new Error(`unexpected ${name}`);
  });
});

describe('signing from the documents list', () => {
  it('offers signing only on generated, verified documents of the signed types', async () => {
    renderList();
    expect(await screen.findByText(/Assinatura digital ativa/)).toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: 'Assinar digitalmente' })).toHaveLength(1);
  });

  it('shows nothing of signing when it is not configured, or the functions are not reachable', async () => {
    mocks.state = { data: { active: false, configured: false }, error: null };
    const { unmount } = renderList();
    await screen.findByText('Receita simples');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('signature-session/state', { method: 'GET' }));
    expect(screen.queryByRole('button', { name: 'Assinar digitalmente' })).not.toBeInTheDocument();
    expect(screen.queryByText('Abrir sessão de assinatura')).not.toBeInTheDocument();
    unmount();
    mocks.invoke.mockImplementation(async () => { throw new Error('Failed to send a request to the Edge Function'); });
    renderList();
    await screen.findByText('Receita simples');
    expect(screen.queryByRole('button', { name: 'Assinar digitalmente' })).not.toBeInTheDocument();
  });

  it('signs with the hash the doctor saw and a kept operation id; completed refreshes and forgets it', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar digitalmente' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Documento assinado digitalmente' })));
    const [[, options]] = signCalls();
    expect(options).toEqual({ method: 'POST', body: { prescriptionId: 'signable', operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), shownPdfSha256: HASH } });
    expect(localStorage.getItem('cortex.signature.operation.owner.signable')).toBeNull();
  });

  it('without an answer from the PSC it offers "Tentar de novo", which resends the same operation as a human retry', async () => {
    mocks.signAnswers = [{ data: { status: 'ambiguous' }, error: null }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar digitalmente' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(signCalls()).toHaveLength(2));
    const [first, second] = signCalls().map(([, options]) => (options as { body: Record<string, unknown> }).body);
    expect(first.humanRetry).toBeUndefined();
    expect(second).toEqual({ ...first, humanRetry: true });
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('a refused retry is not sent', async () => {
    mocks.signAnswers = [{ data: { status: 'ambiguous' }, error: null }];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar digitalmente' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(signCalls()).toHaveLength(1);
  });

  it('a failed operation is forgotten: the next click starts another', async () => {
    mocks.signAnswers = [{
      data: null,
      error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify({ status: 'failed', code: 'psc_rejected' }), { status: 409 }) }),
    }];
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar digitalmente' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'O provedor do certificado recusou a assinatura.' })));
    expect(localStorage.getItem('cortex.signature.operation.owner.signable')).toBeNull();
  });

  it('without a session it asks to open one and sends nothing', async () => {
    mocks.state = { data: { active: false, configured: true }, error: null };
    renderList();
    expect(await screen.findByText('Abrir sessão de assinatura')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar digitalmente' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Abra a sessão de assinatura' })));
    expect(signCalls()).toHaveLength(0);
  });

  it('opening a session keeps this page to come back to', async () => {
    mocks.state = { data: { active: false, configured: true }, error: null };
    renderList();
    fireEvent.click(await screen.findByText('Abrir sessão de assinatura'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('signature-session/start', { method: 'POST' }));
    await waitFor(() => expect(sessionStorage.getItem('cortex.signature.return')).toBe('/'));
  });
});
