/**
 * Pre-consultation ("pré-consulta própria", P1): Edge handlers with injected dependencies.
 * - intake-public: the patient's page, without login. Token in the body, never in logs.
 * - intake-api: clinic staff (JWT + clinic_access), for the form, links, answers and reviews.
 * Contract: docs/product/pre-consulta/CONTRATO.md.
 */
import { starterForm, validateAnswers, validateForm, type AnswerItem, type IntakeForm } from './intakeForm.ts';

export interface IntakeCaller { userId: string; clinicId: string; admin: boolean; reception: boolean }

export interface IntakeRequestRow {
  id: string; clinic_id: string; appointment_id: string; doctor_id: string; appointment_start: string; status: string;
  answered_at: string | null; submissions: number; registration: AnswerItem[] | null; health: AnswerItem[] | null;
  whatsapp_consent: boolean | null; registration_reviewed_at: string | null; health_reviewed_at: string | null; revision: number;
  expires_at: string; opened_at: string | null;
}

export interface IntakeFormRow { clinic_id: string; enabled: boolean; definition: IntakeForm; revision: number; updated_at: string }

export interface IntakeDeps {
  corsHeaders: Record<string, string>;
  /** INTAKE_LINK_SECRET (32+ characters) and INTAKE_APP_URL (https origin of the app). */
  config: { linkSecret: string; appUrl: string };
  authorize(req: Request): Promise<IntakeCaller>;
  authFailure(error: unknown): Response | null;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  store: {
    form(clinicId: string): Promise<IntakeFormRow | null>;
    clinicName(clinicId: string): Promise<string>;
    requestByAppointment(clinicId: string, appointmentId: string): Promise<IntakeRequestRow | null>;
  };
  log?(event: string, detail: Record<string, unknown>): void;
}

export const PRIVACY_VERSION = 'v1';
const MAX_BODY = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'error', readonly extra: Record<string, unknown> = {}) { super(message); }
}

const json = (deps: IntakeDeps, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...deps.corsHeaders, 'Content-Type': 'application/json' } });

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 22-character random nonce; a new one revokes the previous link. */
export const newNonce = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

/** The link token: HMAC-SHA256(secret, "cortex/intake/v1|id|nonce"), base64url (43 characters). */
export async function linkToken(secret: string, id: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`cortex/intake/v1|${id}|${nonce}`))));
}

export const tokenHash = async (token: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

const ready = (deps: IntakeDeps) => deps.config.linkSecret.length >= 32 && /^https:\/\/[^/]+$/.test(deps.config.appUrl);
const linkUrl = (deps: IntakeDeps, token: string) => `${deps.config.appUrl}/pre-consulta/${token}`;

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY) throw new HttpError(413, 'Pedido grande demais.', 'too_large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Pedido grande demais.', 'too_large');
  try {
    const body = JSON.parse(text || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Pedido inválido.', 'invalid');
  }
}

/** Database refusals become plain answers; anything else is a 500 without details. */
function sqlError(e: unknown): HttpError {
  const code = (e as { code?: string })?.code;
  const message = (e as Error)?.message ?? '';
  switch (code) {
    case 'P0002': return new HttpError(404, message || 'Não encontrado.', 'not_found');
    case '42501': return new HttpError(403, message || 'Sem permissão.', 'forbidden');
    case '40001': return new HttpError(409, message || 'Os dados mudaram; atualize a página.', 'stale');
    case '55000': return new HttpError(409, message || 'Não disponível agora.', 'unavailable');
    case '54000': return new HttpError(429, message || 'Limite atingido.', 'limit');
    case '22023': return new HttpError(400, message || 'Pedido inválido.', 'invalid');
    default: return new HttpError(500, 'Não foi possível concluir agora.', 'server');
  }
}

async function call<T>(deps: IntakeDeps, name: string, args: Record<string, unknown>): Promise<T> {
  try {
    return (await deps.rpc(name, args)) as T;
  } catch (e) {
    throw sqlError(e);
  }
}

function fail(deps: IntakeDeps, e: unknown): Response {
  const auth = deps.authFailure(e);
  if (auth) return auth;
  if (e instanceof HttpError) return json(deps, e.status, { error: e.message, code: e.code, ...e.extra });
  deps.log?.('intake_error', { kind: (e as Error)?.name ?? 'unknown' });
  return json(deps, 500, { error: 'Não foi possível concluir agora.', code: 'server' });
}

// ---------------------------------------------------------------- shared with the agenda automation

/**
 * Link of an appointment's pre-consultation, created on first use (actor null = the automation).
 * The same request always yields the same link until it is rotated.
 */
export async function intakeLink(deps: Pick<IntakeDeps, 'rpc' | 'config'>, clinicId: string, appointmentId: string, actor: string | null) {
  const id = crypto.randomUUID();
  const nonce = newNonce();
  const token = await linkToken(deps.config.linkSecret, id, nonce);
  const r = (await deps.rpc('intake_request_ensure', {
    p_clinic: clinicId, p_appointment: appointmentId, p_actor: actor, p_id: id, p_nonce: nonce, p_token_hash: await tokenHash(token),
  })) as { id: string; nonce: string; status: string; expiresAt: string; created: boolean };
  const finalToken = r.created ? token : await linkToken(deps.config.linkSecret, r.id, r.nonce);
  return { url: `${deps.config.appUrl}/pre-consulta/${finalToken}`, requestId: r.id, status: r.status, expiresAt: r.expiresAt };
}

// ---------------------------------------------------------------- public page

export async function intakePublicHandler(req: Request, deps: IntakeDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: deps.corsHeaders });
  if (req.method !== 'POST') return json(deps, 405, { error: 'Método não permitido.' });
  if (!ready(deps)) return json(deps, 503, { error: 'A pré-consulta ainda não está configurada.', code: 'server_not_ready' });
  try {
    const body = await readBody(req);
    if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw new HttpError(404, 'Link inválido ou vencido.', 'not_found');
    const hash = await tokenHash(body.token);
    const open = await call<{ state: string; clinicName: string; doctorName: string; start: string; form: IntakeForm | null;
      answeredAt: string | null; formRevision: number } | null>(deps, 'intake_public_open', { p_token_hash: hash });
    if (!open) throw new HttpError(404, 'Link inválido ou vencido.', 'not_found');
    if (body.action === 'open') {
      return json(deps, 200, {
        state: open.state, clinicName: open.clinicName, doctorName: open.doctorName, start: open.start,
        form: open.form, formRevision: open.formRevision, answeredAt: open.answeredAt, privacyVersion: PRIVACY_VERSION,
      });
    }
    if (body.action !== 'submit') throw new HttpError(400, 'Ação desconhecida.', 'invalid');
    if (!open.form || (open.state !== 'open' && open.state !== 'answered')) throw new HttpError(409, 'Este formulário não aceita mais respostas.', 'unavailable');
    if (body.privacyAccepted !== true) throw new HttpError(400, 'É preciso confirmar a leitura do aviso de privacidade.', 'privacy');
    if (body.formRevision !== open.formRevision) throw new HttpError(409, 'O formulário mudou; recarregue a página.', 'stale');
    const checked = validateAnswers(open.form, body.answers);
    if (checked.errors.length) throw new HttpError(400, 'Revise as respostas destacadas.', 'answers', { errors: checked.errors.slice(0, 30) });
    const saved = await call<{ answeredAt: string; submissions: number }>(deps, 'intake_public_submit', {
      p_token_hash: hash, p_form_revision: open.formRevision, p_registration: checked.registration, p_health: checked.health,
      p_whatsapp_consent: body.whatsappConsent === true, p_privacy_version: PRIVACY_VERSION,
    });
    return json(deps, 200, { answeredAt: saved.answeredAt, thanks: open.form.thanks });
  } catch (e) {
    return fail(deps, e);
  }
}

// ---------------------------------------------------------------- clinic staff API

const requireAdmin = (c: IntakeCaller) => { if (!c.admin) throw new HttpError(403, 'Só a administração da clínica edita o formulário.', 'forbidden'); };
const uuid = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `${what} inválido.`, 'invalid');
  return v;
};

export async function intakeApiHandler(req: Request, deps: IntakeDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: deps.corsHeaders });
  if (req.method !== 'POST') return json(deps, 405, { error: 'Método não permitido.' });
  try {
    const caller = await deps.authorize(req);
    const body = await readBody(req);
    switch (body.action) {
      case 'state': return json(deps, 200, { ready: ready(deps), canEditForm: caller.admin, enabled: (await deps.store.form(caller.clinicId))?.enabled ?? false });
      case 'form': {
        requireAdmin(caller);
        const row = await deps.store.form(caller.clinicId);
        if (!row) return json(deps, 200, { starter: true, revision: 0, enabled: false, form: starterForm(await deps.store.clinicName(caller.clinicId)), updatedAt: null });
        return json(deps, 200, { starter: false, revision: row.revision, enabled: row.enabled, form: row.definition, updatedAt: row.updated_at });
      }
      case 'saveForm': {
        requireAdmin(caller);
        const errors = validateForm(body.form);
        if (errors.length) throw new HttpError(400, errors[0], 'invalid', { errors });
        const f = body.form as IntakeForm;
        // Only the known fields are kept, rebuilt from the request.
        const clean: IntakeForm = {
          intro: f.intro.trim(), thanks: f.thanks.trim(),
          sections: f.sections.map((s) => ({ id: s.id, title: s.title.trim(), audience: s.audience, questions: s.questions.map((q) => ({
            id: q.id, label: q.label.trim(), type: q.type, ...(q.required ? { required: true } : {}), ...(q.options ? { options: q.options.map((o) => o.trim()) } : {}),
            ...(q.help?.trim() ? { help: q.help.trim() } : {}), ...(q.field ? { field: q.field } : {}),
            ...(q.showIf ? { showIf: { question: q.showIf.question, equals: q.showIf.equals } } : {}),
          })) })),
        };
        const r = await call<{ revision: number; updatedAt: string }>(deps, 'intake_form_save', {
          p_clinic: caller.clinicId, p_actor: caller.userId, p_revision: Number(body.revision) || 0, p_enabled: body.enabled === true, p_definition: clean,
        });
        return json(deps, 200, r);
      }
      case 'list': {
        const from = typeof body.from === 'string' ? Date.parse(body.from) : NaN;
        const to = typeof body.to === 'string' ? Date.parse(body.to) : NaN;
        if (!Number.isFinite(from) || !Number.isFinite(to)) throw new HttpError(400, 'Período inválido.', 'invalid');
        const items = await call<unknown[]>(deps, 'intake_list', { p_clinic: caller.clinicId, p_actor: caller.userId,
          p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
        return json(deps, 200, { items: items ?? [] });
      }
      case 'link': {
        if (!ready(deps)) throw new HttpError(503, 'A pré-consulta ainda não está configurada no servidor.', 'server_not_ready');
        const appointmentId = uuid(body.appointmentId, 'Agendamento');
        try {
          return json(deps, 200, await intakeLink(deps, caller.clinicId, appointmentId, caller.userId));
        } catch (e) {
          throw e instanceof HttpError ? e : sqlError(e);
        }
      }
      case 'rotate': {
        if (!ready(deps)) throw new HttpError(503, 'A pré-consulta ainda não está configurada no servidor.', 'server_not_ready');
        const requestId = uuid(body.requestId, 'Pré-consulta');
        const nonce = newNonce();
        const token = await linkToken(deps.config.linkSecret, requestId, nonce);
        const r = await call<{ status: string; expiresAt: string }>(deps, 'intake_request_rotate', {
          p_clinic: caller.clinicId, p_request: requestId, p_actor: caller.userId, p_nonce: nonce, p_token_hash: await tokenHash(token),
        });
        return json(deps, 200, { url: linkUrl(deps, token), requestId, status: r.status, expiresAt: r.expiresAt });
      }
      case 'response': {
        const appointmentId = uuid(body.appointmentId, 'Agendamento');
        const r = await deps.store.requestByAppointment(caller.clinicId, appointmentId);
        if (!r) return json(deps, 200, { request: null });
        const allowed = await call<boolean>(deps, 'intake_scope_ok', { p_clinic: caller.clinicId, p_doctor: r.doctor_id, p_actor: caller.userId });
        if (!allowed) throw new HttpError(403, 'Sem permissão para esta agenda.', 'forbidden');
        const isDoctor = caller.userId === r.doctor_id;
        return json(deps, 200, { request: {
          id: r.id, state: r.status, revision: r.revision, openedAt: r.opened_at, answeredAt: r.answered_at, submissions: r.submissions,
          expiresAt: r.expires_at, whatsappConsent: r.whatsapp_consent, registration: r.registration ?? [],
          registrationReviewedAt: r.registration_reviewed_at, healthReviewedAt: r.health_reviewed_at,
          // Health answers only for the appointment's doctor.
          healthVisible: isDoctor, health: isDoctor ? (r.health ?? []) : null,
        } });
      }
      case 'review': {
        const requestId = uuid(body.requestId, 'Pré-consulta');
        if (body.part !== 'registration' && body.part !== 'health') throw new HttpError(400, 'Parte inválida.', 'invalid');
        const r = await call<unknown>(deps, 'intake_review', {
          p_clinic: caller.clinicId, p_request: requestId, p_actor: caller.userId, p_part: body.part, p_revision: Number(body.revision),
        });
        return json(deps, 200, r);
      }
      default: throw new HttpError(400, 'Ação desconhecida.', 'invalid');
    }
  } catch (e) {
    return fail(deps, e);
  }
}
