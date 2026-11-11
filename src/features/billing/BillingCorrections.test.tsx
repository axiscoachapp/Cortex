// Finance improvement plan, round 2: recovery, corrections and scannability. Synthetic data; only the
// network boundary is replaced (the reviewer's repros of 11/11, inverted).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import { UnsavedChangesRouteGuard } from '@/hooks/useUnsavedChanges';
import BillingPage from './BillingPage';
import { csvCell, monthLabel, monthRange, toCsv, type Batch, type BillingState, type Charge } from './billingApi';
import { seedFrom } from './billingLogic';

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
const APPT = 'e9600000-0000-4000-8000-000000000001';
const state: BillingState = {
  role: 'admin', userId: actor,
  settings: { legalName: 'CLINICA SINTETICA', cnpj: null, cnes: '9999999', nextGuideNumber: 7, revision: 1 },
  doctors: [{ id: actor, name: 'Médico Exemplo', crm: '00000', crmUf: 'PR' }],
  professionals: [{ userId: actor, tissName: 'MEDICO EXEMPLO', council: '06', councilNumber: '00000', councilUf: '41', cbo: '225250', sharePercent: 60, revision: 1 }],
  payers: [{ id: payer, name: 'Convênio Exemplo', ansRegistry: '999999', providerCode: '0001', tissVersion: '4.03.00', hashEncoding: 'latin1',
    zipRequired: false, submissionDays: 30, paymentDays: 60, active: true, notes: '', revision: 1 }],
};
const charge: Charge = {
  id: 'e9400000-0000-4000-8000-000000000001', appointmentId: null, doctorId: actor, contactId: null, patientName: 'Paciente Sintético',
  payerId: null, cardNumber: null, newborn: false, guideType: 'particular', tableCode: '00', procedureCode: 'PARTICULAR', description: 'Consulta exemplo',
  quantity: 1, unitAmount: 150, amount: 150, serviceDate: '2026-11-10', consultationType: null,
  authorization: { number: null, password: null, date: null, validUntil: null }, status: 'open', guideNumber: null, batchId: null,
  paidAmount: 50, deniedAmount: 0, denialCode: null, denialNote: null, notes: '', revision: 2,
};
const planCharge = (over: Partial<Charge> = {}): Charge => ({ ...charge, id: 'e9400000-0000-4000-8000-000000000002', payerId: payer, cardNumber: '0001', guideType: 'consulta',
  tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório', patientName: 'Paciente Convênio', paidAmount: 0, guideNumber: 8, ...over });
const batch = (over: Partial<Batch> = {}): Batch => ({
  id: 'e9500000-0000-4000-8000-000000000001', payerId: payer, number: 4, guideType: 'consulta', status: 'sent', totalAmount: 300,
  paidAmount: 0, deniedAmount: 0, xmlHash: 'a'.repeat(32), generatedAt: '2026-11-09T13:05:00Z', sentAt: '2026-11-09', protocol: null,
  paymentDate: null, nfseNumber: null, notes: '', revision: 3, createdAt: '2026-11-09T12:00:00Z', answered: false, ...over,
});
const httpError = (body: Record<string, unknown>) => Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { json: async () => body } });
const bodies = (action: string) => invoke.mock.calls.filter(([, o]) => o?.body?.action === action).map(([, o]) => o.body);

type Answer = unknown | ((body: Record<string, unknown>, n: number) => unknown);
function respond(overrides: Record<string, Answer> = {}) {
  const counts: Record<string, number> = {};
  invoke.mockImplementation(async (_fn: string, options: { body: Record<string, unknown> & { action: string } }) => {
    const action = options.body.action;
    counts[action] = (counts[action] ?? 0) + 1;
    const answers: Record<string, Answer> = {
      state: structuredClone(state), prices: { prices: [] }, toBill: { items: [], earlier: [] }, charges: { charges: [charge] },
      cash: { payments: [], expenses: [] }, batches: { batches: [] }, openForBatch: { charges: [] }, batchCharges: { charges: [] },
      report: { totals: { count: 0, charged: 0, paid: 0, denied: 0, open: 0 }, doctors: [], payers: [], denials: [] }, ...overrides,
    };
    const raw = answers[action];
    const answer = typeof raw === 'function' ? (raw as (b: Record<string, unknown>, n: number) => unknown)(options.body, counts[action]) : raw;
    if (answer instanceof Error) return { data: null, error: answer };
    return { data: answer ?? {}, error: null };
  });
}
function mount(role: BillingState['role'] = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const access = { kind: 'clinical', active: true, admin: role === 'admin', actorId: actor, clinic: { id: clinic, name: 'Clínica Sintética' }, doctors: [], staff: [] } as unknown as ClinicAccess;
  const router = createMemoryRouter([{ path: '/', element: <><UnsavedChangesRouteGuard /><BillingPage /></> }]);
  render(<QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}><RouterProvider router={router} /></ClinicAccessContext.Provider></QueryClientProvider>);
}
const tab = (name: RegExp) => screen.findByRole('tab', { name });

beforeEach(() => { invoke.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('recovering from a stale revision', () => {
  it('reads the charge again and resends the typed payment with the fresh revision', async () => {
    respond({
      charges: (_b: unknown, n: number) => ({ charges: [{ ...charge, revision: n === 1 ? 2 : 3 }] }),
      pay: (b: Record<string, unknown>) => (b.revision === 2 ? httpError({ error: 'A cobrança mudou; atualize', code: 'stale' }) : { status: 'partial', revision: 4 }),
    });
    mount();
    await userEvent.click(await tab(/Cobranças/));
    fireEvent.click(await screen.findByRole('button', { name: 'Receber pagamento de Paciente Sintético' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Valor (R$)'), { target: { value: '40,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pagamento' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('O que você digitou foi mantido');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(within(dialog).getByLabelText('Valor (R$)')).toHaveValue('40,00');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar e tentar de novo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodies('pay').map((b) => [b.revision, b.amount])).toEqual([[2, 40], [3, 40]]);
    expect(bodies('charges').length).toBeGreaterThanOrEqual(2);
  });

  it('opens "Corrigir retorno" with the recorded paid values and denial codes instead of zeros', async () => {
    const c1 = planCharge({ id: 'e9400000-0000-4000-8000-000000000011', guideNumber: 1, status: 'paid', paidAmount: 150, batchId: batch().id });
    const c2 = planCharge({ id: 'e9400000-0000-4000-8000-000000000012', guideNumber: 2, status: 'partial', paidAmount: 100, deniedAmount: 50, denialCode: '1705', denialNote: 'Valor acima da tabela', batchId: batch().id });
    const reset = (c: Charge) => ({ ...c, status: 'sent', paidAmount: 0, deniedAmount: 0, denialCode: null, denialNote: null });
    let reopened = false;
    respond({
      batches: () => ({ batches: [batch({ status: reopened ? 'sent' : 'closed', revision: reopened ? 5 : 4, answered: true })] }),
      batchCharges: () => ({ charges: reopened ? [reset(c1), reset(c2)] : [c1, c2] }),
      reopenBatch: () => { reopened = true; return { status: 'sent', revision: 5 }; },
      settle: { paid: 240, denied: 60 },
    });
    mount();
    await userEvent.click(await tab(/Lotes/));
    fireEvent.click(await screen.findByRole('button', { name: 'Corrigir o retorno do lote 4' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Corrigir retorno' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lançar retorno' });
    expect(within(dialog).getByText(/valores lançados antes foram mantidos/)).toBeVisible();
    await waitFor(() => expect(within(dialog).getByLabelText('Pago (R$)', { selector: `#settle-paid-${c2.id}` })).toHaveValue('100,00'));
    expect(within(dialog).getByLabelText('Pago (R$)', { selector: `#settle-paid-${c1.id}` })).toHaveValue('150,00');
    expect(within(dialog).getByLabelText('Código da glosa')).toHaveValue('1705');
    expect(within(dialog).getByLabelText('Motivo (opcional)')).toHaveValue('Valor acima da tabela');
    // Correct only the typo, then save with the revision the reopen returned.
    fireEvent.change(within(dialog).getByLabelText('Pago (R$)', { selector: `#settle-paid-${c2.id}` }), { target: { value: '90,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar retorno e fechar lote' }));
    await waitFor(() => expect(bodies('settle')).toHaveLength(1));
    expect(bodies('settle')[0]).toMatchObject({ revision: 5, items: [{ chargeId: c1.id, paid: 150 }, { chargeId: c2.id, paid: 90, denialCode: '1705', denialNote: 'Valor acima da tabela' }] });
    expect(bodies('batchCharges')[0]).toEqual({ action: 'batchCharges', batchId: batch().id });
    const order = invoke.mock.calls.map(([, o]) => o.body.action).filter((a) => a === 'batchCharges' || a === 'reopenBatch');
    expect(order.slice(0, 2)).toEqual(['batchCharges', 'reopenBatch']);
  });
});

describe('charges', () => {
  it('lets reception charge a private patient with patient, description and value, and retries with the same request id', async () => {
    let attempts = 0;
    respond({ createCharge: () => (++attempts === 1 ? new Error('Falha de rede sintética') : charge) });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova cobrança avulsa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Código')).toBeNull();
    expect(within(dialog).queryByLabelText('Tabela')).toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: 'Procedimento da tabela de preços' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Paciente'), { target: { value: 'Paciente Particular' } });
    fireEvent.change(within(dialog).getByLabelText('Descrição'), { target: { value: 'Consulta particular' } });
    fireEvent.change(within(dialog).getByLabelText('Valor unitário (R$)'), { target: { value: '350,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar cobrança' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Falha de rede sintética');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar cobrança' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [first, second] = bodies('createCharge');
    expect(first).toMatchObject({ patientName: 'Paciente Particular', description: 'Consulta particular', unitAmount: 350, payerId: null });
    expect(first).not.toHaveProperty('procedureCode');
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.requestId).toBe(first.requestId);
  });

  it('drops a free-text card validity from the pre-consultation instead of sending it', () => {
    const item = { appointmentId: APPT, doctorId: actor, start: '2026-11-06T13:00:00Z', type: 'novo', contactId: null, patientName: 'Paciente Intake',
      consultationType: '1' as const, attendance: 'done' as const, coverages: [], intake: { type: 'Convênio', payer: 'Convênio Exemplo', card: '0001', validUntil: '12/2027' } };
    expect(seedFrom(item, state)).toMatchObject({ payerId: payer, cardNumber: '0001', cardValidUntil: null });
    expect(seedFrom({ ...item, intake: { ...item.intake, validUntil: '2027-12-31' } }, state).cardValidUntil).toBe('2027-12-31');
  });

  it('shows amounts on a grid, the code after the description, the glosa in red and real plurals', async () => {
    respond({ charges: { charges: [planCharge({ status: 'partial', paidAmount: 100, deniedAmount: 50, denialCode: '1705', denialNote: 'Valor acima da tabela' })] } });
    mount();
    await userEvent.click(await tab(/Cobranças/));
    expect(await screen.findByText('1 cobrança ·', { exact: false })).toBeVisible();
    expect(screen.getByText('· TUSS 10101012', { exact: false })).toHaveClass('text-muted-foreground');
    const glosa = screen.getByText(/^Glosa/);
    expect(glosa).toHaveClass('text-destructive');
    expect(glosa).toHaveTextContent('Glosa R$ 50,00 · 1705 Valor acima da tabela');
    expect(screen.getByText('Paga em parte').className).toMatch(/violet/);
  });

  it('corrects an open unpaid charge and recovers when someone changed it first', async () => {
    const open = planCharge({ status: 'open', revision: 2 });
    respond({
      charges: (_b: unknown, n: number) => ({ charges: [{ ...open, revision: n === 1 ? 2 : 3 }] }),
      updateCharge: (b: Record<string, unknown>) => (b.revision === 2 ? httpError({ error: 'A cobrança mudou; atualize', code: 'stale' }) : { ...open, revision: 4 }),
    });
    mount();
    await userEvent.click(await tab(/Cobranças/));
    fireEvent.click(await screen.findByRole('button', { name: 'Corrigir cobrança de Paciente Convênio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Corrigir cobrança' });
    fireEvent.change(within(dialog).getByLabelText('Número da carteirinha'), { target: { value: '0009 8888' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar correção' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Atualizar e tentar de novo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodies('updateCharge').map((b) => [b.id, b.revision, b.cardNumber])).toEqual([[open.id, 2, '0009 8888'], [open.id, 3, '0009 8888']]);
    expect(bodies('updateCharge')[0]).not.toHaveProperty('requestId');
  });

  it('offers re-present and write-off for a denied guide, only to the admin', async () => {
    const denied = planCharge({ status: 'denied', deniedAmount: 150, denialCode: '1423', revision: 6 });
    respond({ charges: { charges: [denied] }, representCharge: { ...denied, status: 'open' }, writeOffCharge: denied });
    mount();
    await userEvent.click(await tab(/Cobranças/));
    fireEvent.click(await screen.findByRole('button', { name: 'Reapresentar a guia 8 de Paciente Convênio' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reapresentar' }));
    await waitFor(() => expect(bodies('representCharge')).toEqual([{ action: 'representCharge', id: denied.id, revision: 6 }]));
    fireEvent.click(await screen.findByRole('button', { name: 'Dar baixa na glosa da guia 8 de Paciente Convênio' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.change(within(confirm).getByLabelText('Motivo (opcional)'), { target: { value: 'Sem recurso' } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Dar baixa' }));
    await waitFor(() => expect(bodies('writeOffCharge')).toEqual([{ action: 'writeOffCharge', id: denied.id, revision: 6, note: 'Sem recurso' }]));
    cleanup();
    respond({ state: { ...structuredClone(state), role: 'reception' }, charges: { charges: [denied] } });
    mount('reception');
    await userEvent.click(await tab(/Cobranças/));
    await screen.findByText('Paciente Convênio');
    expect(screen.queryByRole('button', { name: /Reapresentar|Dar baixa/ })).toBeNull();
  });

  it('explains an empty "A faturar" and takes the user to unbilled visits of earlier months', async () => {
    respond({ toBill: { items: [], earlier: [{ month: '2026-10', count: 2 }, { month: '2026-09', count: 1 }] } });
    mount();
    expect(await screen.findByText(/marcadas como realizadas ou com chegada registrada/)).toBeVisible();
    expect(screen.getByText('3 atendimentos de meses anteriores sem cobrança')).toBeVisible();
    const before = bodies('toBill').length;
    fireEvent.click(screen.getByRole('button', { name: `Ver 2 atendimentos sem cobrança de ${monthLabel('2026-10')}` }));
    await waitFor(() => expect(bodies('toBill').length).toBeGreaterThan(before));
    const offset = (Number('2026') - Number(monthRange(0).from.slice(0, 4))) * 12 + 10 - Number(monthRange(0).from.slice(5, 7));
    expect(bodies('toBill').at(-1)).toMatchObject({ from: monthRange(offset).from, to: monthRange(offset).to });
  });
});

describe('batches', () => {
  it('teaches the three steps of a draft, keeping step 3 visible but disabled until the XML exists', async () => {
    respond({ batches: { batches: [batch({ id: 'b-new', number: 5, status: 'draft', xmlHash: null, generatedAt: null, sentAt: null })] } });
    mount();
    expect(await tab(/^3 Lotes \(1 a enviar\)$/)).toBeVisible();
    await userEvent.click(await tab(/Lotes/));
    const steps = await screen.findByRole('list', { name: 'Etapas do envio do lote 5' });
    expect(within(steps).getByText('1. Baixar o XML')).toBeVisible();
    expect(within(steps).getByText('2. Enviar no portal do convênio')).toBeVisible();
    const mark = within(steps).getByRole('button', { name: 'Marcar o lote 5 como enviado' });
    expect(mark).toBeDisabled();
    expect(mark).toHaveAccessibleDescription('Disponível depois de baixar o XML.');
  });

  it('says when the XML was generated and regenerates a draft after a confirmation', async () => {
    respond({ batches: { batches: [batch({ number: 5, status: 'draft', sentAt: null, revision: 7 })] }, clearBatchXml: batch({ status: 'draft', xmlHash: null }) });
    mount();
    await userEvent.click(await tab(/Lotes/));
    expect(await screen.findByText(/XML gerado em .*Os próximos downloads trazem este mesmo arquivo\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Marcar o lote 5 como enviado' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar de novo o XML do lote 5' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent(/algum dado foi corrigido depois do download/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Gerar de novo' }));
    await waitFor(() => expect(bodies('clearBatchXml')).toEqual([{ action: 'clearBatchXml', batchId: batch().id, revision: 7 }]));
  });

  it('takes back a send only while the plan has not answered', async () => {
    respond({ batches: { batches: [batch({ revision: 9 }), batch({ id: 'b-answered', number: 6, answered: true })] }, unsendBatch: batch({ status: 'draft' }) });
    mount();
    await userEvent.click(await tab(/Lotes/));
    expect(screen.queryByRole('button', { name: 'Desfazer o envio do lote 6' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Desfazer o envio do lote 4' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desfazer envio' }));
    await waitFor(() => expect(bodies('unsendBatch')).toEqual([{ action: 'unsendBatch', batchId: batch().id, revision: 9 }]));
  });

  it('keeps the list of batches visible when the clinic has no active plan', async () => {
    respond({ state: { ...structuredClone(state), payers: [{ ...state.payers[0], active: false }] }, batches: { batches: [batch()] } });
    mount();
    await userEvent.click(await tab(/Lotes/));
    expect(await screen.findByText(/Lote 4 · Convênio Exemplo/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lançar o retorno do lote 4' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copiar pedido' })).toBeVisible();
  });
});

describe('reports and registrations', () => {
  it('escapes spreadsheet formulas in the CSV and exports the report', async () => {
    expect(csvCell('=SOMA(A1)')).toBe(`"'=SOMA(A1)"`);
    expect(csvCell('+55')).toBe(`"'+55"`);
    expect(csvCell('-x')).toBe(`"'-x"`);
    expect(csvCell('@user')).toBe(`"'@user"`);
    expect(csvCell('Dra. "Ana"')).toBe('"Dra. ""Ana"""');
    expect(csvCell(1234.5)).toBe('1234,50');
    expect(toCsv([['a', 1]])).toBe('﻿"a";1,00\r\n');
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    respond({ report: { totals: { count: 4, charged: 800, paid: 450, denied: 50, open: 300 },
      doctors: [{ doctorId: actor, count: 4, charged: 800, paid: 450, denied: 50, open: 300, sharePercent: 60, payout: 270 }],
      payers: [{ payerId: null, name: 'Particular', count: 1, charged: 350, paid: 100, denied: 0, open: 250 }],
      denials: [{ code: '1705', count: 1, amount: 50, note: '=HYPERLINK("x")' }] } });
    mount();
    await userEvent.click(await tab(/Relatórios/));
    expect(await screen.findByText('Faturado · 4 cobranças')).toBeVisible();
    expect(screen.getByText(/· 1 guia$/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    const csv = await blobs[0].text();
    expect(csv).toContain('"Médico";"Médico Exemplo";"4";800,00;450,00;50,00;300,00;270,00');
    expect(csv).toContain(`"Glosa";"1705 · =HYPERLINK(""x"")"`);
    expect(csv).toContain('"Convênio";"Particular"');
  });

  it('shows registrations as plain values with one request to the Cortex team', async () => {
    respond({ prices: { prices: [{ id: 'p1', payerId: payer, tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório', guideType: 'consulta', amount: 150, active: true, revision: 1 }] } });
    mount();
    await userEvent.click(await tab(/Cadastros/));
    expect(await screen.findByText('CRM-PR 00000 · CBO 225250')).toBeVisible();
    expect(screen.getByText(/TUSS 10101012/)).toBeVisible();
    expect(screen.getByText('Número da próxima guia')).toBeVisible();
    expect(screen.getByText('Não informado (sem CNES)')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Copiar pedido' })).toHaveLength(1);
    expect(screen.queryByText(/Solicite/)).toBeNull();
  });

  it('writes the month as "Novembro de 2026"', async () => {
    expect(monthLabel('2026-11')).toBe('Novembro de 2026');
    respond();
    mount();
    const label = await screen.findByText(monthRange(0).label);
    expect(label).not.toHaveClass('capitalize');
    expect(monthRange(0).label).toMatch(/^[A-ZÇ][a-zç]+ de \d{4}$/);
  });
});

describe('round 3: one way to show dialogs, failed reads and missing access', () => {
  const footerOrder = (dialog: HTMLElement, primary: string) => {
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    const main = within(dialog).getByRole('button', { name: primary });
    // "Cancelar" comes first, then the primary action on the right.
    expect(cancel.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.parentElement).toBe(main.parentElement);
  };

  it('titles each dialog with the words of the button that opened it, with Cancelar before the primary', async () => {
    respond({ batches: { batches: [batch()] } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova cobrança avulsa' }));
    let dialog = await screen.findByRole('dialog', { name: 'Nova cobrança avulsa' });
    footerOrder(dialog, 'Salvar cobrança');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(await tab(/Cobranças/));
    fireEvent.click(await screen.findByRole('button', { name: 'Receber pagamento de Paciente Sintético' }));
    dialog = await screen.findByRole('dialog', { name: 'Receber pagamento' });
    footerOrder(dialog, 'Registrar pagamento');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(await tab(/Lotes/));
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar NFS-e do lote 4' }));
    dialog = await screen.findByRole('dialog', { name: 'Registrar NFS-e' });
    footerOrder(dialog, 'Salvar NFS-e');
  });

  it('shows a dialog error right above the buttons and moves focus to it', async () => {
    respond();
    mount();
    await userEvent.click(await tab(/Caixa/));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova despesa' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova despesa' });
    footerOrder(dialog, 'Salvar despesa');
    fireEvent.submit(dialog.querySelector('form')!);
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Descreva a despesa.');
    expect(alert).toHaveFocus();
    expect(alert.nextElementSibling).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }).parentElement);
  });

  it('a failed read says what did not load and offers a retry, never the server text', async () => {
    respond({ charges: (_b: unknown, n: number) => (n === 1 ? httpError({ error: 'relation "billing_charges" does not exist', code: 'internal' }) : { charges: [charge] }) });
    mount();
    await userEvent.click(await tab(/Cobranças/));
    expect(await screen.findByText('Não foi possível carregar o financeiro. Verifique a conexão e tente de novo.')).toBeVisible();
    expect(screen.queryByText(/relation/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Paciente Sintético')).toBeVisible();
  });

  it('a missing permission says what the person cannot use and who can grant it', async () => {
    respond({ state: httpError({ error: 'Sem acesso ao financeiro desta clínica.', code: 'forbidden' }) });
    mount();
    expect(await screen.findByText('Sua conta não tem acesso ao financeiro desta clínica.')).toBeVisible();
    expect(screen.getByText('Quem pode liberar: o administrador da clínica.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('writes "Não informado" for every empty registration value', async () => {
    respond({ state: { ...structuredClone(state), professionals: [{ ...state.professionals[0], tissName: '', councilNumber: '', cbo: '' }] } });
    mount();
    await userEvent.click(await tab(/Cadastros/));
    const doctor = (await screen.findByText('Nome na guia')).closest('dl')!;
    expect(within(doctor).getAllByText('Não informado')).toHaveLength(2);
  });
});

describe('act warnings stay quiet', () => {
  it('mounts and unmounts', async () => {
    respond();
    await act(async () => { mount(); });
    expect(await tab(/A faturar/)).toBeVisible();
  });
});
