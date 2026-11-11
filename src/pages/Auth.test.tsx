import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Auth from './Auth';
const authMocks = vi.hoisted(() => ({
  signIn: vi.fn().mockResolvedValue({ error: null }),
  signUp: vi.fn().mockResolvedValue({ error: null, session: null }),
  resetPassword: vi.fn().mockResolvedValue({ error: null }),
  resendConfirmation: vi.fn().mockResolvedValue({ error: null }),
  updatePassword: vi.fn().mockResolvedValue({ error: null }),
}));

// Supabase client is imported transitively — stub it out.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
  },
}));

// Provide a minimal AuthContext so the component doesn't crash.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signIn: authMocks.signIn,
    signUp: authMocks.signUp,
    resetPassword: authMocks.resetPassword,
    resendConfirmation: authMocks.resendConfirmation,
    updatePassword: authMocks.updatePassword,
    signOut: vi.fn(),
    enableAdminBypass: vi.fn(),
    session: null,
  }),
}));

function renderAuth() {
  return render(
    <MemoryRouter>
      <Auth />
    </MemoryRouter>,
  );
}

describe('Auth page', () => {
  it('returns to the original callback after sign in', async () => {
    function Destination() { const location=useLocation(); return <output aria-label="Destino">{location.pathname+location.search}</output>; }
    render(<MemoryRouter initialEntries={['/auth?next='+encodeURIComponent('/google-oauth-callback?code=test&state=nonce')]}><Auth /><Destination /></MemoryRouter>);
    const user=userEvent.setup();
    await user.type(screen.getByLabelText('E-mail'),'review@example.invalid');
    await user.type(screen.getByLabelText('Senha'),'synthetic-password');
    await user.click(screen.getByRole('button',{name:/^entrar$/i}));
    await waitFor(() => expect(screen.getByLabelText('Destino')).toHaveTextContent('/google-oauth-callback?code=test&state=nonce'));
  });
  it('names the password visibility action and keeps it keyboard reachable', () => {
    renderAuth();
    expect(screen.getByRole('button', { name: /mostrar senha/i })).not.toHaveAttribute('tabindex', '-1');
  });

  it('lets a user request password recovery without disclosing account existence', async () => {
    renderAuth();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail'), 'review@example.invalid');
    await user.click(screen.getByRole('button', { name: /esqueci minha senha/i }));
    expect(authMocks.resetPassword).toHaveBeenCalledWith('review@example.invalid');
    expect(await screen.findByRole('status')).toHaveTextContent(/se houver uma conta/i);
  });
  it('renders a sign-in submit button', () => {
    renderAuth();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  it('has no public sign-up path and no tab that looks like the button', () => {
    renderAuth();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/criar conta/i)).toBeNull();
    expect(screen.getAllByRole('button', { name: /entrar/i })).toHaveLength(1);
    expect(authMocks.signUp).not.toHaveBeenCalled();
    expect(screen.getByText(/criadas pelo administrador da clínica ou pela equipe Cortex/i)).toBeInTheDocument();
  });

  it('shows a sign-in error directly above the submit button', async () => {
    authMocks.signIn.mockResolvedValueOnce({ error: new Error('invalid') });
    renderAuth();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail'), 'review@example.invalid');
    await user.type(screen.getByLabelText('Senha'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.nextElementSibling).toBe(screen.getByRole('button', { name: /^entrar$/i }));
  });
});
