import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { SessionAssurance } from './SessionAssurance';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
const mock = vi.hoisted(() => ({ level: vi.fn(), factors: vi.fn(), verify: vi.fn(), actor: 'doctor', expiry: 100 }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { mfa: { getAuthenticatorAssuranceLevel: mock.level, listFactors: mock.factors, challengeAndVerify: mock.verify } } },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mock.actor },
    session: { access_token: 'never-put-token-in-query-key', expires_at: mock.expiry },
    signOut: vi.fn(),
  }),
}));
beforeEach(() => {
  mock.level.mockReset();
  mock.actor = 'doctor';
  mock.expiry = 100;
  mock.factors.mockReset().mockResolvedValue({ data: { totp: [{ id: 'factor-synthetic', status: 'verified' }] }, error: null });
  mock.verify.mockReset().mockResolvedValue({ error: null });
});
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionAssurance>
          <p>Private clinical chart</p>
        </SessionAssurance>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
};
describe('session assurance', () => {
  it('can recover with a real document modal already open without losing its draft', async () => {
    const user = userEvent.setup();
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><SessionAssurance>
      <Dialog open><DialogContent><DialogTitle>Documento aberto</DialogTitle><DialogDescription>Somente teste sintético.</DialogDescription>
        <label>Rascunho do documento<textarea defaultValue="Conteúdo sintético preservado" /></label>
      </DialogContent></Dialog>
    </SessionAssurance></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('dialog', { name: 'Documento aberto' });
    await user.click(screen.getByRole('textbox', { name: 'Rascunho do documento' }));
    mock.level.mockResolvedValue({ data: null, error: new Error('offline') });
    await act(() => client.invalidateQueries({ queryKey: ['session-assurance'] }));
    await waitFor(() => expect(screen.getByText('Tentar novamente')).toBeInTheDocument());
    const retry = screen.getByText('Tentar novamente');
    expect(retry.closest('[aria-hidden="true"]')).toBeNull();
    // A normal div behind Radix's body pointer lock cannot receive this click.
    // Recovering must also own focus/ARIA instead of leaving them in the old dialog.
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    await user.click(retry);
    expect(await screen.findByRole('textbox', { name: 'Rascunho do documento' })).toHaveValue('Conteúdo sintético preservado');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Rascunho do documento' })).toHaveFocus());
  });
  it('preserves an existing capture tree behind the lock when a recheck fails', async () => {
    const unmount = vi.fn();
    function Capture() {
      useEffect(() => () => unmount(), []);
      return <p>Capture in progress</p>;
    }
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionAssurance>
            <Capture />
          </SessionAssurance>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Capture in progress');
    mock.level.mockResolvedValue({ data: null, error: new Error('offline') });
    await act(() => client.invalidateQueries({ queryKey: ['session-assurance'] }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('segurança da sessão'));
    expect(unmount).not.toHaveBeenCalled();
    expect(screen.getByText('Capture in progress')).not.toBeVisible();
  });
  it('hides clinical UI until an enrolled factor is verified', async () => {
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
    const client = setup();
    expect(await screen.findByRole('heading', { name: 'Verifique seu acesso' })).toBeInTheDocument();
    expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      ),
    ).not.toContain('never-put-token');
  });
  it('allows verified sessions', async () => {
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    setup();
    expect(await screen.findByText('Private clinical chart')).toBeInTheDocument();
  });
  it('fails closed when assurance cannot be checked', async () => {
    mock.level.mockResolvedValue({ data: null, error: new Error('offline') });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar');
    expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();
  });
  it('requires a new check on mount even when an authorized result is cached', async () => {
    let release!: (value: unknown) => void;
    mock.level.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['session-assurance', 'doctor', 100], { currentLevel: 'aal2', nextLevel: 'aal2' });
    render(<QueryClientProvider client={client}><MemoryRouter><SessionAssurance><p>Private chart from cache</p></SessionAssurance></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText('Private chart from cache')).not.toBeInTheDocument();
    await act(async () => release({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }));
    expect(await screen.findByRole('heading', { name: 'Verifique seu acesso' })).toBeInTheDocument();
    expect(screen.queryByText('Private chart from cache')).not.toBeInTheDocument();
  });
  it('does not carry an authorized workspace into another actor while their check is pending', async () => {
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><SessionAssurance><p>Previous actor chart</p></SessionAssurance></MemoryRouter></QueryClientProvider>;
    const view = render(tree());
    await screen.findByText('Previous actor chart');
    let release!: (value: unknown) => void;
    mock.level.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    mock.actor = 'other-doctor';
    view.rerender(tree());
    expect(screen.queryByText('Previous actor chart')).not.toBeInTheDocument();
    await act(async () => release({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }));
    expect(await screen.findByRole('heading', { name: 'Verifique seu acesso' })).toBeInTheDocument();
    expect(screen.queryByText('Previous actor chart')).not.toBeInTheDocument();
  });
  it('rejects an indeterminate assurance response', async () => {
    mock.level.mockResolvedValue({ data: { currentLevel: null, nextLevel: null }, error: null });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar');
    expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();
  });
  it('preserves but conceals the same actor workspace during a new session-key check', async () => {
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><SessionAssurance><textarea aria-label="Existing draft" defaultValue="Synthetic draft" /></SessionAssurance></MemoryRouter></QueryClientProvider>;
    const view = render(tree());
    const field = await screen.findByRole('textbox', { name: 'Existing draft' });
    let release!: (value: unknown) => void;
    mock.level.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    mock.expiry = 200;
    view.rerender(tree());
    expect(field).toBeInTheDocument();
    expect(field).not.toBeVisible();
    await act(async () => release({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }));
    await waitFor(() => expect(field).toBeVisible());
    expect(screen.getByRole('textbox', { name: 'Existing draft' })).toBe(field);
    expect(field).toHaveValue('Synthetic draft');
  });
  it('retries a factor-list error and verifies inline before exposing the chart', async () => {
    const user = userEvent.setup();
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
    mock.factors.mockResolvedValueOnce({ data: null, error: new Error('synthetic offline') });
    setup();
    await user.click(await screen.findByRole('button', { name: 'Carregar autenticadores novamente' }));
    await user.type(screen.getByLabelText('Código de 6 dígitos'), '123456');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verificar código' })).toBeEnabled());
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    await user.click(screen.getByRole('button', { name: 'Verificar código' }));
    expect(mock.verify).toHaveBeenCalledWith({ factorId: 'factor-synthetic', code: '123456' });
    expect(await screen.findByText('Private clinical chart')).toBeVisible();
  });
});
