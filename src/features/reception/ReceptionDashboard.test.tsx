import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionDashboard from './ReceptionDashboard';
import { ClinicAccessContext } from './accessContext';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import type { ClinicAccess } from './contracts';
import type { WhatsAppDashboard } from './whatsappDashboard';

const mocks = vi.hoisted(() => ({ read: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('./whatsappDashboard', () => ({ readWhatsAppDashboard: mocks.read }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: '22222222-2222-4222-8222-222222222222', name: 'Clínica sintética' }, doctors: [], staff: [] };
const owner = { userId: '33333333-3333-4333-8333-333333333333', name: 'Pessoa sintética', role: 'reception' as const, ambiguous: true, openCount: 2 };
const range = { from: '2026-10-31T15:00:00.000Z', to: '2026-11-07T15:00:00.000Z' };
const page: WhatsAppDashboard = {
  schemaVersion: 1, asOf: '2026-11-07T15:00:05Z', window: { ...range, timeZone: 'America/Sao_Paulo' }, coverage: 'latest_cycle_only',
  cohort: { incomingCycles: 6, withHumanSend: 4, withoutHumanSend: 2, medianFirstHumanSendSeconds: 95, closedWithoutHumanSend: 1 },
  openNow: { total: 5, unassigned: 2, assignedToIneligible: 1, owners: { items: [owner], nextBefore: null } },
  unavailable: { abandonment: 'no_explicit_event', appointments: 'scoped_source_required' },
};
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(value = access, hidden = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (next = value, conceal = hidden) => <QueryClientProvider client={client}><SessionVisibilityContext.Provider value={conceal}><ClinicAccessContext.Provider value={next}><ReceptionDashboard /></ClinicAccessContext.Provider></SessionVisibilityContext.Provider></QueryClientProvider>;
  return { ...render(tree()), client, tree };
}
const ready = () => screen.findByText(owner.name);
const refresh = () => screen.getByRole('button', { name: 'Atualizar painel' });
const current = (client: QueryClient) => client.getQueryCache().findAll().find(q => q.getObserversCount() > 0)!;
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => { vi.resetAllMocks(); mocks.actor = access.actorId; vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T15:00:42Z')); mocks.read.mockResolvedValue(page); });
afterEach(() => { vi.restoreAllMocks(); onlineManager.setOnline(true); });

describe('K2 reception dashboard', () => {
  it('reads seven clinic days, forwards cancellation and keeps unavailable metrics distinct from zero', async () => {
    mount(); await ready();
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ ...range, before: null, limit: 10 }, expect.any(AbortSignal));
    expect(screen.getByLabelText('Data inicial')).toHaveValue('2026-10-31');
    expect(screen.getByText('1 min 35 s')).toBeVisible();
    expect(screen.getAllByText('Não disponível')).toHaveLength(3);
    expect(screen.getByText('Nome repetido na equipe')).toBeVisible();
    expect(screen.queryByText(owner.userId)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /agendar|enviar|transferir/i })).not.toBeInTheDocument();
  });
  it.each([
    { ...access, active: false }, { ...access, clinic: null }, { ...access, kind: 'clinical' as const },
    { ...access, active: false, admin: true }, { ...access, actorId: 'different-actor' },
  ])('does not read under invalid context %j', denied => {
    mount(denied); expect(screen.getByRole('alert')).toHaveTextContent('Acesso ao painel indisponível'); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('allows clinical administrators without changing medical scopes', async () => { mount({ ...access, kind: 'clinical', admin: true }); await ready(); expect(mocks.read).toHaveBeenCalledTimes(1); });
  it('hides the reader and aborts on session concealment', async () => {
    mocks.read.mockReturnValue(new Promise(() => {})); const view = mount();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); const signal = mocks.read.mock.calls[0][1] as AbortSignal;
    view.rerender(view.tree(access, true)); expect(screen.queryByText(owner.name)).not.toBeInTheDocument();
    expect(signal.aborted).toBe(true); expect(screen.queryByRole('heading', { name: 'Painel da recepção' })).not.toBeInTheDocument();
  });
  it('retires all snapshots while a refreshed read is pending, and sanitizes failure', async () => {
    const view = mount(); await ready(); const pending = deferred<WhatsAppDashboard>(); mocks.read.mockReturnValue(pending.promise);
    let fetching!: Promise<void>; act(() => { fetching = view.client.invalidateQueries(); });
    await screen.findByText('Carregando painel…'); expect(screen.queryByText(owner.name)).not.toBeInTheDocument(); expect(screen.queryByText('Não disponível')).not.toBeInTheDocument();
    await act(async () => { pending.resolve(page); await fetching; }); await ready();
    mocks.read.mockRejectedValue(new Error('private raw provider error')); fireEvent.click(refresh());
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o painel');
    expect(screen.queryByText(owner.name)).not.toBeInTheDocument(); expect(screen.queryByText(/private raw/)).not.toBeInTheDocument();
    mocks.read.mockResolvedValue(page); fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar painel' })); await ready();
    expect(mocks.read).toHaveBeenCalledTimes(4);
  });
  it('retires paused data and recovers by completing only the read', async () => {
    const view = mount(); await ready(); onlineManager.setOnline(false); let fetching!: Promise<void>;
    try {
      act(() => { fetching = view.client.invalidateQueries(); }); await waitFor(() => expect(current(view.client).state.fetchStatus).toBe('paused'));
      await screen.findByText('Aguardando conexão de rede para carregar o painel…'); expect(screen.queryByText(owner.name)).not.toBeInTheDocument();
    } finally { await act(async () => { onlineManager.setOnline(true); await fetching; }); }
    await ready();
  });
  it('replaces owners on pagination, preserving whole-snapshot counters and resetting on refresh', async () => {
    const cursor = `a1.${owner.userId}`; mocks.read.mockResolvedValueOnce({ ...page, openNow: { ...page.openNow, owners: { items: [owner], nextBefore: cursor } } });
    mount(); await ready(); const next = { ...page, asOf: '2026-11-07T15:02:00Z', cohort: { ...page.cohort, medianFirstHumanSendSeconds: 125 }, openNow: { ...page.openNow, total: 6, owners: { items: [{ ...owner, userId: '44444444-4444-4444-8444-444444444444', name: 'Outra pessoa sintética', openCount: 3 }], nextBefore: null } } };
    mocks.read.mockResolvedValue(next); fireEvent.click(screen.getByRole('button', { name: 'Próximos responsáveis' })); await screen.findByText('Outra pessoa sintética');
    expect(screen.queryByText(owner.name)).not.toBeInTheDocument(); expect(mocks.read.mock.calls[1][0]).toEqual({ ...range, before: cursor, limit: 10 });
    expect(within(screen.getByRole('region', { name: 'Em aberto agora' })).getByText('Conversas em aberto').nextElementSibling).toHaveTextContent('6');
    expect(screen.getByText('2 min 5 s')).toBeVisible(); expect(screen.getByText('Atualizado em 07/11/2026 às 12:02 · São Paulo')).toBeVisible();
    mocks.read.mockResolvedValue(page); fireEvent.click(refresh()); await ready(); expect(mocks.read.mock.calls[2][0].before).toBeNull();
  });
  it('ignores a captured pagination click after cache invalidation but before React notification', async () => {
    mocks.read.mockResolvedValue({ ...page, openNow: { ...page.openNow, owners: { items: [owner], nextBefore: `a1.${owner.userId}` } } });
    const view = mount(); await ready(); const next = screen.getByRole('button', { name: 'Próximos responsáveis' }); mocks.read.mockReturnValue(new Promise(() => {}));
    void view.client.invalidateQueries(); fireEvent.click(next); expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(current(view.client).queryKey).toContain(null);
  });
  it('retires data on draft edits, requires apply even when reverted, then validates and focuses local errors', async () => {
    mount(); await ready(); change('Data inicial', '2026-11-01'); expect(screen.queryByText(owner.name)).not.toBeInTheDocument();
    change('Data inicial', '2026-10-31'); expect(mocks.read).toHaveBeenCalledTimes(1); expect(screen.queryByText(owner.name)).not.toBeInTheDocument();
    change('Data inicial', '2026-11-08'); fireEvent.click(screen.getByRole('button', { name: 'Aplicar período' }));
    const alert = screen.getByRole('alert'); expect(alert).toHaveFocus(); expect(mocks.read).toHaveBeenCalledTimes(1);
    change('Data inicial', '2026-11-01'); mocks.read.mockResolvedValue({ ...page, window: { ...page.window, from: '2026-11-01T15:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar período' })); await ready(); expect(mocks.read.mock.calls[1][0].from).toBe('2026-11-01T15:00:00.000Z');
  });
  it('starts a separate fresh reader after clinic changes, cancelling the old context', async () => {
    const view = mount(); await ready(); const pending = deferred<WhatsAppDashboard>(); mocks.read.mockReturnValue(pending.promise);
    view.rerender(view.tree({ ...access, clinic: { id: '55555555-5555-4555-8555-555555555555', name: 'Outra clínica sintética' } }));
    expect(screen.queryByText(owner.name)).not.toBeInTheDocument(); expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(page)); await ready();
  });
  it('distinguishes an empty cohort from current workload and preserves a zero-second sample', async () => {
    mocks.read.mockResolvedValue({ ...page, cohort: { incomingCycles: 0, withHumanSend: 0, withoutHumanSend: 0, medianFirstHumanSendSeconds: null, closedWithoutHumanSend: 0 } });
    const view = mount(); await ready(); expect(screen.getByText('Sem amostra')).toBeVisible(); expect(screen.getByText(/Nenhuma entrada no período/)).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Em aberto agora' })).getByText(owner.name)).toBeVisible();
    mocks.read.mockResolvedValue({ ...page, cohort: { ...page.cohort, medianFirstHumanSendSeconds: 0 } }); act(() => { void view.client.invalidateQueries(); });
    expect(await screen.findByText('0 s')).toBeVisible(); expect(screen.getAllByText('Não disponível')).toHaveLength(3);
  });
});
