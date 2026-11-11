// Return from the PSC authorization: the single-use code goes once to
// signature-session/complete, then back to the page the doctor came from.
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignatureReturn from './SignatureReturn';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

const renderAt = (url: string) => render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/assinatura/retorno" element={<SignatureReturn />} />
          <Route path="/" element={<p>início</p>} />
          <Route path="/gerenciar-pacientes" element={<p>pacientes</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);

beforeEach(() => {
  sessionStorage.clear();
  mocks.invoke.mockReset();
  mocks.toast.mockReset();
});

describe('SignatureReturn', () => {
  it('completes once (StrictMode included) and goes back to the saved page', async () => {
    sessionStorage.setItem('cortex.signature.return', '/gerenciar-pacientes');
    mocks.invoke.mockResolvedValue({ data: { active: true, expiresAt: '2026-11-05T21:00:00Z' }, error: null });
    renderAt('/assinatura/retorno?code=synthetic-code&state=synthetic-state');
    expect(await screen.findByText('pacientes')).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('signature-session/complete', { method: 'POST', body: { code: 'synthetic-code', state: 'synthetic-state' } });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sessão de assinatura aberta' }));
  });

  it('never goes back to another origin', async () => {
    sessionStorage.setItem('cortex.signature.return', '//evil.example/x');
    mocks.invoke.mockResolvedValue({ data: { active: true }, error: null });
    renderAt('/assinatura/retorno?code=c&state=s');
    expect(await screen.findByText('início')).toBeInTheDocument();
  });

  it('shows the refusal of the server and stays', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('non-2xx'), {
        context: new Response(JSON.stringify({ error: 'O certificado está vencido. Renove-o antes de assinar.', code: 'certificate_expired' }), { status: 409 }),
      }),
    });
    renderAt('/assinatura/retorno?code=c&state=s');
    expect(await screen.findByRole('alert')).toHaveTextContent('O certificado está vencido');
  });

  it('a denied or missing authorization sends nothing', async () => {
    renderAt('/assinatura/retorno?error=access_denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('negada');
    await waitFor(() => expect(mocks.invoke).not.toHaveBeenCalled());
  });

  it('a return without the authorization says what to do, not what the provider did', async () => {
    renderAt('/assinatura/retorno');
    expect(await screen.findByRole('alert')).toHaveTextContent('A sessão de assinatura não foi aberta. Volte e tente de novo.');
    expect(screen.queryByText(/provedor/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.invoke).not.toHaveBeenCalled());
  });
});
