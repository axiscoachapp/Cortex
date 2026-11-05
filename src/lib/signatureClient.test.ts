// Client of the digital signature functions: every server answer mapped to
// what the screen shows. supabase.functions.invoke is simulated with the
// same shapes it returns (data, or a FunctionsHttpError whose context is the
// Response). Synthetic ids only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeSession, forgetOperation, pendingOperation, rememberOperation, revokeSession, sessionState, signKeepingOperation, signPrescription, startSession,
  type Invoke,
} from './signatureClient';

const RX = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const HASH = 'a'.repeat(64);

const ok = (data: unknown): Invoke => vi.fn(async () => ({ data, error: null }));
const http = (status: number, body: unknown): Invoke => vi.fn(async () => ({
  data: null,
  error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  }),
}));
const offline: Invoke = vi.fn(async () => ({ data: null, error: new Error('Failed to send a request to the Edge Function') }));
const sign = (invoke: Invoke, humanRetry = false) =>
  signPrescription(invoke, { prescriptionId: RX, operationId: OP, shownPdfSha256: HASH, humanRetry });

describe('signPrescription', () => {
  it('sends exactly the four fields, humanRetry only when asked', async () => {
    const invoke = ok({ status: 'completed', signedPath: 'x' });
    await sign(invoke);
    await sign(invoke, true);
    expect(invoke).toHaveBeenNthCalledWith(1, 'sign-document', { method: 'POST', body: { prescriptionId: RX, operationId: OP, shownPdfSha256: HASH } });
    expect(invoke).toHaveBeenNthCalledWith(2, 'sign-document', { method: 'POST', body: { prescriptionId: RX, operationId: OP, shownPdfSha256: HASH, humanRetry: true } });
  });

  it('maps every answer of the handler', async () => {
    const table: Array<[Invoke, Record<string, unknown>]> = [
      [ok({ status: 'completed', signedPath: 'x' }), { kind: 'completed' }],
      [ok({ status: 'in_progress' }), { kind: 'in_progress' }],
      [ok({ status: 'ambiguous' }), { kind: 'ambiguous' }],
      [http(409, { status: 'failed', code: 'psc_rejected' }), { kind: 'refused', ended: true, message: 'O provedor do certificado recusou a assinatura.' }],
      [http(409, { status: 'failed', code: 'certificate_expired' }), { kind: 'refused', ended: true, message: 'O certificado está vencido. Renove-o antes de assinar.' }],
      [http(409, { status: 'cancelled', code: 'document_changed' }), { kind: 'refused', ended: true, message: 'O documento mudou. Gere-o de novo antes de assinar.' }],
      [http(409, { status: 'failed', code: 'unknown_code' }), { kind: 'refused', ended: true, message: 'A assinatura não foi concluída.' }],
      [http(409, { status: 'cancelled_by_revocation', code: null }), { kind: 'needs_session', ended: true }],
      [http(409, { error: 'Sessão de assinatura encerrada.', code: 'signature_session_ended' }), { kind: 'needs_session', ended: false }],
      [http(409, { error: 'Há uma assinatura em andamento ou sem resposta para este documento.', code: 'not_ready' }),
        { kind: 'refused', ended: false, message: 'Há uma assinatura em andamento ou sem resposta para este documento.' }],
      [http(401, { status: 'cancelled', code: 'auth_session_ended', error: 'Sua sessão do Cortex terminou. Entre de novo.' }), { kind: 'renew_login', ended: true }],
      [http(401, { error: 'Sua sessão vai expirar. Entre de novo antes de assinar.', code: 'renew_session' }), { kind: 'renew_login', ended: false }],
      [http(403, { error: 'Confirme o segundo fator para continuar.', mfaRequired: true }), { kind: 'needs_mfa' }],
      [http(403, { error: 'Documento indisponível.' }), { kind: 'refused', ended: false, message: 'Documento indisponível.' }],
      [http(429, { status: 'rate_limited' }), { kind: 'needs_session', ended: false }],
      [http(503, { error: 'Assinatura digital ainda não configurada.', code: 'not_configured' }), { kind: 'refused', ended: false }],
      [http(503, { error: 'Em uso por outra operação. Tente de novo.' }), { kind: 'retry_later', message: 'Em uso por outra operação. Tente de novo.' }],
      [http(500, { error: 'Não foi possível assinar agora.' }), { kind: 'retry_later' }],
      [offline, { kind: 'retry_later', message: 'Sem conexão com o servidor. Verifique a internet e tente novamente.' }],
    ];
    for (const [invoke, expected] of table) expect(await sign(invoke)).toMatchObject(expected);
  });
});

describe('signature session', () => {
  it('reads the state, configured or not; unreachable functions are unavailable', async () => {
    expect(await sessionState(ok({ active: true, expiresAt: '2026-11-05T21:00:00Z', psc: 'vidaas', configured: true })))
      .toEqual({ available: true, configured: true, active: true, expiresAt: '2026-11-05T21:00:00Z' });
    expect(await sessionState(ok({ active: false, configured: false }))).toEqual({ available: true, configured: false, active: false, expiresAt: null });
    expect(await sessionState(http(404, { error: 'not found' }))).toEqual({ available: false });
    // Without the second factor: shown with the way to enable it (Codex 10:25, 1).
    expect(await sessionState(http(403, { error: 'Confirme o segundo fator para continuar.', mfaRequired: true, configured: true })))
      .toEqual({ available: true, configured: true, active: false, expiresAt: null, mfaRequired: true });
    expect(await sessionState(http(403, { mfaRequired: true }))).toMatchObject({ available: true, configured: false, mfaRequired: true });
    expect(await sessionState(offline)).toEqual({ available: false });
  });

  it('start follows only an https authorization page; refusals keep the server message', async () => {
    expect(await startSession(ok({ authorizeUrl: 'https://psc.synthetic.invalid/oauth/authorize?state=x' })))
      .toEqual({ ok: true, authorizeUrl: 'https://psc.synthetic.invalid/oauth/authorize?state=x' });
    expect(await startSession(ok({ authorizeUrl: 'javascript:alert(1)' }))).toMatchObject({ ok: false });
    expect(await startSession(ok({ authorizeUrl: 'http://psc.synthetic.invalid/' }))).toMatchObject({ ok: false });
    expect(await startSession(http(409, { error: 'Informe o seu CPF em Configurações para assinar.', code: 'cpf_missing' })))
      .toEqual({ ok: false, message: 'Informe o seu CPF em Configurações para assinar.' });
    expect(await startSession(offline)).toMatchObject({ ok: false, message: expect.stringContaining('Sem conexão') });
  });

  it('complete sends the code and state; certificate and CPF refusals keep their message', async () => {
    const invoke = ok({ active: true, expiresAt: '2026-11-05T21:00:00Z' });
    expect(await completeSession(invoke, 'synthetic-code', 'synthetic-state')).toEqual({ ok: true, expiresAt: '2026-11-05T21:00:00Z' });
    expect(invoke).toHaveBeenCalledWith('signature-session/complete', { method: 'POST', body: { code: 'synthetic-code', state: 'synthetic-state' } });
    expect(await completeSession(http(409, { error: 'O certificado está vencido. Renove-o antes de assinar.', code: 'certificate_expired' }), 'c', 's'))
      .toEqual({ ok: false, message: 'O certificado está vencido. Renove-o antes de assinar.' });
    expect(await completeSession(http(403, { error: 'O certificado autorizado não é do CPF cadastrado em Configurações.', code: 'cpf_mismatch' }), 'c', 's'))
      .toMatchObject({ ok: false, message: expect.stringContaining('CPF') });
  });

  it('revoke', async () => {
    expect(await revokeSession(ok({ revoked: true }))).toEqual({ ok: true });
    expect(await revokeSession(http(500, {}))).toMatchObject({ ok: false });
  });
});

describe('operation kept per document', () => {
  beforeEach(() => { forgetOperation('u', RX); localStorage.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it('never starts an operation this browser could not keep (Codex 10:25, 3)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const invoke = ok({ status: 'completed' });
    const outcome = await signKeepingOperation(invoke, 'u', { prescriptionId: RX, pdfSha256: HASH });
    expect(outcome).toMatchObject({ kind: 'refused', ended: false, message: expect.stringContaining('não conseguiu guardar') });
    expect(invoke).not.toHaveBeenCalled();
    expect(pendingOperation('u', RX)).toBeNull();
  });

  it('once started, a storage failure keeps the same id for the retries of this page', async () => {
    const first = vi.fn(async () => ({ data: { status: 'in_progress' }, error: null }));
    await signKeepingOperation(first, 'u', { prescriptionId: RX, pdfSha256: HASH }); // stored durably, then in progress
    const started = (first.mock.calls[0] as unknown as [string, { body: { operationId: string } }])[1].body.operationId;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const again = vi.fn(async () => ({ data: { status: 'in_progress' }, error: null }));
    await signKeepingOperation(again, 'u', { prescriptionId: RX, pdfSha256: HASH });
    await signKeepingOperation(again, 'u', { prescriptionId: RX, pdfSha256: HASH }, { humanRetry: true });
    const ids = again.mock.calls.map((call) => (call as unknown as [string, { body: { operationId: string; humanRetry?: boolean } }])[1].body);
    expect(ids.map((b) => b.operationId)).toEqual([started, started]);
    expect(ids[1].humanRetry).toBe(true);
    expect(pendingOperation('u', RX)).toEqual({ operationId: started, awaiting: 'in_progress' });
  });

  it('remembers, reads back and forgets; anything malformed reads as none', () => {
    expect(pendingOperation('u', RX)).toBeNull();
    rememberOperation('u', RX, { operationId: OP, awaiting: 'ambiguous' });
    expect(pendingOperation('u', RX)).toEqual({ operationId: OP, awaiting: 'ambiguous' });
    expect(pendingOperation('other-user', RX)).toBeNull();
    forgetOperation('u', RX);
    expect(pendingOperation('u', RX)).toBeNull();
    for (const raw of ['not json', JSON.stringify({ operationId: 'x', awaiting: null }), JSON.stringify({ operationId: OP, awaiting: 'done' })]) {
      localStorage.setItem(`cortex.signature.operation.u.${RX}`, raw);
      expect(pendingOperation('u', RX)).toBeNull();
    }
  });
});
