import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import { WhatsAppSettings } from './WhatsAppSettings';
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./whatsappApi', async original => ({ ...(await original<typeof import('./whatsappApi')>()), whatsappCall: (...args: unknown[]) => mocks.call(...args) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('./FlowEditor', () => ({ FlowEditor: () => <p>Rotina do canal sintético</p> }));
vi.mock('./AutomationEditor', () => ({ AutomationEditor: () => null }));
function mount({ connected = false, canManage = true, lastError = null as string | null } = {}) {
  mocks.call.mockImplementation(async (action: string) => {
    if (action === 'state') return { serverReady: true, connected, canManage, canUseInbox: true, status: connected ? 'connected' : 'none', displayPhone: null, verifiedName: null, quality: null, connectedAt: null, lastError };
    if (action === 'templates') return { templates: [] };
    if (action === 'automations') return { automations: [], runs: [] };
    if (action === 'syncTemplates') throw new Error('O token expirou. Reconecte o número em Configurações.');
    throw new Error('Unexpected synthetic action ' + action);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ClinicAccessContext.Provider value={{ kind: 'reception', active: true, admin: canManage, actorId: 'synthetic', clinic: { id: 'synthetic', name: 'Clínica sintética' }, doctors: [], staff: [] }}><WhatsAppSettings /></ClinicAccessContext.Provider></QueryClientProvider>);
}
describe('WhatsApp setup belongs to implementation', () => {
  it('tells a receptionist plainly who can act when no number is connected', async () => {
    mount({ canManage: false });
    expect(await screen.findByText('O WhatsApp da clínica ainda não está conectado. Avise o administrador da clínica.')).toBeVisible();
  });
  it('puts reminders first, then the bot, then number and models', async () => {
    mount({ connected: true });
    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual(['Lembretes automáticos', 'Robô de atendimento', 'Número e modelos']);
    expect(screen.getByRole('tab', { name: 'Lembretes automáticos' })).toHaveAttribute('aria-selected', 'true');
  });
  beforeEach(() => vi.clearAllMocks());
  it('does not ask even an admin to enter technical credentials', async () => {
    mount();
    expect(await screen.findByText('O WhatsApp da clínica ainda não foi conectado. A conexão é feita pela equipe Cortex.')).toBeVisible();
    expect(screen.getByRole('button', { name: /Copiar pedido/ })).toBeVisible();
    expect(screen.queryByLabelText(/Token|ID do|PIN/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Conectar número' })).toBeNull();
    expect(mocks.call.mock.calls.map(call => call[0])).toEqual(['state']);
  });
  it('keeps operational sync but sends technical failures to implementation', async () => {
    mount({ connected: true, lastError: 'Reconecte o número em Configurações.' });
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar modelos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('equipe Cortex');
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
    expect(screen.queryByText(/Reconecte o número/)).toBeNull();
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('syncTemplates'));
    expect(mocks.call.mock.calls.some(call => ['connect', 'disconnect'].includes(call[0]))).toBe(false);
  });
  it('does not ask a non-manager to access Meta tools or sync models', async () => {
    mount({ connected: true, canManage: false });
    expect(await screen.findByText(/Nenhum modelo ainda/)).toBeVisible();
    expect(screen.queryByText(/WhatsApp Manager/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Atualizar modelos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nova automação' })).toBeNull();
  });
});
