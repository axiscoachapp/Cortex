// @vitest-environment node
// Security review hardening, round 2 (findings 7, 9, 10, 12 of docs/reviews/2026-11-10/revisao-geral/relatorios/seguranca-privacidade.md).
// The real Edge handlers run with the database, Auth and network replaced by fakes.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as storage from '../../supabase/functions/_shared/storage';
import * as deletion from '../../supabase/functions/_shared/deletion';
import * as cors from '../../supabase/functions/_shared/cors';
import * as oauth from '../../supabase/functions/_shared/oauth';
import * as secrets from '../../supabase/functions/_shared/secrets';
import { webhookHandler, type WhatsAppDeps } from '../../supabase/functions/_shared/whatsappHandlers';

const USER = '11111111-1111-4111-8111-111111111111';
const KEYS = `k1:${btoa(String.fromCharCode(...new Uint8Array(32).fill(3)))}`;
const ORIGIN = 'https://cortex.example';
const REDIRECT = `${ORIGIN}/google-oauth-callback`;

type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const writes: Array<{ table: string; value: Row }> = [];
  const rpc = vi.fn(async (name: string, _args?: Row) => ({ data: name === 'consume_google_oauth_transaction' ? 'verifier' : true as unknown, error: null }));
  const deleteUser = vi.fn(async () => ({ data: null, error: null }));
  const getUserById = vi.fn(async () => ({ data: { user: { id: USER, last_sign_in_at: new Date().toISOString() } }, error: null }));
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let write: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q, order: () => q, range: () => q, limit: () => q, is: () => q, in: () => q, delete: () => q,
      eq: (field: string, value: unknown) => { filters.push((r) => r[field] === value); return q; },
      insert: (value: Row) => { write = value; return q; },
      upsert: (value: Row) => { write = value; return q; },
      update: (value: Row) => { write = value; return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (write) { writes.push({ table, value: write }); (tables[table] ??= []).push(write); }
        return Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve);
      },
    };
    return q;
  };
  const bucket = { list: vi.fn(async () => ({ data: [], error: null })), remove: vi.fn(async () => ({ data: [], error: null })) };
  return { tables, writes, rpc, deleteUser, getUserById, from, storage: { from: () => bucket }, auth: { admin: { deleteUser, getUserById } } };
}

function load(name: string, db: ReturnType<typeof fakeDb>, opts: { env?: Record<string, string | undefined>; network?: ReturnType<typeof vi.fn> } = {}) {
  const network = opts.network ?? vi.fn(async () => { throw new Error('Unexpected network request'); });
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_TOKEN_KEYS: KEYS, ALLOWED_ORIGIN: ORIGIN, ...(opts.env ?? {}),
  };
  const modules: Record<string, unknown> = {
    '../_shared/http.ts': { ...http, fetchWithDeadline: network },
    '../_shared/storage.ts': storage,
    '../_shared/deletion.ts': deletion,
    '../_shared/cors.ts': cors,
    '../_shared/oauth.ts': oauth,
    '../_shared/secrets.ts': secrets,
    '../_shared/providerFiles.ts': { retryProviderCleanup: async () => {} },
    '../_shared/auth.ts': { requireUser: async () => ({ userId: USER }), AuthError: class extends Error {}, authResponse: () => new Response(null, { status: 401 }) },
  };
  let handler!: (req: Request) => Promise<Response>;
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof handler) => { handler = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id in modules) return modules[id];
    throw new Error(`Unsupported test dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', 'fetch', compiled)(require, {}, { env: { get: (k: string) => env[k] } }, network);
  return { network, call: (req: Request) => handler(req) };
}

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bearer = (claims: Row) => ({ Authorization: `Bearer ${b64url({ alg: 'none' })}.${b64url(claims)}.sig` });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://edge.invalid', { method: 'POST', headers, body: JSON.stringify(body) });

describe('constant-time secret comparison (finding 9)', () => {
  it('matches only the exact value and fails closed for short or missing secrets', async () => {
    const key = 'k'.repeat(40);
    expect(await secrets.secretEquals(key, key)).toBe(true);
    for (const given of [key.slice(1), `${key}k`, 'K'.repeat(40), '', null, undefined, 42])
      expect(await secrets.secretEquals(key, given)).toBe(false);
    expect(await secrets.secretEquals('short', 'short')).toBe(false);
    expect(await secrets.secretEquals('', '')).toBe(false);
    expect(await secrets.secretEquals(undefined, undefined)).toBe(false);
    expect(await secrets.secretEquals('ABCD2345', 'ABCD2345', 8)).toBe(true);
    expect(await secrets.secretEquals('ABC', 'ABC', 8)).toBe(false);
  });
  it('reads only a well-formed bearer header', () => {
    expect(secrets.bearerToken('Bearer abc')).toBe('abc');
    expect(secrets.bearerToken('bearer abc')).toBe('abc');
    for (const h of [null, '', 'abc', 'Basic abc', 'Bearer a b']) expect(secrets.bearerToken(h)).toBe('');
  });
  it('compares the webhook verify token in constant time and refuses a short configured token', async () => {
    const deps = (verifyToken: string) => ({ config: { appSecret: 'app-secret', verifyToken, keys: null, webhookUrl: '' } }) as unknown as WhatsAppDeps;
    const url = (t: string) => `https://x/w?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=123`;
    const token = 'verify-token-0123456789';
    expect((await webhookHandler(new Request(url(token)), deps(token))).status).toBe(200);
    expect((await webhookHandler(new Request(url(token.slice(0, -1))), deps(token))).status).toBe(403);
    expect((await webhookHandler(new Request(url('short')), deps('short'))).status).toBe(403);
  });
  it('validates a prescription code case-insensitively and refuses a short stored code', async () => {
    const row = (secret_code: string) => ({ prescriptions: [{ id: USER, user_id: USER, secret_code, status: 'revoked' }] });
    // A matching code reaches the revoked branch (410); any mismatch is the same 404 as an unknown id.
    expect((await load('validate-prescription', fakeDb(row('ABCD2345'))).call(new Request(`https://e.invalid?id=${USER}&code=abcd2345`))).status).toBe(410);
    expect((await load('validate-prescription', fakeDb(row('ABCD2345'))).call(new Request(`https://e.invalid?id=${USER}&code=ABCD234`))).status).toBe(404);
    expect((await load('validate-prescription', fakeDb(row('ABC'))).call(new Request(`https://e.invalid?id=${USER}&code=ABC`))).status).toBe(404);
  });
});

describe('CORS fails closed (finding 7)', () => {
  it('allows only a plain configured origin', () => {
    expect(cors.allowedOrigin('https://app.example.com.br')).toBe('https://app.example.com.br');
    expect(cors.allowedOrigin('https://app.example.com.br/')).toBe('https://app.example.com.br');
    expect(cors.allowedOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    for (const bad of [undefined, null, '', '*', 'null', 'http://app.example.com.br', 'https://app.example.com.br/path',
      'https://user@app.example.com.br', 'https://app.example.com.br,https://evil.example', 'app.example.com.br'])
      expect(cors.allowedOrigin(bad)).toBeNull();
  });
  it('sends no Allow-Origin at all when the origin is not configured', async () => {
    expect(cors.corsHeadersFor(undefined)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(cors.corsHeadersFor('*')).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(cors.corsHeadersFor(ORIGIN, { 'Cache-Control': 'no-store' })).toMatchObject({ 'Access-Control-Allow-Origin': ORIGIN, 'Cache-Control': 'no-store', Vary: 'Origin' });
    for (const name of ['google-oauth-start', 'google-oauth-callback', 'sync-google-calendar', 'delete-user-data']) {
      const preflight = new Request('https://edge.invalid', { method: 'OPTIONS' });
      expect((await load(name, fakeDb(), { env: { ALLOWED_ORIGIN: undefined } }).call(preflight)).headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect((await load(name, fakeDb()).call(new Request('https://edge.invalid', { method: 'OPTIONS' }))).headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    }
  });
  it('derives the OAuth redirect only from a valid origin', () => {
    expect(oauth.configuredOAuthRedirects((k) => ({ ALLOWED_ORIGIN: `${ORIGIN}/` } as Record<string, string>)[k])).toEqual([REDIRECT]);
    expect(oauth.configuredOAuthRedirects((k) => (k === 'ALLOWED_ORIGIN' ? '*' : undefined))).toEqual([]);
    expect(oauth.configuredOAuthRedirects(() => undefined)).toEqual([]);
  });
});

describe('Google tokens are stored sealed (finding 10)', () => {
  const callbackBody = { code: 'google-code', state: 'a'.repeat(43), redirectUri: REDIRECT };
  it('seals both tokens on connection, bound to the account', async () => {
    const db = fakeDb();
    const network = vi.fn(async () => new Response(JSON.stringify({ refresh_token: '1//refresh', access_token: 'access', expires_in: 3600 })));
    const response = await load('google-oauth-callback', db, { network }).call(post(callbackBody));
    expect(response.status).toBe(200);
    const saved = db.writes.find((w) => w.table === 'user_integrations')!.value;
    expect(JSON.stringify(saved)).not.toMatch(/1\/\/refresh|"access"/);
    const keys = oauth.googleTokenKeys(KEYS);
    expect(await oauth.openGoogleToken(keys, saved.google_refresh_token, USER, 'refresh')).toBe('1//refresh');
    expect(await oauth.openGoogleToken(keys, saved.google_access_token, USER, 'access')).toBe('access');
    await expect(oauth.openGoogleToken(keys, saved.google_refresh_token, '22222222-2222-4222-8222-222222222222', 'refresh')).rejects.toThrow();
  });
  it('without GOOGLE_TOKEN_KEYS answers "not configured", keeps the attempt and stores nothing', async () => {
    for (const name of ['google-oauth-start', 'google-oauth-callback']) {
      const db = fakeDb();
      const { call, network } = load(name, db, { env: { GOOGLE_TOKEN_KEYS: undefined } });
      const response = await call(post(name === 'google-oauth-start' ? { redirectUri: REDIRECT } : callbackBody));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'not_configured' });
      expect(network).not.toHaveBeenCalled();
      expect(db.rpc).not.toHaveBeenCalled();
      expect(db.writes).toEqual([]);
    }
  });
});

describe('account deletion step-up uses this session (finding 12)', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const run = async (headers: Record<string, string>, seed: Record<string, Row[]> = {}, env: Record<string, string | undefined> = {}) => {
    const db = fakeDb(seed);
    const network = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await load('delete-user-data', db, { network, env }).call(post({ retentionAcknowledged: true }, headers));
    return { response, db, network };
  };
  it('accepts a password or second factor entered in this session within 10 minutes', async () => {
    for (const method of ['password', 'totp']) {
      const { response, db } = await run(bearer({ sub: USER, amr: [{ method, timestamp: now() - 60 }] }));
      expect(response.status).toBe(200);
      expect(db.deleteUser).toHaveBeenCalled();
    }
  });
  it('refuses an old session even when the account signed in a moment ago elsewhere', async () => {
    for (const headers of [
      bearer({ sub: USER, amr: [{ method: 'password', timestamp: now() - 11 * 60 }] }),
      bearer({ sub: USER, amr: [{ method: 'token_refresh', timestamp: now() }, { method: 'recovery', timestamp: now() }] }),
      bearer({ sub: '22222222-2222-4222-8222-222222222222', amr: [{ method: 'password', timestamp: now() }] }),
      bearer({ sub: USER }),
      {},
    ]) {
      const { response, db } = await run(headers);
      expect(response.status).toBe(403);
      expect((await response.json()).reauthRequired).toBe(true);
      expect(db.deleteUser).not.toHaveBeenCalled();
      expect(db.writes).toEqual([]);
    }
  });
  it('revokes a sealed Google token after opening it, and a legacy plaintext one as it is', async () => {
    const sealed = await oauth.sealGoogleToken(oauth.googleTokenKeys(KEYS), '1//sealed', USER, 'refresh');
    const fresh = bearer({ sub: USER, amr: [{ method: 'password', timestamp: now() }] });
    for (const [stored, plain] of [[sealed, '1//sealed'], ['1//legacy', '1//legacy']]) {
      const { response, network } = await run(fresh, { user_integrations: [{ user_id: USER, google_refresh_token: stored }] });
      expect(response.status).toBe(200);
      expect(String((network.mock.calls[0] as unknown[])[1] && ((network.mock.calls[0] as unknown[])[1] as RequestInit).body)).toBe(new URLSearchParams({ token: plain }).toString());
    }
    // A sealed token without the key cannot be revoked: the deletion stops and can be retried.
    const { response, db } = await run(fresh, { user_integrations: [{ user_id: USER, google_refresh_token: sealed }] }, { GOOGLE_TOKEN_KEYS: undefined });
    expect(response.status).toBe(503);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });
});
