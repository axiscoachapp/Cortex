import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { SessionAssurance } from './SessionAssurance';
import { sessionIdOf } from '@/lib/sessionIdentity';
import { useSessionHidden, useSessionPaused } from '@/contexts/SessionVisibility';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
const mock = vi.hoisted(() => ({ level: vi.fn(), factors: vi.fn(), verify: vi.fn(), actor: 'doctor', expiry: 100, token: 'never-put-token-in-query-key' }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { mfa: { getAuthenticatorAssuranceLevel: mock.level, listFactors: mock.factors, challengeAndVerify: mock.verify } } },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mock.actor },
    session: { access_token: mock.token, expires_at: mock.expiry },
    signOut: vi.fn(),
  }),
}));
// A synthetic, unsigned token: only its `session_id` claim is read by the guard.
const tokenFor = (session: string, exp: number) => ['synthetic', btoa(JSON.stringify({ session_id: session, exp })).replace(/=+$/, ''), 'unsigned'].join('.');
const verifiedLevel = { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null };
const transportFailure = () => ({ data: null, error: new AuthRetryableFetchError('synthetic offline', 0) });
beforeEach(() => {
  mock.level.mockReset();
  mock.actor = 'doctor';
  mock.expiry = 100;
  mock.token = 'never-put-token-in-query-key';
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
  const twoFactors=()=>mock.factors.mockResolvedValue({data:{totp:[{id:'factor-a',friendly_name:'Sintético A',status:'verified'},{id:'factor-b',friendly_name:'Sintético B',status:'verified'}]},error:null});
  it('clears the code and old refusal when selecting another inline authenticator',async()=>{
    mock.level.mockResolvedValue({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});twoFactors();
    mock.verify.mockResolvedValue({error:{code:'mfa_verification_failed',message:'PRIVATE SYNTHETIC ERROR'}});setup();
    const selector=await screen.findByRole('combobox',{name:'Autenticador'}),code=screen.getByLabelText('Código de 6 dígitos');
    fireEvent.change(code,{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verificar código'}));await screen.findByRole('alert');
    fireEvent.change(selector,{target:{value:'factor-b'}});expect(code).toHaveValue('');expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Verificar código'})).toBeDisabled();expect(mock.verify).toHaveBeenCalledTimes(1);expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();
  });
  it('locks the inline factor and code during verification, then focuses the refusal',async()=>{
    mock.level.mockResolvedValue({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});twoFactors();let finish!:(value:unknown)=>void;mock.verify.mockReturnValue(new Promise(resolve=>{finish=resolve;}));setup();
    const selector=await screen.findByRole('combobox',{name:'Autenticador'}),code=screen.getByLabelText('Código de 6 dígitos');
    fireEvent.change(code,{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verificar código'}));await waitFor(()=>expect(mock.verify).toHaveBeenCalledTimes(1));
    expect(selector).toBeDisabled();expect(code).toBeDisabled();expect(screen.getByRole('button',{name:'Verificando…'})).toBeDisabled();
    await act(async()=>finish({error:{code:'mfa_verification_failed',message:'PRIVATE SYNTHETIC ERROR'}}));const alert=await screen.findByRole('alert');expect(alert).toHaveFocus();expect(selector).toBeEnabled();expect(code).toBeEnabled();expect(code).toHaveValue('123456');expect(screen.queryByText('PRIVATE SYNTHETIC ERROR')).not.toBeInTheDocument();expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();
  });
  it('focuses a repeated identical inline refusal while preserving the clinical lock',async()=>{
    mock.level.mockResolvedValue({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});mock.verify.mockResolvedValue({error:{code:'mfa_challenge_expired'}});setup();
    const code=await screen.findByLabelText('Código de 6 dígitos');fireEvent.change(code,{target:{value:'123456'}});
    fireEvent.click(screen.getByRole('button',{name:'Verificar código'}));await screen.findByRole('alert');code.focus();fireEvent.click(screen.getByRole('button',{name:'Verificar código'}));
    await waitFor(()=>expect(mock.verify).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByRole('alert')).toHaveFocus());expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();
  });
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
    // The key is the auth identity (user + session id), no longer the token expiry.
    client.setQueryData(['session-assurance', 'doctor', null], { currentLevel: 'aal2', nextLevel: 'aal2' });
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
    mock.token = tokenFor('session-a', 100);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><SessionAssurance><textarea aria-label="Existing draft" defaultValue="Synthetic draft" /></SessionAssurance></MemoryRouter></QueryClientProvider>;
    const view = render(tree());
    const field = await screen.findByRole('textbox', { name: 'Existing draft' });
    let release!: (value: unknown) => void;
    mock.level.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    // A new auth session of the same user is a new identity (a token refresh is not).
    mock.token = tokenFor('session-b', 200);
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

function Probe() {
  const hidden = useSessionHidden(), paused = useSessionPaused();
  return <output aria-label="Estado da guarda">{hidden ? 'oculto' : paused ? 'pausado' : 'livre'}</output>;
}
describe('session assurance re-verification of the same identity', () => {
  afterEach(() => vi.useRealTimers());
  const mountWorkspace = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><SessionAssurance>
      <label>Campo em digitação<textarea defaultValue="" /></label><Probe />
    </SessionAssurance></MemoryRouter></QueryClientProvider>;
    const view = render(tree());
    return { client, view, tree };
  };
  it('reads only the session id claim and never fails on malformed tokens', () => {
    expect(sessionIdOf(tokenFor('session-a', 1))).toBe('session-a');
    expect(sessionIdOf('never-put-token-in-query-key')).toBeNull();
    expect(sessionIdOf(undefined)).toBeNull();
    expect(sessionIdOf('a.%%%.b')).toBeNull();
  });
  it('keeps the workspace visible, focused and typed through a same-session token refresh', async () => {
    mock.level.mockResolvedValue(verifiedLevel);
    mock.token = tokenFor('session-a', 100);
    const { view, tree, client } = mountWorkspace();
    const field = await screen.findByRole('textbox', { name: 'Campo em digitação' });
    fireEvent.change(field, { target: { value: 'Texto em digitação sintético' } });
    field.focus();
    let release!: (value: unknown) => void;
    mock.level.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    // TOKEN_REFRESHED: new access token and expiry, same user and auth session.
    mock.token = tokenFor('session-a', 200);
    mock.expiry = 200;
    view.rerender(tree());
    await waitFor(() => expect(mock.level).toHaveBeenCalledTimes(2));
    expect(field).toBeVisible();
    expect(field).toHaveFocus();
    expect(screen.queryByText('Verificando sessão…')).toBeNull();
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('livre');
    await act(async () => release(verifiedLevel));
    expect(screen.getByRole('textbox', { name: 'Campo em digitação' })).toBe(field);
    expect(field).toHaveValue('Texto em digitação sintético');
    expect(field).toHaveFocus();
    expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.queryKey))).not.toContain('synthetic.');
  });
  it('still hides when the step-up requirement appears after a token refresh', async () => {
    mock.level.mockResolvedValue(verifiedLevel);
    mock.token = tokenFor('session-a', 100);
    const { view, tree } = mountWorkspace();
    const field = await screen.findByRole('textbox', { name: 'Campo em digitação' });
    mock.level.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
    mock.expiry = 200;
    view.rerender(tree());
    expect(await screen.findByRole('heading', { name: 'Verifique seu acesso' })).toBeInTheDocument();
    expect(field).not.toBeVisible();
  });
  it('unmounts the previous actor workspace when the user changes', async () => {
    mock.level.mockResolvedValue(verifiedLevel);
    const { view, tree } = mountWorkspace();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Campo em digitação' }), { target: { value: 'Texto do primeiro usuário' } });
    mock.actor = 'other-doctor';
    view.rerender(tree());
    expect(screen.queryByDisplayValue('Texto do primeiro usuário')).toBeNull();
    await screen.findByRole('textbox', { name: 'Campo em digitação' });
    expect(screen.queryByDisplayValue('Texto do primeiro usuário')).toBeNull();
  });
  it('keeps the workspace paused with a banner on a transport failure and recovers silently', async () => {
    mock.level.mockResolvedValue(verifiedLevel);
    const { client } = mountWorkspace();
    const field = await screen.findByRole('textbox', { name: 'Campo em digitação' });
    fireEvent.change(field, { target: { value: 'Preservado' } });
    mock.level.mockResolvedValue(transportFailure());
    await act(() => client.invalidateQueries({ queryKey: ['session-assurance'] }));
    expect(mock.level.mock.calls.length).toBeGreaterThanOrEqual(4); // first try + quick retries
    expect(await screen.findByRole('status', { name: 'Estado da verificação da sessão' })).toHaveTextContent('Não foi possível atualizar a verificação da sessão');
    expect(field).toBeVisible();
    expect(field).toHaveValue('Preservado');
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('pausado');
    expect(document.querySelector('[data-session-locked]')).toBeNull();
    mock.level.mockResolvedValue(verifiedLevel);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar sessão novamente' }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Estado da verificação da sessão' })).toBeNull());
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('livre');
    expect(field).toHaveValue('Preservado');
  });
  it('blocks after 45 seconds of transport failures', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock.level.mockResolvedValue(verifiedLevel);
    const { client } = mountWorkspace();
    const field = await screen.findByRole('textbox', { name: 'Campo em digitação' });
    mock.level.mockResolvedValue(transportFailure());
    await act(async () => { void client.invalidateQueries({ queryKey: ['session-assurance'] }); await vi.advanceTimersByTimeAsync(2_000); });
    await screen.findByRole('status', { name: 'Estado da verificação da sessão' });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(field).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(16_000));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar a segurança da sessão');
    expect(field).not.toBeVisible();
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('oculto');
  });
  it('blocks at once on a definitive refusal, and a later transport error does not revive it', async () => {
    mock.level.mockResolvedValue(verifiedLevel);
    const { client } = mountWorkspace();
    const field = await screen.findByRole('textbox', { name: 'Campo em digitação' });
    mock.level.mockResolvedValue({ data: null, error: new Error('synthetic refusal') });
    await act(() => client.invalidateQueries({ queryKey: ['session-assurance'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar');
    expect(field).not.toBeVisible();
    expect(mock.level).toHaveBeenCalledTimes(2); // no retry of a refusal
    mock.level.mockResolvedValue(transportFailure());
    await act(() => client.invalidateQueries({ queryKey: ['session-assurance'] }));
    expect(field).not.toBeVisible();
    expect(screen.queryByRole('status', { name: 'Estado da verificação da sessão' })).toBeNull();
  });
  it('does not grant an initial check that fails with a transport error', async () => {
    mock.level.mockResolvedValue(transportFailure());
    mountWorkspace();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar');
    expect(screen.queryByRole('textbox', { name: 'Campo em digitação' })).toBeNull();
    expect(mock.level).toHaveBeenCalledTimes(1);
  });
});
