// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';

function setup(row: Record<string, unknown> | null, response: Response) {
  const network = vi.fn(async (_input: string, _init?: RequestInit) => response);
  const rpc = vi.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => name === 'claim_calendar_sync'
    ? { data: { claim: 'claim', appointment: { ...row, google_sync_revision: 0 } }, error: null }
    : { data: true, error: null });
  const query = {
    select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
    single: async () => ({ data: { google_refresh_token:'test', google_access_token:'test', google_token_expiry:'2099-01-01' }, error:null }),
    update: (patch: Record<string, unknown>) => { if (row) Object.assign(row, patch); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({data:[],error:null}).then(resolve),
  };
  const source = readFileSync(new URL('../../supabase/functions/sync-google-calendar/index.ts', import.meta.url),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let handler: (request: Request) => Promise<Response>;
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof handler) => {handler=fn;} };
    if (id.includes('@supabase/supabase-js')) return {createClient:()=>({from:()=>query,rpc})};
    if (id.endsWith('/auth.ts')) return { requireUser:async()=>({userId:'owner'}), AuthError:class extends Error {} };
    if (id.endsWith('/http.ts')) return {...http,fetchWithDeadline:network};
    throw new Error(id);
  };
  new Function('require','exports','Deno','fetch',compiled)(require,{}, {env:{get:()=> 'synthetic'}},network);
  return {network, rpc, row, call: (action = 'delete') => handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action,appointment:{id:'appt',google_event_id:'foreign/event'}})}))};
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
