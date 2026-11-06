import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSecurity from './AccountSecurity';

const mocks = vi.hoisted(() => ({ listFactors: vi.fn(), unenroll: vi.fn(), enroll: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { mfa: mocks } } }));
const active = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', friendly_name: 'Ativo sintético', factor_type: 'totp', status: 'verified' };
const pending = { ...active, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', friendly_name: 'Pendente sintético', status: 'unverified' };
const phone = { ...active, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', friendly_name: 'Telefone sintético', factor_type: 'phone' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AccountSecurity /></MemoryRouter></QueryClientProvider>);
}
describe('TOTP metadata including abandoned setups', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Auth SDK totp contains verified factors only; all also contains pending setups.
    mocks.listFactors.mockResolvedValue({ data: { all: [active, pending, phone], totp: [active], phone: [phone] }, error: null });
    mocks.unenroll.mockResolvedValue({ error: null });
    mocks.enroll.mockResolvedValue({ data: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'SYNTHETIC-NOT-A-REAL-SECRET' } }, error: null });
  });
  it('lists pending TOTP setups while keeping them out of the verified selector', async () => {
    mount();
    await screen.findByText('Pendente sintético · Configuração pendente');
    expect(screen.getByText('Ativo sintético · Ativo')).toBeVisible();
    expect(screen.queryByText('Telefone sintético')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: pending.friendly_name })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: active.friendly_name })).toHaveAttribute('value', active.id);
    expect(mocks.unenroll).not.toHaveBeenCalled(); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it('clears only pending TOTP setups before another enrollment', async () => {
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    await screen.findByRole('heading', { name: 'Configurar aplicativo' });
    await waitFor(() => expect(mocks.enroll).toHaveBeenCalledTimes(1));
    expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: pending.id });
    expect(mocks.unenroll.mock.invocationCallOrder[0]).toBeLessThan(mocks.enroll.mock.invocationCallOrder[0]);
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
  });
  it('stops enrollment when the SDK returns a pending-factor cleanup error', async () => {
    mocks.unenroll.mockResolvedValue({ error: Object.assign(new Error('Synthetic cleanup denied'), { code: 'insufficient_aal' }) });
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: pending.id });
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Configurar aplicativo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar autenticador' })).toBeEnabled();
  });
  it('refocuses an identical later failure while preserving edits and allowing code entry', async () => {
    mocks.unenroll.mockResolvedValue({ error: Object.assign(new Error('Synthetic cleanup denied'), { code: 'insufficient_aal' }) });
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    const input = screen.getByLabelText('Código do aplicativo'), selector = screen.getByRole('combobox', { name: 'Autenticador' });
    fireEvent.change(selector, { target: { value: active.id } }); fireEvent.change(input, { target: { value: '1234' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' })); });
    expect(screen.getByRole('alert')).toHaveFocus(); expect(input).toHaveValue('1234'); expect(selector).toHaveValue(active.id);
    input.focus(); fireEvent.change(input, { target: { value: '12345' } });
    expect(input).toHaveFocus(); expect(input).toHaveValue('12345');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' })); });
    expect(screen.getByRole('alert')).toHaveFocus(); expect(input).toHaveValue('12345'); expect(selector).toHaveValue(active.id);
    expect(mocks.unenroll).toHaveBeenCalledTimes(2); expect(mocks.enroll).not.toHaveBeenCalled();
  });
});
