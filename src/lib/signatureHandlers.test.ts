// Edge handlers of the digital signature (D17) with injected dependencies.
// Synthetic only: the PSC, Storage and database are fakes; no real provider,
// certificate or deploy.
import { StorageClient } from '@supabase/storage-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AD_RB_V1_1, sha256 } from '../../supabase/functions/_shared/pades';
import { base64url, openSecret, parseKeyList, tokenBinding, verifierBinding, type SealedSecret } from '../../supabase/functions/_shared/psc';
import {
  readSignatureConfig, signDocumentHandler, signatureSessionHandler, storageAdapter, storageErrorKind, type HandlerDeps, type SignerContext,
} from '../../supabase/functions/_shared/signatureHandlers';
import type { SignatureOutcome, SignaturePorts, SignatureRequest } from '../../supabase/functions/_shared/signatureFlow';
import { RSA, syntheticCertificate } from '../test/syntheticPki';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const RX = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-11-05T12:00:00Z');
const keys = parseKeyList(`k1:${Buffer.from(new Uint8Array(32).fill(5)).toString('base64')}`);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// Synthetic signer certificates (valid at NOW, and one expired by then).
let validCert: Uint8Array;
let expiredCert: Uint8Array;
beforeAll(async () => {
  const ca = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  const doctor = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  validCert = await syntheticCertificate('Médica Sintética', 'AC Sintética', doctor, ca.privateKey, 11,
    { notBefore: new Date('2026-01-01T00:00:00Z'), notAfter: new Date(Date.now() + 365 * 86400_000) });
  expiredCert = await syntheticCertificate('Médica Sintética', 'AC Sintética', doctor, ca.privateKey, 12,
    { notBefore: new Date('2025-01-01T00:00:00Z'), notAfter: new Date('2026-11-01T00:00:00Z') });
}, 30_000);

class FakeAuthError extends Error {}
const rpcError = (code: string, message = code) => Object.assign(new Error(message), { code });

function makeDeps(over: Partial<HandlerDeps> & { ctx?: Partial<SignerContext>; answers?: Record<string, unknown> } = {}) {
  const ctx: SignerContext = { userId: USER, sessionId: SESSION, aal: 'aal2', exp: NOW / 1000 + 3600, ...over.ctx };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const answers: Record<string, unknown> = { signature_session_state: { active: true }, signature_revoke_session: 1, ...over.answers };
  const deps: HandlerDeps = {
    authenticate: async () => ctx,
    authFailure: (e) => (e instanceof FakeAuthError ? new Response(JSON.stringify({ error: 'Sessão inválida' }), { status: 401 }) : null),
    config: {
      psc: { id: 'vidaas', baseUrl: 'https://psc.synthetic.invalid/', clientId: 'cortex-test', clientSecret: 'synthetic', redirectUri: 'https://cortex.synthetic.invalid/assinatura/retorno' },
      keys,
      policy: { oid: AD_RB_V1_1, hash: new Uint8Array(32).fill(7), uri: 'http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der' },
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      const answer = answers[name];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? (answer as (a: Record<string, unknown>) => unknown)(args) : answer;
    }),
    storage: { download: vi.fn(async () => new Uint8Array([1])), upload: vi.fn(async () => 'created' as const), remove: vi.fn(async () => {}) },
    psc: {
      exchangeCode: vi.fn(async () => ({ accessToken: 'synthetic-psc-token', expiresAt: new Date(NOW + 13 * 3600_000), authorizedCpf: '52998224725' })),
      discovery: vi.fn(async () => [{ alias: 'a', certificate: validCert, chain: [] }]),
      sign: vi.fn(async () => new Uint8Array([1])),
    },
    prescription: vi.fn(async () => ({ doc_type: 'receita_simples', crm: '00000', uf: 'PR', specialty: 'Ginecologia e Obstetrícia' })),
    prescriberCpf: vi.fn(async () => '529.982.247-25'),
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    now: () => NOW,
    sign: vi.fn(async () => ({ status: 'completed', signedPath: `rx/${USER}/${RX}/signed-${OP}.pdf`, signedSha256: 'f'.repeat(64) }) as SignatureOutcome),
    ...over,
  };
  return { deps, calls, ctx };
}

const post = (body: unknown, path = 'https://edge.invalid/functions/v1/sign-document') =>
  new Request(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Authorization: 'Bearer synthetic' } });
const signBody = { prescriptionId: RX, operationId: OP, shownPdfSha256: 'a'.repeat(64) };

describe('sign-document handler', () => {
  it('signs with the verified context only, never the body, and answers the completed path', async () => {
    const { deps } = makeDeps();
    const response = await signDocumentHandler(post({ ...signBody, humanRetry: true }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'completed', signedPath: `rx/${USER}/${RX}/signed-${OP}.pdf` });
    const [, request] = (deps.sign as ReturnType<typeof vi.fn>).mock.calls[0] as [SignaturePorts, SignatureRequest];
    expect(request).toMatchObject({
      userId: USER, operationId: OP, prescriptionId: RX, shownPdfSha256: 'a'.repeat(64), humanRetry: true,
      health: { crm: '00000', uf: 'PR', documentType: 'prescricao' }, reason: 'Prescrição médica',
    });
    expect(request.policy.oid).toBe(AD_RB_V1_1);
    expect(deps.prescription).toHaveBeenCalledWith(USER, RX);
  });

  it('adds p_auth from the verified context to the productive functions only', async () => {
    const { deps, calls, ctx } = makeDeps({
      sign: vi.fn(async (ports: SignaturePorts) => {
        await ports.rpc('signature_reserve', { p_user: USER });
        await ports.rpc('signature_session_token', { p_user: USER });
        await ports.rpc('signature_advance', { p_user: USER });
        await ports.rpc('signature_complete', { p_user: USER });
        await ports.rpc('signature_close', { p_user: USER });
        await ports.rpc('signature_cleanup_done', { p_user: USER });
        await ports.downloadOriginal({ user_id: USER, prescription_id: RX } as never);
        return { status: 'in_progress' } as SignatureOutcome;
      }),
    });
    const response = await signDocumentHandler(post(signBody), deps);
    expect(response.status).toBe(202);
    const auth = { sessionId: ctx.sessionId, aal: 'aal2', exp: ctx.exp };
    expect(Object.fromEntries(calls.map(([name, args]) => [name, args.p_auth ?? null]))).toEqual({
      signature_reserve: auth, signature_session_token: auth, signature_advance: auth, signature_complete: auth,
      signature_close: null, signature_cleanup_done: null,
    });
    expect(deps.storage.download).toHaveBeenCalledWith(`rx/${USER}/${RX}.pdf`);
  });

  it('refuses before any RPC: wrong method, no session, aal1, token about to expire, not configured', async () => {
    const cases: Array<[Response | Promise<Response>, number, Record<string, unknown>?]> = [];
    let x = makeDeps();
    cases.push([signDocumentHandler(new Request('https://edge.invalid/x', { method: 'GET' }), x.deps), 405]);
    x = makeDeps({ authenticate: async () => { throw new FakeAuthError(); } });
    cases.push([signDocumentHandler(post(signBody), x.deps), 401]);
    x = makeDeps({ ctx: { aal: 'aal1' } });
    cases.push([signDocumentHandler(post(signBody), x.deps), 403, { mfaRequired: true }]);
    x = makeDeps({ ctx: { exp: NOW / 1000 + 60 } });
    cases.push([signDocumentHandler(post(signBody), x.deps), 401, { code: 'renew_session' }]);
    x = makeDeps({ config: null });
    cases.push([signDocumentHandler(post(signBody), x.deps), 503, { code: 'not_configured' }]);
    for (const [pending, status, body] of cases) {
      const response = await pending;
      expect(response.status).toBe(status);
      if (body) expect(await response.json()).toMatchObject(body);
    }
  });

  it('accepts only the four fields, in their formats', async () => {
    for (const body of [
      { ...signBody, userId: USER },
      { ...signBody, prescriptionId: 'x' },
      { ...signBody, operationId: '' },
      { ...signBody, shownPdfSha256: 'A'.repeat(64) },
      { ...signBody, humanRetry: 'yes' },
      '[1]',
      'not json',
    ]) {
      const { deps } = makeDeps();
      const response = await signDocumentHandler(post(body), deps);
      expect(response.status).toBe(400);
      expect(deps.rpc).not.toHaveBeenCalled();
      expect(deps.sign).not.toHaveBeenCalled();
    }
  });

  it('maps each outcome to its HTTP answer', async () => {
    const table: Array<[SignatureOutcome, number, Record<string, unknown>]> = [
      [{ status: 'ambiguous' }, 202, { status: 'ambiguous' }],
      [{ status: 'in_progress' }, 202, { status: 'in_progress' }],
      [{ status: 'rate_limited' }, 429, { status: 'rate_limited' }],
      [{ status: 'failed', code: 'psc_rejected' }, 409, { status: 'failed', code: 'psc_rejected' }],
      [{ status: 'cancelled_by_revocation', code: null }, 409, { status: 'cancelled_by_revocation' }],
      [{ status: 'cancelled', code: 'auth_session_ended' }, 401, { status: 'cancelled', code: 'auth_session_ended' }],
    ];
    for (const [outcome, status, body] of table) {
      const { deps } = makeDeps({ sign: vi.fn(async () => outcome) });
      const response = await signDocumentHandler(post(signBody), deps);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject(body);
    }
  });

  it('maps database refusals and never leaks an unexpected error', async () => {
    const table: Array<[Error, number, string?]> = [
      [rpcError('40001'), 503],
      [rpcError('P4011'), 401],
      [rpcError('P4031'), 409],
      [rpcError('P4093', 'O documento mudou depois de mostrado. Abra de novo antes de assinar.'), 409, 'O documento mudou'],
      [rpcError('P4094'), 202],
      [rpcError('42501'), 403],
      [rpcError('22023'), 400],
      [new Error('connection string postgres://secret@host'), 500],
    ];
    for (const [error, status, text] of table) {
      const { deps } = makeDeps({ sign: vi.fn(async () => { throw error; }) });
      const response = await signDocumentHandler(post(signBody), deps);
      expect(response.status).toBe(status);
      const raw = await response.text();
      if (text) expect(raw).toContain(text);
      expect(raw).not.toContain('secret@host');
      if (status === 503) expect(response.headers.get('Retry-After')).toBe('1');
    }
  });

  it('refuses a document of another doctor and a type not signed in Phase 1', async () => {
    let { deps } = makeDeps({ prescription: vi.fn(async () => null) });
    expect((await signDocumentHandler(post(signBody), deps)).status).toBe(403);
    ({ deps } = makeDeps({ prescription: vi.fn(async () => ({ doc_type: 'receita_antimicrobiano', crm: '1', uf: 'PR' })) }));
    expect((await signDocumentHandler(post(signBody), deps)).status).toBe(409);
    expect(deps.sign).not.toHaveBeenCalled();
  });
});

describe('signature-session handler', () => {
  const url = (route: string) => `https://edge.invalid/functions/v1/signature-session/${route}`;
  const req = (route: string, method = 'POST', body?: unknown) =>
    new Request(url(route), { method, headers: { Authorization: 'Bearer synthetic' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it('routes only start, complete, revoke and state, each with its method', async () => {
    const { deps } = makeDeps();
    expect((await signatureSessionHandler(req('other'), deps)).status).toBe(404);
    expect((await signatureSessionHandler(req('start', 'GET'), deps)).status).toBe(405);
    expect((await signatureSessionHandler(req('state', 'POST'), deps)).status).toBe(405);
  });

  it('state and revoke need AAL2, as every route (Codex 05/11 05:09, R3), but not the token margin', async () => {
    const low = makeDeps({ ctx: { aal: 'aal1' } });
    for (const [route, method] of [['state', 'GET'], ['revoke', 'POST']]) {
      const response = await signatureSessionHandler(req(route, method), low.deps);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ mfaRequired: true });
    }
    expect(low.deps.rpc).not.toHaveBeenCalled();
    const { deps, calls } = makeDeps({ ctx: { exp: NOW / 1000 + 60 } });
    expect(await (await signatureSessionHandler(req('state', 'GET'), deps)).json()).toEqual({ active: true });
    expect(await (await signatureSessionHandler(req('revoke'), deps)).json()).toEqual({ revoked: true });
    expect(calls.map(([name, args]) => [name, args])).toEqual([
      ['signature_session_state', { p_user: USER }], ['signature_revoke_session', { p_user: USER }],
    ]);
  });

  it('start seals the PKCE verifier to this state, account and PSC, and returns the PSC authorization URL', async () => {
    const { deps, calls, ctx } = makeDeps();
    const response = await signatureSessionHandler(req('start'), deps);
    expect(response.status).toBe(200);
    const { authorizeUrl } = await response.json();
    const target = new URL(authorizeUrl);
    expect(target.origin + target.pathname).toBe('https://psc.synthetic.invalid/oauth/authorize');
    expect(target.searchParams.get('login_hint')).toBe('52998224725');
    expect(target.searchParams.get('lifetime')).toBe(String(12 * 3600));
    const state = target.searchParams.get('state')!;
    const [name, args] = calls[0];
    expect(name).toBe('signature_begin_authorization');
    expect(args.p_auth).toEqual({ sessionId: ctx.sessionId, aal: 'aal2', exp: ctx.exp });
    expect(args.p_state_hash).toBe(hex(await sha256(new TextEncoder().encode(state))));
    const sealed = args.p_verifier as SealedSecret;
    expect(JSON.stringify(sealed)).not.toContain(target.searchParams.get('code_challenge'));
    const verifier = await openSecret(keys, sealed, verifierBinding(args.p_state_hash as string, USER, 'vidaas'));
    expect(base64url(await sha256(new TextEncoder().encode(verifier)))).toBe(target.searchParams.get('code_challenge'));
  });

  it('start needs AAL2 and the prescriber CPF', async () => {
    expect((await signatureSessionHandler(req('start'), makeDeps({ ctx: { aal: 'aal1' } }).deps)).status).toBe(403);
    const { deps } = makeDeps({ prescriberCpf: vi.fn(async () => null) });
    expect((await signatureSessionHandler(req('start'), deps)).status).toBe(409);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  async function started() {
    const made = makeDeps();
    const start = await signatureSessionHandler(req('start'), made.deps);
    const state = new URL((await start.json()).authorizeUrl).searchParams.get('state')!;
    const sealed = made.calls[0][1].p_verifier;
    return { ...made, state, sealed };
  }

  it('complete consumes the state, checks the CPF, seals the PSC token and activates the session', async () => {
    const { deps, calls, state, sealed } = await started();
    (deps.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return name === 'signature_consume_authorization' ? sealed : { sessionId: args.p_session };
    });
    const response = await signatureSessionHandler(req('complete', 'POST', { code: 'synthetic-code', state }), deps);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('synthetic-psc-token');
    expect(JSON.parse(text)).toMatchObject({ active: true });
    const consume = calls.find(([n]) => n === 'signature_consume_authorization')![1];
    const activate = calls.find(([n]) => n === 'signature_activate_session')![1];
    expect(consume.p_state_hash).toBe(hex(await sha256(new TextEncoder().encode(state))));
    expect(deps.psc.exchangeCode).toHaveBeenCalledWith(deps.config!.psc, expect.objectContaining({ code: 'synthetic-code' }));
    expect(activate.p_cert_sha256).toBe(hex(await sha256(validCert)));
    expect(await openSecret(keys, activate.p_token as SealedSecret, tokenBinding(activate.p_session as string, USER, 1))).toBe('synthetic-psc-token');
    expect(Date.parse(activate.p_expires_at as string)).toBeLessThanOrEqual(NOW + 12 * 3600_000);
    expect(activate.p_auth).toMatchObject({ sessionId: SESSION, aal: 'aal2' });
  });

  it('complete activates only a certificate that can sign (Codex 05/11 05:09, R2)', async () => {
    const table: Array<[() => Array<{ alias: string; certificate: Uint8Array; chain: Uint8Array[] }>, number, string?]> = [
      [() => [], 409, 'no_certificate'],
      [() => [{ alias: 'a', certificate: new Uint8Array(0), chain: [] }], 409, 'certificate_invalid'],
      [() => [{ alias: 'a', certificate: Uint8Array.of(9, 9, 9), chain: [] }], 409, 'certificate_invalid'],
      [() => [{ alias: 'a', certificate: expiredCert, chain: [] }], 409, 'certificate_expired'],
      [() => [{ alias: 'a', certificate: new Uint8Array(0), chain: [] }, { alias: 'b', certificate: validCert, chain: [] }], 200],
    ];
    for (const [certificates, status, code] of table) {
      const { deps, calls, state, sealed } = await started();
      (deps.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        return name === 'signature_consume_authorization' ? sealed : { sessionId: args.p_session };
      });
      (deps.psc.discovery as ReturnType<typeof vi.fn>).mockResolvedValue(certificates());
      const response = await signatureSessionHandler(req('complete', 'POST', { code: 'synthetic-code', state }), deps);
      expect(response.status).toBe(status);
      const activate = calls.find(([n]) => n === 'signature_activate_session');
      if (code) {
        expect(await response.json()).toMatchObject({ code });
        expect(activate).toBeUndefined();
      } else {
        expect(activate![1].p_cert_sha256).toBe(hex(await sha256(validCert)));
      }
    }
  });

  it('complete refuses another CPF without activating anything', async () => {
    const { deps, calls, state, sealed } = await started();
    (deps.psc.exchangeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 't', expiresAt: new Date(NOW + 3600_000), authorizedCpf: '11144477735' });
    (deps.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return sealed; });
    const response = await signatureSessionHandler(req('complete', 'POST', { code: 'c', state }), deps);
    expect(response.status).toBe(403);
    expect(calls.some(([n]) => n === 'signature_activate_session')).toBe(false);
  });

  it('complete validates the body, maps a used state and a PSC refusal', async () => {
    const { deps } = makeDeps();
    for (const body of [{ code: 'c' }, { code: 'c', state: 'short' }, { code: 'a b', state: 'x'.repeat(43) }, { code: 'c', state: 'x'.repeat(43), extra: 1 }]) {
      expect((await signatureSessionHandler(req('complete', 'POST', body), deps)).status).toBe(400);
    }
    expect(deps.rpc).not.toHaveBeenCalled();
    const used = makeDeps({ answers: { signature_consume_authorization: rpcError('P4031') } });
    expect((await signatureSessionHandler(req('complete', 'POST', { code: 'c', state: 'x'.repeat(43) }), used.deps)).status).toBe(409);
    const { deps: d2, calls, state, sealed } = await started();
    (d2.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return sealed; });
    (d2.psc.exchangeCode as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('recusado'), { name: 'PscRejectedError', status: 400 }));
    expect((await signatureSessionHandler(req('complete', 'POST', { code: 'c', state }), d2)).status).toBe(502);
  });
});

describe('Storage errors (Codex 05/11 05:09, R4)', () => {
  const api = (status: number, statusCode: string, message: string) => Object.assign(new Error(message), { name: 'StorageApiError', status, statusCode });
  it('only the structured status says absent or already there; any other error is unavailable', async () => {
    const table: Array<[unknown, ReturnType<typeof storageErrorKind>]> = [
      [api(404, '404', 'Object not found'), 'not_found'],
      [api(400, '404', 'Object not found'), 'not_found'], // older Storage: HTTP 400, body statusCode 404
      [api(409, '409', 'The resource already exists'), 'exists'],
      [api(400, '409', 'Duplicate'), 'exists'],
      [api(500, '500', 'Upstream object route not found'), 'unavailable'],
      [api(503, '503', 'Service unavailable'), 'unavailable'],
      [api(500, '404', 'Object not found'), 'unavailable'],
      [api(502, '409', 'already exists'), 'unavailable'],
      [api(403, '403', 'not found'), 'unavailable'],
      [Object.assign(new Error('not found'), { name: 'StorageUnknownError' }), 'unavailable'],
      [{ statusCode: '404', message: 'Object not found' }, 'unavailable'], // no HTTP status: not structural
      [new Error('fetch failed: object not found'), 'unavailable'],
      [null, 'unavailable'],
    ];
    for (const [error, kind] of table) expect([error, await storageErrorKind(error)]).toEqual([error, kind]);
  });
});

describe('Storage adapter over the real storage-js client, fetch in memory (Codex 05/11 06:35, R4)', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notFound = { statusCode: '404', error: 'not_found', message: 'Object not found' };
  /** A bucket whose every request gets `answer`; network failures are thrown by `answer`. */
  function bucket(answer: () => Response | Promise<Response>) {
    const requests: string[] = [];
    const fetchFake = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
      return answer();
    };
    const client = new StorageClient('https://storage.synthetic.invalid/storage/v1', {}, fetchFake as typeof fetch);
    return { storage: storageAdapter(client.from('prescriptions')), requests };
  }
  const path = `rx/${USER}/${RX}/signed-${OP}.pdf`;

  it('download: only a structured 404 is absent (HTTP 404, or the older 400, with statusCode 404 in the body)', async () => {
    const ok = bucket(() => new Response(Uint8Array.of(37, 80, 68, 70), { status: 200 }));
    expect(await ok.storage.download(path)).toEqual(Uint8Array.of(37, 80, 68, 70));
    expect(ok.requests).toEqual([`GET /storage/v1/object/prescriptions/${path}`]);
    expect(await bucket(() => json(404, notFound)).storage.download(path)).toBeNull();
    expect(await bucket(() => json(400, notFound)).storage.download(path)).toBeNull();
  });

  it('download: anything else throws, whatever its text', async () => {
    const answers: Array<() => Response | Promise<Response>> = [
      () => json(500, { statusCode: '500', error: 'internal', message: 'Upstream object route not found' }),
      () => json(500, notFound), // the body says 404, the answer is 500
      () => json(503, { statusCode: '503', message: 'Service unavailable' }),
      () => new Response('<html>Not Found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
      () => json(404, { message: 'no Route matched with those values' }), // a gateway, not Storage
      () => json(404, { statusCode: '400', error: 'invalid', message: 'not found' }),
      () => json(400, { statusCode: '400', error: 'InvalidRequest', message: 'Object not found' }),
      () => json(404, { ...notFound, padding: 'x'.repeat(5000) }), // over the 4 KiB read
      () => json(404, [notFound]),
      () => json(409, notFound), // statusCode 404 under another HTTP status
      () => { throw new TypeError('fetch failed'); },
    ];
    for (const answer of answers) {
      await expect(bucket(answer).storage.download(path)).rejects.toThrow('Storage indisponível');
    }
  });

  it('upload: only a structured 409 is already there; anything else throws', async () => {
    expect(await bucket(() => json(200, { Key: `prescriptions/${path}`, Id: OP })).storage.upload(path, Uint8Array.of(1))).toBe('created');
    expect(await bucket(() => json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })).storage.upload(path, Uint8Array.of(1))).toBe('exists');
    expect(await bucket(() => json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })).storage.upload(path, Uint8Array.of(1))).toBe('exists');
    for (const answer of [
      () => json(500, { statusCode: '500', message: 'The resource already exists' }),
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
      () => json(404, notFound),
    ]) {
      await expect(bucket(answer).storage.upload(path, Uint8Array.of(1))).rejects.toThrow('Storage indisponível');
    }
  });

  it('remove: any error throws', async () => {
    await expect(bucket(() => json(200, [])).storage.remove(path)).resolves.toBeUndefined();
    await expect(bucket(() => json(500, { statusCode: '500', message: 'internal' })).storage.remove(path)).rejects.toThrow('Storage indisponível');
  });
});

describe('request bodies (Codex 05/11 05:09, R5)', () => {
  const signUrl = 'https://edge.invalid/functions/v1/sign-document';
  /** A body streamed in 4 KiB chunks, counting pulls and cancellation. */
  function streamed(chunks: Uint8Array[]) {
    const seen = { pulled: 0, cancelled: false };
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { seen.pulled++; if (i < chunks.length) controller.enqueue(chunks[i++]); else controller.close(); },
      cancel() { seen.cancelled = true; },
    });
    return { body, seen };
  }
  const postStream = (url: string, body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    new Request(url, { method: 'POST', body, headers: { Authorization: 'Bearer synthetic', ...headers }, duplex: 'half' } as RequestInit);

  it('stops reading a streamed body past 8 KiB without Content-Length, cancels it and calls nothing', async () => {
    const { body, seen } = streamed(Array.from({ length: 25 }, () => new Uint8Array(4096).fill(0x20))); // 100 KiB
    const { deps } = makeDeps();
    const response = await signDocumentHandler(postStream(signUrl, body), deps);
    expect(response.status).toBe(400);
    expect(seen.cancelled).toBe(true);
    expect(seen.pulled).toBeLessThanOrEqual(4);
    expect(deps.rpc).not.toHaveBeenCalled();
    expect(deps.prescription).not.toHaveBeenCalled();
    expect(deps.sign).not.toHaveBeenCalled();
  });

  it('refuses a declared Content-Length over the limit before reading', async () => {
    const { body, seen } = streamed([new Uint8Array(4096)]);
    const { deps } = makeDeps();
    const response = await signDocumentHandler(postStream(signUrl, body, { 'Content-Length': String(100 * 1024) }), deps);
    expect(response.status).toBe(400);
    expect(seen.pulled).toBeLessThanOrEqual(1);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('the session complete route has the same limit, before consuming the state', async () => {
    const { body, seen } = streamed(Array.from({ length: 25 }, () => new Uint8Array(4096).fill(0x20)));
    const { deps } = makeDeps();
    const response = await signatureSessionHandler(postStream('https://edge.invalid/functions/v1/signature-session/complete', body), deps);
    expect(response.status).toBe(400);
    expect(seen.cancelled).toBe(true);
    expect(deps.rpc).not.toHaveBeenCalled();
    expect(deps.psc.exchangeCode).not.toHaveBeenCalled();
  });

  it('reads a small body streamed in pieces (control) and refuses invalid UTF-8', async () => {
    const text = new TextEncoder().encode(JSON.stringify(signBody));
    const { body } = streamed([text.subarray(0, 10), text.subarray(10)]);
    const ok = makeDeps();
    expect((await signDocumentHandler(postStream(signUrl, body), ok.deps)).status).toBe(200);
    // Invalid UTF-8 inside a field that would pass once replaced by U+FFFD.
    const bad = makeDeps();
    const raw = new TextEncoder().encode(JSON.stringify({ code: 'cX', state: 'x'.repeat(43) }));
    raw[raw.indexOf(0x58)] = 0xff; // the "X" becomes a lone 0xFF byte
    const invalid = streamed([raw]);
    const response = await signatureSessionHandler(postStream('https://edge.invalid/functions/v1/signature-session/complete', invalid.body), bad.deps);
    expect(response.status).toBe(400);
    expect(bad.deps.rpc).not.toHaveBeenCalled();
  });
});

describe('server configuration', () => {
  const env = (over: Record<string, string | undefined> = {}) => (name: string) => ({
    SIGNATURE_PSC_BASE_URL: 'https://psc.synthetic.invalid/', SIGNATURE_PSC_CLIENT_ID: 'id', SIGNATURE_PSC_CLIENT_SECRET: 's',
    SIGNATURE_PSC_REDIRECT_URI: 'https://cortex.synthetic.invalid/assinatura/retorno',
    SIGNATURE_TOKEN_KEYS: `k1:${Buffer.from(new Uint8Array(32).fill(5)).toString('base64')}`, SIGNATURE_POLICY_SHA256: '07'.repeat(32), ...over,
  } as Record<string, string | undefined>)[name];

  it('reads a complete configuration and refuses anything missing or unsafe', () => {
    const config = readSignatureConfig(env(), parseKeyList)!;
    expect(config.psc.baseUrl).toBe('https://psc.synthetic.invalid/');
    expect(config.policy.oid).toBe(AD_RB_V1_1);
    expect(hex(config.policy.hash)).toBe('07'.repeat(32));
    for (const over of [
      { SIGNATURE_PSC_BASE_URL: undefined }, { SIGNATURE_PSC_BASE_URL: 'http://psc.synthetic.invalid/' },
      { SIGNATURE_PSC_BASE_URL: 'https://psc.synthetic.invalid/v0' }, { SIGNATURE_PSC_REDIRECT_URI: 'http://x.invalid/' },
      { SIGNATURE_POLICY_SHA256: 'abc' }, { SIGNATURE_TOKEN_KEYS: 'bad' }, { SIGNATURE_PSC_CLIENT_SECRET: '' },
    ]) {
      expect(readSignatureConfig(env(over), parseKeyList)).toBeNull();
    }
  });
});
