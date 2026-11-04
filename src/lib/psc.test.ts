// DOC-ICP-17.01 client against an in-memory fake PSC (D17). Synthetic only:
// the doctor's key and certificate are generated for each run; the fake PSC
// signs a bare SHA-256 hash with raw RSA, as a real PSC does with RAW.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_SESSION_SECONDS, PscAmbiguousError, PscRejectedError, authorizeUrl, base64url, certificateDiscovery, exchangeCode,
  newState, openSecret, parseKeyList, pkcePair, sealSecret, signHash, stateHash, tokenBinding, verifierBinding, type PscConfig,
} from '../../supabase/functions/_shared/psc';
import { AD_RB_V1_1, DER, finalizePades, preparePades, tlv, verifyRawSignature } from '../../supabase/functions/_shared/pades';

const cfg: PscConfig = { id: 'vidaas', baseUrl: 'https://psc.synthetic.invalid/', clientId: 'cortex-test', clientSecret: 'synthetic-secret', redirectUri: 'https://cortex.synthetic.invalid/assinatura/retorno' };
const CPF = '52998224725';
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' } as const;

const big = (b64url: string) => BigInt('0x' + Buffer.from(b64url, 'base64url').toString('hex'));
function modPow(base: bigint, exp: bigint, mod: bigint) {
  let result = 1n;
  for (base %= mod; exp > 0n; exp >>= 1n, base = (base * base) % mod) if (exp & 1n) result = (result * base) % mod;
  return result;
}
/** PKCS#1 v1.5 signature of an already computed SHA-256 hash (what a PSC does for RAW). */
function rawRsaSign(jwk: JsonWebKey, hash: Uint8Array): Uint8Array {
  const n = big(jwk.n!);
  const k = (n.toString(16).length + 1) >> 1;
  const digestInfo = Buffer.concat([Buffer.from('3031300d060960864801650304020105000420', 'hex'), Buffer.from(hash)]);
  const em = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(k - digestInfo.length - 3, 0xff), Buffer.from([0]), digestInfo]);
  const s = modPow(BigInt('0x' + em.toString('hex')), big(jwk.d!), n);
  return Uint8Array.from(Buffer.from(s.toString(16).padStart(k * 2, '0'), 'hex'));
}

let doctorJwk: JsonWebKey;
let doctorKey: CryptoKeyPair;
let doctorCert: Uint8Array;

beforeAll(async () => {
  doctorKey = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  doctorJwk = await crypto.subtle.exportKey('jwk', doctorKey.privateKey);
  const name = (cn: string) => DER.seq(DER.setOf(DER.seq(DER.oid('2.5.4.3'), DER.utf8(cn))));
  const alg = DER.seq(DER.oid('1.2.840.113549.1.1.11'), DER.null);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', doctorKey.publicKey));
  const tbs = DER.seq(DER.ctx(0, DER.int(2)), DER.int(99), alg, name('AC Sintética'), DER.seq(DER.utcTime(new Date('2026-01-01')), DER.utcTime(new Date('2027-01-01'))), name(`Médica Sintética:${CPF}`), spki);
  doctorCert = DER.seq(tbs, alg, tlv(0x03, Uint8Array.of(0), new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', doctorKey.privateKey, tbs))));
}, 30_000);

/** Fake PSC: checks PKCE, issues one token, signs RAW hashes; behaviour switches per test. */
function fakePsc(opts: { cpf?: string; expiresIn?: number; loseSignatureAnswer?: boolean; wrongSignature?: boolean } = {}) {
  const codes = new Map<string, string>(); // code -> challenge
  const tokens = new Set<string>();
  const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
  let signatures = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const authorize = (challenge: string) => { const code = `code-${codes.size}`; codes.set(code, challenge); return code; };
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    requests.push({ url: input, method: init.method ?? 'GET', headers, body: String(init.body ?? '') });
    const bearer = (headers.authorization ?? '').replace(/^Bearer /, '');
    if (url.pathname === '/oauth/token') {
      const form = new URLSearchParams(String(init.body));
      const challenge = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? ''); // single use
      const verifierHash = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? ''))));
      if (!challenge || challenge !== verifierHash || form.get('client_secret') !== cfg.clientSecret || form.get('redirect_uri') !== cfg.redirectUri) return json(400, { error: 'invalid_grant' });
      const token = `tok-${tokens.size}-${crypto.randomUUID()}`;
      tokens.add(token);
      return json(200, { access_token: token, token_type: 'Bearer', expires_in: opts.expiresIn ?? 43200, authorized_identification_type: 'CPF', authorized_identification: opts.cpf ?? CPF });
    }
    if (!tokens.has(bearer)) return json(401, { error: 'invalid_token' });
    if (url.pathname === '/oauth/certificate-discovery') return json(200, { status: 'S', certificates: [{ alias: 'vidaas-1', certificate: Buffer.from(doctorCert).toString('base64') }] });
    if (url.pathname === '/oauth/signature') {
      const request = JSON.parse(String(init.body)) as { hashes: Array<{ id: string; hash: string; hash_algorithm: string; signature_format: string }> };
      signatures++;
      if (opts.loseSignatureAnswer) throw new TypeError('connection reset after the PSC signed');
      return json(200, {
        signatures: request.hashes.map((h) => {
          expect(h.signature_format).toBe('RAW');
          expect(h.hash_algorithm).toBe('2.16.840.1.101.3.4.2.1');
          const raw = rawRsaSign(doctorJwk, Uint8Array.from(Buffer.from(h.hash, 'base64')));
          if (opts.wrongSignature) raw[5] ^= 0xff;
          return { id: h.id, raw_signature: Buffer.from(raw).toString('base64') };
        }),
      });
    }
    return json(404, {});
  };
  return { fetchImpl, authorize, revoke: () => tokens.clear(), requests, signatures: () => signatures };
}

async function session(psc = fakePsc()) {
  const { verifier, challenge } = await pkcePair();
  const code = psc.authorize(challenge);
  return { psc, verifier, ...(await exchangeCode(cfg, { code, codeVerifier: verifier, now: new Date('2026-11-04T12:00:00Z') }, psc.fetchImpl)) };
}

describe('authorization URL', () => {
  it('asks for a signature session with PKCE S256 and at most 12 hours', async () => {
    const { challenge } = await pkcePair();
    const url = new URL(authorizeUrl(cfg, { state: newState(), codeChallenge: challenge, lifetimeSeconds: 8 * 3600 }));
    expect(url.origin + url.pathname).toBe('https://psc.synthetic.invalid/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', scope: 'signature_session', code_challenge_method: 'S256', lifetime: '28800', redirect_uri: cfg.redirectUri });
    expect(() => authorizeUrl(cfg, { state: 's', codeChallenge: challenge, lifetimeSeconds: MAX_SESSION_SECONDS + 1 })).toThrow('12 horas');
    expect(() => authorizeUrl({ ...cfg, baseUrl: 'http://psc.synthetic.invalid/' }, { state: 's', codeChallenge: challenge, lifetimeSeconds: 3600 })).toThrow('HTTPS');
    expect(() => authorizeUrl({ ...cfg, baseUrl: 'https://psc.synthetic.invalid/x?y' }, { state: 's', codeChallenge: challenge, lifetimeSeconds: 3600 })).toThrow('origem');
  });
});

describe('token exchange', () => {
  it('returns the token, the authorized CPF and caps the session at 12 hours', async () => {
    const s = await session(fakePsc({ expiresIn: 7 * 24 * 3600 }));
    expect(s.authorizedCpf).toBe(CPF);
    expect(s.expiresAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });

  it('refuses a wrong PKCE verifier and a reused code', async () => {
    const psc = fakePsc();
    const { challenge } = await pkcePair();
    const code = psc.authorize(challenge);
    await expect(exchangeCode(cfg, { code, codeVerifier: 'wrong' }, psc.fetchImpl)).rejects.toBeInstanceOf(PscRejectedError);
    await expect(exchangeCode(cfg, { code, codeVerifier: 'wrong' }, psc.fetchImpl)).rejects.toThrow('400');
  });

  it('refuses a session without an 11-digit CPF', async () => {
    await expect(session(fakePsc({ cpf: '123' }))).rejects.toThrow('CPF');
  });
});

describe('signing a PDF through the fake PSC', () => {
  it('discovers the certificate, signs the RAW hash and the result verifies like a local signature', async () => {
    const s = await session();
    const [found] = await certificateDiscovery(cfg, s.accessToken, s.psc.fetchImpl);
    expect(found.certificate).toEqual(doctorCert);
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>'];
    let body = '%PDF-1.7\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    body += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`;
    const full = Uint8Array.from(body, (c) => c.charCodeAt(0));
    const prepared = await preparePades(full, { certificate: found.certificate, policy: { oid: AD_RB_V1_1, hash: new Uint8Array(32).fill(3) }, signingTime: new Date() });
    const raw = await signHash(cfg, s.accessToken, { id: 'op-1', hash: prepared.toBeSignedHash }, s.psc.fetchImpl);
    // RSA PKCS#1 v1.5 is deterministic: the PSC's RAW signature equals signing the attributes locally.
    expect(raw).toEqual(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', doctorKey.privateKey, prepared.signedAttributes)));
    expect(await verifyRawSignature(found.certificate, prepared.signedAttributes, raw)).toBe(true);
    expect(finalizePades(prepared, raw).length).toBe(prepared.pdf.length);
    // The token only travels as a Bearer header; the hash goes, the PDF never does.
    const signCall = s.psc.requests.find((r) => r.url.endsWith('/oauth/signature'))!;
    expect(signCall.headers.authorization).toBe(`Bearer ${s.accessToken}`);
    expect(signCall.body).not.toContain('%PDF');
  });

  it('marks a lost answer as ambiguous, without retrying', async () => {
    const s = await session(fakePsc({ loseSignatureAnswer: true }));
    await expect(signHash(cfg, s.accessToken, { id: 'op-2', hash: new Uint8Array(32) }, s.psc.fetchImpl)).rejects.toBeInstanceOf(PscAmbiguousError);
    expect(s.psc.signatures()).toBe(1);
  });

  it('lets the caller catch a signature that does not match the certificate', async () => {
    const s = await session(fakePsc({ wrongSignature: true }));
    const data = new Uint8Array([1, 2, 3]);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const raw = await signHash(cfg, s.accessToken, { id: 'op-3', hash }, s.psc.fetchImpl);
    expect(await verifyRawSignature(doctorCert, data, raw)).toBe(false);
  });

  it('refuses a revoked token', async () => {
    const s = await session();
    s.psc.revoke();
    await expect(signHash(cfg, s.accessToken, { id: 'op-4', hash: new Uint8Array(32) }, s.psc.fetchImpl)).rejects.toThrow('401');
    await expect(certificateDiscovery(cfg, s.accessToken, s.psc.fetchImpl)).rejects.toThrow('401');
  });
});

describe('sealed secrets (AES-256-GCM, versioned bindings)', () => {
  const SESSION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const b64 = (fill: number) => Buffer.from(new Uint8Array(32).fill(fill)).toString('base64');
  const keys = parseKeyList(`k2:${b64(9)},k1:${b64(8)}`);

  it('reads the server key list: first key seals, older keys only open, malformed lists refused', () => {
    expect(keys.current).toBe('k2');
    expect(Object.keys(keys.keys)).toEqual(['k2', 'k1']);
    expect(() => parseKeyList('')).toThrow('Nenhuma chave');
    expect(() => parseKeyList(`k1:${Buffer.from(new Uint8Array(16)).toString('base64')}`)).toThrow('inválida');
    expect(() => parseKeyList(`K 1:${b64(1)}`)).toThrow('inválida');
    expect(() => parseKeyList(`k1:${b64(1)},k1:${b64(2)}`)).toThrow('inválida');
  });

  it('opens a token only for the same session, account and generation, with a listed key', async () => {
    const binding = tokenBinding(SESSION, USER, 1);
    const sealed = await sealSecret(keys, 'token-sintetico', binding);
    expect(sealed).toMatchObject({ v: 1, keyId: 'k2' });
    expect(sealed.ciphertext).not.toContain('token-sintetico');
    expect(await openSecret(keys, sealed, binding)).toBe('token-sintetico');
    await expect(openSecret(keys, sealed, tokenBinding(SESSION, USER, 2))).rejects.toThrow('inválido');
    await expect(openSecret(parseKeyList(`k2:${b64(7)}`), sealed, binding)).rejects.toThrow('inválido');
    await expect(openSecret(parseKeyList(`k1:${b64(8)}`), sealed, binding)).rejects.toThrow('não está mais autorizada');
    await expect(openSecret(keys, { ...sealed, keyId: '__proto__' }, binding)).rejects.toThrow();
    await expect(openSecret(keys, { ...sealed, v: 2 as 1 }, binding)).rejects.toThrow('formato');
    const tampered = { ...sealed, ciphertext: sealed.ciphertext.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(openSecret(keys, tampered, binding)).rejects.toThrow('inválido');
  });

  it('keeps rotation working: a secret sealed with an older listed key still opens', async () => {
    const old = await sealSecret(parseKeyList(`k1:${b64(8)}`), 'antigo', tokenBinding(SESSION, USER, 3));
    expect(await openSecret(keys, old, tokenBinding(SESSION, USER, 3))).toBe('antigo');
  });

  it('never opens a token as an OAuth verifier, and uses a fresh nonce every time', async () => {
    const hash = await stateHash(newState());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const verifier = await sealSecret(keys, 'verificador', verifierBinding(hash, USER, 'vidaas'));
    expect(await openSecret(keys, verifier, verifierBinding(hash, USER, 'vidaas'))).toBe('verificador');
    await expect(openSecret(keys, verifier, tokenBinding(SESSION, USER, 1))).rejects.toThrow('inválido');
    await expect(openSecret(keys, verifier, verifierBinding(hash, USER, 'birdid'))).rejects.toThrow('inválido');
    const again = await sealSecret(keys, 'verificador', verifierBinding(hash, USER, 'vidaas'));
    expect(again.nonce).not.toBe(verifier.nonce);
    expect(() => tokenBinding('nao-uuid', USER, 1)).toThrow('inválido');
    expect(() => tokenBinding(SESSION, USER, 0)).toThrow('inválido');
  });
});
