// Client of the digital signature functions (D17): signature-session and
// sign-document (docs/prescriptions/ASSINATURA_HANDLERS.md). Every answer is
// mapped to what the screen shows; the server decides everything else.
// `invoke` is supabase.functions.invoke (injected for tests).
import { functionErrorBody, functionErrorMessage } from '@/lib/functionErrors';

type InvokeResult = { data: unknown; error: unknown };
export type Invoke = (name: string, options: { method: 'GET' | 'POST'; body?: Record<string, unknown> }) => Promise<InvokeResult>;

/** Document types signed in this phase (the same list as the database). */
export const SIGNABLE_TYPES = new Set(['receita_simples', 'atestado', 'solicitacao_exames']);

/** HTTP status and JSON body of an answer; null when the server was not reached. */
async function answer(result: InvokeResult): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (!result.error) {
    const body = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? (result.data as Record<string, unknown>) : {};
    return { status: 200, body };
  }
  const status = (result.error as { context?: { status?: unknown } } | null)?.context?.status;
  if (typeof status !== 'number') return null;
  return { status, body: (await functionErrorBody(result.error)) ?? {} };
}
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const OFFLINE = 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
function sessionMessage(body: Record<string, unknown>, fallback: string): string {
  if (body.code === 'cpf_missing') return 'Solicite à equipe de implantação a inclusão do CPF no seu cadastro profissional para usar a assinatura.';
  if (body.code === 'cpf_mismatch') return 'O certificado autorizado não corresponde ao CPF cadastrado. Confira o certificado usado e, se o cadastro estiver incorreto, solicite a correção à implantação.';
  return text(body.error, fallback);
}


// ---------------------------------------------------------------------------
// Signature session

export type SessionState =
  | { available: false }
  /** `mfaRequired`: the doctor must enable or confirm the second factor first. */
  | { available: true; configured: boolean; active: boolean; expiresAt: string | null; mfaRequired?: boolean };

/** Whether signing is available here and the doctor has an open session. */
export async function sessionState(invoke: Invoke): Promise<SessionState> {
  const result = await answer(await invoke('signature-session/state', { method: 'GET' }));
  // Without the second factor the server refuses, saying whether signing is
  // configured: the screen sends the doctor to enable it (Codex 05/11 10:25, 1).
  if (result?.status === 403 && result.body.mfaRequired === true) {
    return { available: true, configured: result.body.configured === true, active: false, expiresAt: null, mfaRequired: true };
  }
  if (!result || result.status !== 200) return { available: false };
  const { body } = result;
  return {
    available: true,
    configured: body.configured === true,
    active: body.active === true,
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
  };
}

export type SessionStep = { ok: true; authorizeUrl: string } | { ok: false; message: string };

/** The PSC authorization page (https only) to open a session, or why not. */
export async function startSession(invoke: Invoke): Promise<SessionStep> {
  const raw = await invoke('signature-session/start', { method: 'POST' });
  const result = await answer(raw);
  if (!result) return { ok: false, message: await functionErrorMessage(raw.error, OFFLINE) };
  const url = result.body.authorizeUrl;
  if (result.status === 200 && typeof url === 'string') {
    try {
      if (new URL(url).protocol === 'https:') return { ok: true, authorizeUrl: url };
    } catch { /* falls through */ }
    return { ok: false, message: 'Endereço de autorização inválido.' };
  }
  return { ok: false, message: sessionMessage(result.body, 'Não foi possível abrir a sessão de assinatura.') };
}

/** Finishes the session with the code the PSC returned. */
export async function completeSession(invoke: Invoke, code: string, state: string): Promise<{ ok: true; expiresAt: string | null } | { ok: false; message: string }> {
  const raw = await invoke('signature-session/complete', { method: 'POST', body: { code, state } });
  const result = await answer(raw);
  if (!result) return { ok: false, message: await functionErrorMessage(raw.error, OFFLINE) };
  if (result.status === 200 && result.body.active === true) {
    return { ok: true, expiresAt: typeof result.body.expiresAt === 'string' ? result.body.expiresAt : null };
  }
  return { ok: false, message: sessionMessage(result.body, 'Não foi possível concluir a sessão de assinatura.') };
}

/** Ends the doctor's signature session (local revocation first). */
export async function revokeSession(invoke: Invoke): Promise<{ ok: boolean; message?: string }> {
  const raw = await invoke('signature-session/revoke', { method: 'POST' });
  const result = await answer(raw);
  if (!result) return { ok: false, message: await functionErrorMessage(raw.error, OFFLINE) };
  if (result.status === 200) return { ok: true };
  return { ok: false, message: text(result.body.error, 'Não foi possível encerrar a sessão de assinatura.') };
}

// ---------------------------------------------------------------------------
// Signing one document

export type SignOutcome =
  | { kind: 'completed' }
  /** Another request of this operation is still waiting for the PSC. */
  | { kind: 'in_progress' }
  /** The PSC did not answer: only an explicit "tentar de novo" resumes. */
  | { kind: 'ambiguous' }
  /** No usable signature session: open one, then sign again. */
  | { kind: 'needs_session'; message: string; ended: boolean }
  | { kind: 'needs_mfa'; message: string }
  | { kind: 'renew_login'; message: string; ended: boolean }
  /** Busy or unreachable: nothing changed, the same request may be repeated. */
  | { kind: 'retry_later'; message: string }
  /** Refused; `ended` when this operation is over (a new click starts another). */
  | { kind: 'refused'; message: string; ended: boolean };

const FAILED: Record<string, string> = {
  psc_rejected: 'O provedor do certificado recusou a assinatura.',
  certificate_changed: 'O certificado da sessão mudou. Abra uma nova sessão de assinatura.',
  certificate_expired: 'O certificado está vencido. Renove-o antes de assinar.',
  certificate_invalid: 'O certificado não pode assinar nesta versão.',
  original_changed: 'O documento mudou. Gere-o de novo antes de assinar.',
  document_changed: 'O documento mudou. Gere-o de novo antes de assinar.',
  invalid_signature: 'O provedor devolveu uma assinatura inválida. Nada foi publicado.',
  artifact_invalid: 'O provedor devolveu uma assinatura inválida. Nada foi publicado.',
  prepared_mismatch: 'A repetição não correspondeu ao documento preparado. Assine de novo.',
  storage_conflict: 'A assinatura não pôde ser guardada. Assine de novo.',
  stored_object_invalid: 'A assinatura não pôde ser guardada. Assine de novo.',
  stored_object_missing: 'A assinatura não pôde ser guardada. Assine de novo.',
  stored_expired: 'A assinatura guardada expirou antes de concluir. Assine de novo.',
  abandoned: 'A assinatura ficou parada e foi encerrada. Assine de novo.',
};
const ENDED = new Set(['failed', 'cancelled', 'cancelled_by_revocation']);

export interface SignRequest {
  prescriptionId: string;
  operationId: string;
  shownPdfSha256: string;
  /** Only from an explicit "tentar de novo" of the doctor after `ambiguous`. */
  humanRetry?: boolean;
}

export async function signPrescription(invoke: Invoke, request: SignRequest): Promise<SignOutcome> {
  const raw = await invoke('sign-document', {
    method: 'POST',
    body: {
      prescriptionId: request.prescriptionId,
      operationId: request.operationId,
      shownPdfSha256: request.shownPdfSha256,
      ...(request.humanRetry ? { humanRetry: true } : {}),
    },
  });
  const result = await answer(raw);
  if (!result) return { kind: 'retry_later', message: await functionErrorMessage(raw.error, OFFLINE) };
  const { status, body } = result;
  const outcome = typeof body.status === 'string' ? body.status : '';
  const code = typeof body.code === 'string' ? body.code : '';
  const ended = ENDED.has(outcome);
  if (status === 200 || status === 202) {
    if (outcome === 'completed') return { kind: 'completed' };
    if (outcome === 'ambiguous') return { kind: 'ambiguous' };
    return { kind: 'in_progress' };
  }
  if (status === 401) return { kind: 'renew_login', message: text(body.error, 'Sua sessão do Cortex terminou. Entre de novo.'), ended };
  if (status === 403 && body.mfaRequired === true) return { kind: 'needs_mfa', message: text(body.error, 'Confirme o segundo fator para assinar.') };
  if (status === 429) return { kind: 'needs_session', message: 'Muitas assinaturas em pouco tempo. A sessão de assinatura foi suspensa; abra outra.', ended: false };
  if (outcome === 'cancelled_by_revocation' || code === 'signature_session_ended') {
    return { kind: 'needs_session', message: 'A sessão de assinatura foi encerrada. Abra outra e assine de novo.', ended };
  }
  if (status === 503 && code === 'not_configured') return { kind: 'refused', message: 'A assinatura digital ainda não está configurada.', ended: false };
  if (status === 503 || status >= 500) return { kind: 'retry_later', message: text(body.error, 'Não foi possível assinar agora. Tente de novo.') };
  if (ended) return { kind: 'refused', message: FAILED[code] ?? 'A assinatura não foi concluída.', ended: true };
  return { kind: 'refused', message: text(body.error, 'Não foi possível assinar este documento.'), ended: false };
}

// ---------------------------------------------------------------------------
// The operation id of a document, kept on this device until the operation
// ends, so a repeated click or "tentar de novo" resumes the same operation
// (the server is idempotent per id). Only a random id: nothing clinical.

export interface PendingOperation { operationId: string; awaiting: 'in_progress' | 'ambiguous' | null }
const key = (userId: string, prescriptionId: string) => `cortex.signature.operation.${userId}.${prescriptionId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// This page's copy (Codex 05/11 10:25, 3): when the browser storage fails
// after an operation started, its retries in this page keep the same id.
const kept = new Map<string, PendingOperation>();

export function pendingOperation(userId: string, prescriptionId: string): PendingOperation | null {
  const k = key(userId, prescriptionId);
  const inPage = kept.get(k);
  if (inPage) return inPage;
  try {
    const value = JSON.parse(localStorage.getItem(k) ?? 'null') as PendingOperation | null;
    return value && typeof value.operationId === 'string' && UUID.test(value.operationId)
      && (value.awaiting === null || value.awaiting === 'in_progress' || value.awaiting === 'ambiguous') ? value : null;
  } catch {
    return null;
  }
}

/** Keeps the operation for this page and this browser; false when the browser could not store it. */
export function rememberOperation(userId: string, prescriptionId: string, value: PendingOperation): boolean {
  const k = key(userId, prescriptionId);
  kept.set(k, value);
  try {
    localStorage.setItem(k, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function forgetOperation(userId: string, prescriptionId: string): void {
  const k = key(userId, prescriptionId);
  kept.delete(k);
  try { localStorage.removeItem(k); } catch { /* nothing kept */ }
}

/**
 * Signs one document with the operation kept on this device: resumes the
 * pending one or starts a new one (kept before the request, so a closed tab
 * resumes it), then keeps it while the PSC answer is pending and forgets it
 * once the operation ended. The list and "Gerar e assinar" share this.
 */
export async function signKeepingOperation(
  invoke: Invoke,
  userId: string,
  document: { prescriptionId: string; pdfSha256: string },
  options: { humanRetry?: boolean } = {},
): Promise<SignOutcome> {
  const pending = pendingOperation(userId, document.prescriptionId);
  const operationId = pending?.operationId ?? crypto.randomUUID();
  const stored = rememberOperation(userId, document.prescriptionId, { operationId, awaiting: pending?.awaiting ?? null });
  // A new operation starts only once it is kept in this browser: otherwise a
  // closed tab would lose it and a retry would start another one, which the
  // server refuses while the first is open (Codex 05/11 10:25, 3).
  if (!pending && !stored) {
    forgetOperation(userId, document.prescriptionId);
    return {
      kind: 'refused', ended: false,
      message: 'Este navegador não conseguiu guardar a assinatura em andamento (armazenamento cheio ou bloqueado). Libere espaço ou saia da janela privada e assine de novo.',
    };
  }
  const outcome = await signPrescription(invoke, {
    prescriptionId: document.prescriptionId, operationId, shownPdfSha256: document.pdfSha256, humanRetry: options.humanRetry,
  });
  if (outcome.kind === 'completed' || ('ended' in outcome && outcome.ended)) forgetOperation(userId, document.prescriptionId);
  else if (outcome.kind === 'in_progress' || outcome.kind === 'ambiguous') rememberOperation(userId, document.prescriptionId, { operationId, awaiting: outcome.kind });
  return outcome;
}

/** What to tell the doctor about an outcome (toast). */
export function signatureNotice(outcome: SignOutcome): { title: string; description?: string; destructive?: boolean } {
  switch (outcome.kind) {
    case 'completed': return { title: 'Documento assinado digitalmente', description: 'A assinatura ICP-Brasil já vale na validação pública.' };
    case 'in_progress': return { title: 'Assinatura em andamento', description: 'Use "Verificar assinatura" na lista de documentos em instantes.' };
    case 'ambiguous': return { title: 'O provedor não respondeu', description: 'Nada foi publicado. Use "Tentar de novo" na lista de documentos quando quiser.' };
    default: return { title: 'Documento não assinado', description: outcome.message, destructive: true };
  }
}

/** Where to come back after the PSC authorization (same tab). */
export const RETURN_KEY = 'cortex.signature.return';
