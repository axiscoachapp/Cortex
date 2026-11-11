import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordCard } from './ChangePasswordCard';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'medica@example.invalid' } }) }));

describe('Alterar senha', () => {
  beforeEach(() => invoke.mockReset());

  it('checks the same rules before calling the server, then changes the password', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    const user = userEvent.setup();
    render(<ChangePasswordCard />);
    await user.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a senha atual.');
    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Senha atual'), 'senha-atual-sintetica-1');
    await user.type(screen.getByLabelText('Nova senha'), 'curta');
    await user.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use pelo menos 10 caracteres.');
    await user.clear(screen.getByLabelText('Nova senha'));
    await user.type(screen.getByLabelText('Nova senha'), 'cavalo-azul-lagoa-17');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'cavalo-azul-lagoa-17');
    expect(invoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(invoke).toHaveBeenCalledWith('change-password', { body: { currentPassword: 'senha-atual-sintetica-1', password: 'cavalo-azul-lagoa-17' } });
    expect(await screen.findByText(/Senha alterada/)).toBeInTheDocument();
    expect(screen.getByLabelText('Senha atual')).toHaveValue('');
  }, 30_000);

  it('marks the current password when the server says it does not match', async () => {
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { context: new Response(JSON.stringify({ error: 'A senha atual não confere.', code: 'wrong_password' }), { status: 403 }) }) });
    const user = userEvent.setup();
    render(<ChangePasswordCard />);
    await user.type(screen.getByLabelText('Senha atual'), 'senha-errada-sintetica');
    await user.type(screen.getByLabelText('Nova senha'), 'cavalo-azul-lagoa-17');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'cavalo-azul-lagoa-17');
    await user.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A senha atual não confere.');
    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('aria-invalid', 'true');
  }, 30_000);
});
