import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Auth from './Auth';

const updatePassword = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: {} } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'medica@example.invalid' }, loading: false, signIn: vi.fn(), resetPassword: vi.fn(), updatePassword, enableAdminBypass: vi.fn() }),
}));

describe('password recovery', () => {
  it('uses the same password rules as the server and asks for confirmation', async () => {
    render(<MemoryRouter initialEntries={['/auth?mode=recovery']}><Auth /></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nova senha'), 'curta');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use pelo menos 10 caracteres.');
    await user.clear(screen.getByLabelText('Nova senha'));
    await user.type(screen.getByLabelText('Nova senha'), '1234567890');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/fácil de adivinhar/);
    await user.clear(screen.getByLabelText('Nova senha'));
    await user.type(screen.getByLabelText('Nova senha'), 'cavalo-azul-lagoa-17');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'cavalo-azul-lagoa-18');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('As senhas não coincidem.');
    expect(updatePassword).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Confirme a nova senha'));
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'cavalo-azul-lagoa-17');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(updatePassword).toHaveBeenCalledWith('cavalo-azul-lagoa-17');
  }, 30_000);
});
