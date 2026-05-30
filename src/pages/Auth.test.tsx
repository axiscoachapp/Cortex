import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Auth from './Auth';

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
    signIn: vi.fn(),
    signUp: vi.fn(),
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
