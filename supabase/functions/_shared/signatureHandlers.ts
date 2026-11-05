// Edge handlers of the digital signature (D17): signature-session and
// sign-document. Contract: docs/prescriptions/ASSINATURA_HANDLERS.md v3.1.
//
// Thin on purpose: authentication comes from requireUserContext (injected),
// every decision about state is in the database (service-role RPCs with the
// verified session context as p_auth), and the signature itself is
// signDocument. Nothing in a request body is taken as the actor, the
// session, the deadline or consent. Logs carry ids and codes only, never a
// token, CPF, code, verifier, hash or document.

import { AD_RB_V1_1, sha256, signerCertificateProblem } from './pades.ts';
import {
  MAX_SESSION_SECONDS, authorizeUrl, newState, openSecret, pkcePair, sealSecret, stateHash, tokenBinding, verifierBinding,
  type PscCertificate, type PscConfig, type PscSession, type SealedSecret,
} from './psc.ts';
import { signDocument, type RpcError, type SignatureOutcome, type SignaturePorts, type SignatureRequest } from './signatureFlow.ts';

/** The context requireUserContext verified for the bearer (never a body). */
export interface SignerContext { userId: string; sessionId: string; aal: 'aal1' | 'aal2'; exp: number }

export interface SignatureServerConfig {
  psc: PscConfig;
  keys: { current: string; keys: Record<string, Uint8Array> };
  policy: { oid: string; hash: Uint8Array; uri: string };
}

export interface HandlerDeps {
  authenticate(req: Request): Promise<SignerContext>;
  /** The response for an authentication error, or null when it is not one. */
  authFailure(error: unknown): Response | null;
  /** null when the server is not configured for signatures: 503. */
  config: SignatureServerConfig | null;
  /** Service-role RPC; throws an RpcError carrying the SQLSTATE. */
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  storage: {
    download(path: string): Promise<Uint8Array | null>;
    upload(path: string, pdf: Uint8Array): Promise<'created' | 'exists'>;
    remove(path: string): Promise<void>;
  };
  psc: {
    exchangeCode(cfg: PscConfig, p: { code: string; codeVerifier: string }): Promise<PscSession>;
    discovery(cfg: PscConfig, accessToken: string): Promise<PscCertificate[]>;
    sign(cfg: PscConfig, accessToken: string, p: { id: string; hash: Uint8Array; alias?: string }): Promise<Uint8Array>;
  };
  /** Owner-scoped read of what the signature metadata needs (never trusted for state). */
  prescription(userId: string, prescriptionId: string): Promise<{ doc_type: string; crm: string; uf: string; specialty?: string } | null>;
  prescriberCpf(userId: string): Promise<string | null>;
  corsHeaders: Record<string, string>;
  sign?: typeof signDocument;
  now?: () => number;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
/** Shortest JWT lifetime left to start a signature step (the database checks the real deadline). */
export const MIN_TOKEN_SECONDS = 120;
const DOC_TYPE_OID_KEY: Record<string, 'prescricao' | 'atestado' | 'pedido_exame'> = {
  receita_simples: 'prescricao', atestado: 'atestado', solicitacao_exames: 'pedido_exame',
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Reads the server configuration from the environment; null when incomplete or invalid. */
export function readSignatureConfig(env: (name: string) => string | undefined, parseKeys: (v: string) => SignatureServerConfig['keys']): SignatureServerConfig | null {
  const baseUrl = env('SIGNATURE_PSC_BASE_URL');
  const clientId = env('SIGNATURE_PSC_CLIENT_ID');
  const clientSecret = env('SIGNATURE_PSC_CLIENT_SECRET');
  const redirectUri = env('SIGNATURE_PSC_REDIRECT_URI');
  const keyList = env('SIGNATURE_TOKEN_KEYS');
  const policyHash = (env('SIGNATURE_POLICY_SHA256') ?? '').toLowerCase();
  if (!baseUrl || !clientId || !clientSecret || !redirectUri || !keyList || !HEX64.test(policyHash)) return null;
  try {
    const base = new URL(baseUrl);
    const redirect = new URL(redirectUri);
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || redirect.protocol !== 'https:') return null;
    return {
      psc: { id: 'vidaas', baseUrl: base.toString(), clientId, clientSecret, redirectUri: redirect.toString() },
      keys: parseKeys(keyList),
      policy: { oid: AD_RB_V1_1, hash: Uint8Array.from(policyHash.match(/../g)!.map((h) => parseInt(h, 16))), uri: 'http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der' },
    };
  } catch {
    return null;
  }
}

/** Largest request body the handlers read. */
export const MAX_BODY_BYTES = 8 * 1024;

/** A stream read piece by piece, cancelled as soon as it passes `maxBytes`; null then or on any error. */
async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bytes only (ArrayBuffer.isView also holds across realms).
      if (!ArrayBuffer.isView(value) || (size += value.byteLength) > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/**
 * The JSON object of a small body (Codex 05/11 05:09, R5). A declared
 * Content-Length over the limit is refused before reading; otherwise the
 * stream is read piece by piece and cancelled as soon as it passes the limit,
 * so a large or growing body is never buffered. Invalid UTF-8 or JSON, or
 * anything but an object, is null.
 */
async function readBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && !(/^\d{1,9}$/.test(declared) && Number(declared) <= maxBytes)) {
    await req.body?.cancel().catch(() => {});
    return null;
  }
  if (!req.body) return null;
  const bytes = await readCapped(req.body, maxBytes);
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Largest Storage error body read to classify it. */
const MAX_STORAGE_ERROR_BYTES = 4 * 1024;

const storageKind = (status: number, statusCode: unknown): 'not_found' | 'exists' | 'unavailable' => {
  const code = typeof statusCode === 'string' || typeof statusCode === 'number' ? String(statusCode) : '';
  if (code === '404' && (status === 400 || status === 404)) return 'not_found';
  if (code === '409' && (status === 400 || status === 409)) return 'exists';
  return 'unavailable';
};

/**
 * How a Storage error reads (Codex 05/11 05:09 and 06:35, R4). Only a
 * structured answer says that an object is absent or already there: HTTP 400
 * or 404 with statusCode 404 (400 is the older Storage), HTTP 400 or 409 with
 * statusCode 409. storage-js 2.86 gives it in two shapes:
 * - StorageApiError (JSON answers, e.g. upload): status and statusCode;
 * - StorageUnknownError around the HTTP answer itself (download, which asks
 *   for the raw body): its status and a small JSON body (at most 4 KiB) whose
 *   own statusCode must agree; a body without it (a gateway's 404, HTML) is
 *   not an answer about the object.
 * Anything else, whatever its text (500, 503, network), is an unavailable
 * Storage: the caller throws and nothing is closed or removed because of it.
 */
export async function storageErrorKind(error: unknown): Promise<'not_found' | 'exists' | 'unavailable'> {
  const e = error as { status?: unknown; statusCode?: unknown; originalError?: unknown } | null;
  if (typeof e?.status === 'number') return storageKind(e.status, e.statusCode);
  const response = e?.originalError as { status?: unknown; bodyUsed?: unknown; body?: unknown } | null | undefined;
  if (typeof response?.status !== 'number' || response.bodyUsed) return 'unavailable';
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') return 'unavailable';
  const bytes = await readCapped(body, MAX_STORAGE_ERROR_BYTES);
  if (!bytes) return 'unavailable';
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unavailable';
    return storageKind(response.status, (parsed as { statusCode: unknown }).statusCode);
  } catch {
    return 'unavailable';
  }
}

/** The part of a storage-js bucket (supabase-js storage.from) the handlers use. */
export interface StorageBucket {
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
  upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
  remove(paths: string[]): PromiseLike<{ error: unknown }>;
}

/**
 * The handlers' Storage over a storage-js bucket: absent and already there
 * only by storageErrorKind; every other error throws, so an unavailable
 * Storage never reads as a missing or existing object.
 */
export function storageAdapter(bucket: StorageBucket): HandlerDeps['storage'] {
  return {
    download: async (path) => {
      const { data, error } = await bucket.download(path);
      if (error) {
        if ((await storageErrorKind(error)) === 'not_found') return null;
        throw new Error('Storage indisponível');
      }
      if (!data) throw new Error('Storage indisponível');
      return new Uint8Array(await data.arrayBuffer());
    },
    upload: async (path, pdf) => {
      const { error } = await bucket.upload(path, pdf, { contentType: 'application/pdf', upsert: false });
      if (!error) return 'created';
      if ((await storageErrorKind(error)) === 'exists') return 'exists';
      throw new Error('Storage indisponível');
    },
    remove: async (path) => {
      const { error } = await bucket.remove([path]);
      if (error) throw new Error('Storage indisponível');
    },
  };
}

function responder(deps: HandlerDeps) {
  return (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...deps.corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}

/** SQLSTATE of a service RPC -> HTTP, or null when it is not one of ours. */
function rpcFailure(json: ReturnType<typeof responder>, error: unknown): Response | null {
  const code = (error as RpcError)?.code;
  switch (code) {
    case '40001': return json(503, { error: 'Em uso por outra operação. Tente de novo.' }, { 'Retry-After': '1' });
    case 'P4011': return json(401, { error: 'Sua sessão do Cortex terminou. Entre de novo.', code: 'auth_session_ended' });
    case 'P4031': return json(409, { error: 'Sessão de assinatura encerrada. Abra uma nova no aplicativo do certificado.', code: 'signature_session_ended' });
    case 'P4093': return json(409, { error: (error as Error).message || 'O documento não está pronto para assinar.', code: 'not_ready' });
    case 'P4094': return json(202, { status: 'in_progress' });
    case '42501': return json(403, { error: 'Documento indisponível.' });
    case '22023': return json(400, { error: 'Pedido inválido.' });
    default: return null;
  }
}

/**
 * Authentication shared by both functions: verified context and AAL2 on
 * every route (Codex 05/11 05:09, R3: the same requirement the global MFA
 * gate of requireUserContext enforces once a factor is verified, without a
 * weaker path for state or revoke). Starting a signature step also needs
 * enough token left.
 */
async function signer(req: Request, deps: HandlerDeps, json: ReturnType<typeof responder>, needsMargin = true, mfaDetail: Record<string, unknown> = {}): Promise<SignerContext | Response> {
  let ctx: SignerContext;
  try {
    ctx = await deps.authenticate(req);
  } catch (error) {
    return deps.authFailure(error) ?? json(401, { error: 'Não autorizado' });
  }
  if (ctx.aal !== 'aal2') return json(403, { error: 'Confirme o segundo fator para continuar.', mfaRequired: true, ...mfaDetail });
  if (needsMargin && ctx.exp - (deps.now ?? Date.now)() / 1000 < MIN_TOKEN_SECONDS) return json(401, { error: 'Sua sessão vai expirar. Entre de novo antes de assinar.', code: 'renew_session' });
  return ctx;
}

const authOf = (ctx: SignerContext) => ({ sessionId: ctx.sessionId, aal: ctx.aal, exp: ctx.exp });

// ---------------------------------------------------------------------------
// sign-document: POST {prescriptionId, operationId, shownPdfSha256, humanRetry?}

const SIGN_KEYS = new Set(['prescriptionId', 'operationId', 'shownPdfSha256', 'humanRetry']);
const PRODUCTIVE = new Set(['signature_reserve', 'signature_session_token', 'signature_advance', 'signature_complete']);

export async function signDocumentHandler(req: Request, deps: HandlerDeps): Promise<Response> {
  const json = responder(deps);
  if (req.method === 'OPTIONS') return new Response(null, { headers: deps.corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const ctx = await signer(req, deps, json);
  if (ctx instanceof Response) return ctx;
  if (!deps.config) return json(503, { error: 'Assinatura digital ainda não configurada.', code: 'not_configured' });
  const config = deps.config;

  const body = await readBody(req);
  if (!body || Object.keys(body).some((k) => !SIGN_KEYS.has(k))
    || typeof body.prescriptionId !== 'string' || !UUID.test(body.prescriptionId)
    || typeof body.operationId !== 'string' || !UUID.test(body.operationId)
    || typeof body.shownPdfSha256 !== 'string' || !HEX64.test(body.shownPdfSha256)
    || (body.humanRetry !== undefined && typeof body.humanRetry !== 'boolean')) {
    return json(400, { error: 'Pedido inválido.' });
  }

  try {
    const doc = await deps.prescription(ctx.userId, body.prescriptionId);
    if (!doc) return json(403, { error: 'Documento indisponível.' });
    const documentType = DOC_TYPE_OID_KEY[doc.doc_type];
    if (!documentType) return json(409, { error: 'Este tipo de documento ainda não é assinado digitalmente.', code: 'not_ready' });

    const auth = authOf(ctx);
    const ports: SignaturePorts = {
      // The verified context goes only to the productive functions; closing
      // steps (close, cleanup) work after a logout and only close.
      rpc: (name, args) => deps.rpc(name, PRODUCTIVE.has(name) ? { ...args, p_auth: auth } : args),
      downloadOriginal: async (op) => {
        const pdf = await deps.storage.download(`rx/${op.user_id}/${op.prescription_id}.pdf`);
        if (!pdf) throw new Error('Documento original indisponível.');
        return pdf;
      },
      uploadSigned: (path, pdf) => deps.storage.upload(path, pdf),
      downloadSigned: (path) => deps.storage.download(path),
      removeSigned: (path) => deps.storage.remove(path),
      psc: {
        discovery: (token) => deps.psc.discovery(config.psc, token),
        sign: (token, p) => deps.psc.sign(config.psc, token, p),
      },
      keys: config.keys,
      log: deps.log,
    };
    const request: SignatureRequest = {
      userId: ctx.userId,
      operationId: body.operationId.toLowerCase(),
      prescriptionId: body.prescriptionId.toLowerCase(),
      shownPdfSha256: body.shownPdfSha256,
      humanRetry: body.humanRetry === true,
      policy: config.policy,
      health: { crm: doc.crm, uf: doc.uf, specialty: doc.specialty, documentType },
      reason: documentType === 'prescricao' ? 'Prescrição médica' : documentType === 'atestado' ? 'Atestado médico' : 'Solicitação de exames',
    };
    const outcome = await (deps.sign ?? signDocument)(ports, request);
    return outcomeResponse(json, outcome);
  } catch (error) {
    const mapped = rpcFailure(json, error);
    if (mapped) return mapped;
    deps.log?.('sign_document_failed', { name: (error as Error)?.name ?? 'Error' });
    return json(500, { error: 'Não foi possível assinar agora.' });
  }
}

function outcomeResponse(json: ReturnType<typeof responder>, outcome: SignatureOutcome): Response {
  switch (outcome.status) {
    case 'completed': return json(200, { status: 'completed', signedPath: outcome.signedPath });
    case 'in_progress':
    case 'ambiguous': return json(202, { status: outcome.status });
    case 'rate_limited': return json(429, { status: 'rate_limited', error: 'Muitas assinaturas em pouco tempo. A sessão de assinatura foi suspensa.' });
    default:
      if (outcome.code === 'auth_session_ended') return json(401, { status: outcome.status, code: outcome.code, error: 'Sua sessão do Cortex terminou. Entre de novo.' });
      return json(409, { status: outcome.status, code: outcome.code });
  }
}

// ---------------------------------------------------------------------------
// signature-session: POST start | POST complete {code, state} | POST revoke | GET state

const CERTIFICATE_REFUSED = {
  no_certificate: 'O PSC não devolveu certificado para esta sessão.',
  certificate_invalid: 'O certificado devolvido pelo PSC não pode assinar nesta versão (formato ou chave).',
  certificate_expired: 'O certificado está vencido. Renove-o antes de assinar.',
} as const;

export async function signatureSessionHandler(req: Request, deps: HandlerDeps): Promise<Response> {
  const json = responder(deps);
  if (req.method === 'OPTIONS') return new Response(null, { headers: deps.corsHeaders });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  const allowed: Record<string, string> = { start: 'POST', complete: 'POST', revoke: 'POST', state: 'GET' };
  if (!(route in allowed)) return json(404, { error: 'Rota desconhecida.' });
  if (req.method !== allowed[route]) return json(405, { error: 'Método não permitido.' });

  // Every route needs AAL2; opening a session also needs enough token left.
  // The state's refusal still says whether signing is configured, so the
  // screen can send a doctor without a second factor to enable it (Codex
  // 05/11 10:25, 1).
  const ctx = await signer(req, deps, json, route === 'start' || route === 'complete', route === 'state' ? { configured: deps.config !== null } : {});
  if (ctx instanceof Response) return ctx;

  try {
    if (route === 'revoke') return json(200, { revoked: Number(await deps.rpc('signature_revoke_session', { p_user: ctx.userId })) > 0 });
    // `configured` lets the screen hide signing until Phase 0 (SIGNATURE_* set).
    if (route === 'state') return json(200, { ...((await deps.rpc('signature_session_state', { p_user: ctx.userId })) as Record<string, unknown>), configured: deps.config !== null });
    if (!deps.config) return json(503, { error: 'Assinatura digital ainda não configurada.', code: 'not_configured' });
    const config = deps.config;
    const auth = authOf(ctx);

    if (route === 'start') {
      const cpf = (await deps.prescriberCpf(ctx.userId))?.replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return json(409, { error: 'Informe o seu CPF em Configurações para assinar.', code: 'cpf_missing' });
      const state = newState();
      const hash = await stateHash(state);
      const pkce = await pkcePair();
      const sealedVerifier = await sealSecret(config.keys, pkce.verifier, verifierBinding(hash, ctx.userId, config.psc.id));
      await deps.rpc('signature_begin_authorization', { p_user: ctx.userId, p_psc: config.psc.id, p_state_hash: hash, p_verifier: sealedVerifier, p_auth: auth });
      return json(200, { authorizeUrl: authorizeUrl(config.psc, { state, codeChallenge: pkce.challenge, lifetimeSeconds: MAX_SESSION_SECONDS, loginHint: cpf }) });
    }

    // complete: the state is consumed (CAS) before anything goes to the PSC.
    const body = await readBody(req);
    if (!body || Object.keys(body).some((k) => k !== 'code' && k !== 'state')
      || typeof body.code !== 'string' || body.code.length < 1 || body.code.length > 2048 || /\s/.test(body.code)
      || typeof body.state !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(body.state)) {
      return json(400, { error: 'Pedido inválido.' });
    }
    const hash = await stateHash(body.state);
    const sealedVerifier = (await deps.rpc('signature_consume_authorization', { p_user: ctx.userId, p_psc: config.psc.id, p_state_hash: hash, p_auth: auth })) as SealedSecret;
    const verifier = await openSecret(config.keys, sealedVerifier, verifierBinding(hash, ctx.userId, config.psc.id));
    const session = await deps.psc.exchangeCode(config.psc, { code: body.code, codeVerifier: verifier });
    const cpf = (await deps.prescriberCpf(ctx.userId))?.replace(/\D/g, '');
    if (!cpf || session.authorizedCpf.replace(/\D/g, '') !== cpf) {
      deps.log?.('signature_session_cpf_mismatch', { userId: ctx.userId });
      return json(403, { error: 'O certificado autorizado não é do CPF cadastrado em Configurações.', code: 'cpf_mismatch' });
    }
    // Only a certificate that can sign opens the session (Codex 05/11 05:09,
    // R2): the first one discovered that is a complete DER certificate with a
    // supported RSA key, valid now. Nothing is activated otherwise.
    const now = (deps.now ?? Date.now)();
    let certificate: PscCertificate | undefined;
    let problem: keyof typeof CERTIFICATE_REFUSED = 'no_certificate';
    for (const candidate of await deps.psc.discovery(config.psc, session.accessToken)) {
      const found = await signerCertificateProblem(candidate.certificate, new Date(now));
      if (!found) { certificate = candidate; break; }
      if (problem === 'no_certificate') problem = found;
    }
    if (!certificate) {
      deps.log?.('signature_session_certificate_refused', { userId: ctx.userId, code: problem });
      return json(409, { error: CERTIFICATE_REFUSED[problem], code: problem });
    }
    const certSha256 = hex(await sha256(certificate.certificate));
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Math.min(session.expiresAt.getTime(), now + (MAX_SESSION_SECONDS - 60) * 1000));
    const sealedToken = await sealSecret(config.keys, session.accessToken, tokenBinding(sessionId, ctx.userId, 1));
    await deps.rpc('signature_activate_session', {
      p_user: ctx.userId, p_psc: config.psc.id, p_session: sessionId, p_expires_at: expiresAt.toISOString(),
      p_cert_sha256: certSha256, p_token: sealedToken, p_auth: auth,
    });
    return json(200, { active: true, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    const mapped = rpcFailure(json, error);
    if (mapped) return mapped;
    const status = (error as { status?: unknown })?.status;
    if ((error as Error)?.name === 'PscRejectedError' && typeof status === 'number') {
      return json(502, { error: 'O PSC recusou o pedido. Tente de novo pelo aplicativo do certificado.', code: 'psc_rejected' });
    }
    deps.log?.('signature_session_failed', { route, name: (error as Error)?.name ?? 'Error' });
    return json(500, { error: 'Não foi possível concluir agora.' });
  }
}
