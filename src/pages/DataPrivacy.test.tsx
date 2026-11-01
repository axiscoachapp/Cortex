import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DataPrivacy from './DataPrivacy';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), invoke: vi.fn(), signIn: vi.fn(async () => ({ error: null })) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor', email: 'review@example.invalid' }, signOut: mocks.signOut }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke }, auth: { signInWithPassword: mocks.signIn } },
}));

describe('Account deletion recovery', () => {
  it('keeps the confirmation open and allows retry when deletion is incomplete', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'Exclusão incompleta. Tente novamente.' }) } } });
    render(<MemoryRouter><DataPrivacy /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Excluir minha conta' }));
    await user.type(screen.getByLabelText(/digite excluir para confirmar/i), 'EXCLUIR');
    // Irreversible: requires the retention acknowledgment and a password re-check.
    expect(screen.getByRole('button', { name: 'Sim, excluir tudo' })).toBeDisabled();
    await user.click(screen.getByLabelText(/assumo a obrigação legal/i));
    await user.type(screen.getByLabelText(/confirme sua senha/i), 'senha-de-teste');
    await user.click(screen.getByRole('button', { name: 'Sim, excluir tudo' }));
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'review@example.invalid', password: 'senha-de-teste' });
    expect(mocks.invoke).toHaveBeenCalledWith('delete-user-data', { body: { retentionAcknowledged: true } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Exclusão incompleta');
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sim, excluir tudo' })).toBeEnabled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
