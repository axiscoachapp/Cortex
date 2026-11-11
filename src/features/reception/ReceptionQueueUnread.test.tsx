import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionQueue from './ReceptionQueue';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
import { UNREAD_POLL_MS } from './useWhatsAppUnread';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), detail: vi.fn(), conversations: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { queue: mocks.queue, case: mocks.detail } }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { conversations: mocks.conversations } }));
vi.mock('./WhatsAppInbox', () => ({ default: () => <p>Caixa sintética montada</p> }));
vi.mock('./CaseWorkspace', () => ({ CaseWorkspace: () => <p>Caso sintético montado</p> }));
vi.mock('./NewCaseDialog', () => ({ NewCaseDialog: () => null }));
vi.mock('@/hooks/use-mobile', () => ({ isBelowMobileBreakpoint: () => false }));

const actor = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222', other = '77777777-7777-4777-8777-777777777777';
const access: ClinicAccess = { actorId: actor, kind: 'reception', active: true, admin: false, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const row = (n: number, unreadCount: number, assignedTo: string | null) => ({ id: `${n}3333333-3333-4333-8333-333333333333`, unreadCount, assignedTo });
function mount(path = '/recepcao', value: ClinicAccess = access) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><ClinicAccessContext.Provider value={value}><ReceptionQueue /></ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  mocks.queue.mockResolvedValue({ items: [], nextCursor: null });
  mocks.conversations.mockResolvedValue({ conversations: [row(1, 2, null), row(2, 1, actor), row(3, 4, other), row(4, 0, null)], nextBefore: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('unread count on the Conversas toggle', () => {
  it('counts unread conversations this person can answer and refreshes every 30 s on Atendimentos', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Conversas (2)' })).toBeVisible();
    expect(mocks.conversations).toHaveBeenCalledWith({ filter: 'open', limit: 100 }, expect.any(AbortSignal));
    mocks.conversations.mockResolvedValue({ conversations: [row(1, 2, null), row(2, 1, actor), row(5, 1, null)], nextBefore: 'cursor' });
    await act(async () => { vi.advanceTimersByTime(UNREAD_POLL_MS); });
    expect(await screen.findByRole('button', { name: 'Conversas (3+)' })).toBeVisible();
    expect(mocks.conversations).toHaveBeenCalledTimes(2);
  });
  it('shows no count when nothing is unread or the read fails', async () => {
    mocks.conversations.mockResolvedValue({ conversations: [row(3, 4, other)], nextBefore: null });
    const view = mount();
    await waitFor(() => expect(mocks.conversations).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Conversas' })).toBeVisible();
    view.unmount();
    mocks.conversations.mockRejectedValue(new Error('SYNTHETIC PRIVATE'));
    mount();
    await waitFor(() => expect(mocks.conversations).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Conversas' })).toBeVisible();
  });
  it('does not read on the Conversas view or without inbox access', async () => {
    const view = mount('/recepcao?view=conversations');
    expect(screen.getByText('Caixa sintética montada')).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(UNREAD_POLL_MS); });
    expect(mocks.conversations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Atendimentos' }));
    expect(await screen.findByRole('button', { name: 'Conversas (2)' })).toBeVisible();
    view.unmount(); mocks.conversations.mockClear();
    mount('/recepcao', { ...access, kind: 'clinical' });
    await act(async () => { vi.advanceTimersByTime(UNREAD_POLL_MS); });
    expect(mocks.conversations).not.toHaveBeenCalled();
  });
});
