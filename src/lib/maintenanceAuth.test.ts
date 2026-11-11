// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as secrets from '../../supabase/functions/_shared/secrets';

async function invoke(key: string | undefined, token?: string) {
  let handler: (request:Request)=>Promise<Response>;
  const fetch = vi.fn(async()=>{throw new Error('Network must not be reached');});
  const require = (id:string) => {
    if(id.includes('/http/server.ts')) return {serve:(fn:typeof handler)=>{handler=fn;}};
    if(id.includes('@supabase/supabase-js')) return {createClient:()=>{throw new Error('Database must not be reached');}};
    if(id.endsWith('/http.ts')) return {...http,fetchWithDeadline:fetch};
    if(id.endsWith('/secrets.ts')) return secrets;
    throw new Error(id);
  };
  const source=readFileSync(new URL('../../supabase/functions/refresh-medication-catalog/index.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','Deno','fetch',compiled)(require,{}, {env:{get:()=>key}},fetch);
  return handler(new Request('https://test.invalid',{headers:token?{Authorization:`Bearer ${token}`}:{}}));
}
describe('maintenance authentication',()=>{
  it('fails closed when the service secret is missing',async()=>{
    expect((await invoke(undefined)).status).toBe(401);
  });
  it('rejects an unsigned role claim instead of trusting a decoded JWT payload',async()=>{
    const forged='e30.'+btoa(JSON.stringify({role:'service_role'}))+'.fake';
    expect((await invoke('actual-test-key',forged)).status).toBe(401);
  });
  it('accepts only the exact configured key, compared in constant time',async()=>{
    const key='synthetic-service-key-'+'x'.repeat(40);
    // Past authentication the handler tries the download, which the stub refuses (500, not 401).
    expect((await invoke(key,key)).status).toBe(500);
    for(const wrong of [key.slice(0,-1),key+'y',key.toUpperCase(),'',key+' extra'])
      expect((await invoke(key,wrong)).status).toBe(401);
  });
  it('fails closed when the configured key is too short to be a real service key',async()=>{
    expect((await invoke('short-key','short-key')).status).toBe(401);
  });
});
