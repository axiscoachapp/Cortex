import { describe, expect, it, vi } from 'vitest';
import {
  billingHandler, productionReport, saoPaulo, type BatchRow, type BillingDeps, type BillingRole, type BillingStore, type ChargeRow, type PayerRow, type ProfessionalRow,
} from '../../supabase/functions/_shared/billingHandlers';
import { md5 } from '../../supabase/functions/_shared/tiss';

// Synthetic ids, plans and people only.
const CLINIC = 'e9200000-0000-4000-8000-000000000001';
const ADMIN = 'e9100000-0000-4000-8000-000000000001';
const DOCTOR = 'e9100000-0000-4000-8000-000000000002';
const RECEPTION = 'e9100000-0000-4000-8000-000000000003';
const PAYER = 'e9300000-0000-4000-8000-000000000001';
const BATCH = 'e9500000-0000-4000-8000-000000000001';
const APPT = 'e9600000-0000-4000-8000-000000000001';

const payer: PayerRow = { id: PAYER, clinic_id: CLINIC, name: 'Operadora Exemplo', ans_registry: '999999', provider_code: '123456', tiss_version: '4.03.00',
  hash_encoding: 'latin1', zip_required: false, submission_days: 30, payment_days: 60, active: true, notes: '', revision: 1 };
const professional: ProfessionalRow = { clinic_id: CLINIC, user_id: DOCTOR, tiss_name: 'MEDICA FICTICIA', council: '06', council_number: '00000', council_uf: '41',
  cbo: '225250', share_percent: 60, revision: 1 };
const charge = (over: Partial<ChargeRow> = {}): ChargeRow => ({
  id: 'e9400000-0000-4000-8000-000000000001', clinic_id: CLINIC, appointment_id: null, doctor_id: DOCTOR, contact_id: null, patient_name: 'Paciente Exemplo',
  payer_id: PAYER, card_number: '00000000000000000', newborn: false, guide_type: 'consulta', table_code: '22', procedure_code: '10101012', description: 'Consulta',
  quantity: 1, unit_amount: 150, amount: 150, service_date: '2026-11-06', consultation_type: '1', authorization_number: null, authorization_password: null,
  authorization_date: null, authorization_valid_until: null, status: 'batched', guide_number: 1, batch_id: BATCH, paid_amount: 0, denied_amount: 0,
  denial_code: null, denial_note: null, notes: '', revision: 2, created_at: '2026-11-06T12:00:00Z', ...over,
});
const batch = (over: Partial<BatchRow> = {}): BatchRow => ({
  id: BATCH, clinic_id: CLINIC, payer_id: PAYER, number: 1, guide_type: 'consulta', status: 'draft', total_amount: 150, paid_amount: 0, denied_amount: 0, xml_hash: null,
  xml_payload: null, generated_at: null, sent_at: null, protocol: null, payment_date: null, nfse_number: null, notes: '', revision: 1, created_at: '2026-11-07T10:00:00Z', ...over,
});

function harness(opts: { role?: BillingRole | null; caller?: string; payer?: Partial<PayerRow>; professionals?: ProfessionalRow[]; batch?: Partial<BatchRow>; charges?: ChargeRow[] } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const inserted: unknown[] = [];
  const coverages: unknown[] = [];
  const store = {
    settings: async () => ({ clinic_id: CLINIC, legal_name: 'CLINICA FICTICIA LTDA', cnpj: null, cnes: '9999999', next_guide_number: 2, revision: 1 }),
    payers: async () => [{ ...payer, ...(opts.payer ?? {}) }],
    professionals: async () => opts.professionals ?? [professional],
    doctors: async () => [{ id: DOCTOR, name: 'Dra. Exemplo', crm: '00000', crmUf: 'PR' }],
    batch: async (_c: string, id: string) => (id === BATCH ? batch(opts.batch) : null),
    batchCharges: async () => opts.charges ?? [charge()],
    appointment: async (_c: string, id: string) => (id === APPT ? { id: APPT, doctor_id: DOCTOR, start_time: '2026-11-06T13:00:00Z', type: 'novo', status: 'realizado',
      contact_id: 'e9700000-0000-4000-8000-000000000001', contact_name: null } : null),
    appointmentsToBill: async () => [
      { id: APPT, doctor_id: DOCTOR, start_time: '2026-11-06T13:00:00Z', type: 'novo', status: 'realizado', contact_id: 'e9700000-0000-4000-8000-000000000001', contact_name: 'Paciente Exemplo' },
      { id: 'e9600000-0000-4000-8000-000000000002', doctor_id: DOCTOR, start_time: '2026-11-06T14:00:00Z', type: 'retorno', status: 'realizado', contact_id: null, contact_name: null }],
    billedAppointments: async () => ['e9600000-0000-4000-8000-000000000002'],
    coverages: async () => [{ contact_id: 'e9700000-0000-4000-8000-000000000001', payer_id: PAYER, card_number: '0001', card_valid_until: null, plan: '' }],
    intakeInsurance: async () => ({ [APPT]: { type: 'Convênio', payer: 'Operadora Exemplo', card: '0001' } }),
    insertCharge: async (row: Record<string, unknown>) => { inserted.push(row); return charge({ ...(row as Partial<ChargeRow>), id: 'e9400000-0000-4000-8000-000000000009', status: 'open', batch_id: null, guide_number: null, revision: 1 }); },
    saveCoverage: async (_c: string, row: unknown) => { coverages.push(row); },
    charges: async () => [],
    payments: async () => [
      { id: 'p1', charge_id: 'e9400000-0000-4000-8000-000000000001', batch_id: null, method: 'pix', amount: 100, received_on: '2026-11-06', notes: '', cancelled_at: null, created_at: 'x' },
      { id: 'p2', charge_id: 'e9400000-0000-4000-8000-000000000002', batch_id: null, method: 'pix', amount: 50, received_on: '2026-11-06', notes: '', cancelled_at: null, created_at: 'x' },
      { id: 'p3', charge_id: null, batch_id: BATCH, method: 'convenio', amount: 300, received_on: '2026-11-06', notes: '', cancelled_at: null, created_at: 'x' },
      { id: 'p4', charge_id: 'e9400000-0000-4000-8000-000000000001', batch_id: null, method: 'pix', amount: 10, received_on: '2026-11-06', notes: '', cancelled_at: 'y', created_at: 'x' }],
    chargesByIds: async (_c: string, ids: string[]) => [charge({ payer_id: null, guide_type: 'particular', patient_name: 'Paciente Um' }),
      charge({ id: 'e9400000-0000-4000-8000-000000000002', doctor_id: ADMIN, payer_id: null, guide_type: 'particular', patient_name: 'Paciente Dois' })].filter((c) => ids.includes(c.id)),
    expenses: async () => [],
  } as unknown as BillingStore;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (name === 'billing_role') return opts.role === undefined ? 'admin' : opts.role;
    if (name === 'billing_doctor_ok') return args.p_doctor === DOCTOR;
    if (name === 'billing_visible_doctors') return [DOCTOR];
    if (name === 'billing_batch_update') return { ...batch(), revision: 2, xml_hash: (args.p_patch as { xmlHash: string }).xmlHash };
    return null;
  });
  const deps: BillingDeps = {
    corsHeaders: {}, authorize: async () => ({ userId: opts.caller ?? ADMIN, clinicId: CLINIC }), authFailure: () => null, rpc, store,
    now: () => new Date('2026-11-07T13:30:00Z'),
  };
  const api = async (body: Record<string, unknown>) => billingHandler(new Request('https://x/b', { method: 'POST', body: JSON.stringify(body) }), deps);
  return { deps, calls, inserted, coverages, api };
}

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe('billing-api', () => {
  it('refuses people without a billing role, and keeps setup and batches with the admin', async () => {
    expect((await harness({ role: null }).api({ action: 'state' })).status).toBe(403);
    const rec = harness({ role: 'reception', caller: RECEPTION });
    expect((await rec.api({ action: 'savePayer', name: 'X', ansRegistry: '999999', providerCode: '1' })).status).toBe(403);
    expect((await rec.api({ action: 'createBatch', payerId: PAYER, chargeIds: [] })).status).toBe(403);
    const doc = harness({ role: 'doctor', caller: DOCTOR });
    expect((await doc.api({ action: 'createCharge', doctorId: DOCTOR })).status).toBe(403);
    expect((await doc.api({ action: 'report', from: '2026-11-01', to: '2026-11-30' })).status).toBe(200);
  });

  it('lists attended appointments not yet billed, with the saved card and the pre-consultation insurance', async () => {
    const h = harness({ role: 'reception', caller: RECEPTION });
    const r = await (await h.api({ action: 'toBill', from: '2026-11-01', to: '2026-11-07' })).json();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ appointmentId: APPT, patientName: 'Paciente Exemplo', consultationType: '1',
      coverages: [{ payerId: PAYER, cardNumber: '0001' }], intake: { type: 'Convênio', card: '0001' } });
  });

  it('creates a plan charge from an appointment for a doctor in scope, and saves the card', async () => {
    const h = harness({ role: 'reception', caller: RECEPTION });
    const res = await h.api({ action: 'createCharge', appointmentId: APPT, patientName: 'Paciente Exemplo', payerId: PAYER, cardNumber: '0001 2345',
      procedureCode: '10101012', description: 'Consulta em consultório', unitAmount: '150,00', serviceDate: '2026-11-06', consultationType: '1' });
    expect(res.status).toBe(200);
    expect(h.inserted[0]).toMatchObject({ doctor_id: DOCTOR, guide_type: 'consulta', amount: 150, card_number: '0001 2345', created_by: RECEPTION });
    expect(h.calls).toContainEqual(['billing_doctor_ok', { p_clinic: CLINIC, p_doctor: DOCTOR, p_actor: RECEPTION }]);
    expect(h.coverages).toEqual([expect.objectContaining({ payer_id: PAYER, card_number: '0001 2345' })]);
    // Plan charge without a card, or a consultation with quantity 2: refused before the database.
    expect((await h.api({ action: 'createCharge', appointmentId: APPT, patientName: 'X', payerId: PAYER, procedureCode: '10101012', description: 'Consulta', unitAmount: 1, serviceDate: '2026-11-06' })).status).toBe(400);
    expect((await h.api({ action: 'createCharge', appointmentId: APPT, patientName: 'X', payerId: PAYER, cardNumber: '1', quantity: 2, procedureCode: '10101012', description: 'Consulta', unitAmount: 1, serviceDate: '2026-11-06' })).status).toBe(400);
    // A doctor outside the reception's scope.
    expect((await h.api({ action: 'createCharge', doctorId: ADMIN, patientName: 'X', procedureCode: '10101012', description: 'Consulta', unitAmount: 1, serviceDate: '2026-11-06' })).status).toBe(403);
  });

  it('generates the batch XML, records its hash, and refuses doctors without TISS identity', async () => {
    const h = harness();
    const r = await (await h.api({ action: 'batchXml', batchId: BATCH })).json();
    const xml = new TextDecoder('latin1').decode(decode(r.base64));
    expect(r.contentType).toBe('application/xml');
    expect(xml).toContain('<ans:guiaConsulta>');
    expect(xml).toContain('<ans:dataRegistroTransacao>2026-11-07</ans:dataRegistroTransacao><ans:horaRegistroTransacao>10:30:00</ans:horaRegistroTransacao>');
    expect(r.fileName).toBe(`00000000000000000001_${r.hash}.xml`);
    const update = h.calls.find(([n]) => n === 'billing_batch_update')![1];
    expect(update).toMatchObject({ p_batch: BATCH, p_revision: 1, p_patch: { xmlHash: r.hash } });
    const missing = await harness({ professionals: [] }).api({ action: 'batchXml', batchId: BATCH });
    expect([missing.status, (await missing.json()).doctorIds]).toEqual([400, [DOCTOR]]);
  });

  it('zips the XML for plans that ask for it, and serves a sent batch unchanged', async () => {
    const zipped = await (await harness({ payer: { zip_required: true } }).api({ action: 'batchXml', batchId: BATCH })).json();
    expect(zipped.contentType).toBe('application/zip');
    expect(decode(zipped.base64).slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const sentXml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n<ans:mensagemTISS/>';
    const h = harness({ batch: { status: 'sent', xml_payload: sentXml, xml_hash: md5(new TextEncoder().encode('x')), revision: 3 } });
    const r = await (await h.api({ action: 'batchXml', batchId: BATCH })).json();
    expect(new TextDecoder('latin1').decode(decode(r.base64))).toBe(sentXml);
    expect(h.calls.some(([n]) => n === 'billing_batch_update')).toBe(false);
  });
});

describe('billing-api scope of lists', () => {
  it('lists only in-scope doctors to the reception', async () => {
    const r = await (await harness({ role: 'reception', caller: RECEPTION }).api({ action: 'state' })).json();
    expect(r.doctors.map((d: { id: string }) => d.id)).toEqual([DOCTOR]);
  });

  it('shows the reception only its private payments, with the patient, and never batch or cancelled ones', async () => {
    const rec = await (await harness({ role: 'reception', caller: RECEPTION }).api({ action: 'cash', from: '2026-11-01', to: '2026-11-30' })).json();
    expect(rec.payments.map((p: { id: string; patientName: string }) => [p.id, p.patientName])).toEqual([['p1', 'Paciente Um']]);
    expect(rec.expenses).toEqual([]);
    const admin = await (await harness().api({ action: 'cash', from: '2026-11-01', to: '2026-11-30' })).json();
    expect(admin.payments.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('production report', () => {
  it('sums by doctor and plan, with the payout over what was received', () => {
    const r = productionReport([
      charge({ status: 'paid', paid_amount: 150 }),
      charge({ id: 'b', status: 'partial', paid_amount: 100, denied_amount: 50, denial_code: '1705' }),
      charge({ id: 'c', payer_id: null, guide_type: 'particular', amount: 250, unit_amount: 250, status: 'open', card_number: null }),
    ], [professional], [payer]);
    expect(r.totals).toEqual({ count: 3, charged: 550, paid: 250, denied: 50, open: 250 });
    expect(r.doctors).toEqual([expect.objectContaining({ doctorId: DOCTOR, paid: 250, sharePercent: 60, payout: 150 })]);
    expect(r.payers.map((p) => [p.name, p.charged])).toEqual([['Operadora Exemplo', 300], ['Particular', 250]]);
    expect(r.denials).toEqual([{ code: '1705', count: 1, amount: 50 }]);
  });

  it('formats São Paulo time for the transaction header', () => {
    expect(saoPaulo(new Date('2026-11-07T02:15:09Z'))).toEqual({ date: '2026-11-06', time: '23:15:09' });
  });
});
