// Synthetic finance flows. The real draft/route guard runs; only the network boundary is replaced.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import { confirmSessionExit, UnsavedChangesRouteGuard } from '@/hooks/useUnsavedChanges';
import BillingPage from './BillingPage';
import { billingKey, type Batch, type BillingState, type Charge } from './billingApi';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'e9100000-0000-4000-8000-000000000001' }, signOut: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

const clinic = 'e9200000-0000-4000-8000-000000000001';
const actor = 'e9100000-0000-4000-8000-000000000001';
const payer = 'e9300000-0000-4000-8000-000000000001';
const state: BillingState = {
  role: 'admin', userId: actor,
  settings: { legalName: 'CLINICA SINTETICA', cnpj: null, cnes: '9999999', nextGuideNumber: 3, revision: 1 },
  doctors: [{ id: actor, name: 'Médico Exemplo', crm: '00000', crmUf: 'PR' }], professionals: [],
  payers: [{ id: payer, name: 'Convênio Exemplo', ansRegistry: '999999', providerCode: '0001', tissVersion: '4.03.00', hashEncoding: 'latin1',
    zipRequired: false, submissionDays: 30, paymentDays: 60, active: true, notes: '', revision: 1 }],
};
const charge: Charge = {
  id: 'e9400000-0000-4000-8000-000000000001', appointmentId: null, doctorId: actor, contactId: null, patientName: 'Paciente Sintético',
  payerId: null, cardNumber: null, newborn: false, guideType: 'particular', tableCode: '22', procedureCode: '10101012', description: 'Consulta exemplo',
  quantity: 1, unitAmount: 150, amount: 150, serviceDate: '2026-11-10', consultationType: null,
  authorization: { number: null, password: null, date: null, validUntil: null }, status: 'open', guideNumber: null, batchId: null,
  paidAmount: 50, deniedAmount: 0, denialCode: null, denialNote: null, notes: '', revision: 2,
};
const batch: Batch = {
  id: 'e9500000-0000-4000-8000-000000000001', payerId: payer, number: 4, guideType: 'consulta', status: 'sent', totalAmount: 150,
  paidAmount: 0, deniedAmount: 0, xmlHash: 'a'.repeat(32), generatedAt: null, sentAt: '2026-11-09', protocol: null,
  paymentDate: null, nfseNumber: null, notes: '', revision: 3, createdAt: '2026-11-09T12:00:00Z',
};
const batchCharge: Charge = { ...charge, payerId: payer, guideType: 'consulta', guideNumber: 8, batchId: batch.id, status: 'sent', paidAmount: 0 };

function respond(overrides: Record<string, unknown> = {}) {
  invoke.mockImplementation(async (_fn: string, options: { body: { action: string } }) => {
    const answers: Record<string, unknown> = {
      state: structuredClone(state), prices: { prices: [] }, toBill: { items: [] }, charges: { charges: [charge] },
      cash: { payments: [], expenses: [] }, batches: { batches: [batch, { ...batch, id: `${batch.id}-draft`, number: 5, status: 'draft' }] },
      openForBatch: { charges: [] }, batchCharges: { charges: [batchCharge] }, ...overrides,
    };
    return { data: answers[options.body.action] ?? {}, error: null };
  });
}
function Page() {
  return <><UnsavedChangesRouteGuard /><BillingPage /></>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const access = { kind: 'clinical', active: true, admin: true, actorId: actor, clinic: { id: clinic, name: 'Clínica Sintética' }, doctors: [], staff: [] } as unknown as ClinicAccess;
  const router = createMemoryRouter([{ path: '/', element: <Page /> }, { path: '/outside', element: <p>Destino externo ao financeiro</p> }]);
  render(<QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}><RouterProvider router={router} /></ClinicAccessContext.Provider></QueryClientProvider>);
  return { client, router };
}
async function openPayment() {
  await userEvent.click(await screen.findByRole('tab', { name: /Cobranças/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Receber de Paciente Sintético' }));
  return screen.findByRole('dialog');
}

describe('financial draft protection', () => {
  beforeEach(() => { invoke.mockReset(); respond(); vi.spyOn(window, 'confirm').mockReturnValue(false); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('allows a pristine charge to close and protects an edited charge from cancel, close, reload and session exit', async () => {
    mount();
    const newCharge = await screen.findByRole('button', { name: 'Nova cobrança avulsa' });
    fireEvent.click(newCharge);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(newCharge);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Paciente'), { target: { value: 'Rascunho sintético' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(dialog).toBeVisible();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(dialog).toBeVisible();
    expect(confirmSessionExit()).toBe(false);
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirmSessionExit()).toBe(true);
    expect(invoke.mock.calls.some(([, options]) => options.body.action === 'createCharge')).toBe(false);
  });

  it('retains the same charge draft when billing state is refreshed', async () => {
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova cobrança avulsa' }));
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'Rascunho sintético' } });
    respond({ state: { ...state, doctors: [{ ...state.doctors[0], crm: '00001' }] } });
    await act(async () => { await client.invalidateQueries({ queryKey: billingKey([clinic, actor], 'state') }); });
    expect(screen.getByLabelText('Paciente')).toHaveValue('Rascunho sintético');
  });

  it('keeps edited payments on canceled navigation and clears the draft only after confirmed discard', async () => {
    const { router } = mount();
    const dialog = await openPayment();
    fireEvent.change(within(dialog).getByLabelText('Valor (R$)'), { target: { value: '40,00' } });
    await act(async () => { await router.navigate('/outside'); });
    // Route exits ask in the app's dialog (round 3, M 33).
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Descartar alterações?' })).getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/');
    expect(within(dialog).getByLabelText('Valor (R$)')).toHaveValue('40,00');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog).toBeVisible();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Receber de Paciente Sintético' }));
    expect(await screen.findByLabelText('Valor (R$)')).toHaveValue('100,00');
    expect(confirmSessionExit()).toBe(true);
  });

  it('protects a new expense while allowing a rejected discard to keep its values', async () => {
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /Caixa/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova despesa' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Descrição'), { target: { value: 'Material sintético' } });
    expect(confirmSessionExit()).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Material sintético');
  });

  it('protects guide selection from section and guide-type changes until discard is confirmed', async () => {
    respond({ openForBatch: { charges: [batchCharge] } });
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /Lotes/ }));
    const selected = await screen.findByRole('checkbox', { name: /Incluir Paciente Sintético/ });
    await userEvent.click(selected);
    await userEvent.click(screen.getByRole('tab', { name: /Cadastros/ }));
    expect(screen.getByRole('tab', { name: /Lotes/ })).toHaveAttribute('data-state', 'active');
    expect(selected).toBeChecked();
    await userEvent.click(screen.getByRole('combobox', { name: 'Tipo de guia do lote' }));
    await userEvent.click(await screen.findByRole('option', { name: 'SP/SADT' }));
    expect(selected).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Tipo de guia do lote' })).toHaveTextContent('Consulta');
    vi.mocked(window.confirm).mockReturnValue(true);
    await userEvent.click(screen.getByRole('tab', { name: /Cadastros/ }));
    expect(await screen.findByText(/equipe Cortex prepara/)).toBeVisible();
    expect(confirmSessionExit()).toBe(true);
    expect(invoke.mock.calls.some(([, options]) => options.body.action === 'createBatch')).toBe(false);
  });

  it('keeps a batch creation in flight until its reply and releases the selection after success', async () => {
    respond({ openForBatch: { charges: [batchCharge] } });
    let finish!: (value: unknown) => void;
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation((fn, options) => options.body.action === 'createBatch' ? new Promise(resolve => { finish = resolve; }) : normal(fn, options));
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /Lotes/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Incluir Paciente Sintético/ }));
    const create = screen.getByRole('button', { name: 'Criar lote' });
    act(() => { fireEvent.click(create); fireEvent.click(create); });
    await waitFor(() => expect(invoke.mock.calls.filter(([, options]) => options.body.action === 'createBatch')).toHaveLength(1));
    expect(confirmSessionExit()).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Convênio do lote' })).toBeDisabled();
    await userEvent.click(screen.getByRole('tab', { name: /Cadastros/ }));
    expect(screen.getByRole('tab', { name: /Lotes/ })).toHaveAttribute('data-state', 'active');
    await act(async () => { finish({ data: { number: 6, guides: 1 }, error: null }); });
    await waitFor(() => expect(create).toBeDisabled());
    expect(confirmSessionExit()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(invoke.mock.calls.find(([, options]) => options.body.action === 'createBatch')![1].body).toMatchObject({ payerId: payer, guideType: 'consulta', chargeIds: [batchCharge.id] });
  });

  it.each([
    ['Lançar o retorno do lote 4', 'Data do pagamento'],
    ['Marcar o lote 5 como enviado', 'Enviado em'],
    ['Nota fiscal do lote 4', 'Número da NFS-e'],
  ])('protects and resets batch draft: %s', async (action, label) => {
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /Lotes/ }));
    fireEvent.click(await screen.findByRole('button', { name: action }));
    const dialog = await screen.findByRole('dialog');
    const input = await within(dialog).findByLabelText(label);
    const initial = (input as HTMLInputElement).value;
    fireEvent.change(input, { target: { value: label === 'Número da NFS-e' ? '0004' : '2026-10-02' } });
    expect(confirmSessionExit()).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog).toBeVisible();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(await screen.findByLabelText(label)).toHaveValue(initial);
    expect(confirmSessionExit()).toBe(true);
  });

  it('locks an in-flight payment, submits once, and completes without a discard confirmation', async () => {
    let finish!: (value: unknown) => void;
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation((fn, options) => options.body.action === 'pay' ? new Promise(resolve => { finish = resolve; }) : normal(fn, options));
    mount();
    const dialog = await openPayment();
    const form = within(dialog).getByRole('button', { name: 'Registrar pagamento' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(invoke.mock.calls.filter(([, options]) => options.body.action === 'pay')).toHaveLength(1));
    expect(confirmSessionExit()).toBe(false);
    expect(window.alert).toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(dialog).toBeVisible();
    await act(async () => { finish({ data: {}, error: null }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(confirmSessionExit()).toBe(true);
  });

  it.each(['createCharge', 'saveExpense', 'settle', 'markSent', 'updateBatch'])(
    'locks and completes one financial request: %s', async (action) => {
      let finish!: (value: unknown) => void;
      const normal = invoke.getMockImplementation()!;
      invoke.mockImplementation((fn, options) => options.body.action === action ? new Promise(resolve => { finish = resolve; }) : normal(fn, options));
      mount();
      if (action === 'createCharge') {
        fireEvent.click(await screen.findByRole('button', { name: 'Nova cobrança avulsa' }));
        fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'Paciente Sintético' } });
        fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Consulta sintética' } });
        fireEvent.change(screen.getByLabelText('Valor unitário (R$)'), { target: { value: '150,00' } });
      } else if (action === 'saveExpense') {
        await userEvent.click(await screen.findByRole('tab', { name: /Caixa/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Nova despesa' }));
        fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Material sintético' } });
        fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '120,00' } });
      } else {
        await userEvent.click(await screen.findByRole('tab', { name: /Lotes/ }));
        const button = action === 'settle' ? 'Lançar o retorno do lote 4' : action === 'markSent' ? 'Marcar o lote 5 como enviado' : 'Nota fiscal do lote 4';
        fireEvent.click(await screen.findByRole('button', { name: button }));
        if (action === 'settle') await screen.findByLabelText('Pago (R$)');
        if (action === 'markSent') fireEvent.change(screen.getByLabelText('Protocolo do portal (opcional)'), { target: { value: 'PROTOCOLO-SINTETICO' } });
        if (action === 'updateBatch') fireEvent.change(screen.getByLabelText('Número da NFS-e'), { target: { value: '0004' } });
      }
      const dialog = await screen.findByRole('dialog');
      const form = dialog.querySelector('form')!;
      act(() => { fireEvent.submit(form); fireEvent.submit(form); });
      await waitFor(() => expect(invoke.mock.calls.filter(([, options]) => options.body.action === action)).toHaveLength(1));
      expect(confirmSessionExit()).toBe(false);
      expect(window.alert).toHaveBeenCalled();
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
      expect([...form.querySelectorAll('input')].every(input => input.matches(':disabled'))).toBe(true);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
      expect(dialog).toBeVisible();
      const body = invoke.mock.calls.find(([, options]) => options.body.action === action)![1].body;
      if (action === 'createCharge') expect(body).toMatchObject({ doctorId: actor, patientName: 'Paciente Sintético', quantity: 1, unitAmount: 150 });
      if (action === 'saveExpense') expect(body).toMatchObject({ amount: 120, paidOn: null, method: null });
      if (action === 'settle') expect(body).toMatchObject({ batchId: batch.id, revision: 3, items: [{ chargeId: batchCharge.id, paid: 150 }] });
      if (action === 'markSent') expect(body).toMatchObject({ batchId: `${batch.id}-draft`, revision: 3, protocol: 'PROTOCOLO-SINTETICO' });
      if (action === 'updateBatch') expect(body).toMatchObject({ batchId: batch.id, revision: 3, nfseNumber: '0004' });
      await act(async () => { finish({ data: action === 'createCharge' ? charge : {}, error: null }); });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(window.confirm).not.toHaveBeenCalled();
      expect(confirmSessionExit()).toBe(true);
    },
  );

  it('preserves a failed payment for explicit retry and allows confirmed route discard afterward', async () => {
    const normal = invoke.getMockImplementation()!;
    let attempts = 0;
    invoke.mockImplementation((fn, options) => {
      if (options.body.action === 'pay' && ++attempts === 1) return Promise.reject(new Error('Falha sintética; confira antes de tentar novamente.'));
      return normal(fn, options);
    });
    const { router } = mount();
    const dialog = await openPayment();
    fireEvent.change(within(dialog).getByLabelText('Valor (R$)'), { target: { value: '40,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pagamento' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Falha sintética');
    expect(within(dialog).getByLabelText('Valor (R$)')).toHaveValue('40,00');
    expect(within(dialog).getByRole('button', { name: 'Registrar pagamento' })).toBeEnabled();
    expect(confirmSessionExit()).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pagamento' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invoke.mock.calls.filter(([, options]) => options.body.action === 'pay')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Receber de Paciente Sintético' }));
    fireEvent.change(await screen.findByLabelText('Observação'), { target: { value: 'Descartar rascunho sintético' } });
    await act(async () => { await router.navigate('/outside'); });
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Descartar alterações?' })).getByRole('button', { name: 'Descartar alterações' }));
    expect(await screen.findByText('Destino externo ao financeiro')).toBeVisible();
    expect(confirmSessionExit()).toBe(true);
  });

  it('shows prepared billing registrations for review without exposing editing actions', async () => {
    respond({ prices: { prices: [{ id: 'price-example', payerId: payer, tableCode: '22', procedureCode: '10101012', description: 'Consulta sintética',
      guideType: 'consulta', amount: 150, active: true, revision: 1 }] } });
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /Cadastros/ }));
    expect(await screen.findByText(/equipe Cortex prepara/)).toBeVisible();
    expect(screen.getByText('CLINICA SINTETICA')).toBeVisible();
    expect(screen.getByText('Consulta sintética')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Salvar|Editar|Preencher|Novo convênio|Novo preço|Excluir/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(invoke.mock.calls.some(([, options]) => /^save|delete/.test(options.body.action))).toBe(false);
  });

  it('shows a failed price read with retry instead of claiming the table is empty', async () => {
    const normal = invoke.getMockImplementation()!;
    let fail = true;
    invoke.mockImplementation((fn, options) => options.body.action === 'prices' && fail ? Promise.reject(new Error('Falha sintética da tabela de preços.')) : normal(fn, options));
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /Cadastros/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha sintética da tabela de preços.');
    expect(screen.queryByText(/Nenhum preço cadastrado/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText(/equipe Cortex prepara/)).toBeVisible();
    expect(screen.getByText(/Nenhum preço cadastrado/)).toBeVisible();
  });
});
