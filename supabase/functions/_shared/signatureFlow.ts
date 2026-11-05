// One digital signature (D17), from the reservation to the commit point.
//
// Pure orchestration over injected ports, so the Edge Function only wires the
// service-role RPCs, Storage and the PSC client, and the tests drive every
// branch with a fake PSC and scripted database answers.
//
// Rules this module keeps (docs/prescriptions/ASSINATURA_DIGITAL.md):
// - no SQL transaction or lock is held across a network call: each step is
//   one short RPC;
// - an attempt in flight is never sent to the PSC again; after a lost answer
//   only an explicit human retry (same operation id) resumes, and RSA
//   PKCS#1 v1.5 makes that retry produce the same bytes;
// - every step after a PSC call names its attempt; the database refuses an
//   older attempt's late answer, timeout or failure (P4094);
// - a stored answer is resumed without the PSC or the session token;
// - nothing is published unless the final artifact passes verifyPadesArtifact;
// - a file is removed only for an operation the database marked
//   cleanup_pending (never a completed one).
//
// The caller (Edge Function) proves who the doctor is from the JWT, with MFA;
// nothing in a request body (userId, humanRetry) is taken as that proof.

import {
  certificateSummary, finalizePades, preparePades, sha256, signatureCertificates, verifyPadesArtifact, verifyRawSignature, type PadesOptions,
} from './pades.ts';
import { PscAmbiguousError, PscRejectedError, openSecret, tokenBinding, type PscCertificate, type SealedSecret } from './psc.ts';

export interface SignatureOperation {
  operation_id: string;
  user_id: string;
  prescription_id: string;
  session_id: string;
  session_generation: number;
  shown_pdf_sha256: string;
  cert_sha256: string;
  signing_time: string;
  state: 'reserved' | 'prepared' | 'psc_requested' | 'ambiguous' | 'stored' | 'completed' | 'failed' | 'cancelled' | 'cancelled_by_revocation';
  prepared_pdf_sha256: string | null;
  to_be_signed_sha256: string | null;
  policy_oid: string | null;
  psc_attempts: number;
  signed_pdf_sha256: string | null;
  cleanup_pending: boolean;
  error_code: string | null;
}

/** Error raised by a service-role RPC, with its SQLSTATE. */
export interface RpcError extends Error { code?: string }

export interface SignaturePorts {
  /** Service-role RPC; throws an RpcError carrying the SQLSTATE. The handler
   *  adds p_auth (the verified session context, never from the body) to the
   *  productive functions: reserve, session_token, advance and complete. */
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** The generated PDF the doctor saw (private bucket). */
  downloadOriginal(op: SignatureOperation): Promise<Uint8Array>;
  /** Upload without overwrite: 'exists' when the path is already taken. */
  uploadSigned(path: string, pdf: Uint8Array): Promise<'created' | 'exists'>;
  downloadSigned(path: string): Promise<Uint8Array | null>;
  removeSigned(path: string): Promise<void>;
  psc: {
    discovery(accessToken: string): Promise<PscCertificate[]>;
    sign(accessToken: string, p: { id: string; hash: Uint8Array; alias?: string }): Promise<Uint8Array>;
  };
  /** Server key list for the sealed session token (SIGNATURE_TOKEN_KEYS). */
  keys: { keys: Record<string, Uint8Array> };
  log?(event: string, detail: Record<string, unknown>): void;
  /** Pause between database retries after the PSC answered (default setTimeout). */
  sleep?(ms: number): Promise<void>;
}

export interface SignatureRequest {
  userId: string;
  operationId: string;
  prescriptionId: string;
  shownPdfSha256: string;
  /** A new explicit action of the doctor after an attempt without answer. */
  humanRetry?: boolean;
  policy: PadesOptions['policy'];
  health?: PadesOptions['health'];
  reason?: string;
}

export type SignatureOutcome =
  | { status: 'completed'; signedPath: string; signedSha256: string }
  | { status: 'rate_limited' }
  | { status: 'in_progress' }
  | { status: 'ambiguous' }
  | { status: 'failed' | 'cancelled' | 'cancelled_by_revocation'; code: string | null };

export const signedPathOf = (op: Pick<SignatureOperation, 'user_id' | 'prescription_id' | 'operation_id'>) =>
  `rx/${op.user_id}/${op.prescription_id}/signed-${op.operation_id}.pdf`;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const TERMINAL = new Set(['failed', 'cancelled', 'cancelled_by_revocation']);

export async function signDocument(ports: SignaturePorts, req: SignatureRequest): Promise<SignatureOutcome> {
  try {
    return await run(ports, req);
  } catch (error) {
    // A newer attempt of the same operation took over (P4094): this request
    // stops, the other one decides.
    if ((error as RpcError)?.code === 'P4094') return { status: 'in_progress' };
    throw error;
  }
}

async function run(ports: SignaturePorts, req: SignatureRequest): Promise<SignatureOutcome> {
  const log = ports.log ?? (() => {});
  const sleep = ports.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const base = { p_user: req.userId, p_operation: req.operationId };
  // Productive steps (prepared, psc_requested, stored) and closing steps
  // (ambiguous, failed, cancelled) are separate functions; only the
  // productive ones carry the verified session context, added by the handler.
  const advance = async (to: 'prepared' | 'psc_requested' | 'stored', data: Record<string, unknown> = {}) =>
    (await ports.rpc('signature_advance', { ...base, p_to: to, p_data: data })) as SignatureOperation;
  const close = async (to: 'ambiguous' | 'failed' | 'cancelled', data: Record<string, unknown> = {}) =>
    (await ports.rpc('signature_close', { ...base, p_to: to, p_data: data })) as SignatureOperation;
  // After the PSC answered, a busy row (40001, NOWAIT) must not cost another
  // PSC call: these idempotent database steps are retried a few times.
  const settled = async <T>(step: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await step();
      } catch (error) {
        if ((error as RpcError)?.code !== '40001' || attempt >= 4) throw error;
        await sleep(100 * attempt);
      }
    }
  };

  // Leaves an abandoned operation clean, then reports it. The database marks
  // the cleanup (cleanup_pending); Storage errors are left to the
  // reconciliation job (signature_pending_work).
  const finish = async (op: SignatureOperation): Promise<SignatureOutcome> => {
    if (op.state === 'completed') return { status: 'completed', signedPath: signedPathOf(op), signedSha256: op.signed_pdf_sha256 ?? '' };
    if (op.state === 'ambiguous') return { status: 'ambiguous' };
    if (op.cleanup_pending) {
      try {
        await ports.removeSigned(signedPathOf(op));
        await ports.rpc('signature_cleanup_done', base);
      } catch (error) {
        log('signature_cleanup_deferred', { operationId: op.operation_id, error: String((error as Error)?.message ?? error) });
      }
    }
    if (TERMINAL.has(op.state)) return { status: op.state as 'failed', code: op.error_code };
    return { status: 'in_progress' };
  };
  // Commit point: the database rechecks session, generation and document.
  const complete = async (certificate: Uint8Array) => {
    const summary = await certificateSummary(certificate);
    return finish(await settled(async () =>
      (await ports.rpc('signature_complete', { ...base, p_cert_serial: summary.serialHex, p_cert_issuer: summary.issuer })) as SignatureOperation));
  };
  const certificateOf = async (list: Uint8Array[], sha: string) => {
    for (const c of list) if (hex(await sha256(c)) === sha) return c;
    return undefined;
  };

  // 1. Reservation (idempotent per operation id).
  let op = (await ports.rpc('signature_reserve', { ...base, p_prescription: req.prescriptionId, p_shown_sha256: req.shownPdfSha256 })) as
    SignatureOperation | { error: 'rate_limited' };
  if ('error' in op) return { status: 'rate_limited' };
  if (op.state === 'completed' || TERMINAL.has(op.state)) return finish(op);

  if (op.state === 'stored') {
    // The answer is already stored: no PSC call and no session token. The
    // certificate comes from the stored file, whose hash the database holds,
    // and signature_complete decides (revocation and document changes win).
    const stored = await ports.downloadSigned(signedPathOf(op));
    const certificate = stored && hex(await sha256(stored)) === op.signed_pdf_sha256
      ? await certificateOf(signatureCertificates(stored), op.cert_sha256)
      : undefined;
    if (!certificate) return finish(await close('cancelled', { code: 'stored_object_invalid' }));
    return complete(certificate);
  }

  if (op.state === 'psc_requested') {
    // Another request may still be waiting for the PSC. Only the doctor
    // decides that it is lost; then that attempt is reconciled as ambiguous.
    if (!req.humanRetry) return { status: 'in_progress' };
    op = await close('ambiguous', { attempt: op.psc_attempts });
  }
  if (op.state === 'ambiguous' && !req.humanRetry) return { status: 'ambiguous' };
  // The attempt this request last saw; every step after a PSC call names it.
  let attempt = op.psc_attempts;
  const fail = async (code: string) => finish(await close('failed', { code, attempt }));

  // 2. Session token, sealed to this session, account and generation.
  let accessToken: string;
  try {
    const sealed = (await ports.rpc('signature_session_token', { p_user: req.userId, p_session: op.session_id, p_generation: op.session_generation })) as SealedSecret;
    accessToken = await openSecret(ports.keys, sealed, tokenBinding(op.session_id, req.userId, op.session_generation));
  } catch (error) {
    if ((error as RpcError)?.code !== 'P4031') throw error;
    // Revoked or expired: the next step's own check cancels the operation
    // (and schedules the cleanup when the PSC was ever called).
    return finish(await advance('prepared'));
  }

  let certificate: PscCertificate | undefined;
  for (const c of await ports.psc.discovery(accessToken)) {
    if (hex(await sha256(c.certificate)) === op.cert_sha256) { certificate = c; break; }
  }
  if (!certificate) return fail('certificate_changed');

  // 3. Preparation over the exact bytes the doctor saw.
  const original = await ports.downloadOriginal(op);
  if (hex(await sha256(original)) !== op.shown_pdf_sha256) return fail('original_changed');
  const prepared = await preparePades(original, {
    certificate: certificate.certificate,
    chain: certificate.chain,
    policy: req.policy,
    signingTime: new Date(op.signing_time),
    health: req.health,
    reason: req.reason,
  });
  const preparedSha256 = hex(await sha256(prepared.pdf));
  const toBeSignedSha256 = hex(prepared.toBeSignedHash);
  if (op.state === 'reserved') {
    op = await advance('prepared', { preparedSha256, toBeSignedSha256, policyOid: req.policy.oid });
    if (op.state !== 'prepared') return finish(op);
  } else if (op.prepared_pdf_sha256 !== preparedSha256 || op.to_be_signed_sha256 !== toBeSignedSha256 || op.policy_oid !== req.policy.oid) {
    return fail('prepared_mismatch'); // a retry must sign exactly the same bytes
  }

  // 4. One authorized PSC call, under its own attempt number.
  // The attempt observed when deciding: 0 from prepared, the unanswered one
  // from ambiguous. A newer attempt made meanwhile gets P4094 here.
  op = await advance('psc_requested', { toBeSignedSha256, humanRetry: op.state === 'ambiguous', attempt: op.psc_attempts });
  if (op.state !== 'psc_requested') return finish(op);
  attempt = op.psc_attempts;
  let signature: Uint8Array;
  try {
    signature = await ports.psc.sign(accessToken, { id: req.operationId, hash: prepared.toBeSignedHash, alias: certificate.alias || undefined });
  } catch (error) {
    if (error instanceof PscRejectedError) return fail('psc_rejected');
    // Lost answer or anything unknown: the PSC may have signed. Never retried here.
    log('signature_psc_ambiguous', { operationId: req.operationId, error: error instanceof PscAmbiguousError ? 'ambiguous' : 'unknown' });
    return finish(await close('ambiguous', { attempt }));
  }

  // 5. Checks before anything is published.
  if (!(await verifyRawSignature(certificate.certificate, prepared.signedAttributes, signature))) return fail('invalid_signature');
  const signed = finalizePades(prepared, signature);
  const problem = await verifyPadesArtifact(signed, prepared);
  if (problem) {
    log('signature_artifact_refused', { operationId: req.operationId, problem });
    return fail('artifact_invalid');
  }

  // 6. Upload without overwrite. An object already there (another attempt of
  // this same operation) is kept only if it is exactly a valid signature of
  // these prepared bytes by the same certificate.
  const path = signedPathOf(op);
  let signedSha256 = hex(await sha256(signed));
  let placed: 'created' | 'exists';
  try {
    placed = await ports.uploadSigned(path, signed);
  } catch {
    // Refused (the operation moved on) or lost in transit: the answer is not
    // stored, so this attempt is reconciled as without answer. An older
    // attempt gets P4094 instead and never ends the newer one.
    log('signature_upload_failed', { operationId: req.operationId, attempt });
    return finish(await close('ambiguous', { attempt }));
  }
  if (placed === 'exists') {
    const existing = await ports.downloadSigned(path);
    const existingSha256 = existing ? hex(await sha256(existing)) : '';
    if (!existing || (existingSha256 !== signedSha256 && (await verifyPadesArtifact(existing, prepared)) !== null)) return fail('storage_conflict');
    signedSha256 = existingSha256;
  }
  op = await settled(() => advance('stored', { stagedPath: path, signedSha256, attempt }));
  if (op.state !== 'stored') return finish(op);

  // 7. Commit point.
  return complete(certificate.certificate);
}
