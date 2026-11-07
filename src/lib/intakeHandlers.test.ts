import { describe, expect, it, vi } from 'vitest';
import { starterForm } from '../../supabase/functions/_shared/intakeForm';
import {
  intakeApiHandler, intakeLink, intakePublicHandler, linkToken, tokenHash, type IntakeCaller, type IntakeDeps, type IntakeRequestRow,
} from '../../supabase/functions/_shared/intakeHandlers';

const CLINIC = 'e8200000-0000-4000-8000-000000000001';
const DOCTOR = 'e8100000-0000-4000-8000-000000000002';
const RECEPTION = 'e8100000-0000-4000-8000-000000000003';
const ADMIN = 'e8100000-0000-4000-8000-000000000001';
const APPT = 'e8700000-0000-4000-8000-000000000001';
const REQ = 'e8900000-0000-4000-8000-000000000001';
const SECRET = 'synthetic-intake-secret-0123456789abcdef';

function harness(opts: { caller?: IntakeCaller; config?: Partial<IntakeDeps['config']>; open?: Record<string, unknown> | null; request?: Partial<IntakeRequestRow> | null } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const results: Record<string, unknown> = {
    intake_public_open: opts.open === undefined ? { state: 'open', clinicName: 'Clínica Exemplo', doctorName: 'Dra. Exemplo', start: '2026-11-10T13:00:00Z',
      form: starterForm('Clínica Exemplo'), formRevision: 3, answeredAt: null } : opts.open,
    intake_public_submit: { answeredAt: '2026-11-07T12:00:00Z', submissions: 1 },
    intake_scope_ok: true,
  };
  const errors: Record<string, { code: string; message: string }> = {};
  const request: IntakeRequestRow | null = opts.request === null ? null : {
    id: REQ, clinic_id: CLINIC, appointment_id: APPT, doctor_id: DOCTOR, appointment_start: '2026-11-10T13:00:00Z', status: 'answered',
    answered_at: '2026-11-07T12:00:00Z', submissions: 1, registration: [{ id: 'nome', label: 'Nome', value: 'Maria', field: 'name' }],
    health: [{ id: 'motivo', label: 'Motivo', value: 'Rotina' }], whatsapp_consent: true, registration_reviewed_at: null, health_reviewed_at: null,
    revision: 4, expires_at: '2026-11-10T15:30:00Z', opened_at: '2026-11-07T11:00:00Z', ...(opts.request ?? {}),
  };
  const deps: IntakeDeps = {
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    config: { linkSecret: SECRET, appUrl: 'https://app.example.com.br', ...(opts.config ?? {}) },
    authorize: async () => opts.caller ?? { userId: RECEPTION, clinicId: CLINIC, admin: false, reception: true },
    authFailure: () => null,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (errors[name]) throw Object.assign(new Error(errors[name].message), { code: errors[name].code });
      return results[name] ?? null;
    }),
    store: {
      form: async () => null,
      clinicName: async () => 'Clínica Exemplo',
      requestByAppointment: async (clinicId, appointmentId) => (clinicId === CLINIC && appointmentId === APPT ? request : null),
    },
  };
  const post = (handler: typeof intakeApiHandler, body: unknown) =>
    handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), deps);
  return { deps, calls, results, errors, api: (b: unknown) => post(intakeApiHandler, b), pub: (b: unknown) => post(intakePublicHandler, b) };
}

const TOKEN = 'A'.repeat(43);

describe('intake links', () => {
  it('derives a stable 43-character token per request and nonce, and stores only its hash', async () => {
    const a = await linkToken(SECRET, REQ, 'abcdefghijklmnopqrstuv');
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await linkToken(SECRET, REQ, 'abcdefghijklmnopqrstuv')).toBe(a);
    expect(await linkToken(SECRET, REQ, 'bbbbbbbbbbbbbbbbbbbbbb')).not.toBe(a);
    expect(await tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rebuilds the existing link when the request already exists', async () => {
    const h = harness();
    h.results.intake_request_ensure = { id: REQ, nonce: 'abcdefghijklmnopqrstuv', status: 'pending', expiresAt: 'x', created: false };
    const r = await intakeLink(h.deps, CLINIC, APPT, null);
    expect(r.url).toBe(`https://app.example.com.br/pre-consulta/${await linkToken(SECRET, REQ, 'abcdefghijklmnopqrstuv')}`);
    const args = h.calls[0][1];
    expect(args).toMatchObject({ p_clinic: CLINIC, p_appointment: APPT, p_actor: null });
    expect(args.p_token_hash).toBe(await tokenHash(await linkToken(SECRET, String(args.p_id), String(args.p_nonce))));
  });
});

describe('intake-public', () => {
  it('opens the form without any patient data, and refuses bad or unknown tokens alike', async () => {
    const h = harness();
    const r = await (await h.pub({ action: 'open', token: TOKEN })).json();
    expect(r).toMatchObject({ state: 'open', clinicName: 'Clínica Exemplo', formRevision: 3, privacyVersion: 'v1' });
    expect(h.calls[0]).toEqual(['intake_public_open', { p_token_hash: await tokenHash(TOKEN) }]);
    expect((await h.pub({ action: 'open', token: 'short' })).status).toBe(404);
    const none = harness({ open: null });
    expect((await none.pub({ action: 'open', token: TOKEN })).status).toBe(404);
  });

  it('validates answers on the server, requires the privacy notice, and stores them by audience', async () => {
    const h = harness();
    const answers = { nome: 'Maria Exemplo', nascimento: '1990-05-20', cpf: '52998224725', tipo_atendimento: 'Particular', motivo: 'Rotina' };
    expect((await h.pub({ action: 'submit', token: TOKEN, formRevision: 3, answers })).status).toBe(400);
    const bad = await h.pub({ action: 'submit', token: TOKEN, formRevision: 3, privacyAccepted: true, answers: { ...answers, cpf: '123' } });
    expect([bad.status, (await bad.json()).errors]).toEqual([400, [expect.stringContaining('CPF inválido')]]);
    expect((await h.pub({ action: 'submit', token: TOKEN, formRevision: 2, privacyAccepted: true, answers })).status).toBe(409);
    const ok = await h.pub({ action: 'submit', token: TOKEN, formRevision: 3, privacyAccepted: true, whatsappConsent: true, answers });
    expect(ok.status).toBe(200);
    const submit = h.calls.find(([n]) => n === 'intake_public_submit')![1];
    expect(submit).toMatchObject({ p_form_revision: 3, p_whatsapp_consent: true, p_privacy_version: 'v1' });
    expect((submit.p_health as Array<{ id: string }>).map((a) => a.id)).toEqual(['motivo']);
    expect((submit.p_registration as Array<{ id: string }>).map((a) => a.id)).toEqual(['nome', 'nascimento', 'cpf', 'tipo_atendimento']);
  });

  it('answers 503 until the server is configured, and maps refusals from the database', async () => {
    expect((await harness({ config: { linkSecret: '' } }).pub({ action: 'open', token: TOKEN })).status).toBe(503);
    const h = harness();
    h.errors.intake_public_submit = { code: '55000', message: 'A recepção já conferiu as respostas' };
    const r = await h.pub({ action: 'submit', token: TOKEN, formRevision: 3, privacyAccepted: true,
      answers: { nome: 'Maria Exemplo', nascimento: '1990-05-20', cpf: '52998224725', tipo_atendimento: 'Particular', motivo: 'Rotina' } });
    expect([r.status, (await r.json()).error]).toEqual([409, 'A recepção já conferiu as respostas']);
    expect((await harness({ open: { state: 'closed', form: null, formRevision: 3 } }).pub({ action: 'submit', token: TOKEN, formRevision: 3, privacyAccepted: true, answers: {} })).status).toBe(409);
  });
});

describe('intake-api', () => {
  it('shows health answers only to the appointment doctor', async () => {
    const reception = await (await harness().api({ action: 'response', appointmentId: APPT })).json();
    expect(reception.request).toMatchObject({ healthVisible: false, health: null, registration: [{ id: 'nome' }] });
    const doctor = await (await harness({ caller: { userId: DOCTOR, clinicId: CLINIC, admin: false, reception: false } }).api({ action: 'response', appointmentId: APPT })).json();
    expect(doctor.request).toMatchObject({ healthVisible: true, health: [{ id: 'motivo', value: 'Rotina' }] });
  });

  it('refuses callers outside the agenda scope', async () => {
    const h = harness();
    h.results.intake_scope_ok = false;
    expect((await h.api({ action: 'response', appointmentId: APPT })).status).toBe(403);
    expect(h.calls).toContainEqual(['intake_scope_ok', { p_clinic: CLINIC, p_doctor: DOCTOR, p_actor: RECEPTION }]);
  });

  it('lets only the admin read and save the form, and validates it', async () => {
    const h = harness();
    expect((await h.api({ action: 'form' })).status).toBe(403);
    const admin = harness({ caller: { userId: ADMIN, clinicId: CLINIC, admin: true, reception: false } });
    const starter = await (await admin.api({ action: 'form' })).json();
    expect(starter).toMatchObject({ starter: true, revision: 0, enabled: false });
    const broken = { ...starter.form, sections: [] };
    expect((await admin.api({ action: 'saveForm', revision: 0, enabled: true, form: broken })).status).toBe(400);
    admin.results.intake_form_save = { revision: 1, updatedAt: 'x' };
    expect((await admin.api({ action: 'saveForm', revision: 0, enabled: true, form: { ...starter.form, extra: 'dropped' } })).status).toBe(200);
    const saved = admin.calls.at(-1)![1];
    expect(saved).toMatchObject({ p_clinic: CLINIC, p_actor: ADMIN, p_revision: 0, p_enabled: true });
    expect(saved.p_definition).not.toHaveProperty('extra');
  });

  it('creates links for staff and passes the actor for the scope check', async () => {
    const h = harness();
    h.results.intake_request_ensure = { id: REQ, nonce: 'abcdefghijklmnopqrstuv', status: 'pending', expiresAt: 'x', created: false };
    const r = await (await h.api({ action: 'link', appointmentId: APPT })).json();
    expect(r.url).toMatch(/^https:\/\/app\.example\.com\.br\/pre-consulta\/[A-Za-z0-9_-]{43}$/);
    expect(h.calls[0][1]).toMatchObject({ p_actor: RECEPTION });
    h.errors.intake_request_ensure = { code: '55000', message: 'A pré-consulta não está ativa nesta clínica' };
    const off = await h.api({ action: 'link', appointmentId: APPT });
    expect([off.status, (await off.json()).error]).toEqual([409, 'A pré-consulta não está ativa nesta clínica']);
    expect((await h.api({ action: 'link', appointmentId: 'x' })).status).toBe(400);
  });
});
