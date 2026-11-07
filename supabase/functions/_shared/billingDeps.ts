// Production dependencies of billing-api: Supabase service client, authorization by JWT + clinic_access.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { AuthError, authResponse, requireUser } from './auth.ts';
import { fetchWithDeadline } from './http.ts';
import { HttpError } from './billingHandlers.ts';
import type {
  AppointmentToBill, BatchRow, BillingCaller, BillingDeps, ChargeRow, CoverageRow, DoctorRow, ExpenseRow, PayerRow, PaymentRow, PriceRow, ProfessionalRow, SettingsRow,
} from './billingHandlers.ts';

const CHARGE_COLUMNS = 'id, clinic_id, appointment_id, doctor_id, contact_id, patient_name, payer_id, card_number, newborn, guide_type, table_code, procedure_code, '
  + 'description, quantity, unit_amount, amount, service_date, consultation_type, authorization_number, authorization_password, authorization_date, '
  + 'authorization_valid_until, status, guide_number, batch_id, paid_amount, denied_amount, denial_code, denial_note, notes, revision, created_at';
const BATCH_COLUMNS = 'id, clinic_id, payer_id, number, guide_type, status, total_amount, paid_amount, denied_amount, xml_hash, generated_at, sent_at, '
  + 'protocol, payment_date, nfse_number, notes, revision, created_at';
const STATUSES = new Set(['open', 'batched', 'sent', 'paid', 'partial', 'denied', 'cancelled']);

export function billingDeps(): BillingDeps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: fetchWithDeadline } });
  const cors = {
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
  const fail = (what: string, error?: { code?: string; message?: string } | null): never => {
    if (error?.code && /^(23|40|P0|42|55)/.test(error.code)) throw Object.assign(new Error(error.message ?? what), { code: error.code });
    throw new Error(`Banco indisponível (${what})`);
  };
  const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  // Reads page through the API row cap (1000) instead of stopping silently at it; beyond CAP the
  // caller is told to narrow the period rather than receiving a partial list.
  const PAGE = 1000;
  const CAP = 20000;
  async function pages<T>(what: string, build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) fail(what, error);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
      if (out.length >= CAP) throw new HttpError(413, 'Período com dados demais; escolha um intervalo menor.', 'too_large');
    }
  }
  // Long id lists go in groups (URL length of the hosted gateway).
  async function chunked<T>(ids: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 200) out.push(...(await run(ids.slice(i, i + 200))));
    return out;
  }

  return {
    corsHeaders: cors,
    async authorize(req): Promise<BillingCaller> {
      const { userId } = await requireUser(req, { allowReception: true });
      const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' }, fetch: fetchWithDeadline },
      });
      const { data, error } = await user.rpc('clinic_access');
      if (error) throw new AuthError('Não foi possível verificar seu acesso à clínica.', 503);
      const access = data as { clinic?: { id?: string } | null; actorId?: string } | null;
      const clinicId = access?.clinic?.id;
      if (!access || !clinicId || access.actorId !== userId) throw new AuthError('Sua conta não está vinculada a uma clínica.', 403);
      return { userId, clinicId };
    },
    authFailure: (error) => (error instanceof AuthError ? authResponse(error, cors) : null),
    rpc: async (name, args) => {
      const { data, error } = await service.rpc(name, args);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    },
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
    store: {
      async settings(clinic) {
        const { data, error } = await service.from('billing_settings').select('clinic_id, legal_name, cnpj, cnes, next_guide_number, revision').eq('clinic_id', clinic).maybeSingle();
        if (error) fail('configuração', error);
        return (data as SettingsRow | null) ?? null;
      },
      async saveSettings(clinic, revision, patch, actor) {
        if (!revision) {
          const { data, error } = await service.from('billing_settings').insert({ clinic_id: clinic, ...patch, updated_by: actor }).select().maybeSingle();
          if (error?.code === '23505') return null;
          if (error) fail('configuração', error);
          return data as SettingsRow;
        }
        const { data, error } = await service.from('billing_settings').update({ ...patch, updated_by: actor, updated_at: new Date().toISOString(), revision: revision + 1 })
          .eq('clinic_id', clinic).eq('revision', revision).select().maybeSingle();
        if (error) fail('configuração', error);
        return (data as SettingsRow | null) ?? null;
      },
      async payers(clinic) {
        const { data, error } = await service.from('billing_payers').select('*').eq('clinic_id', clinic).order('name');
        if (error) fail('convênios', error);
        return (data ?? []) as PayerRow[];
      },
      async savePayer(clinic, id, revision, row) {
        const q = id
          ? service.from('billing_payers').update({ ...row, revision: (revision ?? 0) + 1, updated_at: new Date().toISOString() }).eq('clinic_id', clinic).eq('id', id).eq('revision', revision ?? -1)
          : service.from('billing_payers').insert({ ...row, clinic_id: clinic });
        const { data, error } = await q.select().maybeSingle();
        if (error) fail('convênio', error);
        return (data as PayerRow | null) ?? null;
      },
      async prices(clinic) {
        const { data, error } = await service.from('billing_prices').select('*').eq('clinic_id', clinic).order('description').limit(2000);
        if (error) fail('preços', error);
        return (data ?? []) as PriceRow[];
      },
      async savePrice(clinic, id, revision, row) {
        const q = id
          ? service.from('billing_prices').update({ ...row, revision: (revision ?? 0) + 1, updated_at: new Date().toISOString() }).eq('clinic_id', clinic).eq('id', id).eq('revision', revision ?? -1)
          : service.from('billing_prices').insert({ ...row, clinic_id: clinic });
        const { data, error } = await q.select().maybeSingle();
        if (error) fail('preço', error);
        return (data as PriceRow | null) ?? null;
      },
      async deletePrice(clinic, id) {
        const { data, error } = await service.from('billing_prices').delete().eq('clinic_id', clinic).eq('id', id).select('id');
        if (error) fail('preço', error);
        return (data ?? []).length > 0;
      },
      async professionals(clinic) {
        const { data, error } = await service.from('billing_professionals').select('*').eq('clinic_id', clinic);
        if (error) fail('profissionais', error);
        return (data ?? []) as ProfessionalRow[];
      },
      async saveProfessional(clinic, revision, row) {
        const q = revision
          ? service.from('billing_professionals').update({ ...row, revision: revision + 1, updated_at: new Date().toISOString() }).eq('clinic_id', clinic).eq('user_id', row.user_id).eq('revision', revision)
          : service.from('billing_professionals').insert({ ...row, clinic_id: clinic });
        const { data, error } = await q.select().maybeSingle();
        if (error?.code === '23505') return null;
        if (error) fail('profissional', error);
        return (data as ProfessionalRow | null) ?? null;
      },
      async doctors(clinic) {
        const { data, error } = await service.from('clinic_members').select('user_id').eq('clinic_id', clinic).eq('status', 'active');
        if (error) fail('médicos', error);
        const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
        if (!ids.length) return [];
        const { data: settings, error: e2 } = await service.from('user_settings').select('user_id, doctor_name, crm_number, crm_uf').in('user_id', ids);
        if (e2) fail('médicos', e2);
        const byId = new Map(((settings ?? []) as Array<{ user_id: string; doctor_name: string | null; crm_number: string | null; crm_uf: string | null }>).map((r) => [r.user_id, r]));
        return ids.map((id): DoctorRow => ({ id, name: byId.get(id)?.doctor_name?.trim() || 'Médico', crm: byId.get(id)?.crm_number ?? null, crmUf: byId.get(id)?.crm_uf ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      },
      async appointmentsToBill(clinic, doctors, from, to) {
        if (doctors && !doctors.length) return [];
        // Attended appointments of the clinic agenda: done, or checked in and not cancelled.
        const rows = await pages<{ id: string; user_id: string; start_time: string; type: string | null; status: string | null; contact_id: string | null }>('agenda', (a, b) => {
          let q = service.from('appointments').select('id, user_id, start_time, type, status, contact_id')
            .eq('clinic_id', clinic).gte('start_time', `${from}T00:00:00-03:00`).lt('start_time', `${nextDay(to)}T00:00:00-03:00`)
            .or('status.eq.realizado,and(checked_in_at.not.is.null,status.not.in.(cancelado,faltou))');
          if (doctors) q = q.in('user_id', doctors);
          return q.order('start_time').order('id').range(a, b);
        });
        const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((x): x is string => !!x))];
        const names = new Map<string, string>();
        for (const c of await chunked(contactIds, async (part) => {
          const { data, error } = await service.from('clinic_contacts').select('id, name').eq('clinic_id', clinic).in('id', part);
          if (error) fail('contatos', error);
          return (data ?? []) as Array<{ id: string; name: string }>;
        })) names.set(c.id, c.name);
        return rows.map((a): AppointmentToBill => ({ id: a.id, doctor_id: a.user_id, start_time: a.start_time, type: a.type, status: a.status, contact_id: a.contact_id,
          contact_name: a.contact_id ? names.get(a.contact_id) ?? null : null }));
      },
      async billedAppointments(clinic, ids) {
        return chunked(ids, async (part) => {
          const { data, error } = await service.from('billing_charges').select('appointment_id').eq('clinic_id', clinic).in('appointment_id', part).neq('status', 'cancelled');
          if (error) fail('cobranças', error);
          return ((data ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id);
        });
      },
      async coverages(clinic, contactIds) {
        return chunked(contactIds, async (part) => {
          const { data, error } = await service.from('billing_coverages').select('contact_id, payer_id, card_number, card_valid_until, plan').eq('clinic_id', clinic).in('contact_id', part);
          if (error) fail('carteirinhas', error);
          return (data ?? []) as CoverageRow[];
        });
      },
      async saveCoverage(clinic, row) {
        const { error } = await service.from('billing_coverages').upsert({ ...row, clinic_id: clinic, updated_at: new Date().toISOString() }, { onConflict: 'clinic_id,contact_id,payer_id' });
        if (error) fail('carteirinha', error);
      },
      async intakeInsurance(clinic, appointmentIds) {
        const rows = await chunked(appointmentIds, async (part) => {
          const { data, error } = await service.from('intake_requests').select('appointment_id, registration').eq('clinic_id', clinic).eq('status', 'answered').in('appointment_id', part);
          if (error) fail('pré-consulta', error);
          return (data ?? []) as Array<{ appointment_id: string; registration: Array<{ field?: string; value: unknown }> | null }>;
        });
        const out: Record<string, { payer?: string; card?: string; validUntil?: string; type?: string }> = {};
        for (const r of rows) {
          const get = (f: string) => { const v = r.registration?.find((a) => a.field === f)?.value; return typeof v === 'string' ? v : undefined; };
          out[r.appointment_id] = { type: get('insurance_type'), payer: get('insurance_payer'), card: get('insurance_card'), validUntil: get('insurance_card_valid_until') };
        }
        return out;
      },
      async appointment(clinic, id) {
        const { data, error } = await service.from('appointments').select('id, user_id, start_time, type, status, contact_id').eq('clinic_id', clinic).eq('id', id).maybeSingle();
        if (error) fail('agenda', error);
        if (!data) return null;
        const a = data as { id: string; user_id: string; start_time: string; type: string | null; status: string | null; contact_id: string | null };
        return { id: a.id, doctor_id: a.user_id, start_time: a.start_time, type: a.type, status: a.status, contact_id: a.contact_id, contact_name: null };
      },
      async charges(clinic, doctors, f) {
        if (doctors && !doctors.length) return [];
        return pages<ChargeRow>('cobranças', (a, b) => {
          let q = service.from('billing_charges').select(CHARGE_COLUMNS).eq('clinic_id', clinic).gte('service_date', f.from).lte('service_date', f.to);
          if (doctors) q = q.in('doctor_id', doctors);
          if (f.status && STATUSES.has(f.status)) q = q.eq('status', f.status);
          if (f.payerId) q = q.eq('payer_id', f.payerId);
          return q.order('service_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(a, b);
        });
      },
      async charge(clinic, id) {
        const { data, error } = await service.from('billing_charges').select(CHARGE_COLUMNS).eq('clinic_id', clinic).eq('id', id).maybeSingle();
        if (error) fail('cobrança', error);
        return (data as unknown as ChargeRow | null) ?? null;
      },
      async chargesByIds(clinic, ids) {
        if (!ids.length) return [];
        const out: ChargeRow[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await service.from('billing_charges').select(CHARGE_COLUMNS).eq('clinic_id', clinic).in('id', ids.slice(i, i + 200));
          if (error) fail('cobranças', error);
          out.push(...((data ?? []) as unknown as ChargeRow[]));
        }
        return out;
      },
      async openCharges(clinic, payerId, guideType) {
        const { data, error } = await service.from('billing_charges').select(CHARGE_COLUMNS).eq('clinic_id', clinic).eq('payer_id', payerId).eq('guide_type', guideType)
          .eq('status', 'open').order('service_date').limit(500);
        if (error) fail('cobranças', error);
        return (data ?? []) as unknown as ChargeRow[];
      },
      async insertCharge(row) {
        const { data, error } = await service.from('billing_charges').insert(row).select(CHARGE_COLUMNS).single();
        if (error) fail('cobrança', error);
        return data as unknown as ChargeRow;
      },
      async updateCharge(clinic, id, revision, patch) {
        const { data, error } = await service.from('billing_charges').update({ ...patch, revision: revision + 1, updated_at: new Date().toISOString() })
          .eq('clinic_id', clinic).eq('id', id).eq('revision', revision).select(CHARGE_COLUMNS).maybeSingle();
        if (error) fail('cobrança', error);
        return (data as unknown as ChargeRow | null) ?? null;
      },
      async batches(clinic) {
        const { data, error } = await service.from('billing_batches').select(BATCH_COLUMNS).eq('clinic_id', clinic).order('created_at', { ascending: false }).limit(300);
        if (error) fail('lotes', error);
        return ((data ?? []) as unknown as BatchRow[]).map((b) => ({ ...b, xml_payload: null }));
      },
      async batch(clinic, id) {
        const { data, error } = await service.from('billing_batches').select(`${BATCH_COLUMNS}, xml_payload`).eq('clinic_id', clinic).eq('id', id).maybeSingle();
        if (error) fail('lote', error);
        return (data as unknown as BatchRow | null) ?? null;
      },
      async batchCharges(clinic, batchId) {
        const { data, error } = await service.from('billing_charges').select(CHARGE_COLUMNS).eq('clinic_id', clinic).eq('batch_id', batchId).order('guide_number');
        if (error) fail('guias', error);
        return (data ?? []) as unknown as ChargeRow[];
      },
      async payments(clinic, from, to) {
        return pages<PaymentRow>('recebimentos', (a, b) => service.from('billing_payments')
          .select('id, charge_id, batch_id, method, amount, received_on, notes, cancelled_at, created_at')
          .eq('clinic_id', clinic).gte('received_on', from).lte('received_on', to).order('received_on', { ascending: false }).order('id').range(a, b));
      },
      async expenses(clinic, from, to) {
        // Due in the period or paid in it: the cash view counts paid ones by payment date.
        return pages<ExpenseRow>('despesas', (a, b) => service.from('billing_expenses')
          .select('id, description, category, amount, due_on, paid_on, method, notes, revision').eq('clinic_id', clinic)
          .or(`and(due_on.gte.${from},due_on.lte.${to}),and(paid_on.gte.${from},paid_on.lte.${to})`).order('due_on').order('id').range(a, b));
      },
      async saveExpense(clinic, id, revision, row, actor) {
        const q = id
          ? service.from('billing_expenses').update({ ...row, revision: (revision ?? 0) + 1, updated_at: new Date().toISOString() }).eq('clinic_id', clinic).eq('id', id).eq('revision', revision ?? -1)
          : service.from('billing_expenses').insert({ ...row, clinic_id: clinic, created_by: actor });
        const { data, error } = await q.select('id, description, category, amount, due_on, paid_on, method, notes, revision').maybeSingle();
        if (error) fail('despesa', error);
        return (data as ExpenseRow | null) ?? null;
      },
      async deleteExpense(clinic, id) {
        const { data, error } = await service.from('billing_expenses').delete().eq('clinic_id', clinic).eq('id', id).select('id');
        if (error) fail('despesa', error);
        return (data ?? []).length > 0;
      },
    },
  };
}
