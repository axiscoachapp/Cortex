// Finance screen. Synthetic data only; the Edge Function is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
// Radix Select needs pointer capture and scrollIntoView, which jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const invoke = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'e9100000-0000-4000-8000-000000000002' }, signOut: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import BillingPage from './BillingPage';
import { settleProblems } from './billingLogic';
import type { Charge } from './billingApi';

const CLINIC = 'e9200000-0000-4000-8000-000000000001';
const DOCTOR = 'e9100000-0000-4000-8000-000000000002';
const PAYER = 'e9300000-0000-4000-8000-000000000001';
const APPT = 'e9600000-0000-4000-8000-000000000001';
const BATCH = 'e9500000-0000-4000-8000-000000000001';

const state = (role: 'admin' | 'reception' | 'doctor') => ({
  role, userId: DOCTOR, settings: { legalName: 'CLINICA FICTICIA LTDA', cnpj: null, cnes: '9999999', nextGuideNumber: 3, revision: 1 },
  payers: [{ id: PAYER, name: 'Operadora Exemplo', ansRegistry: '999999', providerCode: '123456', tissVersion: '4.03.00', hashEncoding: 'latin1', zipRequired: false,
    submissionDays: 30, paymentDays: 60, active: true, notes: '', revision: 1 }],
  doctors: [{ id: DOCTOR, name: 'Dra. Ana Exemplo', crm: '00000', crmUf: 'PR' }],
  professionals: [],
});
const price = { id: 'e9800000-0000-4000-8000-000000000001', payerId: PAYER, tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório',
  guideType: 'consulta', amount: 150, active: true, revision: 1 };
const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'e9400000-0000-4000-8000-000000000001', appointmentId: null, doctorId: DOCTOR, contactId: null, patientName: 'Paciente Exemplo', payerId: PAYER,
  cardNumber: '0001', newborn: false, guideType: 'consulta', tableCode: '22', procedureCode: '10101012', description: 'Consulta', quantity: 1, unitAmount: 150,
  amount: 150, serviceDate: '2026-11-06', consultationType: '1', authorization: { number: null, password: null, date: null, validUntil: null }, status: 'sent',
  guideNumber: 1, batchId: BATCH, paidAmount: 0, deniedAmount: 0, denialCode: null, denialNote: null, notes: '', revision: 2, ...over,
});

function answer(role: 'admin' | 'reception' | 'doctor', extra: Record<string, unknown> = {}) {
  return async (_fn: string, opts?: { body: Record<string, unknown> }) => {
    const action = opts?.body.action as string;
    const data: Record<string, unknown> = {
      state: state(role), prices: { prices: [price] },
      toBill: { items: [{ appointmentId: APPT, doctorId: DOCTOR, start: '2026-11-06T13:00:00Z', type: 'novo', contactId: 'e9700000-0000-4000-8000-000000000001',
        patientName: 'Paciente Exemplo', consultationType: '1', attendance: 'done', coverages: [{ payerId: PAYER, cardNumber: '0001 2345', cardValidUntil: null, plan: '' }], intake: null }] },
      charges: { charges: [] }, cash: { payments: [], expenses: [] }, batches: { batches: [] }, openForBatch: { charges: [] },
      report: { totals: { count: 0, charged: 0, paid: 0, denied: 0, open: 0 }, doctors: [], payers: [], denials: [] },
      createCharge: charge({ status: 'open' }), ...extra,
    };
    return { data: data[action] ?? {}, error: null };
  };
}

function renderPage(role: 'admin' | 'reception' | 'doctor') {
  const access = { kind: role === 'reception' ? 'reception' : 'clinical', active: true, admin: role === 'admin', actorId: DOCTOR,
    clinic: { id: CLINIC, name: 'Clínica Sintética' }, doctors: [], staff: [] } as unknown as ClinicAccess;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ClinicAccessContext.Provider value={access}>
        <MemoryRouter><BillingPage /></MemoryRouter>
      </ClinicAccessContext.Provider>
    </QueryClientProvider>,
  );
}

describe('finance page', () => {
  beforeEach(() => invoke.mockReset());

  it('explains a doctor’s read-only charges without promising payment actions', async () => {
    invoke.mockImplementation(answer('doctor'));
    renderPage('doctor');
    await screen.findByRole('tab', { name: /Cobranças/ });
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Cobranças', 'Relatórios']);
    expect(screen.getByText('Consulte suas cobranças, os pagamentos registrados e os saldos em aberto.')).toBeVisible();
    expect(screen.queryByText(/registre o pagamento recebido/)).toBeNull();
  });

  it('describes cash according to role and the existing date scopes', async () => {
    invoke.mockImplementation(answer('reception'));
    const view = renderPage('reception');
    await userEvent.click(await screen.findByRole('tab', { name: /Caixa/ }));
    expect(screen.getByText('Confira os recebimentos do período pela data de pagamento.')).toBeVisible();
    view.unmount();
    invoke.mockImplementation(answer('admin'));
    renderPage('admin');
    await userEvent.click(await screen.findByRole('tab', { name: /Caixa/ }));
    expect(screen.getByText('Recebimentos pela data de pagamento; despesas em aberto pelo vencimento e despesas pagas pela data do pagamento.')).toBeVisible();
  });

  it('shows the tabs of each role', async () => {
    invoke.mockImplementation(answer('admin'));
    const { unmount } = renderPage('admin');
    await screen.findByRole('tab', { name: /A faturar \(1\)/ });
    // The daily sequence is numbered, with what waits in each step; reference tabs come apart, unnumbered.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['1 A faturar (1)', '2 Cobranças', '3 Lotes', '4 Caixa', 'Relatórios', 'Cadastros']);
    unmount();
    invoke.mockImplementation(answer('reception'));
    renderPage('reception');
    await screen.findByRole('tab', { name: /A faturar \(1\)/ });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['1 A faturar (1)', '2 Cobranças', '3 Caixa']);
    expect(screen.getByText(/Próximo passo: clique em “Cobrar”/)).toBeVisible();
  });

  it('bills an attended appointment prefilled with the saved card and the price table', async () => {
    invoke.mockImplementation(answer('reception'));
    const user = userEvent.setup();
    renderPage('reception');
    await user.click(await screen.findByRole('button', { name: 'Cobrar o atendimento de Paciente Exemplo' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Paciente')).toHaveValue('Paciente Exemplo');
    expect(within(dialog).getByLabelText('Número da carteirinha')).toHaveValue('0001 2345');
    // The plan's consultation price comes preselected; guide type, table and code stay folded.
    expect(within(dialog).getByRole('combobox', { name: 'Procedimento da tabela de preços' })).toHaveTextContent('Consulta em consultório · R$ 150,00 · 10101012');
    expect(within(dialog).getByLabelText('Valor unitário (R$)')).toHaveValue('150,00');
    expect(within(dialog).getByRole('button', { name: /Detalhes da guia/ })).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByLabelText('Código')).toBeNull();
    expect(within(dialog).getByLabelText('Quantidade')).toHaveAccessibleDescription('A guia de consulta tem sempre 1.');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar cobrança' }));
    await waitFor(() => expect(invoke.mock.calls.some(([, o]) => o?.body.action === 'createCharge')).toBe(true));
    const body = invoke.mock.calls.find(([, o]) => o?.body.action === 'createCharge')![1].body;
    expect(body).toMatchObject({ appointmentId: APPT, patientName: 'Paciente Exemplo', payerId: PAYER, cardNumber: '0001 2345', guideType: 'consulta',
      tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório', quantity: 1, unitAmount: 150, serviceDate: '2026-11-06', consultationType: '1' });
    expect(body).not.toHaveProperty('doctorId');
  }, 30_000);

  it('requires a denial code when the plan paid less than the guide', async () => {
    const c1 = charge();
    const c2 = charge({ id: 'e9400000-0000-4000-8000-000000000002', guideNumber: 2 });
    expect(settleProblems([c1, c2], { [c1.id]: { paid: '150,00', code: '', note: '' }, [c2.id]: { paid: '100,00', code: '', note: '' } }))
      .toEqual(['Guia 2: informe o código da glosa.']);
    expect(settleProblems([c1], { [c1.id]: { paid: '200', code: '', note: '' } })).toEqual([expect.stringContaining('valor pago entre')]);

    const batch = { id: BATCH, payerId: PAYER, number: 4, guideType: 'consulta', status: 'sent', totalAmount: 300, paidAmount: 0, deniedAmount: 0, xmlHash: 'a'.repeat(32),
      generatedAt: null, sentAt: '2026-11-07', protocol: 'P-1', paymentDate: null, nfseNumber: null, notes: '', revision: 3, createdAt: '2026-11-07T10:00:00Z' };
    invoke.mockImplementation(answer('admin', { batches: { batches: [batch] }, batchCharges: { charges: [c1, c2] }, settle: { paid: 250, denied: 50 } }));
    const user = userEvent.setup();
    renderPage('admin');
    await user.click(await screen.findByRole('tab', { name: /Lotes/ }));
    await user.click(await screen.findByRole('button', { name: 'Lançar o retorno do lote 4' }));
    const dialog = await screen.findByRole('dialog');
    const paid2 = await within(dialog).findByLabelText('Pago (R$)', { selector: `#settle-paid-${c2.id}` });
    await user.clear(paid2);
    await user.type(paid2, '100,00');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar retorno e fechar lote' }));
    expect(await within(dialog).findByText('Guia 2: informe o código da glosa.')).toBeInTheDocument();
    expect(invoke.mock.calls.some(([, o]) => o?.body.action === 'settle')).toBe(false);
    await user.type(within(dialog).getByLabelText('Código da glosa'), '1705');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar retorno e fechar lote' }));
    await waitFor(() => expect(invoke.mock.calls.some(([, o]) => o?.body.action === 'settle')).toBe(true));
    expect(invoke.mock.calls.find(([, o]) => o?.body.action === 'settle')![1].body).toMatchObject({
      batchId: BATCH, revision: 3, items: [{ chargeId: c1.id, paid: 150 }, { chargeId: c2.id, paid: 100, denialCode: '1705', denialNote: null }] });
  }, 30_000);
});
