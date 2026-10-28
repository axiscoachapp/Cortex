// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';

async function invoke(key: string | undefined, token?: string) {
  let handler: (request:Request)=>Promise<Response>;
  const fetch = vi.fn(async()=>{throw new Error('Network must not be reached');});
  const require = (id:string) => {
    if(id.includes('/http/server.ts')) return {serve:(fn:typeof handler)=>{handler=fn;}};
    if(id.includes('@supabase/supabase-js')) return {createClient:()=>{throw new Error('Database must not be reached');}};
    if(id.endsWith('/http.ts')) return {...http,fetchWithDeadline:fetch};
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
});
