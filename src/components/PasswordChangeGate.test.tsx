import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordChangeGate } from './PasswordChangeGate';

const mock = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  invoke: vi.fn(),
  refreshSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    auth: { refreshSession: mock.refreshSession, updateUser: mock.updateUser },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, signOut: mock.signOut }) }));

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const account = (app: Record<string, unknown>, meta: Record<string, unknown> = {}, createdAt = new Date().toISOString()) => ({
  id: 'c7100000-0000-4000-8000-000000000002', email: 'medica@example.invalid', created_at: createdAt, app_metadata: app, user_metadata: meta,
});
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: new Response(JSON.stringify(body), { status }) });

const setup = () => render(<PasswordChangeGate><p>Prontuário privado</p></PasswordChangeGate>);
async function fill(password: string, confirm = password) {
  await userEvent.type(screen.getByLabelText('Nova senha'), password);
  await userEvent.type(screen.getByLabelText('Confirme a nova senha'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
}

beforeEach(() => {
  mock.invoke.mockReset().mockResolvedValue({ data: { success: true, refreshSession: true }, error: null });
  mock.refreshSession.mockReset().mockResolvedValue({ data: {}, error: null });
  mock.updateUser.mockReset();
  mock.signOut.mockReset().mockResolvedValue(undefined);
});

describe('PasswordChangeGate', () => {
  it('lets an account without a temporary password straight through', () => {
    mock.user = account({ password_set_by_owner_at: '2026-11-10T00:00:00Z' }, { must_change_password: false });
    setup();
    expect(screen.getByText('Prontuário privado')).toBeInTheDocument();
  });

  it.each([
    ['server flag', account({ must_change_password: true, temporary_password_expires_at: future() })],
    ['legacy user_metadata flag', account({}, { must_change_password: true })],
  ])('blocks the app for the %s', (_label, user) => {
    mock.user = user;
    setup();
    expect(screen.queryByText('Prontuário privado')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Defina sua senha' })).toBeInTheDocument();
  });

  it('changes the password through the server function, refreshes the session and never writes the flag', async () => {
    mock.user = account({ must_change_password: true, temporary_password_expires_at: future() });
    setup();
    await fill('cavalo-azul-lagoa-17');
    await waitFor(() => expect(mock.refreshSession).toHaveBeenCalledTimes(1));
    expect(mock.invoke).toHaveBeenCalledExactlyOnceWith('change-initial-password', { body: { password: 'cavalo-azul-lagoa-17' } });
    expect(mock.invoke.mock.invocationCallOrder[0]).toBeLessThan(mock.refreshSession.mock.invocationCallOrder[0]);
    expect(mock.updateUser).not.toHaveBeenCalled();
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it('applies the password rule before calling the server', async () => {
    mock.user = account({ must_change_password: true, temporary_password_expires_at: future() });
    setup();
    await fill('curta');
    expect(screen.getByRole('alert')).toHaveTextContent('Use pelo menos 10 caracteres.');
    await userEvent.clear(screen.getByLabelText('Nova senha'));
    await userEvent.clear(screen.getByLabelText('Confirme a nova senha'));
    await fill('cavalo-azul-lagoa-17', 'cavalo-azul-lagoa-18');
    expect(screen.getByRole('alert')).toHaveTextContent('As senhas não coincidem.');
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('shows the expired message without a form when the temporary password is past its expiry', () => {
    mock.user = account({ must_change_password: true, temporary_password_expires_at: '2026-01-01T00:00:00Z' });
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('Senha temporária vencida. Peça uma nova ao administrador da clínica.');
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  });

  it('switches to the expired message when the server says so', async () => {
    mock.user = account({ must_change_password: true, temporary_password_expires_at: future() });
    mock.invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'Senha temporária vencida.', code: 'temporary_password_expired' }) });
    setup();
    await fill('cavalo-azul-lagoa-17');
    expect(await screen.findByText('Senha temporária vencida. Peça uma nova ao administrador da clínica.')).toBeInTheDocument();
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });

  it('shows the server reason when the new password is refused', async () => {
    mock.user = account({ must_change_password: true, temporary_password_expires_at: future() });
    mock.invoke.mockResolvedValue({ data: null, error: httpError(422, { error: 'Escolha uma senha diferente da senha temporária.', code: 'same_as_temporary' }) });
    setup();
    await fill('cavalo-azul-lagoa-17');
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha uma senha diferente da senha temporária.');
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });

  it('signs out when the session cannot be refreshed after a successful change', async () => {
    mock.user = account({ must_change_password: true, temporary_password_expires_at: future() });
    mock.refreshSession.mockResolvedValue({ data: {}, error: new Error('refresh failed') });
    setup();
    await fill('cavalo-azul-lagoa-17');
    await waitFor(() => expect(mock.signOut).toHaveBeenCalledTimes(1));
  });
});
