// Edge handlers of the digital signature (D17) with injected dependencies.
// Synthetic only: the PSC, Storage and database are fakes; no real provider,
// certificate or deploy.
import { describe, expect, it, vi } from 'vitest';
import { AD_RB_V1_1, sha256 } from '../../supabase/functions/_shared/pades';
import { base64url, openSecret, parseKeyList, tokenBinding, verifierBinding, type SealedSecret } from '../../supabase/functions/_shared/psc';
import {
  readSignatureConfig, signDocumentHandler, signatureSessionHandler, type HandlerDeps, type SignerContext,
} from '../../supabase/functions/_shared/signatureHandlers';
import type { SignatureOutcome, SignaturePorts, SignatureRequest } from '../../supabase/functions/_shared/signatureFlow';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const RX = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-11-05T12:00:00Z');
const keys = parseKeyList(`k1:${Buffer.from(new Uint8Array(32).fill(5)).toString('base64')}`);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

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
      discovery: vi.fn(async () => [{ alias: 'a', certificate: new Uint8Array([9, 9, 9]), chain: [] }]),
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

  it('state and revoke need only a valid bearer (aal1 included)', async () => {
    const { deps, calls } = makeDeps({ ctx: { aal: 'aal1' } });
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
    expect(activate.p_cert_sha256).toBe(hex(await sha256(new Uint8Array([9, 9, 9]))));
    expect(await openSecret(keys, activate.p_token as SealedSecret, tokenBinding(activate.p_session as string, USER, 1))).toBe('synthetic-psc-token');
    expect(Date.parse(activate.p_expires_at as string)).toBeLessThanOrEqual(NOW + 12 * 3600_000);
    expect(activate.p_auth).toMatchObject({ sessionId: SESSION, aal: 'aal2' });
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
