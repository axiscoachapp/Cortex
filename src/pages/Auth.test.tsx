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
    await user.type(screen.getByLabelText('Email'),'review@example.invalid');
    await user.type(screen.getByLabelText('Senha'),'synthetic-password');
    await user.click(screen.getByRole('button',{name:/^entrar$/i}));
    await waitFor(() => expect(screen.getByLabelText('Destino')).toHaveTextContent('/google-oauth-callback?code=test&state=nonce'));
  });
  it('names the password visibility action and keeps it keyboard reachable', () => {
    renderAuth();
    expect(screen.getByRole('button', { name: /mostrar senha/i })).not.toHaveAttribute('tabindex', '-1');
  });

  it('explains email confirmation when signup does not create a session', async () => {
    renderAuth();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /criar conta/i }));
    await user.type(screen.getByLabelText('Email'), 'review@example.invalid');
    await user.type(screen.getByLabelText('Senha'), 'test-password');
    await user.click(screen.getByRole('button', { name: /criar conta grátis/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/confirme seu email/i);
    await user.click(screen.getByRole('button',{name:'Reenviar confirmação'}));
    expect(authMocks.resendConfirmation).toHaveBeenCalledWith('review@example.invalid');
    expect(await screen.findByRole('status')).toHaveTextContent(/novo link/i);
  });

  it('lets a user request password recovery without disclosing account existence', async () => {
    renderAuth();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'review@example.invalid');
    await user.click(screen.getByRole('button', { name: /esqueci minha senha/i }));
    expect(authMocks.resetPassword).toHaveBeenCalledWith('review@example.invalid');
    expect(await screen.findByRole('status')).toHaveTextContent(/se houver uma conta/i);
  });
  it('renders the sign-in tab by default', () => {
    renderAuth();
    expect(screen.getByRole('tab', { name: /entrar/i })).toBeInTheDocument();
  });

  it('renders email and password inputs', () => {
    renderAuth();
    // Auth page has two forms (sign-in + sign-up tabs), so getAllByLabelText is correct.
    expect(screen.getAllByLabelText(/email/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/senha/i).length).toBeGreaterThan(0);
  });

  it('renders a sign-in submit button', () => {
    renderAuth();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  it('renders the sign-up tab', () => {
    renderAuth();
    expect(screen.getByRole('tab', { name: /criar conta/i })).toBeInTheDocument();
  });
});
