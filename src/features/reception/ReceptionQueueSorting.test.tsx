import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionQueue, { QUEUE_SCAN_PAGES } from './ReceptionQueue';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess, QueueItem } from './contracts';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), detail: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { queue: mocks.queue, case: mocks.detail } }));
vi.mock('./WhatsAppInbox', () => ({ default: () => null }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { conversations: async () => ({ conversations: [], nextBefore: null }) } }));
vi.mock('./CaseWorkspace', () => ({ CaseWorkspace: () => null }));
vi.mock('./NewCaseDialog', () => ({ NewCaseDialog: () => null }));
vi.mock('@/hooks/use-mobile', () => ({ isBelowMobileBreakpoint: () => false }));

const actor = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222';
const access: ClinicAccess = { actorId: actor, kind: 'reception', active: true, admin: false, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const item = (n: number, name: string, phone: string, createdAt: string): QueueItem => ({
  id: `0000000${n}-3333-4333-8333-333333333333`, subject: `Pedido sintético ${n}`, kind: 'return', status: 'new', revision: 1,
  contactId: '44444444-4444-4444-8444-444444444444', contactName: name, phone, doctorId: null, assignedTo: null, assigneeName: null, createdAt,
});
function Location() { return <output aria-label="Endereço">{useLocation().search}</output>; }
function mount(path = '/recepcao') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><ClinicAccessContext.Provider value={access}><ReceptionQueue /><Location /></ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>);
}
const cards = () => within(screen.getByRole('region', { name: 'Atendimentos da fila' })).getAllByRole('button', { pressed: false }).map(card => card.textContent ?? '');

describe('queue cards and sorting (D10)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The server lists the newest first.
    mocks.queue.mockResolvedValue({ items: [
      item(1, 'Maria Souza', '+5541999990001', minutesAgo(12)),
      item(2, 'José Lima', '+5541988880002', minutesAgo(95)),
    ], nextCursor: null });
  });

  it('shows the waiting time and the phone under the name on each card', async () => {
    mount();
    await screen.findByText('Maria Souza');
    expect(cards()[0]).toContain('há 12 min');
    expect(cards()[0]).toContain('(41) 99999-0001');
    expect(cards()[1]).toContain('há 1 h 35 min');
  });

  it('searches by name without accents or by phone digits, without putting it in the address', async () => {
    mount();
    await screen.findByText('Maria Souza');
    fireEvent.change(screen.getByLabelText('Buscar na fila'), { target: { value: 'jose' } });
    expect(screen.queryByText('Maria Souza')).not.toBeInTheDocument();
    expect(screen.getByText('José Lima')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Buscar na fila'), { target: { value: '99999' } });
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.queryByText('José Lima')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar na fila'), { target: { value: 'Ana' } });
    expect(screen.getByText('Nenhum atendimento encontrado para esta busca.')).toBeVisible();
    expect(screen.getByLabelText('Endereço').textContent).toBe('');
  });

  it('orders oldest first on request and keeps the choice in the address', async () => {
    mount();
    await screen.findByText('Maria Souza');
    expect(cards()[0]).toContain('Maria Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Mais antigos' }));
    await waitFor(() => expect(cards()[0]).toContain('José Lima'));
    expect(screen.getByRole('button', { name: 'Mais antigos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Endereço').textContent).toBe('?order=oldest');
  });

  it('reads the rest of the queue for the oldest-first order, up to a limit it states', async () => {
    let page = 0;
    mocks.queue.mockImplementation(async () => {
      page += 1;
      return { items: [item(page % 10, `Contato ${page}`, '+5541999990001', minutesAgo(page * 10))], nextCursor: `0000000${page % 10}-3333-4333-8333-333333333333` };
    });
    mount('/recepcao?order=oldest');
    await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(QUEUE_SCAN_PAGES));
    expect(await screen.findByText(/Mostrando os 300 atendimentos mais recentes/)).toBeVisible();
    expect(cards()[0]).toContain(`Contato ${QUEUE_SCAN_PAGES}`);
    expect(screen.queryByRole('button', { name: 'Carregar mais atendimentos' })).not.toBeInTheDocument();
  });

  it('folds the filters behind a "Filtros" button that counts the active ones', async () => {
    mount('/recepcao?mine=1&order=oldest');
    await screen.findByText('Maria Souza');
    const toggle = screen.getByRole('button', { name: 'Filtros (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(panel.className).toContain('md:grid');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(within(panel).getByRole('checkbox', { name: 'Só os meus' })).toBeChecked();
  });
});
