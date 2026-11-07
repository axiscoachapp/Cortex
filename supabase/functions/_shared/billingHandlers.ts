/**
 * billing-api: health-plan billing (TISS) and basic finance, for clinic staff (JWT + clinic_access).
 * Contract: docs/product/faturamento/CONTRATO.md. Dependencies are injected for tests.
 *
 * Who does what (checked here and again in SQL for the atomic operations):
 * - admin: everything (plans, prices, professionals, batches, statements, expenses, reports);
 * - reception (active staff): charges and private payments of the doctors in its scope;
 * - doctor: reads own charges and own production.
 */
import { buildBatchXml, zipOne, type GuideType, type TissGuide } from './tiss.ts';

export type BillingRole = 'admin' | 'reception' | 'doctor';
export interface BillingCaller { userId: string; clinicId: string }

export interface PayerRow {
  id: string; clinic_id: string; name: string; ans_registry: string; provider_code: string; tiss_version: string; hash_encoding: 'latin1' | 'utf8';
  zip_required: boolean; submission_days: number | null; payment_days: number | null; active: boolean; notes: string; revision: number;
}
export interface PriceRow {
  id: string; clinic_id: string; payer_id: string | null; table_code: string; procedure_code: string; description: string; guide_type: 'consulta' | 'sadt';
  amount: number; active: boolean; revision: number;
}
export interface ProfessionalRow {
  clinic_id: string; user_id: string; tiss_name: string; council: string; council_number: string; council_uf: string; cbo: string;
  share_percent: number | null; revision: number;
}
export interface SettingsRow { clinic_id: string; legal_name: string; cnpj: string | null; cnes: string; next_guide_number: number; revision: number }
export interface ChargeRow {
  id: string; clinic_id: string; appointment_id: string | null; doctor_id: string; contact_id: string | null; patient_name: string; payer_id: string | null;
  card_number: string | null; newborn: boolean; guide_type: 'consulta' | 'sadt' | 'particular'; table_code: string; procedure_code: string; description: string;
  quantity: number; unit_amount: number; amount: number; service_date: string; consultation_type: '1' | '2' | '3' | '4' | null;
  authorization_number: string | null; authorization_password: string | null; authorization_date: string | null; authorization_valid_until: string | null;
  status: string; guide_number: number | null; batch_id: string | null; paid_amount: number; denied_amount: number; denial_code: string | null;
  denial_note: string | null; notes: string; revision: number; created_at: string;
}
export interface BatchRow {
  id: string; clinic_id: string; payer_id: string; number: number; guide_type: GuideType; status: 'draft' | 'sent' | 'closed'; total_amount: number;
  paid_amount: number; denied_amount: number; xml_hash: string | null; xml_payload: string | null; generated_at: string | null; sent_at: string | null;
  protocol: string | null; payment_date: string | null; nfse_number: string | null; notes: string; revision: number; created_at: string;
}
export interface PaymentRow {
  id: string; charge_id: string | null; batch_id: string | null; method: string; amount: number; received_on: string; notes: string;
  cancelled_at: string | null; created_at: string;
}
export interface ExpenseRow {
  id: string; description: string; category: string; amount: number; due_on: string; paid_on: string | null; method: string | null; notes: string; revision: number;
}
export interface AppointmentToBill {
  id: string; doctor_id: string; start_time: string; type: string | null; status: string | null; contact_id: string | null; contact_name: string | null;
}
export interface CoverageRow { contact_id: string; payer_id: string; card_number: string; card_valid_until: string | null; plan: string }
export interface DoctorRow { id: string; name: string; crm: string | null; crmUf: string | null }

export interface BillingStore {
  settings(clinic: string): Promise<SettingsRow | null>;
  saveSettings(clinic: string, revision: number, patch: Pick<SettingsRow, 'legal_name' | 'cnpj' | 'cnes'>, actor: string): Promise<SettingsRow | null>;
  payers(clinic: string): Promise<PayerRow[]>;
  savePayer(clinic: string, id: string | null, revision: number | null, row: Omit<PayerRow, 'id' | 'clinic_id' | 'revision'>): Promise<PayerRow | null>;
  prices(clinic: string): Promise<PriceRow[]>;
  savePrice(clinic: string, id: string | null, revision: number | null, row: Omit<PriceRow, 'id' | 'clinic_id' | 'revision'>): Promise<PriceRow | null>;
  deletePrice(clinic: string, id: string): Promise<boolean>;
  professionals(clinic: string): Promise<ProfessionalRow[]>;
  saveProfessional(clinic: string, revision: number | null, row: Omit<ProfessionalRow, 'clinic_id' | 'revision'>): Promise<ProfessionalRow | null>;
  doctors(clinic: string): Promise<DoctorRow[]>;
  appointmentsToBill(clinic: string, doctors: string[], from: string, to: string): Promise<AppointmentToBill[]>;
  billedAppointments(clinic: string, ids: string[]): Promise<string[]>;
  coverages(clinic: string, contactIds: string[]): Promise<CoverageRow[]>;
  saveCoverage(clinic: string, row: CoverageRow): Promise<void>;
  intakeInsurance(clinic: string, appointmentIds: string[]): Promise<Record<string, { payer?: string; card?: string; validUntil?: string; type?: string }>>;
  appointment(clinic: string, id: string): Promise<AppointmentToBill | null>;
  charges(clinic: string, doctors: string[], filter: { from: string; to: string; status?: string; payerId?: string }): Promise<ChargeRow[]>;
  charge(clinic: string, id: string): Promise<ChargeRow | null>;
  chargesByIds(clinic: string, ids: string[]): Promise<ChargeRow[]>;
  openCharges(clinic: string, payerId: string, guideType: GuideType): Promise<ChargeRow[]>;
  insertCharge(row: Omit<ChargeRow, 'id' | 'status' | 'guide_number' | 'batch_id' | 'paid_amount' | 'denied_amount' | 'denial_code' | 'denial_note' | 'revision' | 'created_at'> & { created_by: string }): Promise<ChargeRow>;
  updateCharge(clinic: string, id: string, revision: number, patch: Partial<ChargeRow>): Promise<ChargeRow | null>;
  batches(clinic: string): Promise<BatchRow[]>;
  batch(clinic: string, id: string): Promise<BatchRow | null>;
  batchCharges(clinic: string, batchId: string): Promise<ChargeRow[]>;
  payments(clinic: string, from: string, to: string): Promise<PaymentRow[]>;
  expenses(clinic: string, from: string, to: string): Promise<ExpenseRow[]>;
  saveExpense(clinic: string, id: string | null, revision: number | null, row: Omit<ExpenseRow, 'id' | 'revision'>, actor: string): Promise<ExpenseRow | null>;
  deleteExpense(clinic: string, id: string): Promise<boolean>;
}

export interface BillingDeps {
  corsHeaders: Record<string, string>;
  authorize(req: Request): Promise<BillingCaller>;
  authFailure(error: unknown): Response | null;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  store: BillingStore;
  now?: () => Date;
  log?(event: string, detail: Record<string, unknown>): void;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'error', readonly extra: Record<string, unknown> = {}) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia'] as const;
const TABLES = ['00', '18', '19', '20', '22', '90', '98'];

const json = (deps: BillingDeps, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...deps.corsHeaders, 'Content-Type': 'application/json' } });

const str = (v: unknown, what: string, max: number, opts: { min?: number; re?: RegExp; optional?: boolean } = {}) => {
  if ((v === undefined || v === null || v === '') && opts.optional) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${what}: informe um valor.`, 'invalid');
  const t = v.trim();
  if (t.length < (opts.min ?? 1) || t.length > max || (opts.re && !opts.re.test(t))) throw new HttpError(400, `${what}: valor inválido.`, 'invalid');
  return t;
};
const uuid = (v: unknown, what: string) => str(v, what, 36, { re: UUID })!;
const date = (v: unknown, what: string, optional = false) => str(v, what, 10, { re: DATE, optional });
const money = (v: unknown, what: string, min = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < min || n > 1_000_000) throw new HttpError(400, `${what}: valor inválido.`, 'invalid');
  return Math.round(n * 100) / 100;
};
const int = (v: unknown, what: string, min: number, max: number, optional = false) => {
  if ((v === undefined || v === null || v === '') && optional) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${what}: valor inválido.`, 'invalid');
  return n;
};
const revisionOf = (v: unknown) => (v === undefined || v === null ? null : int(v, 'Revisão', 1, 1_000_000)!);

function sqlError(e: unknown): HttpError {
  const code = (e as { code?: string })?.code;
  const message = (e as Error)?.message ?? '';
  const map: Record<string, [number, string]> = {
    P0002: [404, 'not_found'], '42501': [403, 'forbidden'], '40001': [409, 'stale'], '55000': [409, 'unavailable'], '22023': [400, 'invalid'],
    '23505': [409, 'duplicate'], '23514': [400, 'invalid'], '23503': [409, 'in_use'],
  };
  const hit = code ? map[code] : undefined;
  if (!hit) return new HttpError(500, 'Não foi possível concluir agora.', 'server');
  const friendly = code === '23505' ? 'Já existe um cadastro igual.' : code === '23514' ? 'Algum valor não é aceito.' : code === '23503' ? 'O cadastro está em uso.' : message;
  return new HttpError(hit[0], friendly || 'Pedido recusado.', hit[1]);
}

async function call<T>(deps: BillingDeps, name: string, args: Record<string, unknown>): Promise<T> {
  try { return (await deps.rpc(name, args)) as T; } catch (e) { throw sqlError(e); }
}

const stale = () => new HttpError(409, 'Os dados mudaram; atualize e tente de novo.', 'stale');

/** São Paulo date and time (YYYY-MM-DD, HH:MM:SS). */
export function saoPaulo(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

const chargeDto = (c: ChargeRow) => ({
  id: c.id, appointmentId: c.appointment_id, doctorId: c.doctor_id, contactId: c.contact_id, patientName: c.patient_name, payerId: c.payer_id,
  cardNumber: c.card_number, newborn: c.newborn, guideType: c.guide_type, tableCode: c.table_code, procedureCode: c.procedure_code, description: c.description,
  quantity: c.quantity, unitAmount: Number(c.unit_amount), amount: Number(c.amount), serviceDate: c.service_date, consultationType: c.consultation_type,
  authorization: { number: c.authorization_number, password: c.authorization_password ? '••••' : null, date: c.authorization_date, validUntil: c.authorization_valid_until },
  status: c.status, guideNumber: c.guide_number, batchId: c.batch_id, paidAmount: Number(c.paid_amount), deniedAmount: Number(c.denied_amount),
  denialCode: c.denial_code, denialNote: c.denial_note, notes: c.notes, revision: c.revision,
});
const batchDto = (b: BatchRow) => ({
  id: b.id, payerId: b.payer_id, number: b.number, guideType: b.guide_type, status: b.status, totalAmount: Number(b.total_amount),
  paidAmount: Number(b.paid_amount), deniedAmount: Number(b.denied_amount), xmlHash: b.xml_hash, generatedAt: b.generated_at, sentAt: b.sent_at,
  protocol: b.protocol, paymentDate: b.payment_date, nfseNumber: b.nfse_number, notes: b.notes, revision: b.revision, createdAt: b.created_at,
});
const payerDto = (p: PayerRow) => ({
  id: p.id, name: p.name, ansRegistry: p.ans_registry, providerCode: p.provider_code, tissVersion: p.tiss_version, hashEncoding: p.hash_encoding,
  zipRequired: p.zip_required, submissionDays: p.submission_days, paymentDays: p.payment_days, active: p.active, notes: p.notes, revision: p.revision,
});
const priceDto = (p: PriceRow) => ({
  id: p.id, payerId: p.payer_id, tableCode: p.table_code, procedureCode: p.procedure_code, description: p.description, guideType: p.guide_type,
  amount: Number(p.amount), active: p.active, revision: p.revision,
});
const professionalDto = (p: ProfessionalRow) => ({
  userId: p.user_id, tissName: p.tiss_name, council: p.council, councilNumber: p.council_number, councilUf: p.council_uf, cbo: p.cbo,
  sharePercent: p.share_percent === null ? null : Number(p.share_percent), revision: p.revision,
});

/** Brazilian UF letters → IBGE code used by TISS (table 59). */
export const UF_IBGE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

/** Consultation type from the agenda type: first visit, return (follow-up counts as return). */
export const consultationTypeOf = (type: string | null): '1' | '2' => (type === 'novo' ? '1' : '2');

export async function billingHandler(req: Request, deps: BillingDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: deps.corsHeaders });
  if (req.method !== 'POST') return json(deps, 405, { error: 'Método não permitido.' });
  try {
    const caller = await deps.authorize(req);
    const text = await req.text();
    if (text.length > 256 * 1024) throw new HttpError(413, 'Pedido grande demais.', 'too_large');
    let body: Record<string, unknown>;
    try { body = JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Pedido inválido.', 'invalid'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Pedido inválido.', 'invalid');
    const role = await call<BillingRole | null>(deps, 'billing_role', { p_clinic: caller.clinicId, p_actor: caller.userId });
    if (!role) throw new HttpError(403, 'Sem acesso ao financeiro desta clínica.', 'forbidden');
    return json(deps, 200, await route(deps, caller, role, body));
  } catch (e) {
    const auth = deps.authFailure(e);
    if (auth) return auth;
    if (e instanceof HttpError) return json(deps, e.status, { error: e.message, code: e.code, ...e.extra });
    deps.log?.('billing_error', { kind: (e as Error)?.name ?? 'unknown' });
    return json(deps, 500, { error: 'Não foi possível concluir agora.', code: 'server' });
  }
}

async function route(deps: BillingDeps, caller: BillingCaller, role: BillingRole, body: Record<string, unknown>): Promise<unknown> {
  const clinic = caller.clinicId;
  const s = deps.store;
  const admin = () => { if (role !== 'admin') throw new HttpError(403, 'Só a administração da clínica faz isso.', 'forbidden'); };
  const staff = () => { if (role === 'doctor') throw new HttpError(403, 'O médico só consulta a própria produção.', 'forbidden'); };
  const visible = () => call<string[]>(deps, 'billing_visible_doctors', { p_clinic: clinic, p_actor: caller.userId });
  const doctorOk = async (doctor: string) => {
    if (!(await call<boolean>(deps, 'billing_doctor_ok', { p_clinic: clinic, p_doctor: doctor, p_actor: caller.userId })))
      throw new HttpError(403, 'Sem permissão para a agenda deste médico.', 'forbidden');
  };
  const period = () => {
    const from = date(body.from, 'Início')!;
    const to = date(body.to, 'Fim')!;
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new HttpError(400, 'Escolha um período de até 3 meses.', 'invalid');
    return { from, to };
  };

  switch (body.action) {
    case 'state': {
      const [settings, payers, professionals, doctors, visibleIds] = await Promise.all([s.settings(clinic), s.payers(clinic), s.professionals(clinic), s.doctors(clinic), visible()]);
      const inScope = new Set(visibleIds);
      return {
        role, userId: caller.userId,
        settings: settings ? { legalName: settings.legal_name, cnpj: settings.cnpj, cnes: settings.cnes, nextGuideNumber: settings.next_guide_number, revision: settings.revision } : null,
        payers: payers.map(payerDto),
        // Reception sees only the doctors in its scope; a doctor sees only themself.
        doctors: role === 'admin' ? doctors : doctors.filter((d) => inScope.has(d.id)),
        professionals: professionals.map(professionalDto),
      };
    }

    // ---------------------------------------------------------- setup (admin)
    case 'saveSettings': {
      admin();
      const row = { legal_name: str(body.legalName ?? '', 'Razão social', 120, { min: 0 })!, cnpj: str(body.cnpj, 'CNPJ', 18, { optional: true }),
        cnes: str(body.cnes ?? '9999999', 'CNES', 7, { re: /^[0-9]{7}$/ })! };
      if (row.cnpj) { row.cnpj = row.cnpj.replace(/\D/g, ''); if (row.cnpj.length !== 14) throw new HttpError(400, 'CNPJ precisa ter 14 dígitos.', 'invalid'); }
      const saved = await s.saveSettings(clinic, Number(body.revision) || 0, row, caller.userId);
      if (!saved) throw stale();
      return { revision: saved.revision };
    }
    case 'savePayer': {
      admin();
      const id = body.id ? uuid(body.id, 'Convênio') : null;
      const row = {
        name: str(body.name, 'Nome', 80, { min: 2 })!, ans_registry: str(body.ansRegistry, 'Registro ANS', 6, { re: /^[0-9]{6}$/ })!,
        provider_code: str(body.providerCode, 'Código do prestador', 20, { re: /^[0-9A-Za-z]+$/ })!,
        tiss_version: str(body.tissVersion ?? '4.03.00', 'Versão TISS', 7, { re: /^4\.0[123]\.00$/ })!,
        hash_encoding: body.hashEncoding === 'utf8' ? 'utf8' as const : 'latin1' as const, zip_required: body.zipRequired === true,
        submission_days: int(body.submissionDays, 'Prazo de envio', 1, 365, true), payment_days: int(body.paymentDays, 'Prazo de pagamento', 1, 365, true),
        active: body.active !== false, notes: str(body.notes ?? '', 'Observações', 1000, { min: 0 })!,
      };
      try {
        const saved = await s.savePayer(clinic, id, id ? revisionOf(body.revision) : null, row);
        if (!saved) throw stale();
        return payerDto(saved);
      } catch (e) { throw e instanceof HttpError ? e : sqlError(e); }
    }
    case 'prices': return { prices: (await s.prices(clinic)).map(priceDto) };
    case 'savePrice': {
      admin();
      const id = body.id ? uuid(body.id, 'Preço') : null;
      const payerId = body.payerId ? uuid(body.payerId, 'Convênio') : null;
      if (payerId && !(await s.payers(clinic)).some((p) => p.id === payerId)) throw new HttpError(404, 'Convênio não encontrado.', 'not_found');
      const row = {
        payer_id: payerId, table_code: str(body.tableCode ?? '22', 'Tabela', 2, { re: /^[0-9]{2}$/ })!,
        procedure_code: str(body.procedureCode, 'Código', 10, { re: /^[0-9A-Za-z]+$/ })!, description: str(body.description, 'Descrição', 150, { min: 2 })!,
        guide_type: body.guideType === 'sadt' ? 'sadt' as const : 'consulta' as const, amount: money(body.amount, 'Valor'), active: body.active !== false,
      };
      if (!TABLES.includes(row.table_code)) throw new HttpError(400, 'Tabela TUSS inválida.', 'invalid');
      try {
        const saved = await s.savePrice(clinic, id, id ? revisionOf(body.revision) : null, row);
        if (!saved) throw stale();
        return priceDto(saved);
      } catch (e) { throw e instanceof HttpError ? e : sqlError(e); }
    }
    case 'deletePrice': {
      admin();
      if (!(await s.deletePrice(clinic, uuid(body.id, 'Preço')))) throw new HttpError(404, 'Preço não encontrado.', 'not_found');
      return { deleted: true };
    }
    case 'saveProfessional': {
      admin();
      const userId = uuid(body.userId, 'Médico');
      if (!(await s.doctors(clinic)).some((d) => d.id === userId)) throw new HttpError(404, 'Médico não encontrado na clínica.', 'not_found');
      const share = body.sharePercent === null || body.sharePercent === undefined || body.sharePercent === '' ? null : money(body.sharePercent, 'Repasse');
      if (share !== null && share > 100) throw new HttpError(400, 'Repasse: até 100%.', 'invalid');
      const saved = await s.saveProfessional(clinic, revisionOf(body.revision), {
        user_id: userId, tiss_name: str(body.tissName, 'Nome', 70, { min: 2 })!, council: str(body.council ?? '06', 'Conselho', 2, { re: /^[0-9]{2}$/ })!,
        council_number: str(body.councilNumber, 'Número do conselho', 15, { re: /^[0-9]+$/ })!, council_uf: str(body.councilUf ?? '41', 'UF', 2, { re: /^[0-9]{2}$/ })!,
        cbo: str(body.cbo, 'CBO', 6, { re: /^[0-9]{6}$/ })!, share_percent: share,
      });
      if (!saved) throw stale();
      return professionalDto(saved);
    }

    // ---------------------------------------------------------- charges
    case 'toBill': {
      staff();
      const { from, to } = period();
      const doctors = await visible();
      const list = await s.appointmentsToBill(clinic, doctors, from, to);
      const billed = new Set(await s.billedAppointments(clinic, list.map((a) => a.id)));
      const pending = list.filter((a) => !billed.has(a.id));
      const coverages = await s.coverages(clinic, [...new Set(pending.map((a) => a.contact_id).filter((x): x is string => !!x))]);
      const intake = await s.intakeInsurance(clinic, pending.map((a) => a.id));
      return {
        items: pending.map((a) => ({
          appointmentId: a.id, doctorId: a.doctor_id, start: a.start_time, type: a.type, contactId: a.contact_id, patientName: a.contact_name ?? '',
          consultationType: consultationTypeOf(a.type),
          // 'checked_in': only the arrival was recorded; charging stays a human decision (Codex 1032).
          attendance: a.status === 'realizado' ? 'done' : 'checked_in',
          coverages: coverages.filter((c) => c.contact_id === a.contact_id).map((c) => ({ payerId: c.payer_id, cardNumber: c.card_number, cardValidUntil: c.card_valid_until, plan: c.plan })),
          intake: intake[a.id] ?? null,
        })),
      };
    }
    case 'charges': {
      const { from, to } = period();
      const doctors = await visible();
      const rows = await s.charges(clinic, doctors, {
        from, to, ...(typeof body.status === 'string' ? { status: body.status } : {}), ...(typeof body.payerId === 'string' && UUID.test(body.payerId) ? { payerId: body.payerId } : {}),
      });
      return { charges: rows.map(chargeDto) };
    }
    case 'createCharge': {
      staff();
      const appointmentId = body.appointmentId ? uuid(body.appointmentId, 'Agendamento') : null;
      let doctorId = body.doctorId ? uuid(body.doctorId, 'Médico') : null;
      let contactId = body.contactId ? uuid(body.contactId, 'Contato') : null;
      if (appointmentId) {
        const a = await s.appointment(clinic, appointmentId);
        if (!a) throw new HttpError(404, 'Agendamento não encontrado na agenda da clínica.', 'not_found');
        doctorId = a.doctor_id;
        contactId = a.contact_id;
      }
      if (!doctorId) throw new HttpError(400, 'Informe o médico.', 'invalid');
      await doctorOk(doctorId);
      const payerId = body.payerId ? uuid(body.payerId, 'Convênio') : null;
      const payer = payerId ? (await s.payers(clinic)).find((p) => p.id === payerId && p.active) : null;
      if (payerId && !payer) throw new HttpError(404, 'Convênio não encontrado ou inativo.', 'not_found');
      const guideType = payer ? (body.guideType === 'sadt' ? 'sadt' : 'consulta') : 'particular';
      const quantity = int(body.quantity ?? 1, 'Quantidade', 1, 99)!;
      const unit = money(body.unitAmount, 'Valor');
      if (guideType === 'consulta' && quantity !== 1) throw new HttpError(400, 'A guia de consulta tem um procedimento.', 'invalid');
      const card = payer ? str(body.cardNumber, 'Carteirinha', 30, { re: /^[0-9A-Za-z .-]+$/ }) : null;
      const authDate = date(body.authorizationDate, 'Data da autorização', true);
      const row = {
        clinic_id: clinic, appointment_id: appointmentId, doctor_id: doctorId, contact_id: contactId,
        patient_name: str(body.patientName, 'Paciente', 200)!, payer_id: payerId, card_number: card, newborn: body.newborn === true,
        guide_type: guideType as ChargeRow['guide_type'], table_code: str(body.tableCode ?? '22', 'Tabela', 2, { re: /^[0-9]{2}$/ })!,
        procedure_code: str(body.procedureCode, 'Código', 10, { re: /^[0-9A-Za-z]+$/ })!, description: str(body.description, 'Descrição', 150, { min: 2 })!,
        quantity, unit_amount: unit, amount: Math.round(unit * quantity * 100) / 100, service_date: date(body.serviceDate, 'Data do atendimento')!,
        consultation_type: guideType === 'consulta' ? (['1', '2', '3', '4'].includes(String(body.consultationType)) ? String(body.consultationType) as '1' : '1') : null,
        authorization_number: str(body.authorizationNumber, 'Número da autorização', 20, { re: /^[0-9A-Za-z-]+$/, optional: true }),
        authorization_password: str(body.authorizationPassword, 'Senha', 20, { re: /^[0-9A-Za-z-]+$/, optional: true }),
        authorization_date: authDate, authorization_valid_until: date(body.authorizationValidUntil, 'Validade da senha', true),
        notes: str(body.notes ?? '', 'Observações', 500, { min: 0 })!, created_by: caller.userId,
      };
      if (!TABLES.includes(row.table_code)) throw new HttpError(400, 'Tabela TUSS inválida.', 'invalid');
      if (guideType === 'sadt' && (row.authorization_password || row.authorization_number) && !authDate)
        throw new HttpError(400, 'Informe a data da autorização junto com a senha.', 'invalid');
      let saved: ChargeRow;
      try { saved = await s.insertCharge(row); } catch (e) { throw sqlError(e); }
      if (payer && contactId && body.saveCoverage !== false) {
        await s.saveCoverage(clinic, { contact_id: contactId, payer_id: payer.id, card_number: card!, card_valid_until: date(body.cardValidUntil, 'Validade', true), plan: '' })
          .catch(() => null);
      }
      return chargeDto(saved);
    }
    case 'cancelCharge': {
      staff();
      const c = await s.charge(clinic, uuid(body.id, 'Cobrança'));
      if (!c) throw new HttpError(404, 'Cobrança não encontrada.', 'not_found');
      await doctorOk(c.doctor_id);
      if (c.status !== 'open' || Number(c.paid_amount) > 0) throw new HttpError(409, 'Só uma cobrança em aberto e sem pagamento pode ser cancelada.', 'unavailable');
      const saved = await s.updateCharge(clinic, c.id, int(body.revision, 'Revisão', 1, 1_000_000)!, { status: 'cancelled' });
      if (!saved) throw stale();
      return chargeDto(saved);
    }
    case 'pay': {
      staff();
      const method = String(body.method);
      if (!(METHODS as readonly string[]).includes(method)) throw new HttpError(400, 'Forma de pagamento inválida.', 'invalid');
      return call(deps, 'billing_charge_pay', {
        p_clinic: clinic, p_actor: caller.userId, p_charge: uuid(body.chargeId, 'Cobrança'), p_revision: int(body.revision, 'Revisão', 1, 1_000_000),
        p_amount: money(body.amount, 'Valor', 0.01), p_method: method, p_received_on: date(body.receivedOn, 'Data')!, p_notes: str(body.notes ?? '', 'Observação', 300, { min: 0 }),
      });
    }
    case 'cancelPayment': {
      admin();
      return call(deps, 'billing_payment_cancel', { p_clinic: clinic, p_actor: caller.userId, p_payment: uuid(body.paymentId, 'Pagamento') });
    }

    // ---------------------------------------------------------- batches (admin)
    case 'batches': {
      admin();
      return { batches: (await s.batches(clinic)).map(batchDto) };
    }
    case 'openForBatch': {
      admin();
      const payerId = uuid(body.payerId, 'Convênio');
      const type: GuideType = body.guideType === 'sadt' ? 'sadt' : 'consulta';
      return { charges: (await s.openCharges(clinic, payerId, type)).map(chargeDto) };
    }
    case 'batchCharges': {
      admin();
      return { charges: (await s.batchCharges(clinic, uuid(body.batchId, 'Lote'))).map(chargeDto) };
    }
    case 'createBatch': {
      admin();
      const ids = Array.isArray(body.chargeIds) ? body.chargeIds.map((x) => uuid(x, 'Cobrança')) : [];
      return call(deps, 'billing_batch_create', {
        p_clinic: clinic, p_actor: caller.userId, p_payer: uuid(body.payerId, 'Convênio'), p_guide_type: body.guideType === 'sadt' ? 'sadt' : 'consulta', p_charges: ids,
      });
    }
    case 'cancelBatch': {
      admin();
      return call(deps, 'billing_batch_cancel', { p_clinic: clinic, p_actor: caller.userId, p_batch: uuid(body.batchId, 'Lote'), p_revision: int(body.revision, 'Revisão', 1, 1_000_000) });
    }
    case 'batchXml': {
      admin();
      return batchFile(deps, clinic, caller.userId, uuid(body.batchId, 'Lote'));
    }
    case 'markSent': {
      admin();
      const r = await call<BatchRow>(deps, 'billing_batch_update', {
        p_clinic: clinic, p_actor: caller.userId, p_batch: uuid(body.batchId, 'Lote'), p_revision: int(body.revision, 'Revisão', 1, 1_000_000),
        p_patch: { sentAt: date(body.sentAt, 'Data de envio'), protocol: str(body.protocol, 'Protocolo', 40, { optional: true }) ?? '' },
      });
      return batchDto(r);
    }
    case 'updateBatch': {
      admin();
      const r = await call<BatchRow>(deps, 'billing_batch_update', {
        p_clinic: clinic, p_actor: caller.userId, p_batch: uuid(body.batchId, 'Lote'), p_revision: int(body.revision, 'Revisão', 1, 1_000_000),
        p_patch: { nfseNumber: str(body.nfseNumber, 'NFS-e', 30, { optional: true }) ?? '', notes: str(body.notes ?? '', 'Observações', 1000, { min: 0 }) },
      });
      return batchDto(r);
    }
    case 'settle': {
      admin();
      const items = Array.isArray(body.items) ? body.items.map((x) => {
        const i = x as Record<string, unknown>;
        return { chargeId: uuid(i.chargeId, 'Cobrança'), paid: money(i.paid, 'Valor pago'),
          denialCode: str(i.denialCode, 'Código da glosa', 4, { re: /^[0-9]+$/, optional: true }), denialNote: str(i.denialNote, 'Motivo', 300, { optional: true }) };
      }) : [];
      return call(deps, 'billing_batch_settle', {
        p_clinic: clinic, p_actor: caller.userId, p_batch: uuid(body.batchId, 'Lote'), p_revision: int(body.revision, 'Revisão', 1, 1_000_000),
        p_payment_date: date(body.paymentDate, 'Data do pagamento'), p_items: items,
      });
    }

    // ---------------------------------------------------------- cash, expenses, reports
    case 'cash': {
      staff();
      const { from, to } = period();
      const payments = (await s.payments(clinic, from, to)).filter((p) => !p.cancelled_at);
      const charges = new Map((await s.chargesByIds(clinic, [...new Set(payments.map((p) => p.charge_id).filter((x): x is string => !!x))])).map((c) => [c.id, c]));
      // Reception: only private payments of charges of doctors in its scope; batch payments stay with the admin.
      const scope = role === 'admin' ? null : new Set(await visible());
      const list = payments.filter((p) => !scope || (p.charge_id && scope.has(charges.get(p.charge_id)?.doctor_id ?? '')));
      const expenses = role === 'admin' ? await s.expenses(clinic, from, to) : [];
      return {
        payments: list.map((p) => ({ id: p.id, chargeId: p.charge_id, batchId: p.batch_id, method: p.method, amount: Number(p.amount), receivedOn: p.received_on, notes: p.notes,
          patientName: p.charge_id ? charges.get(p.charge_id)?.patient_name ?? null : null, description: p.charge_id ? charges.get(p.charge_id)?.description ?? null : null })),
        expenses: expenses.map((e) => ({ id: e.id, description: e.description, category: e.category, amount: Number(e.amount), dueOn: e.due_on, paidOn: e.paid_on,
          method: e.method, notes: e.notes, revision: e.revision })),
      };
    }
    case 'saveExpense': {
      admin();
      const id = body.id ? uuid(body.id, 'Despesa') : null;
      const paidOn = date(body.paidOn, 'Pago em', true);
      const method = paidOn ? String(body.method ?? '') : null;
      if (paidOn && !(METHODS as readonly string[]).includes(method!)) throw new HttpError(400, 'Forma de pagamento inválida.', 'invalid');
      const saved = await s.saveExpense(clinic, id, id ? revisionOf(body.revision) : null, {
        description: str(body.description, 'Descrição', 150, { min: 2 })!, category: str(body.category ?? 'outros', 'Categoria', 30, { re: /^[a-z_]{2,30}$/ })!,
        amount: money(body.amount, 'Valor', 0.01), due_on: date(body.dueOn, 'Vencimento')!, paid_on: paidOn, method, notes: str(body.notes ?? '', 'Observações', 300, { min: 0 })!,
      }, caller.userId);
      if (!saved) throw stale();
      return { id: saved.id, revision: saved.revision };
    }
    case 'deleteExpense': {
      admin();
      if (!(await s.deleteExpense(clinic, uuid(body.id, 'Despesa')))) throw new HttpError(404, 'Despesa não encontrada.', 'not_found');
      return { deleted: true };
    }
    case 'report': {
      const { from, to } = period();
      const doctors = role === 'admin' ? await visible() : role === 'doctor' ? [caller.userId] : (() => { throw new HttpError(403, 'Relatórios ficam com a administração e cada médico.', 'forbidden'); })();
      const [charges, professionals, payers] = await Promise.all([s.charges(clinic, doctors, { from, to }), s.professionals(clinic), s.payers(clinic)]);
      return productionReport(charges.filter((c) => c.status !== 'cancelled'), professionals, payers);
    }
    default: throw new HttpError(400, 'Ação desconhecida.', 'invalid');
  }
}

/** Production by doctor and by payer for charges of the period (service date), and the payout. */
export function productionReport(charges: ChargeRow[], professionals: ProfessionalRow[], payers: PayerRow[]) {
  const share = new Map(professionals.map((p) => [p.user_id, p.share_percent === null ? null : Number(p.share_percent)]));
  const sum = (list: ChargeRow[]) => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const charged = r2(list.reduce((a, c) => a + Number(c.amount), 0));
    const paid = r2(list.reduce((a, c) => a + Number(c.paid_amount), 0));
    const denied = r2(list.reduce((a, c) => a + Number(c.denied_amount), 0));
    return { count: list.length, charged, paid, denied, open: r2(charged - paid - denied) };
  };
  const by = <K extends string>(key: (c: ChargeRow) => K) => {
    const m = new Map<K, ChargeRow[]>();
    for (const c of charges) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
    return m;
  };
  const doctors = [...by((c) => c.doctor_id)].map(([doctorId, list]) => {
    const t = sum(list);
    const pct = share.get(doctorId) ?? null;
    return { doctorId, ...t, sharePercent: pct, payout: pct === null ? null : Math.round(t.paid * pct) / 100 };
  });
  const payerName = new Map(payers.map((p) => [p.id, p.name]));
  const byPayer = [...by((c) => c.payer_id ?? 'particular')].map(([key, list]) => ({ payerId: key === 'particular' ? null : key,
    name: key === 'particular' ? 'Particular' : payerName.get(key) ?? 'Convênio', ...sum(list) }));
  const denials = [...by((c) => c.denial_code ?? '')].filter(([code]) => code).map(([code, list]) => ({ code, count: list.length, amount: sum(list).denied }));
  return { totals: sum(charges), doctors, payers: byPayer, denials };
}

/** Builds (draft) or returns (sent) the batch XML; a draft records the hash and the payload. */
async function batchFile(deps: BillingDeps, clinic: string, actor: string, batchId: string) {
  const s = deps.store;
  const b = await s.batch(clinic, batchId);
  if (!b) throw new HttpError(404, 'Lote não encontrado.', 'not_found');
  const payer = (await s.payers(clinic)).find((p) => p.id === b.payer_id)!;
  const encode = (xml: string, name: string) => {
    const bytes = new Uint8Array([...xml].map((ch) => { const c = ch.charCodeAt(0); return c <= 0xff ? c : 0x3f; }));
    const file = payer.zip_required ? zipOne(name, bytes, (deps.now ?? (() => new Date()))()) : bytes;
    let bin = '';
    for (const x of file) bin += String.fromCharCode(x);
    return { fileName: payer.zip_required ? name.replace(/\.xml$/, '.zip') : name, contentType: payer.zip_required ? 'application/zip' : 'application/xml', base64: btoa(bin) };
  };
  if (b.status !== 'draft') {
    if (!b.xml_payload || !b.xml_hash) throw new HttpError(409, 'Este lote não tem XML guardado.', 'unavailable');
    return { ...encode(b.xml_payload, `${String(b.number).padStart(20, '0')}_${b.xml_hash}.xml`), hash: b.xml_hash, revision: b.revision };
  }
  const [settings, professionals, charges] = await Promise.all([s.settings(clinic), s.professionals(clinic), s.batchCharges(clinic, b.id)]);
  const pro = new Map(professionals.map((p) => [p.user_id, p]));
  const missing = [...new Set(charges.filter((c) => !pro.has(c.doctor_id)).map((c) => c.doctor_id))];
  if (missing.length) throw new HttpError(400, 'Cadastre conselho, número e CBO de todos os médicos do lote antes de gerar o XML.', 'professional', { doctorIds: missing });
  const when = saoPaulo((deps.now ?? (() => new Date()))());
  const guides: TissGuide[] = charges.map((c) => {
    const p = pro.get(c.doctor_id)!;
    return {
      guideNumber: String(c.guide_number), cardNumber: c.card_number ?? '', newborn: c.newborn, serviceDate: c.service_date,
      professional: { name: p.tiss_name, council: p.council, councilNumber: p.council_number, uf: p.council_uf, cbo: p.cbo },
      tableCode: c.table_code, procedureCode: c.procedure_code, description: c.description, quantity: c.quantity, unitAmount: Number(c.unit_amount),
      ...(c.consultation_type ? { consultationType: c.consultation_type } : {}),
      authorization: { number: c.authorization_number, password: c.authorization_password, date: c.authorization_date, validUntil: c.authorization_valid_until },
    };
  });
  let built;
  try {
    built = buildBatchXml({
      version: payer.tiss_version, ansRegistry: payer.ans_registry, batchNumber: b.number, guideType: b.guide_type, date: when.date, time: when.time,
      hashEncoding: payer.hash_encoding, provider: { providerCode: payer.provider_code, cnes: settings?.cnes ?? '9999999', legalName: settings?.legal_name ?? '' }, guides,
    });
  } catch (e) {
    const problems = (e as { problems?: string[] }).problems;
    throw new HttpError(400, (e as Error).message, 'tiss', problems ? { problems } : {});
  }
  const updated = await call<BatchRow>(deps, 'billing_batch_update', {
    p_clinic: clinic, p_actor: actor, p_batch: b.id, p_revision: b.revision, p_patch: { xmlHash: built.hash, xml: built.xml },
  });
  return { ...encode(built.xml, built.fileName), hash: built.hash, revision: updated.revision };
}
