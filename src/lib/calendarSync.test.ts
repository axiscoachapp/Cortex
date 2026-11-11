// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as cors from '../../supabase/functions/_shared/cors';
import * as oauth from '../../supabase/functions/_shared/oauth';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEYS = `k1:${btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))}`;
const keyList = oauth.googleTokenKeys(KEYS);
let sealed: { google_refresh_token: string; google_access_token: string; google_token_expiry: string };
beforeAll(async () => {
  sealed = {
    google_refresh_token: await oauth.sealGoogleToken(keyList, 'refresh-test', OWNER, 'refresh'),
    google_access_token: await oauth.sealGoogleToken(keyList, 'access-test', OWNER, 'access'),
    google_token_expiry: '2099-01-01',
  };
});

type Integration = Record<string, unknown>;
function setup(row: Record<string, unknown> | null, response: Response, opts: { integration?: Integration; env?: Record<string, string | undefined> } = {}) {
  const network = vi.fn(async (_input: string, _init?: RequestInit) => response);
  const rpc = vi.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => name === 'claim_calendar_sync'
    ? { data: { claim: 'claim', appointment: { ...row, google_sync_revision: 0 } }, error: null }
    : { data: true, error: null });
  const integration: Integration = { ...(opts.integration ?? sealed) };
  const integrationWrites: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      single: async () => ({ data: integration, error: null }),
      update: (value: Record<string, unknown>) => {
        patch = value;
        if (table === 'user_integrations') integrationWrites.push({ patch: value, filters });
        else if (row) Object.assign(row, value);
        return query;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'user_integrations' && patch) Object.assign(integration, patch);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return query;
  };
  const env: Record<string, string | undefined> = { GOOGLE_TOKEN_KEYS: KEYS, GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', ALLOWED_ORIGIN: 'https://cortex.example', ...(opts.env ?? {}) };
  const source = readFileSync(new URL('../../supabase/functions/sync-google-calendar/index.ts', import.meta.url),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let handler: (request: Request) => Promise<Response>;
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof handler) => {handler=fn;} };
    if (id.includes('@supabase/supabase-js')) return {createClient:()=>({from,rpc})};
    if (id.endsWith('/auth.ts')) return { requireUser:async()=>({userId:OWNER}), AuthError:class extends Error {} };
    if (id.endsWith('/http.ts')) return {...http,fetchWithDeadline:network};
    if (id.endsWith('/cors.ts')) return cors;
    if (id.endsWith('/oauth.ts')) return oauth;
    throw new Error(id);
  };
  new Function('require','exports','Deno','fetch',compiled)(require,{}, {env:{get:(key: string)=> env[key]}},network);
  return {network, rpc, row, integration, integrationWrites, call: (action = 'delete') => handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action,appointment:{id:'appt',google_event_id:'foreign/event'}})}))};
}

describe('Google Calendar mutation boundaries',()=>{
  it('never accepts a body event id when the owned appointment is missing',async()=>{
    const test=setup(null,new Response(null,{status:204}));
    expect((await test.call()).status).toBe(404);
    expect(test.network).not.toHaveBeenCalled();
  });
  it('surfaces a provider deletion failure instead of reporting success',async()=>{
    const test=setup({id:'appt',google_event_id:'owned'},new Response('private provider detail',{status:503}));
    const response=await test.call();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private provider detail');
  });
  it('treats an already deleted provider event as successfully removed',async()=>{
    const test=setup({id:'appt',google_event_id:'owned'},new Response(null,{status:410}));
    expect((await test.call()).status).toBe(200);
    // The sealed access token was opened and sent; nothing was rewritten.
    expect(test.network.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer access-test' });
    expect(test.integrationWrites).toEqual([]);
  });
  it('rejects unknown actions before any Google request',async()=>{
    const test=setup({id:'appt',google_event_id:'owned'},new Response(null,{status:204}));
    expect((await test.call('destroy-everything')).status).toBe(400);
    expect(test.network).not.toHaveBeenCalled();
  });
  it('retains creation identity before a successful provider response is lost, then updates it on retry', async () => {
    const test = setup({ id: 'appt', google_event_id: null }, new Response('{}'));
    test.network.mockImplementationOnce(async () => { throw new Error('Response lost after provider creation'); });
    expect((await test.call('create')).status).toBe(500);
    const createdId = test.row!.google_event_id;
    expect(createdId).toMatch(/^[a-f0-9]{32}$/);
    expect((await test.call('create')).status).toBe(200);
    expect(test.network.mock.calls).toHaveLength(2);
    expect(test.network.mock.calls[1][0]).toContain(createdId);
    expect(test.network.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
  });
  it('denies a concurrent sync attempt before touching Google', async () => {
    const test = setup({ id: 'appt', google_event_id: null }, new Response('{}'));
    test.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await test.call('create')).status).toBe(409);
    expect(test.network).not.toHaveBeenCalled();
  });
});

describe('Google tokens at rest (finding 10)', () => {
  it('answers "not configured" without the token key, before claiming or calling Google', async () => {
    for (const value of [undefined, '', 'k1:short', 'not a key list']) {
      const test = setup({ id: 'appt', google_event_id: 'owned' }, new Response(null, { status: 204 }), { env: { GOOGLE_TOKEN_KEYS: value } });
      const response = await test.call('update');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'not_configured', error: expect.stringContaining('equipe Cortex') });
      expect(test.rpc).not.toHaveBeenCalled();
      expect(test.network).not.toHaveBeenCalled();
    }
  });
  it('reads a legacy plaintext row, refreshes it and stores both tokens sealed', async () => {
    const test = setup({ id: 'appt', google_event_id: 'owned' }, new Response(null, { status: 204 }), {
      integration: { google_refresh_token: '1//legacy-refresh', google_access_token: 'legacy-access', google_token_expiry: '2099-01-01' },
    });
    test.network.mockImplementationOnce(async () => new Response(JSON.stringify({ access_token: 'fresh-access', expires_in: 3600 })));
    expect((await test.call('delete')).status).toBe(200);
    const refresh = test.network.mock.calls[0];
    expect(refresh[0]).toBe('https://oauth2.googleapis.com/token');
    expect(String(refresh[1]?.body)).toContain('refresh_token=1%2F%2Flegacy-refresh');
    expect(test.network.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer fresh-access' });
    expect(test.integrationWrites).toHaveLength(1);
    const { patch, filters } = test.integrationWrites[0];
    expect(JSON.stringify(patch)).not.toMatch(/legacy-refresh|fresh-access/);
    expect(oauth.isSealedGoogleToken(patch.google_refresh_token)).toBe(true);
    expect(await oauth.openGoogleToken(keyList, patch.google_refresh_token, OWNER, 'refresh')).toBe('1//legacy-refresh');
    expect(await oauth.openGoogleToken(keyList, patch.google_access_token, OWNER, 'access')).toBe('fresh-access');
    // Written only over the value read, so a reconnection in between is not overwritten.
    expect(filters).toContainEqual(['google_refresh_token', '1//legacy-refresh']);
  });
  it('keeps a rotated refresh token, sealed', async () => {
    const test = setup({ id: 'appt', google_event_id: 'owned' }, new Response(null, { status: 204 }), {
      integration: { ...sealed, google_token_expiry: '2000-01-01' },
    });
    test.network.mockImplementationOnce(async () => new Response(JSON.stringify({ access_token: 'fresh-access', refresh_token: 'rotated', expires_in: 3600 })));
    expect((await test.call('delete')).status).toBe(200);
    expect(String(test.network.mock.calls[0][1]?.body)).toContain('refresh_token=refresh-test');
    expect(await oauth.openGoogleToken(keyList, test.integrationWrites[0].patch.google_refresh_token, OWNER, 'refresh')).toBe('rotated');
  });
  it('refuses a sealed token bound to another account and asks to reconnect', async () => {
    const foreign = await oauth.sealGoogleToken(keyList, 'someone-else', OTHER, 'refresh');
    const test = setup({ id: 'appt', google_event_id: 'owned' }, new Response(null, { status: 204 }), {
      integration: { ...sealed, google_refresh_token: foreign },
    });
    const response = await test.call('delete');
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Reconecte');
    expect(test.network).not.toHaveBeenCalled();
  });
  it('does not open an access token sealed as a refresh token', async () => {
    const refresh = await oauth.sealGoogleToken(keyList, 'x', OWNER, 'refresh');
    await expect(oauth.openGoogleToken(keyList, refresh, OWNER, 'access')).rejects.toThrow();
    await expect(oauth.openGoogleToken(oauth.googleTokenKeys(`k2:${btoa('k'.repeat(32))}`), refresh, OWNER, 'refresh')).rejects.toThrow();
    expect(await oauth.openGoogleToken(keyList, null, OWNER, 'refresh')).toBeNull();
  });
});
